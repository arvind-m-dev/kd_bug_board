-- Phase 2.2: sprints. A sprint groups bugs of one project for a fixed period. sprint_items keeps membership history
-- (added/removed with who and when, and where a carried-over bug came from) so added scope and carry-over are facts.
-- At most one active sprint per project (partial unique index). Idempotent.
CREATE TABLE IF NOT EXISTS bugflow.sprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES bugflow.projects(id),
  name text NOT NULL,
  goal text NOT NULL DEFAULT '',
  starts_on date,
  ends_on date,
  state text NOT NULL DEFAULT 'planned' CHECK (state IN ('planned','active','closed')),
  created_by uuid NOT NULL REFERENCES bugflow.users(id),
  started_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sprints_one_active_per_project ON bugflow.sprints (project_id) WHERE state = 'active';
CREATE INDEX IF NOT EXISTS sprints_project_idx ON bugflow.sprints (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bugflow.sprint_items (
  sprint_id uuid NOT NULL REFERENCES bugflow.sprints(id),
  bug_id bigint NOT NULL REFERENCES bugflow.bugs(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  added_by uuid NOT NULL REFERENCES bugflow.users(id),
  removed_at timestamptz,
  removed_by uuid REFERENCES bugflow.users(id),
  carried_from_sprint_id uuid REFERENCES bugflow.sprints(id),
  PRIMARY KEY (sprint_id, bug_id)
);
-- One open (planned/active) membership per bug is enforced in addToSprint, which checks before inserting.
CREATE INDEX IF NOT EXISTS sprint_items_bug_idx ON bugflow.sprint_items (bug_id) WHERE removed_at IS NULL;
