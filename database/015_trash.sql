-- Trash: deleted bugs and members stay restorable for 30 days. purged_at marks an item deleted forever: it leaves the Trash
-- and its files leave storage, while the row itself stays so history, comments and references remain intact. Idempotent.
ALTER TABLE bugflow.bugs ADD COLUMN IF NOT EXISTS purged_at timestamptz;
ALTER TABLE bugflow.users ADD COLUMN IF NOT EXISTS purged_at timestamptz;
CREATE INDEX IF NOT EXISTS bugs_trash_idx ON bugflow.bugs (deleted_at DESC) WHERE deleted_at IS NOT NULL AND purged_at IS NULL;
CREATE INDEX IF NOT EXISTS users_trash_idx ON bugflow.users (deleted_at DESC) WHERE deleted_at IS NOT NULL AND purged_at IS NULL;
