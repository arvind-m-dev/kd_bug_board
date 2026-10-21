CREATE TABLE bugflow.portal_onboarding (
 portal_id uuid PRIMARY KEY REFERENCES bugflow.portals(id),
 collaborator_role text NOT NULL CHECK(collaborator_role IN ('tester','developer','qa','other')),
 permissions jsonb NOT NULL,
 scope_note text NOT NULL DEFAULT '',
 context text NOT NULL DEFAULT '',
 welcome text NOT NULL DEFAULT ''
);