CREATE TABLE bugflow.admin_sessions (
 token_hash text PRIMARY KEY,
 portal_id uuid NOT NULL REFERENCES bugflow.portals(id),
 expires_at timestamptz NOT NULL
);