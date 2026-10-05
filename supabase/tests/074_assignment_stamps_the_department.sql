-- I28.6/I28.7 (ADR-0060 d.9) — a task counts against the department of whoever is doing it.
--
-- `public.update_task_assignment` wrote the assignee and never touched `department_id`, while the
-- `/deliverables` add form passed it — two assignment surfaces disagreeing about the same fact. A
-- materialised task inherits the DELIVERABLE's department, stamped from its OWNER (ADR-0050), so an
-- OOH deliverable owned by a creative lead lays down Installation stamped Creative. Hand it to
-- somebody in Production and it stayed counted against Creative in every per-department number.
--
-- ADR-0060 makes `/schedule` the main assignment surface, so this would have gone from a defect
-- reachable on one screen to the normal path.
--
-- **Assertion 3 is the one that is really about security rather than reporting.** The write-scope
-- gate must be evaluated against the task's placement BEFORE the change. Read it after, and this
-- becomes a way to move a task out of a department you have no authority over by assigning it to
-- somebody in one you do.
--
-- Subjects (helpers/seed.sql, tenant A): a001 power_admin, a002 scheduler (both hold
-- project_tasks:manage + tenant scope), a003 team_member.

begin;
select plan(9);
\ir helpers/seed.sql

reset role;

-- Two departments and a person in each, so "followed the assignee" is distinguishable from
-- "happened to already be right".
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000074c1','aaaaaaaa-0000-0000-0000-000000000001','Creative 74'),
  ('aaaaaaaa-0000-0000-0000-0000000074c2','aaaaaaaa-0000-0000-0000-000000000001','Production 74')
on conflict do nothing;

update user_profiles set department_id = 'aaaaaaaa-0000-0000-0000-0000000074c2', team_id = null
 where id = '00000000-0000-0000-0000-00000000a003';

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000074f1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','S74');

-- The deliverable is CREATIVE-owned, so its tasks are stamped Creative — the real shape. Owned by
-- a Creative person for real (22 Sep, I53.29): the department is stamped FROM the owner, and an
-- ownerless row is stamped null whatever is inserted — the seed helper then gave it the fixture
-- department and, since 20260922110000, the unassigned task followed it.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000074a0', 'lead74@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id) values
  ('00000000-0000-0000-0000-0000000074a0', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative lead 74',
   (select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'department_lead'),
   'aaaaaaaa-0000-0000-0000-0000000074c1');
insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000074e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000074f1','Billboard 74','in_progress',
   '00000000-0000-0000-0000-0000000074a0');

insert into sub_tasks (id, tenant_id, deliverable_id, title, status, department_id, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000074a1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000074e1','Installation','todo',
   'aaaaaaaa-0000-0000-0000-0000000074c1', 8);
-- 20 Sep: the department has accepted this work (ADR-0072 d.6) — see helpers/seed.sql.
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-00000000e001');

select is((select department_id from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000074a1'),
  'aaaaaaaa-0000-0000-0000-0000000074c1'::uuid,
  'the task starts stamped with the DELIVERABLE''s department, as the materialiser leaves it');

-- ============================================ 2-4. the stamp follows the assignee ====
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

select lives_ok(
  $$select public.update_task_assignment(
      'aaaaaaaa-0000-0000-0000-0000000074a1', 'Installation',
      '00000000-0000-0000-0000-00000000a003',
      '[{"user_id": "00000000-0000-0000-0000-00000000a001", "is_mandatory": true}]'::jsonb)$$,
  'the task is assigned to somebody in another department');

select is((select department_id from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000074a1'),
  'aaaaaaaa-0000-0000-0000-0000000074c2'::uuid,
  'and the task now counts against the department of the person DOING it');

select is((select assignee_id from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000074a1'),
  '00000000-0000-0000-0000-00000000a003'::uuid,
  'the assignee is written — the half ADR-0029 promised and ADR-0060 finally delivers');

-- ================================ 5. a person with no department wipes nothing ====
-- COALESCE, not a bare assignment: an unrecorded placement is not a statement that the task belongs
-- nowhere, and blanking a department would silently drop the task out of its own team's numbers.
reset role;
update user_profiles set department_id = null, team_id = null
 where id = '00000000-0000-0000-0000-00000000a002';

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select public.update_task_assignment(
  'aaaaaaaa-0000-0000-0000-0000000074a1', 'Installation',
  '00000000-0000-0000-0000-00000000a002',
  '[{"user_id": "00000000-0000-0000-0000-00000000a001", "is_mandatory": true}]'::jsonb);

select is((select department_id from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000074a1'),
  'aaaaaaaa-0000-0000-0000-0000000074c2'::uuid,
  'assigning somebody with no department recorded LEAVES the department alone rather than clearing it');

-- ======================== 6. the assignee is still fenced to the tenant ====
select throws_ok(
  $$select public.update_task_assignment(
      'aaaaaaaa-0000-0000-0000-0000000074a1', 'Installation',
      '00000000-0000-0000-0000-0000000000b3',
      '[{"user_id": "00000000-0000-0000-0000-00000000a001", "is_mandatory": true}]'::jsonb)$$,
  '22023', null,
  'a uuid from another tenant is refused — the placement is READ from the profile, not trusted');

-- ================== 7-8. the rules this must not have softened ====
-- ADR-0043 d.4: an assigned live task must have a reviewer. Sending an empty list says "nobody
-- reviews this", which is refused here rather than as a raw constraint violation at commit.
select throws_ok(
  $$select public.update_task_assignment(
      'aaaaaaaa-0000-0000-0000-0000000074a1', 'Installation',
      '00000000-0000-0000-0000-00000000a003', '[]'::jsonb)$$,
  '22023', null,
  'an empty reviewer list is still refused (ADR-0043 d.4, unmodified)');

-- ADR-0048 d.8: nothing on an unapproved campaign may be assigned. The gate is a trigger, so it
-- fires whatever route the write came in by — including this one.
reset role;
update campaigns set status = 'pending_approval'
 where id = 'aaaaaaaa-0000-0000-0000-00000000e001';
update sub_tasks set assignee_id = null where id = 'aaaaaaaa-0000-0000-0000-0000000074a1';

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select throws_ok(
  $$select public.update_task_assignment(
      'aaaaaaaa-0000-0000-0000-0000000074a1', 'Installation',
      '00000000-0000-0000-0000-00000000a003',
      '[{"user_id": "00000000-0000-0000-0000-00000000a001", "is_mandatory": true}]'::jsonb)$$,
  '42501', null,
  'work on an unapproved campaign still cannot be assigned (ADR-0048 d.8, unmodified)');

-- ==================================== 9. taking a task on from another department ====
-- Was "the gate reads the PRE-change placement" — a002, scoped to Creative 74, could not touch a
-- task in Production 74 by naming an assignee inside their own scope. ADR-0060's 22 Sep addendum
-- withdrew that gate and ADR-0098 widened the reach: the same call is now the intended act.
reset role;
update campaigns set status = 'approved' where id = 'aaaaaaaa-0000-0000-0000-00000000e001';
update user_profiles set department_id = 'aaaaaaaa-0000-0000-0000-0000000074c1'
 where id = '00000000-0000-0000-0000-00000000a002';
update sub_tasks set department_id = 'aaaaaaaa-0000-0000-0000-0000000074c2', assignee_id = null
 where id = 'aaaaaaaa-0000-0000-0000-0000000074a1';
update roles set scope = 'department'
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'scheduler';

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);
-- ADR-0060 addendum (22 Sep) withdrew d.9's "as it stands" gate, and ADR-0098 made the act
-- explicit: a caller with the booking grant takes a task from another department by naming a
-- person they may schedule. What remains refused is an EDIT with no change of assignee (141).
select lives_ok(
  $$select public.update_task_assignment(
      'aaaaaaaa-0000-0000-0000-0000000074a1', 'Installation',
      '00000000-0000-0000-0000-00000000a002',
      '[{"user_id": "00000000-0000-0000-0000-00000000a001", "is_mandatory": true}]'::jsonb)$$,
  'naming an assignee you may schedule takes on a task from another department (ADR-0060 addendum, ADR-0098)');

select * from finish();
rollback;
