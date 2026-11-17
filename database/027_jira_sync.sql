-- Phase 3: Jira Cloud two-way sync. Storage for the connection (one live connection per workspace), project
-- mappings, issue links, the durable inbound inbox and outbound outbox, field conflicts and user mappings.
-- Additive and idempotent. The runner executes one statement per semicolon inside one transaction, so there are
-- no DO blocks and comments stay on their own lines.
--
-- Nothing here changes existing tables. Jira never becomes a login: the "Jira Sync" user has no portal.

-- The non-login actor that inbound Jira changes are attributed to in history (activity, status_history, ...).
INSERT INTO bugflow.users (id, name, email, active)
VALUES ('00000000-0000-4000-8000-00006a697261', 'Jira Sync', 'jira-sync@bugflow.invalid', true)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS bugflow.integration_actors (
  user_id uuid PRIMARY KEY REFERENCES bugflow.users(id),
  kind text NOT NULL UNIQUE CHECK (kind IN ('jira')),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO bugflow.integration_actors (user_id, kind)
VALUES ('00000000-0000-4000-8000-00006a697261', 'jira')
ON CONFLICT DO NOTHING;

-- One row per Atlassian authorization. Tokens are AES-GCM ciphertext (key JIRA_TOKEN_ENCRYPTION_KEY, bound to the
-- row id); they are wiped on disconnect. token_generation + refresh_lease_until serialise the rotating refresh:
-- a refresh only saves when the generation it read is still current.
-- cloud_id is empty only while the Admin still has to choose between several sites (state 'pending_site').
CREATE TABLE IF NOT EXISTS bugflow.jira_connections (
  id uuid PRIMARY KEY,
  cloud_id text,
  site_url text,
  site_name text,
  authorized_account_id text,
  authorized_display_name text,
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  token_key_version smallint NOT NULL DEFAULT 1,
  token_generation integer NOT NULL DEFAULT 0,
  access_expires_at timestamptz,
  scopes text[] NOT NULL DEFAULT '{}',
  refresh_lease_until timestamptz,
  state text NOT NULL CHECK (state IN ('pending_site','connected','paused','reauthorization_required','revoked','error')),
  webhooks jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(webhooks) = 'array'),
  webhook_expires_at timestamptz,
  last_api_ok_at timestamptz,
  last_event_at timestamptz,
  last_reconciled_at timestamptz,
  last_error text,
  created_by uuid NOT NULL REFERENCES bugflow.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz,
  CHECK (state = 'pending_site' OR disconnected_at IS NOT NULL OR cloud_id IS NOT NULL)
);
-- One live connection per workspace: one Atlassian grant holds one rotating refresh token, so two live rows
-- would invalidate each other's tokens.
CREATE UNIQUE INDEX IF NOT EXISTS jira_connections_one_live ON bugflow.jira_connections ((true)) WHERE disconnected_at IS NULL;
CREATE INDEX IF NOT EXISTS jira_connections_webhook_expiry ON bugflow.jira_connections (webhook_expires_at) WHERE disconnected_at IS NULL AND webhook_expires_at IS NOT NULL;

-- Single-use OAuth "state" values, stored as hashes and bound to the Admin session that started the flow.
CREATE TABLE IF NOT EXISTS bugflow.jira_oauth_states (
  state_hash text PRIMARY KEY,
  admin_session_hash text NOT NULL,
  admin_user_id uuid NOT NULL REFERENCES bugflow.users(id),
  purpose text NOT NULL CHECK (purpose IN ('connect','reconnect')),
  redirect_uri text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jira_oauth_states_expiry ON bugflow.jira_oauth_states (expires_at);

-- BugFlow project <-> Jira project (+ Bug issue type, optional board). config holds the validated status,
-- priority, field and user-policy maps. One live mapping per BugFlow project and per Jira project.
CREATE TABLE IF NOT EXISTS bugflow.jira_project_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES bugflow.jira_connections(id),
  project_id uuid NOT NULL REFERENCES bugflow.projects(id),
  jira_project_id text NOT NULL,
  jira_project_key text NOT NULL,
  issue_type_id text NOT NULL,
  board_id bigint,
  config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','active','paused','disabled')),
  initial_sync text NOT NULL DEFAULT 'none' CHECK (initial_sync IN ('none','preview','running','done')),
  reconcile_cursor timestamptz,
  full_scan_at timestamptz,
  created_by uuid NOT NULL REFERENCES bugflow.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS jira_mappings_one_per_project ON bugflow.jira_project_mappings (project_id) WHERE state IN ('active','paused');
CREATE UNIQUE INDEX IF NOT EXISTS jira_mappings_one_per_jira_project ON bugflow.jira_project_mappings (connection_id, jira_project_id) WHERE state IN ('active','paused');

-- One BugFlow bug <-> one Jira issue. The immutable Jira issue id is the identity; the key is display only.
-- jira_issue_id is empty only while a create is in flight (state 'creating', create_op_id names the attempt).
-- The two snapshots are the last values both sides agreed on, used for the three-way comparison.
-- overrides holds an Admin's decisions on conflicts that the next sync pass still has to carry out.
CREATE TABLE IF NOT EXISTS bugflow.jira_issue_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mapping_id uuid NOT NULL REFERENCES bugflow.jira_project_mappings(id),
  connection_id uuid NOT NULL REFERENCES bugflow.jira_connections(id),
  bug_id bigint NOT NULL REFERENCES bugflow.bugs(id),
  jira_issue_id text,
  jira_issue_key text,
  origin text NOT NULL CHECK (origin IN ('bugflow','jira')),
  state text NOT NULL CHECK (state IN ('creating','linked','conflict','remote_missing','local_trashed','disabled')),
  bugflow_snapshot jsonb,
  jira_snapshot jsonb,
  bugflow_version timestamptz,
  jira_updated_at timestamptz,
  remote_reporter jsonb,
  create_op_id uuid,
  overrides jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(overrides) = 'object'),
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jira_issue_id IS NOT NULL OR state IN ('creating','disabled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS jira_links_one_per_issue ON bugflow.jira_issue_links (connection_id, jira_issue_id) WHERE jira_issue_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS jira_links_one_per_bug ON bugflow.jira_issue_links (bug_id) WHERE state <> 'disabled';
CREATE INDEX IF NOT EXISTS jira_links_reconcile ON bugflow.jira_issue_links (mapping_id, jira_updated_at);

-- Inbound events (webhooks, reconciliation finds). Only a bounded envelope is kept: the processor re-reads the
-- issue from Jira, so the full payload is never stored.
CREATE TABLE IF NOT EXISTS bugflow.jira_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES bugflow.jira_connections(id),
  dedup_key text NOT NULL,
  event_type text NOT NULL,
  source text NOT NULL CHECK (source IN ('webhook','reconcile','manual')),
  jira_issue_id text,
  jira_issue_key text,
  jira_sprint_id bigint,
  event_at timestamptz,
  envelope jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(envelope) = 'object'),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processing','done','retry','conflict','dead')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner uuid,
  lease_until timestamptz,
  last_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS jira_inbox_dedup ON bugflow.jira_inbox (connection_id, dedup_key);
CREATE INDEX IF NOT EXISTS jira_inbox_due ON bugflow.jira_inbox (next_attempt_at) WHERE state IN ('pending','retry');
CREATE INDEX IF NOT EXISTS jira_inbox_leases ON bugflow.jira_inbox (lease_until) WHERE state = 'processing';
CREATE INDEX IF NOT EXISTS jira_inbox_done ON bugflow.jira_inbox (processed_at) WHERE state = 'done';

-- Outbound work, inserted by the same statement as the BugFlow change that needs exporting. A 'sync' row is a
-- marker that the bug changed (the processor reads the current bug), so at most one waits per bug.
CREATE TABLE IF NOT EXISTS bugflow.jira_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mapping_id uuid NOT NULL REFERENCES bugflow.jira_project_mappings(id),
  bug_id bigint REFERENCES bugflow.bugs(id),
  link_id uuid REFERENCES bugflow.jira_issue_links(id),
  op text NOT NULL CHECK (op IN ('create','sync','sprint','refresh_webhook')),
  dedup_key text NOT NULL,
  bugflow_version timestamptz,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processing','done','retry','conflict','dead')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner uuid,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS jira_outbox_dedup ON bugflow.jira_outbox (dedup_key);
CREATE UNIQUE INDEX IF NOT EXISTS jira_outbox_one_waiting ON bugflow.jira_outbox (bug_id, op) WHERE state IN ('pending','retry') AND bug_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS jira_outbox_due ON bugflow.jira_outbox (next_attempt_at) WHERE state IN ('pending','retry');
CREATE INDEX IF NOT EXISTS jira_outbox_leases ON bugflow.jira_outbox (lease_until) WHERE state = 'processing';
CREATE INDEX IF NOT EXISTS jira_outbox_done ON bugflow.jira_outbox (processed_at) WHERE state = 'done';

-- One open conflict per link and field: both sides changed the same field differently since the snapshot.
CREATE TABLE IF NOT EXISTS bugflow.jira_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES bugflow.jira_issue_links(id),
  field text NOT NULL,
  base_value jsonb,
  local_value jsonb,
  remote_value jsonb,
  local_meta jsonb,
  remote_meta jsonb,
  reason text NOT NULL,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','resolved','ignored')),
  resolution text CHECK (resolution IN ('use_bugflow','use_jira','merged','ignored','unlinked')),
  resolved_by uuid REFERENCES bugflow.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS jira_conflicts_one_open ON bugflow.jira_conflicts (link_id, field) WHERE state = 'open';
CREATE INDEX IF NOT EXISTS jira_conflicts_open ON bugflow.jira_conflicts (created_at) WHERE state = 'open';

-- Jira sprint <-> the BugFlow sprint that mirrors it. Jira owns the sprint (name, dates, state); BugFlow keeps
-- its own rules (one active sprint per project, no carry-over on close).
CREATE TABLE IF NOT EXISTS bugflow.jira_sprint_links (
  connection_id uuid NOT NULL REFERENCES bugflow.jira_connections(id),
  jira_sprint_id bigint NOT NULL,
  sprint_id uuid NOT NULL REFERENCES bugflow.sprints(id),
  mapping_id uuid NOT NULL REFERENCES bugflow.jira_project_mappings(id),
  jira_board_id bigint,
  jira_state text NOT NULL CHECK (jira_state IN ('future','active','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, jira_sprint_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS jira_sprint_links_sprint ON bugflow.jira_sprint_links (sprint_id);

-- BugFlow member <-> Atlassian account, one to one. Only Admin-confirmed rows are used for assignment,
-- reporter attribution or verification; an email match is a suggestion, never an identity.
CREATE TABLE IF NOT EXISTS bugflow.jira_user_mappings (
  connection_id uuid NOT NULL REFERENCES bugflow.jira_connections(id),
  user_id uuid NOT NULL REFERENCES bugflow.users(id),
  account_id text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  source text NOT NULL CHECK (source IN ('suggested','manual')),
  confirmed_at timestamptz,
  confirmed_by uuid REFERENCES bugflow.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS jira_user_mappings_account ON bugflow.jira_user_mappings (connection_id, account_id);
