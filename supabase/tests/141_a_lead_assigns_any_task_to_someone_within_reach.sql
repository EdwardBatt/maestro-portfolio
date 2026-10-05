-- ADR-0060 addendum, 22 Sep — a lead assigns any task on an approved campaign to a person within
-- her reach, whichever department owns the deliverable; the task's department follows the
-- assignee. Still refused: a task on a deliverable whose OWNER has not approved its task list, a
-- team member with no grant, and an EDIT of another department's task with no change of assignee.
-- ADR-0098 (22 Sep) made a person outside her team a direct booking; ADR-0139 d.1 (3 Oct) makes it a request again —
-- now to that team's lead.
-- ADR-0100 d.2 (23 Sep): the second gate changed hands. It was "the department approved its
-- brief"; it is now "the owner approved this deliverable's task list", for a campaign exactly as
-- for a single job. This suite's two deliverables now differ by that stamp, not by a brief.
begin;
select plan(9);
\ir helpers/seed.sql
select app.seed_tenant_brief_approval_grants(id) from tenants;

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de1410', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 141'),
  ('aaaaaaaa-0000-0000-0000-000000de1411', 'aaaaaaaa-0000-0000-0000-000000000001', 'Content 141');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000007e141', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000de1410', 'Design 141'),
  ('aaaaaaaa-0000-0000-0000-00000007e142', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000de1410', 'Motion 141');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000a10', 'am141@a.test'),
  ('00000000-0000-0000-0000-000000000a11', 'contentlead141@a.test'),
  ('00000000-0000-0000-0000-000000000a12', 'tl141@a.test'),
  ('00000000-0000-0000-0000-000000000a13', 'maker141@a.test'),
  ('00000000-0000-0000-0000-000000000a14', 'animator141@a.test'),
  ('00000000-0000-0000-0000-000000000a15', 'motionlead141@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid, v.team::uuid
from (values
  ('00000000-0000-0000-0000-000000000a10','AM 141',          'account_manager', null, null),
  ('00000000-0000-0000-0000-000000000a11','Content lead 141','department_lead','aaaaaaaa-0000-0000-0000-000000de1411', null),
  ('00000000-0000-0000-0000-000000000a12','TL 141',          'team_lead',      'aaaaaaaa-0000-0000-0000-000000de1410', 'aaaaaaaa-0000-0000-0000-00000007e141'),
  ('00000000-0000-0000-0000-000000000a13','Maker 141',       'team_member',    'aaaaaaaa-0000-0000-0000-000000de1410', 'aaaaaaaa-0000-0000-0000-00000007e141'),
  ('00000000-0000-0000-0000-000000000a14','Animator 141',    'team_member',    'aaaaaaaa-0000-0000-0000-000000de1410', 'aaaaaaaa-0000-0000-0000-00000007e142'),
  ('00000000-0000-0000-0000-000000000a15','Motion lead 141', 'team_lead',      'aaaaaaaa-0000-0000-0000-000000de1410', 'aaaaaaaa-0000-0000-0000-00000007e142')
) as v(id, name, role_key, dept, team);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id in ('00000000-0000-0000-0000-000000000a12','00000000-0000-0000-0000-000000000a13');
insert into resources (id, tenant_id, kind, name, capacity_model, load_ceiling_pct, warn_at_pct, user_id, department_id, team_id) values
  ('aaaaaaaa-0000-0000-0000-0000000e1413', 'aaaaaaaa-0000-0000-0000-000000000001', 'human', 'Maker 141', 'load_based', 120.0, 100.0,
   '00000000-0000-0000-0000-000000000a13', 'aaaaaaaa-0000-0000-0000-000000de1410', 'aaaaaaaa-0000-0000-0000-00000007e141'),
  ('aaaaaaaa-0000-0000-0000-0000000e1414', 'aaaaaaaa-0000-0000-0000-000000000001', 'human', 'Animator 141', 'load_based', 120.0, 100.0,
   '00000000-0000-0000-0000-000000000a14', 'aaaaaaaa-0000-0000-0000-000000de1410', 'aaaaaaaa-0000-0000-0000-00000007e142');

-- An approved campaign whose deliverable is CONTENT's (its owner is the Content lead), its task
-- list accepted by that owner; and a second, Content-owned deliverable whose list is NOT.
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id, brief) values
  ('aaaaaaaa-0000-0000-0000-000000001410','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Season 141','approved','campaign','00000000-0000-0000-0000-000000000a10','{"proposition":"Posts"}'::jsonb),
  ('aaaaaaaa-0000-0000-0000-000000001411','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Unaccepted 141','approved','campaign','00000000-0000-0000-0000-000000000a10','{"proposition":"Later"}'::jsonb);
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f141','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001410','Season 141'),
  ('aaaaaaaa-0000-0000-0000-00000000f142','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001411','Unaccepted 141');
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d1410','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f141',
   'social posts 141','draft', now() + interval '10 days', '00000000-0000-0000-0000-000000000a11'),
  ('aaaaaaaa-0000-0000-0000-0000000d1411','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f142',
   'later posts 141','draft', now() + interval '10 days', '00000000-0000-0000-0000-000000000a11');
-- The owner accepts the first deliverable's list and not the second's (ADR-0100 d.2). The stamp is
-- server-written only (ADR-0090 d.2, the fence), so the flag is raised exactly as
-- `public.approve_deliverable_tasks` raises it rather than the column being written behind it.
select set_config('app.task_list_approval', 'on', true);
update deliverables set tasks_approved_at = now(), tasks_approved_by = owner_user_id
 where id = 'aaaaaaaa-0000-0000-0000-0000000d1410';
select set_config('app.task_list_approval', '', true);
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order, department_id, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000a1411','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1410','Create Content — social posts 1','todo',1,'aaaaaaaa-0000-0000-0000-000000de1411', 8),
  ('aaaaaaaa-0000-0000-0000-0000000a1412','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1410','Create Content — social posts 2','todo',2,'aaaaaaaa-0000-0000-0000-000000de1411', 8),
  ('aaaaaaaa-0000-0000-0000-0000000a1413','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1410','Create Content — social posts 3','todo',3,'aaaaaaaa-0000-0000-0000-000000de1411', 8),
  ('aaaaaaaa-0000-0000-0000-0000000a1414','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1411','Create Content — later posts 1','todo',1,'aaaaaaaa-0000-0000-0000-000000de1411', 8);

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000a12'),true);

-- 1. The Creative team lead assigns Content's task to her own team member.
select lives_ok($$
  select public.update_task_assignment('aaaaaaaa-0000-0000-0000-0000000a1411', 'Create Content — social posts 1', '00000000-0000-0000-0000-000000000a13',
    '[{"user_id":"00000000-0000-0000-0000-000000000a11","is_mandatory":true}]'::jsonb)
$$, 'a Creative team lead assigns a Content-owned task to her own team member (addendum, 22 Sep)');
reset role;
select results_eq($$
  select assignee_id, department_id, team_id from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a1411'
$$, $$ values ('00000000-0000-0000-0000-000000000a13'::uuid, 'aaaaaaaa-0000-0000-0000-000000de1410'::uuid, 'aaaaaaaa-0000-0000-0000-00000007e141'::uuid) $$,
  'assigned, and the task''s department and team now follow the person doing it (d.9 first half)');
select is((select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1410'),
  'aaaaaaaa-0000-0000-0000-000000de1411'::uuid, 'the deliverable stays Content''s — the owner has not changed');

-- 2. Someone on ANOTHER team (Motion), in her own department, is a REQUEST to Motion's lead — ADR-0139 d.1.
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000a12'),true);
select results_eq($$
  select outcome from public.update_task_assignment('aaaaaaaa-0000-0000-0000-0000000a1412', 'Create Content — social posts 2', '00000000-0000-0000-0000-000000000a14',
    '[{"user_id":"00000000-0000-0000-0000-000000000a11","is_mandatory":true}]'::jsonb)
$$, $$ values ('requested') $$, 'a person on another team is requested, not assigned (ADR-0139 d.1)');
reset role;
select results_eq($$
  select st.assignee_id, q.team_id from sub_tasks st
    join sub_task_assignment_requests q on q.sub_task_id = st.id and q.status = 'pending'
   where st.id = 'aaaaaaaa-0000-0000-0000-0000000a1412'
$$, $$ values (null::uuid, 'aaaaaaaa-0000-0000-0000-00000007e142'::uuid) $$,
  'nothing is assigned; the request names the person''s team, Motion (ADR-0139 d.2)');

-- 3. The second gate still holds — it has simply changed hands. Work whose owner has not accepted
--    the task list is refused, in words, however far the lead's reach goes (ADR-0100 d.2,
--    replacing ADR-0072 d.6's department-brief gate).
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000a12'),true);
select throws_ok($$
  select public.update_task_assignment('aaaaaaaa-0000-0000-0000-0000000a1414', 'Create Content — later posts 1', '00000000-0000-0000-0000-000000000a13',
    '[{"user_id":"00000000-0000-0000-0000-000000000a11","is_mandatory":true}]'::jsonb)
$$, '42501', 'the task list for "later posts 141" has not been approved by Content lead 141 yet, so its work cannot be assigned',
  'the task-list gate is not loosened by the addendum, and it names the list and the person owed (ADR-0100 d.2)');

-- 4. Editing another department's task WITHOUT taking it on is still that department's business.
select throws_ok($$
  select public.update_task_assignment('aaaaaaaa-0000-0000-0000-0000000a1413', 'Renamed by a Creative lead', null)
$$, '42501', 'editing this task requires project-task management permission',
  'renaming Content''s task without taking it on is still Content''s business — refused');
select lives_ok($$
  select public.update_task_assignment('aaaaaaaa-0000-0000-0000-0000000a1411', 'Renamed after assignment', '00000000-0000-0000-0000-000000000a13',
    '[{"user_id":"00000000-0000-0000-0000-000000000a11","is_mandatory":true}]'::jsonb)
$$, 'editing her OWN team''s task (now Creative''s, same assignee) is allowed — the task is within reach');

-- 5. A team member holds no grant: refused in words, as ever.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000a13'),true);
select throws_ok($$
  select public.update_task_assignment('aaaaaaaa-0000-0000-0000-0000000a1413', 'Create Content — social posts 3', '00000000-0000-0000-0000-000000000a13',
    '[{"user_id":"00000000-0000-0000-0000-000000000a11","is_mandatory":true}]'::jsonb)
$$, '42501', null, 'a team member cannot assign — the grant, not the reach');

select * from finish();
rollback;
