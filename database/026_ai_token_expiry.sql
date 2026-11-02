-- AI tokens expire after 90 days without use (each use pushes expires_at out again), and connections made through
-- claude.ai/ChatGPT (OAuth) are kept to the newest 10 per portal. source tells the two kinds apart: OAuth inserts never
-- set created_by, hand-made tokens always do. Existing tokens get their 90 days from today, so nobody is cut off.
-- Idempotent.
ALTER TABLE bugflow.ai_tokens ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
UPDATE bugflow.ai_tokens SET source='oauth' WHERE created_by IS NULL AND source<>'oauth';
ALTER TABLE bugflow.ai_tokens DROP CONSTRAINT IF EXISTS ai_tokens_source_check;
ALTER TABLE bugflow.ai_tokens ADD CONSTRAINT ai_tokens_source_check CHECK (source IN ('manual','oauth'));
ALTER TABLE bugflow.ai_tokens ADD COLUMN IF NOT EXISTS expires_at timestamptz;
UPDATE bugflow.ai_tokens SET expires_at=now()+interval '90 days' WHERE expires_at IS NULL;
ALTER TABLE bugflow.ai_tokens ALTER COLUMN expires_at SET DEFAULT now()+interval '90 days';
ALTER TABLE bugflow.ai_tokens ALTER COLUMN expires_at SET NOT NULL;
