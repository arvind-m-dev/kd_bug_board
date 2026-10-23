-- Small JPEG previews uploaded next to each image or recording (<key>.thumb.jpg): lists show these instead of downloading
-- the full file, and a recording shows its poster at once. Older files have none and show an icon. Idempotent.
ALTER TABLE bugflow.bug_media ADD COLUMN IF NOT EXISTS has_thumb boolean NOT NULL DEFAULT false;
