-- Removed files go to the Trash: they stay in storage and can be restored until restorable_until (30 days), then the media sweep deletes them.
-- Files removed by clean-up, or with a purged bug, keep restorable_until NULL and leave storage right away. Idempotent.
ALTER TABLE bugflow.bug_media ADD COLUMN IF NOT EXISTS restorable_until timestamptz;
CREATE INDEX IF NOT EXISTS bug_media_trash_idx ON bugflow.bug_media (restorable_until) WHERE deleted_at IS NOT NULL AND purged_at IS NULL;
