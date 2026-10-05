-- I59.31 / E11 (25 Sep) — a task cannot be assigned without hours allocated, on every route, refused by
-- the database in words: a direct insert and update (even a system path), update_task_assignment (the
-- Schedule modal and the drag), save_sub_task (the task editor), create_adhoc_deliverable, a bare PATCH,
-- and a booking request (ADR-0087). Hours given with the assignment — or already on the task — pass;
-- unassigning and editing are untouched.
--
-- a001 Admin A (power admin: schedules anyone, reviews) · a002 Booker A · a003 Creative A, the maker.
begin;
select plan(19);
\ir helpers/seed.sql

-- Three tasks on the ad-hoc fixture deliverable (f101, reviewer a001), none with hours.
insert into sub_tasks (id, tenant_id, deliverable_id, title, status) values
  ('aaaaaaaa-0000-0000-0000-0000000f1751', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f101', 'Retouch 175', 'todo'),
  ('aaaaaaaa-0000-0000-0000-0000000f1752', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f101', 'Resize 175', 'todo'),
  ('aaaaaaaa-0000-0000-0000-0000000f1754', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f101', 'Crop 175', 'todo');

-- ---------------------------------------------------------------- the database, directly ----
select throws_ok($$
  insert into sub_tasks (tenant_id, deliverable_id, title, status, assignee_id) values
    ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f101', 'Bare 175', 'todo',
     '00000000-0000-0000-0000-00000000a003')
$$, '22023', '"Bare 175" has no hours allocated, so it cannot be assigned — give it its hours first.',
  'a task inserted WITH an assignee and no hours is refused, the task named — even with no caller (a system path)');
select throws_ok($$
  update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a003' where id = 'aaaaaaaa-0000-0000-0000-0000000f1751'
$$, '22023', null, 'giving an hour-less task to a person is refused');
select lives_ok($$
  update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a003', sla_hours = 3 where id = 'aaaaaaaa-0000-0000-0000-0000000f1752'
$$, 'the hours given in the same statement pass');
update sub_tasks set assignee_id = null where id = 'aaaaaaaa-0000-0000-0000-0000000f1752';
select is((select sla_hours from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000f1752'), 3.00::numeric(6,2),
  'unassigning is untouched (and the hours stay on the task)');

-- ---------------------------------------------------------------- the Schedule's RPC ----
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select throws_ok($$
  select public.update_task_assignment('aaaaaaaa-0000-0000-0000-0000000f1751', 'Retouch 175',
    '00000000-0000-0000-0000-00000000a003',
    '[{"user_id": "00000000-0000-0000-0000-00000000a001", "is_mandatory": true}]'::jsonb)
$$, '22023', '"Retouch 175" has no hours allocated, so it cannot be assigned — give it its hours first.',
  'update_task_assignment (the modal, the drag) with no hours sent and none on the task: refused in words');
select is((select assignee_id from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000f1751'), null::uuid,
  'and nothing was assigned');
select lives_ok($$
  select public.update_task_assignment('aaaaaaaa-0000-0000-0000-0000000f1751', 'Retouch 175',
    '00000000-0000-0000-0000-00000000a003',
    '[{"user_id": "00000000-0000-0000-0000-00000000a001", "is_mandatory": true}]'::jsonb,
    '2026-10-04 06:00+00', '2026-10-05 15:00+00', 6)
$$, 'with its hours, it is assigned');
select is((select array[assignee_id::text, sla_hours::text] from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000f1751'),
  array['00000000-0000-0000-0000-00000000a003', '6.00'], 'to the maker, with 6 hours');
select lives_ok($$
  select public.update_task_assignment('aaaaaaaa-0000-0000-0000-0000000f1751', 'Retouch 175',
    '00000000-0000-0000-0000-00000000a002', null)
$$, 'a reassignment (the drag) that sends no hours passes — the task already has them');

-- ---------------------------------------------------------------- the task editor ----
select throws_ok($$
  select public.save_sub_task(null, 'aaaaaaaa-0000-0000-0000-00000000f101', 'Cut-downs 175',
    '[{"user_id": "00000000-0000-0000-0000-00000000a001", "is_mandatory": true}]'::jsonb,
    null, '00000000-0000-0000-0000-00000000a003')
$$, '22023', null, 'save_sub_task: a new task given to a person with no hours is refused');
select lives_ok($$
  select public.save_sub_task(null, 'aaaaaaaa-0000-0000-0000-00000000f101', 'Cut-downs 175',
    '[{"user_id": "00000000-0000-0000-0000-00000000a001", "is_mandatory": true}]'::jsonb,
    null, '00000000-0000-0000-0000-00000000a003', null, null, 2)
$$, 'save_sub_task: with 2 hours, saved and assigned');

-- ---------------------------------------------------------------- an ad-hoc job ----
select throws_ok($$
  select public.create_adhoc_deliverable('00000000-0000-0000-0000-00000000a003', 'Quick fix 175', null,
    '2026-10-04 06:00+00', '2026-10-04 15:00+00', '00000000-0000-0000-0000-00000000a001')
$$, '22023', null, 'create_adhoc_deliverable with no hours is refused');
select lives_ok($$
  select public.create_adhoc_deliverable('00000000-0000-0000-0000-00000000a003', 'Quick fix 175', 2,
    '2026-10-04 06:00+00', '2026-10-04 15:00+00', '00000000-0000-0000-0000-00000000a001')
$$, 'with its hours it is created and assigned');

-- ---------------------------------------------------------------- a bare PATCH ----
select throws_ok($$
  update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a003' where id = 'aaaaaaaa-0000-0000-0000-0000000f1754'
$$, '22023', null, 'a bare PATCH of the assignee is refused the same way — the table holds the rule, not the door');

-- ---------------------------------------------------------------- a booking request ----
reset role;
update sub_tasks set sla_hours = null where id = 'aaaaaaaa-0000-0000-0000-0000000f1752';
select throws_ok($$
  insert into sub_task_assignment_requests (tenant_id, sub_task_id, resource_id, assignee_id, requested_by, title)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000f1752', 'aaaaaaaa-0000-0000-0000-00000000d0a3',
          '00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-00000000a002', 'Resize 175')
$$, '22023', null, 'a booking request with no hours, for a task with none, is refused when asked — not on approval');
select lives_ok($$
  insert into sub_task_assignment_requests (tenant_id, sub_task_id, resource_id, assignee_id, requested_by, title, hours)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000f1752', 'aaaaaaaa-0000-0000-0000-00000000d0a3',
          '00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-00000000a002', 'Resize 175', 4)
$$, 'with the hours in the request, it is raised');
delete from sub_task_assignment_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000f1752';
update sub_tasks set sla_hours = 5 where id = 'aaaaaaaa-0000-0000-0000-0000000f1752';
select lives_ok($$
  insert into sub_task_assignment_requests (tenant_id, sub_task_id, resource_id, assignee_id, requested_by, title)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000f1752', 'aaaaaaaa-0000-0000-0000-00000000d0a3',
          '00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-00000000a002', 'Resize 175')
$$, 'and a request for a task that already has hours needs none of its own');

-- ---------------------------------------------------------------- existing work is left alone ----
-- A task assigned before E11 with its hours later cleared (the only way one can exist now).
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, assignee_id, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000f1753', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f101',
   'Legacy 175', 'todo', '00000000-0000-0000-0000-00000000a003', 1);
update sub_tasks set sla_hours = null where id = 'aaaaaaaa-0000-0000-0000-0000000f1753';
select lives_ok($$ update sub_tasks set title = 'Legacy 175 — renamed' where id = 'aaaaaaaa-0000-0000-0000-0000000f1753' $$,
  'an already-assigned task without hours can still be edited — the rule is about the moment of assigning');
select lives_ok($$ update sub_tasks set assignee_id = null where id = 'aaaaaaaa-0000-0000-0000-0000000f1753' $$,
  'and unassigned');

select * from finish();
rollback;
