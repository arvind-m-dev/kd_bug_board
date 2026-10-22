-- Private evidence media (screenshots, recordings, PDFs) stored in an S3-compatible bucket (Cloudflare R2 free tier recommended; Backblaze B2 / AWS S3 also work).
-- Objects are private. The browser uploads straight to the bucket with a short-lived signed PUT minted after permission checks;
-- the server verifies the object (HEAD: exists, size, type) before the row becomes 'ready'; viewing uses signed GETs minted per view.
-- Removal is a soft delete on the row (deleted_at/deleted_by, audited in bugflow.activity); purged_at records when the object left the bucket.
-- The legacy, empty bugflow.evidence table from 001 is left untouched. Every statement is idempotent.
CREATE TABLE IF NOT EXISTS bugflow.bug_media (
  id uuid PRIMARY KEY,
  bug_id bigint NOT NULL REFERENCES bugflow.bugs(id),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  content_type text NOT NULL,
  size bigint NOT NULL CHECK (size >= 0),
  kind text NOT NULL CHECK (kind IN ('image','video','pdf')),
  uploaded_by uuid NOT NULL REFERENCES bugflow.users(id),
  uploaded_via text NOT NULL DEFAULT 'admin',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES bugflow.users(id)
);
ALTER TABLE bugflow.bug_media ADD COLUMN IF NOT EXISTS width integer CHECK (width IS NULL OR width > 0);
ALTER TABLE bugflow.bug_media ADD COLUMN IF NOT EXISTS height integer CHECK (height IS NULL OR height > 0);
ALTER TABLE bugflow.bug_media ADD COLUMN IF NOT EXISTS ready_at timestamptz;
ALTER TABLE bugflow.bug_media ADD COLUMN IF NOT EXISTS purged_at timestamptz;
DROP INDEX IF EXISTS bugflow.bug_media_bug_idx;
CREATE INDEX IF NOT EXISTS bug_media_bug_order_idx ON bugflow.bug_media (bug_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS bug_media_pending_idx ON bugflow.bug_media (created_at) WHERE status = 'pending' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS bug_media_purge_idx ON bugflow.bug_media (deleted_at) WHERE deleted_at IS NOT NULL AND purged_at IS NULL;
