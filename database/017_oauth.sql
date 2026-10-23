-- OAuth 2.1 (authorization code + PKCE) so claude.ai, ChatGPT and other connectors can sign in to the MCP endpoint.
-- Clients register themselves (Dynamic Client Registration); auth codes are single-use and short-lived, stored as a hash.
-- The issued access token is an ordinary AI token (bugflow.ai_tokens), so it is scoped per panel and revocable in Settings. Idempotent.
CREATE TABLE IF NOT EXISTS bugflow.oauth_clients (
  id uuid PRIMARY KEY,
  client_id text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT '',
  redirect_uris jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bugflow.oauth_codes (
  code_hash text PRIMARY KEY,
  client_id text NOT NULL,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  portal_id uuid NOT NULL REFERENCES bugflow.portals(id),
  label text NOT NULL DEFAULT '',
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oauth_codes_expiry_idx ON bugflow.oauth_codes (expires_at);
