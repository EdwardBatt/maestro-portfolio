-- I52.7 (17 Sep) — a reinstated task is announced to the people who can assign it, never to the
-- person who lost it.
--
-- Edward, reading the `task_reinstated` mail as sent: "the reinstatement requires action… it
-- cannot be assigned by a team member." Reinstate clears the assignee and rebuilds nothing
-- (ADR-0068 d.5), so the mail was going to the one person who could do nothing about it.
--
--   * Reinstated UNASSIGNED: the leads whose reach covers the task's department/team (the ADR-0087
--     d.6 shape, over the task) and the deliverable's owner are told. The former assignee is NOT.
--     The caller is NOT. A lead of another department is NOT.
--   * Reinstated with `p_assigning`: nobody is told by reinstate — the assignment that follows
--     carries the ordinary `assigned` notification, and one event is not worded twice.
--   * Everything ADR-0068 promised still holds: todo, unassigned, no bookings, only from cancelled.
--
-- Every case runs as `authenticated` with the caller's own claims.
begin;
select plan(8);
\ir helpers/seed.sql

-- ---------------------------------------------------------------- fixtures ----
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a030', 'creative-lead@a.test'),
  ('00000000-0000-0000-0000-00000000a031', 'copy-lead@a.test'),
  ('00000000-0000-0000-0000-00000000a032', 'media-lead@a.test'),
  ('00000000-0000-0000-0000-00000000a033', 'copy-maker@a.test'),
  ('00000000-0000-0000-0000-00000000a034', 'owner-lead@a.test');

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de1240','aaaaaaaa-0000-0000-0000-000000000001','Creative'),
  ('aaaaaaaa-0000-0000-0000-000000de1241','aaaaaaaa-0000-0000-0000-000000000001','Media');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000f1240','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000de1240','Copy');

insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
          and r.key = v.role_key),
       v.dept::uuid, v.team::uuid
from (values
  ('00000000-0000-0000-0000-00000000a030','Creative Lead', 'department_lead','aaaaaaaa-0000-0000-0000-000000de1240', null),
  ('00000000-0000-0000-0000-00000000a031','Copy Lead',     'team_lead',      'aaaaaaaa-0000-0000-0000-000000de1240','aaaaaaaa-0000-0000-0000-0000000f1240'),
  ('00000000-0000-0000-0000-00000000a032','Media Lead',    'department_lead','aaaaaaaa-0000-0000-0000-000000de1241', null),
  ('00000000-0000-0000-0000-00000000a033','Copy Maker',    'team_member',    'aaaaaaaa-0000-0000-0000-000000de1240','aaaaaaaa-0000-0000-0000-0000000f1240'),
  -- The deliverable's owner: a lead of ANOTHER department, so "the owner is told" is distinguishable
  -- from "a lead in reach is told".
  ('00000000-0000-0000-0000-00000000a034','Owner Lead',    'department_lead','aaaaaaaa-0000-0000-0000-000000de1241', null)
) as v(id, name, role_key, dept, team);

insert into test_claims (id, jwt)
select up.id,
       json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id in ('00000000-0000-0000-0000-00000000a030','00000000-0000-0000-0000-00000000a033');

insert into deliverables (id, tenant_id, job_id, name, reviewer_id, owner_user_id, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000ca124','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001','Reinstate fixture','00000000-0000-0000-0000-00000000a001',
   '00000000-0000-0000-0000-00000000a034','aaaaaaaa-0000-0000-0000-000000de1240');

-- A Copy task, assigned to the Copy maker, cancelled by the Creative lead.
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, assignee_id, department_id, team_id, sort_order, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000da124','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000ca124','Write Copy','cancelled','00000000-0000-0000-0000-00000000a033',
   'aaaaaaaa-0000-0000-0000-000000de1240','aaaaaaaa-0000-0000-0000-0000000f1240', 1, 8),
  ('aaaaaaaa-0000-0000-0000-0000000da125','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000ca124','Write More Copy','cancelled','00000000-0000-0000-0000-00000000a033',
   'aaaaaaaa-0000-0000-0000-000000de1240','aaaaaaaa-0000-0000-0000-0000000f1240', 2, 8);

delete from notifications where type = 'task_reinstated';

-- ================================================================ unassigned ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a030'),true);

select lives_ok($$
  select public.sub_task_reinstate('aaaaaaaa-0000-0000-0000-0000000da124')
$$, 'the Creative lead reinstates the Copy task, unassigned');

select results_eq($$
  select status, assignee_id is null from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000da124'
$$, $$ values ('todo', true) $$, 'it comes back todo and unassigned (ADR-0068 d.5 still holds)');

-- `notifications` is recipient-scoped: read as superuser.
reset role;
select results_eq($$
  select user_id from notifications
   where type = 'task_reinstated' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000da124'
   order by user_id
$$, $$ values ('00000000-0000-0000-0000-00000000a031'::uuid), ('00000000-0000-0000-0000-00000000a034'::uuid) $$,
  'told: the Copy team lead (in reach) and the deliverable''s owner — exactly those two');

select is((select count(*) from notifications where type = 'task_reinstated'
            and user_id = '00000000-0000-0000-0000-00000000a033')::int, 0,
  'the former assignee is NOT told — nothing is theirs to do');
select is((select count(*) from notifications where type = 'task_reinstated'
            and user_id = '00000000-0000-0000-0000-00000000a030')::int, 0,
  'the caller is NOT told what they just did');
select is((select count(*) from notifications where type = 'task_reinstated'
            and user_id = '00000000-0000-0000-0000-00000000a032')::int, 0,
  'a lead of another department, out of reach, is NOT told');

-- ================================================================ assigning ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a030'),true);

select lives_ok($$
  select public.sub_task_reinstate('aaaaaaaa-0000-0000-0000-0000000da125', true)
$$, 'reinstated with p_assigning — the screen is assigning it in the same step');

reset role;
select is((select count(*) from notifications where type = 'task_reinstated'
            and entity_id = 'aaaaaaaa-0000-0000-0000-0000000da125')::int, 0,
  'nobody is told by reinstate when it is being assigned at once — the assignment says so');

-- The `assigned` notification the assignment then raises is app.tg_subtask_notify_assignee's, proven
-- where it was written (20260818140000); the point here is that reinstate adds nothing to it.

select * from finish();
rollback;
