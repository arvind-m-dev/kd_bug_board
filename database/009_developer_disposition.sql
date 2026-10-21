-- Grant developers the bug-disposition permission (close as not a bug, duplicate, won't fix)
update bugflow.portal_onboarding
set permissions = permissions || '["disposition"]'::jsonb
where collaborator_role = 'developer'
  and not permissions @> '["disposition"]'::jsonb;
