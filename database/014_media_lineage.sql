-- Media lineage: an annotated copy points at the file it was drawn on (derived_from) and, for a video frame, the time it was taken at (at_seconds).
-- Idempotent.
ALTER TABLE bugflow.bug_media ADD COLUMN IF NOT EXISTS derived_from uuid REFERENCES bugflow.bug_media(id);
ALTER TABLE bugflow.bug_media ADD COLUMN IF NOT EXISTS at_seconds numeric CHECK (at_seconds IS NULL OR at_seconds >= 0);
CREATE INDEX IF NOT EXISTS bug_media_uploader_idx ON bugflow.bug_media (uploaded_by, created_at DESC) WHERE status = 'ready' AND deleted_at IS NULL;
