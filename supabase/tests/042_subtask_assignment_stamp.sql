-- Accountability: sub_tasks.assigned_at/assigned_by are server-controlled — stamped on
-- assign/reassign with the acting user, frozen on other edits, cleared on unassign, and never
-- client-forgeable. Seed (tenant A): a001 power_admin, a002 scheduler (both hold project_tasks:manage
-- + tenant scope, so both can write sub_tasks), a003 team_member (the assignee). Deliverable f101.
begin;
select plan(8);
\ir helpers/seed.sql

set local role authenticated;

-- a001 assigns a new task to a003.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, sla_hours)
  values ('dddd0000-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-00000000a003', 'ST assign', 8);

select is((select assigned_by from sub_tasks where id = 'dddd0000-0000-0000-0000-0000000000d1'),
  '00000000-0000-0000-0000-00000000a001'::uuid, 'assigned_by = the assigner (a001)');
select ok((select assigned_at is not null from sub_tasks where id = 'dddd0000-0000-0000-0000-0000000000d1'),
  'assigned_at is stamped on assign');

-- a002 reassigns the task → the stamp re-points to a002.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);
-- ADR-0038: the task inherits a001 as its reviewer, so a001 cannot also be its assignee. Who the
-- work lands on is incidental here — the assertion is that the STAMP re-points to the reassigner.
update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a002' where id = 'dddd0000-0000-0000-0000-0000000000d1';
select is((select assigned_by from sub_tasks where id = 'dddd0000-0000-0000-0000-0000000000d1'),
  '00000000-0000-0000-0000-00000000a002'::uuid, 'reassignment re-stamps assigned_by to the reassigner (a002)');

-- a001 edits a non-assignee field → the stamp is frozen (does NOT become a001).
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
update sub_tasks set title = 'ST retitled' where id = 'dddd0000-0000-0000-0000-0000000000d1';
select is((select assigned_by from sub_tasks where id = 'dddd0000-0000-0000-0000-0000000000d1'),
  '00000000-0000-0000-0000-00000000a002'::uuid, 'a non-assignee edit does not change assigned_by (frozen)');

-- Unassign → both cleared.
update sub_tasks set assignee_id = null where id = 'dddd0000-0000-0000-0000-0000000000d1';
select is((select assigned_by from sub_tasks where id = 'dddd0000-0000-0000-0000-0000000000d1'),
  null, 'unassign clears assigned_by');
select is((select assigned_at from sub_tasks where id = 'dddd0000-0000-0000-0000-0000000000d1'),
  null, 'unassign clears assigned_at');

-- Re-assign after unassign → assigned_at is stamped again (proves the assign branch SETS it, rather
-- than the freeze branch leaving the just-cleared null in place). now() is constant within the txn,
-- so a null→not-null transition is the way to prove re-stamping.
update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a003' where id = 'dddd0000-0000-0000-0000-0000000000d1';
select ok((select assigned_at is not null from sub_tasks where id = 'dddd0000-0000-0000-0000-0000000000d1'),
  'reassign after unassign re-stamps assigned_at');

-- A client cannot forge the stamp: supplying assigned_by on insert is overridden with auth.uid().
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, assigned_by, title, sla_hours)
  values ('dddd0000-0000-0000-0000-0000000000d2', 'aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-00000000a003',
          '00000000-0000-0000-0000-00000000a003', 'ST spoof', 8);
select is((select assigned_by from sub_tasks where id = 'dddd0000-0000-0000-0000-0000000000d2'),
  '00000000-0000-0000-0000-00000000a001'::uuid, 'client-supplied assigned_by is overridden with the real actor');

select finish();
rollback;
