-- Timed mark-up on recordings: drawings that appear from one moment of the video until a later one (or the end).
-- Stored on the media row as JSON with an optimistic version so two people editing the same video cannot overwrite each other. Idempotent.
ALTER TABLE bugflow.bug_media ADD COLUMN IF NOT EXISTS marks jsonb NOT NULL DEFAULT '[]';
ALTER TABLE bugflow.bug_media ADD COLUMN IF NOT EXISTS marks_version integer NOT NULL DEFAULT 0;
