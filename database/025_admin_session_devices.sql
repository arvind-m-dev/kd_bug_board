-- Signed-in devices: record when each Admin session began so Settings can list the
-- devices currently signed in and "Sign out other devices" has something to show.
ALTER TABLE bugflow.admin_sessions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
