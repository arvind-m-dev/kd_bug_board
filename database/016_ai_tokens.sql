-- AI access tokens: let an MCP client (Claude, Cursor, VS Code, etc.) act as one portal — Admin or a member.
-- A token carries the permissions and project scope of its portal, nothing more; revoking it or the portal stops it at once.
-- Only the SHA-256 hash is stored, like portal links. Idempotent.
CREATE TABLE IF NOT EXISTS bugflow.ai_tokens (
  id uuid PRIMARY KEY,
  portal_id uuid NOT NULL REFERENCES bugflow.portals(id),
  token_hash text NOT NULL UNIQUE,
  label text NOT NULL DEFAULT '',
  created_by uuid REFERENCES bugflow.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS ai_tokens_portal_idx ON bugflow.ai_tokens (portal_id) WHERE revoked_at IS NULL;
