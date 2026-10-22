-- Private evidence media (screenshots, recordings, PDFs) stored in an S3-compatible bucket (Cloudflare R2 / Backblaze B2 / AWS S3).
-- Objects are private; the app mints short-lived signed URLs after checking bug scope and the 'evidence' permission.
-- A row is 'pending' while the browser uploads straight to the bucket and becomes 'ready' once the server has verified the object.
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
CREATE INDEX IF NOT EXISTS bug_media_bug_idx ON bugflow.bug_media (bug_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS bug_media_pending_idx ON bugflow.bug_media (created_at) WHERE status = 'pending' AND deleted_at IS NULL;
