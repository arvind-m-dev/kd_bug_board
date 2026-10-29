-- Configurable bug-ID prefixes: the display code becomes <prefix>-<number> (e.g. DEPLOY-000123). The number is the
-- stable identity everywhere; the prefix is stamped on the row at report time (workspace default or the reporter's
-- choice from the Admin-managed list), so existing codes never change retroactively. Idempotent.
ALTER TABLE bugflow.bugs ADD COLUMN IF NOT EXISTS code_prefix text NOT NULL DEFAULT 'BF';
ALTER TABLE bugflow.bugs DROP CONSTRAINT IF EXISTS bugs_code_prefix_check;
ALTER TABLE bugflow.bugs ADD CONSTRAINT bugs_code_prefix_check CHECK (code_prefix ~ '^[A-Z][A-Z0-9]{0,9}$');
