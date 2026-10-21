WITH project AS (
 INSERT INTO bugflow.projects(id,name,description) VALUES ('ad110000-0000-4000-8000-000000000001','BugFlow sandbox','Clearly labeled sample issues for exploring bug management.') ON CONFLICT(id) DO UPDATE SET description=excluded.description RETURNING id
), owner AS (SELECT user_id FROM bugflow.portals WHERE type='admin' LIMIT 1), sample(title,priority,status,module_name,description,expected,actual) AS (VALUES
 ('[Sample] Sign-in fails after a valid password retry','P0','NEW','Authentication','The sign-in form retains the previous error after a valid retry.','Successful retry clears the error and opens the workspace.','The stale error blocks navigation.'),
 ('[Sample] Project selector loses the selected project','P1','VALIDATING','Bug reporting','Switching a browser tab clears the selected project in a draft report.','The selected project remains until the draft is closed.','The project selection resets.'),
 ('[Sample] Developer assignment shows a stale owner','P2','VALIDATED','Assignments','The previous developer remains visible after reassignment.','The new developer appears after saving.','The previous owner remains until reload.'),
 ('[Sample] Priority filter omits P4 issues','P3','READY_FOR_ASSIGNMENT','Filters','Filtering the list by P4 returns no results despite matching records.','All P4 issues appear in the filtered list.','The list is empty.'),
 ('[Sample] Drive evidence opens an access request','P4','NEEDS_INFORMATION','Evidence','The supplied evidence link requires additional sharing permission.','Authorized reviewers can open the evidence.','Drive requests access; reporter sharing details are needed.'),
 ('[Sample] Minor icon alignment in the report form','P5','NEW','Presentation','The evidence icon is slightly misaligned beside its label.','Icon and label share a baseline.','The icon appears lower than the label.')
), created AS (
 INSERT INTO bugflow.bugs(title,project_id,reporter_id,priority,status,severity,description,expected,actual,browser_device,environment)
 SELECT s.title,p.id,o.user_id,s.priority,s.status,CASE WHEN s.priority='P0' THEN 'Critical' WHEN s.priority IN ('P1','P2') THEN 'High' ELSE 'Low' END,s.description,s.expected,s.actual,'Chrome / desktop','Development' FROM sample s CROSS JOIN project p CROSS JOIN owner o WHERE NOT EXISTS(SELECT 1 FROM bugflow.bugs b WHERE b.project_id=p.id AND b.title=s.title) RETURNING id,title,status,reporter_id
), details AS (INSERT INTO bugflow.bug_details(bug_id,request_id,module_name) SELECT c.id,gen_random_uuid(),s.module_name FROM created c JOIN sample s ON s.title=c.title),
 steps AS (INSERT INTO bugflow.steps(bug_id,position,content) SELECT c.id,v.position,v.content FROM created c CROSS JOIN (VALUES (1,'Open the relevant page in the BugFlow sandbox.'),(2,'Perform the action described in this sample report.'),(3,'Compare the actual result with the expected result.')) v(position,content)),
 history AS (INSERT INTO bugflow.status_history(id,bug_id,actor_id,new_status) SELECT gen_random_uuid(),id,reporter_id,status FROM created),
 activity AS (INSERT INTO bugflow.activity(id,bug_id,actor_id,action,detail) SELECT gen_random_uuid(),id,reporter_id,'bug.sample_created',jsonb_build_object('sample',true,'status',status) FROM created)
 SELECT count(*) AS sample_bugs_added FROM created;
