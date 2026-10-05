-- I49.67: Remove on a task the SLA log has recorded CANCELS it; a task with no record is deleted.
--
-- The case that failed on 15 Sep, reproduced: a task is given to somebody (its commitment is
-- stamped, so the log writes `deadline_set`), then cancelled and reinstated — unassigned, `todo`,
-- no time logged. Under `20260828230000` that read as "a plan", `remove_sub_task` tried to DELETE,
-- and `fk_sla_events_sub_task_tenant` refused it (23503). Now the log counts as history and the
-- same press cancels the task, record intact. A sibling that was never recorded is still deleted.
--
-- Subjects: a001 = Admin A (holds project_tasks:manage, whole-tenant scope).

begin;
select plan(6);
\ir helpers/seed.sql

reset role;

insert into deliverables (id, tenant_id, job_id, name, state) values
  ('aaaaaaaa-0000-0000-0000-000000001210','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001','Removal after history','in_progress');

-- Two unassigned, todo, unworked tasks. The first is then given a commitment — what assigning it
-- would stamp — which the deadline-log trigger records; the second is never touched.
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order) values
  ('aaaaaaaa-0000-0000-0000-0000000121a1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000001210','Once committed','todo', 1),
  ('aaaaaaaa-0000-0000-0000-0000000121a2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000001210','Never recorded','todo', 2);

update sub_tasks
   set committed_starts_at = '2026-10-01T06:00:00Z', committed_due_at = '2026-10-03T14:00:00Z',
       starts_at = '2026-10-01T06:00:00Z', due_at = '2026-10-03T14:00:00Z'
 where id = 'aaaaaaaa-0000-0000-0000-0000000121a1';

select is(
  (select count(*)::int from sla_events where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000121a1'),
  1, 'the commitment is in the log — the task has history though nobody holds it now');

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

-- THE assertion: the press that used to be refused with 23503.
select lives_ok(
  $$select public.remove_sub_task('aaaaaaaa-0000-0000-0000-0000000121a1')$$,
  'removing a task the log has recorded is not refused');

reset role;
select is(
  (select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000121a1'),
  'cancelled', 'it is cancelled, not deleted — the record survives');

select is(
  (select count(*)::int from sla_events where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000121a1'),
  1, 'and its log row is untouched');

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

-- The other branch is unchanged: nothing recorded, nothing kept.
select is(
  (select public.remove_sub_task('aaaaaaaa-0000-0000-0000-0000000121a2')),
  'deleted', 'a task with no record at all is still deleted outright');

reset role;
select is(
  (select count(*)::int from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000121a2'),
  0, 'and is gone');

select finish();
rollback;
