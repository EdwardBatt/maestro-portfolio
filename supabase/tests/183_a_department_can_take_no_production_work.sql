-- 20260926190000 (ADR-0115, I59.46) — a department that does no production work is not offered for work.
--
--   d.1  every department starts ON;
--   d.5  switching one off is refused while it owns live work, naming it; allowed with none; ON always;
--   d.6  no new work lands there — a deliverable (its department follows its owner), a task given to one
--        of its people, a booking on one of them — while a reviewer appointment (CS) is still allowed.
begin;
select plan(11);
\ir helpers/seed.sql

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000de183', 'aaaaaaaa-0000-0000-0000-000000000001', 'Finance 183');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000183d1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S183');
-- Live work in the fixture department: owned by a001, whose department it is.
insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id, reviewer_id, due_at) values
  ('aaaaaaaa-0000-0000-0000-0000000183e1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000183d1',
   'Live piece 183','in_progress','00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-00000000a001','2026-11-30 15:00:00+00');
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-00000000e001');

-- d.1
select is((select is_production from departments where id = 'aaaaaaaa-0000-0000-0000-0000000de183'), true,
  'd.1: a department starts ON');

-- d.5
select throws_ok(
  $$ update departments set is_production = false where id = 'aaaaaaaa-0000-0000-0000-0000000de0ff' $$,
  '23514', null,
  'd.5: a department with live work cannot be switched off');
select throws_like(
  $$ update departments set is_production = false where id = 'aaaaaaaa-0000-0000-0000-0000000de0ff' $$,
  '%Live piece 183%',
  'd.5: the refusal names the work that must move');
select lives_ok(
  $$ update departments set is_production = false where id = 'aaaaaaaa-0000-0000-0000-0000000de183' $$,
  'd.5: a department with no live work is switched off');

-- d.5 again, through a person: a001 owns "Live piece 183", which follows its owner (ADR-0102), so
-- moving a001 into the switched-off department is refused — the live work would land there.
select throws_ok(
  $$ update user_profiles set department_id = 'aaaaaaaa-0000-0000-0000-0000000de183'
      where id = '00000000-0000-0000-0000-00000000a001' $$,
  '23514', null,
  'd.5/d.6: the owner of live work cannot be moved into a switched-off department');

-- d.6 — the live piece passes to a002 (the owner-is-a-lead check is skipped for this superuser set-up),
-- so a001 owns nothing and moves into the switched-off department. a001 can moderate reviews, which the
-- reviewer check below needs.
update deliverables set owner_user_id = '00000000-0000-0000-0000-00000000a002'
 where id = 'aaaaaaaa-0000-0000-0000-0000000183e1';
update user_profiles set department_id = 'aaaaaaaa-0000-0000-0000-0000000de183'
 where id = '00000000-0000-0000-0000-00000000a001';

select throws_ok(
  $$ insert into deliverables (tenant_id, stream_id, name, state, owner_user_id, reviewer_id, due_at) values
       ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000183d1','New piece 183','draft',
        '00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-00000000a001','2026-11-30 15:00:00+00') $$,
  '23514', null,
  'd.6: a deliverable owned in a switched-off department is refused (its department follows its owner)');

select throws_ok(
  $$ insert into sub_tasks (tenant_id, deliverable_id, title, status, sla_hours, assignee_id) values
       ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000183e1','Task for Finance','todo', 4,
        '00000000-0000-0000-0000-00000000a001') $$,
  '23514', null,
  'd.6: a task cannot be given to someone in a switched-off department');

select throws_ok(
  $$ insert into bookings (tenant_id, resource_id, starts_at, ends_at, state, booked_by) values
       ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000d0a1',
        '2026-11-10 06:00:00+00','2026-11-10 10:00:00+00','confirmed','00000000-0000-0000-0000-00000000a002') $$,
  '23514', null,
  'd.6: a booking on someone in a switched-off department is refused (their department read through their profile)');

-- d.4: a reviewer from a switched-off department (CS reviews and approves) is still appointed.
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000183a1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000183e1',
   'Unassigned 183','todo', 4);
select lives_ok(
  $$ insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory) values
       ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000183a1','00000000-0000-0000-0000-00000000a001', true) $$,
  'd.4: someone in a switched-off department can still be appointed a reviewer');

select lives_ok(
  $$ update departments set is_production = true where id = 'aaaaaaaa-0000-0000-0000-0000000de183' $$,
  'd.5: switching back on is always allowed');
select lives_ok(
  $$ insert into sub_tasks (tenant_id, deliverable_id, title, status, sla_hours, assignee_id) values
       ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000183e1','Task back on','todo', 4,
        '00000000-0000-0000-0000-00000000a001') $$,
  'd.6: once back on, the same task can be given to them');

select * from finish();
rollback;
