-- Indexes for the per-bug lookups the list, detail and export queries run for every row (latest verification,
-- latest developer/QA comment, status history, assignments). Without them each lookup scans the whole table, and
-- purging a bug scans them for its foreign keys. Idempotent; no data changes.
CREATE INDEX IF NOT EXISTS comments_bug ON bugflow.comments(bug_id, created_at DESC);
CREATE INDEX IF NOT EXISTS verifications_bug ON bugflow.verifications(bug_id, created_at DESC);
CREATE INDEX IF NOT EXISTS status_history_bug ON bugflow.status_history(bug_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assignments_bug ON bugflow.assignments(bug_id, created_at);
