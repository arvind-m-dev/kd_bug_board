-- Removes ONLY demo data: the "Demo · Customer Portal" project, its bugs and everything attached to them,
-- and the demo people (@demo.bugboard.test, ids de300000-…). Real members and real bugs are untouched.
-- Apply with: npm run demo:remove (one transaction).
DELETE FROM bugflow.bug_mutations WHERE bug_id IN (SELECT id FROM bugflow.bugs WHERE project_id='de300000-0000-4000-8000-000000000001') OR actor_id IN (SELECT id FROM bugflow.users WHERE email LIKE '%@demo.bugboard.test');
DELETE FROM bugflow.comments WHERE bug_id IN (SELECT id FROM bugflow.bugs WHERE project_id='de300000-0000-4000-8000-000000000001') OR actor_id IN (SELECT id FROM bugflow.users WHERE email LIKE '%@demo.bugboard.test');
DELETE FROM bugflow.verifications WHERE bug_id IN (SELECT id FROM bugflow.bugs WHERE project_id='de300000-0000-4000-8000-000000000001') OR actor_id IN (SELECT id FROM bugflow.users WHERE email LIKE '%@demo.bugboard.test');
DELETE FROM bugflow.status_history WHERE bug_id IN (SELECT id FROM bugflow.bugs WHERE project_id='de300000-0000-4000-8000-000000000001') OR actor_id IN (SELECT id FROM bugflow.users WHERE email LIKE '%@demo.bugboard.test');
DELETE FROM bugflow.assignments WHERE bug_id IN (SELECT id FROM bugflow.bugs WHERE project_id='de300000-0000-4000-8000-000000000001') OR actor_id IN (SELECT id FROM bugflow.users WHERE email LIKE '%@demo.bugboard.test') OR assignee_id IN (SELECT id FROM bugflow.users WHERE email LIKE '%@demo.bugboard.test') OR previous_assignee_id IN (SELECT id FROM bugflow.users WHERE email LIKE '%@demo.bugboard.test');
DELETE FROM bugflow.assignment_batches WHERE actor_id IN (SELECT id FROM bugflow.users WHERE email LIKE '%@demo.bugboard.test');
DELETE FROM bugflow.bug_assignees WHERE bug_id IN (SELECT id FROM bugflow.bugs WHERE project_id='de300000-0000-4000-8000-000000000001') OR user_id IN (SELECT id FROM bugflow.users WHERE email LIKE '%@demo.bugboard.test') OR assigned_by IN (SELECT id FROM bugflow.users WHERE email LIKE '%@demo.bugboard.test');
DELETE FROM bugflow.evidence WHERE bug_id IN (SELECT id FROM bugflow.bugs WHERE project_id='de300000-0000-4000-8000-000000000001');
DELETE FROM bugflow.steps WHERE bug_id IN (SELECT id FROM bugflow.bugs WHERE project_id='de300000-0000-4000-8000-000000000001');
DELETE FROM bugflow.bug_details WHERE bug_id IN (SELECT id FROM bugflow.bugs WHERE project_id='de300000-0000-4000-8000-000000000001');
DELETE FROM bugflow.activity WHERE bug_id IN (SELECT id FROM bugflow.bugs WHERE project_id='de300000-0000-4000-8000-000000000001') OR actor_id IN (SELECT id FROM bugflow.users WHERE email LIKE '%@demo.bugboard.test');
UPDATE bugflow.bugs SET assignee_id=NULL WHERE assignee_id IN (SELECT id FROM bugflow.users WHERE email LIKE '%@demo.bugboard.test') AND project_id<>'de300000-0000-4000-8000-000000000001';
UPDATE bugflow.bugs SET qa_owner_id=NULL WHERE qa_owner_id IN (SELECT id FROM bugflow.users WHERE email LIKE '%@demo.bugboard.test') AND project_id<>'de300000-0000-4000-8000-000000000001';
UPDATE bugflow.bugs SET duplicate_of=NULL WHERE duplicate_of IN (SELECT id FROM bugflow.bugs WHERE project_id='de300000-0000-4000-8000-000000000001');
DELETE FROM bugflow.bugs WHERE project_id='de300000-0000-4000-8000-000000000001';
DELETE FROM bugflow.saved_views WHERE portal_id IN (SELECT p.id FROM bugflow.portals p JOIN bugflow.users u ON u.id=p.user_id WHERE u.email LIKE '%@demo.bugboard.test');
DELETE FROM bugflow.portal_projects WHERE project_id='de300000-0000-4000-8000-000000000001' OR portal_id IN (SELECT p.id FROM bugflow.portals p JOIN bugflow.users u ON u.id=p.user_id WHERE u.email LIKE '%@demo.bugboard.test');
DELETE FROM bugflow.portal_onboarding WHERE portal_id IN (SELECT p.id FROM bugflow.portals p JOIN bugflow.users u ON u.id=p.user_id WHERE u.email LIKE '%@demo.bugboard.test');
DELETE FROM bugflow.portals WHERE user_id IN (SELECT id FROM bugflow.users WHERE email LIKE '%@demo.bugboard.test');
DELETE FROM bugflow.notification_state WHERE user_id IN (SELECT id FROM bugflow.users WHERE email LIKE '%@demo.bugboard.test');
DELETE FROM bugflow.users WHERE email LIKE '%@demo.bugboard.test';
DELETE FROM bugflow.modules WHERE project_id='de300000-0000-4000-8000-000000000001';
DELETE FROM bugflow.projects WHERE id='de300000-0000-4000-8000-000000000001';
