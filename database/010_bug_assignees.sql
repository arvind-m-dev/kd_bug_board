-- Multiple assignees per bug; bugs.assignee_id stays the lead assignee.
CREATE TABLE IF NOT EXISTS bugflow.bug_assignees (bug_id bigint NOT NULL REFERENCES bugflow.bugs(id), user_id uuid NOT NULL REFERENCES bugflow.users(id), assigned_by uuid NOT NULL REFERENCES bugflow.users(id), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (bug_id,user_id));
CREATE INDEX IF NOT EXISTS bug_assignees_user_idx ON bugflow.bug_assignees(user_id);
INSERT INTO bugflow.bug_assignees(bug_id,user_id,assigned_by) SELECT b.id,b.assignee_id,b.reporter_id FROM bugflow.bugs b WHERE b.assignee_id IS NOT NULL ON CONFLICT DO NOTHING;
