-- Removes exactly what phase2_seed.sql added (fixed de300000-…-9000-… ids). Due dates set by the seed stay,
-- since they landed on real demo bugs; clear them by hand if unwanted. Idempotent.
delete from bugflow.sprint_items where sprint_id in ('de300000-0000-4000-9000-100000000001','de300000-0000-4000-9000-100000000002','de300000-0000-4000-9000-100000000003');
delete from bugflow.sprints where id in ('de300000-0000-4000-9000-100000000001','de300000-0000-4000-9000-100000000002','de300000-0000-4000-9000-100000000003');
delete from bugflow.activity where id in ('de300000-0000-4000-9000-300000000001','de300000-0000-4000-9000-300000000002','de300000-0000-4000-9000-300000000003','de300000-0000-4000-9000-300000000004');
delete from bugflow.activity where bug_id in (select bug_id from bugflow.bug_details where request_id::text like 'de300000-0000-4000-9000-2000000000%');
delete from bugflow.status_history where bug_id in (select bug_id from bugflow.bug_details where request_id::text like 'de300000-0000-4000-9000-2000000000%');
delete from bugflow.steps where bug_id in (select bug_id from bugflow.bug_details where request_id::text like 'de300000-0000-4000-9000-2000000000%');
delete from bugflow.sprint_items where bug_id in (select bug_id from bugflow.bug_details where request_id::text like 'de300000-0000-4000-9000-2000000000%');
update bugflow.bugs set parent_id=null where parent_id in (select bug_id from bugflow.bug_details where request_id::text like 'de300000-0000-4000-9000-2000000000%');
delete from bugflow.bug_details where request_id::text like 'de300000-0000-4000-9000-2000000000%' and bug_id in (select id from bugflow.bugs where kind<>'bug');
delete from bugflow.bugs where kind<>'bug' and id not in (select bug_id from bugflow.bug_details);
