CREATE TABLE IF NOT EXISTS bugflow.bug_details (
  bug_id bigint PRIMARY KEY REFERENCES bugflow.bugs(id),
  request_id uuid NOT NULL UNIQUE,
  module_name text NOT NULL DEFAULT '',
  evidence_urls jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(evidence_urls)='array')
);
CREATE TABLE IF NOT EXISTS bugflow.bug_mutations (
  request_id uuid PRIMARY KEY,
  bug_id bigint NOT NULL REFERENCES bugflow.bugs(id),
  actor_id uuid NOT NULL REFERENCES bugflow.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);