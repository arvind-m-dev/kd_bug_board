-- Phase 2.4: the backlog. Stories, tasks and epics live in the bugs table (kind) so portals, scope, media, comments,
-- history, sprints and the board keep working for them unchanged. They flow through the same 13-status workflow
-- (deliberate deviation from the plan's separate short workflow: one status model, no constraint change).
-- Ranking is a lexicographic string (fractional ranking: a reorder writes one row). Idempotent.
ALTER TABLE bugflow.bugs ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'bug';
-- The migrate runner executes one statement per semicolon (no DO blocks): drop-then-add keeps this idempotent.
ALTER TABLE bugflow.bugs DROP CONSTRAINT IF EXISTS bugs_kind_check;
ALTER TABLE bugflow.bugs ADD CONSTRAINT bugs_kind_check CHECK (kind IN ('bug','story','task','epic'));
ALTER TABLE bugflow.bugs ADD COLUMN IF NOT EXISTS parent_id bigint REFERENCES bugflow.bugs(id);
ALTER TABLE bugflow.bugs ADD COLUMN IF NOT EXISTS estimate smallint CHECK (estimate IS NULL OR (estimate >= 0 AND estimate <= 1000));
ALTER TABLE bugflow.bugs ADD COLUMN IF NOT EXISTS ready boolean NOT NULL DEFAULT false;
ALTER TABLE bugflow.bugs ADD COLUMN IF NOT EXISTS backlog_rank text;
CREATE INDEX IF NOT EXISTS bugs_backlog_idx ON bugflow.bugs (project_id, backlog_rank) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS bugs_parent_idx ON bugflow.bugs (parent_id) WHERE parent_id IS NOT NULL;
