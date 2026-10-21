ALTER TABLE bugflow.users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE bugflow.portals ADD COLUMN IF NOT EXISTS token_ciphertext text;
ALTER TABLE bugflow.portals ADD COLUMN IF NOT EXISTS welcome_seen_at timestamptz;
