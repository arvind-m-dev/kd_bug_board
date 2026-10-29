-- Phase 2.1: an optional target date per bug. "Overdue" is derived (date < today in the workspace time zone and the
-- bug is still open), never stored. The workspace time zone lives in settings key 'workspace'. Idempotent.
ALTER TABLE bugflow.bugs ADD COLUMN IF NOT EXISTS due_on date;
CREATE INDEX IF NOT EXISTS bugs_due_on_idx ON bugflow.bugs (project_id, due_on) WHERE deleted_at IS NULL AND due_on IS NOT NULL;
