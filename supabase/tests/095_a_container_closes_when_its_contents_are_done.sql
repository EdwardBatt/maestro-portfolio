-- ADR-0077 / I40.23 — a container closes when its contents are done (8 Sep).
--
-- ADR-0058 d.6 was decided in August and never fired once: the automatic sign-off was gated on the
-- deliverable being `in_review`, and nothing in the system ever wrote that state. Eleven ad-hoc
-- deliverables sat with their only task done AND approved while the container stayed `in_progress`,
-- unreachable from both directions — no automatic path, and no button on the Ad-hoc tab either.
--
-- The assertions that matter most here are the NEGATIVE ones. A container closing itself is a write
-- that happens without anybody asking for it, so what it must NOT do is the load-bearing half:
-- it must not close while work is outstanding, and it must not need a permission the person
-- approving the task does not have.
begin;
select plan(10);
\ir helpers/seed.sql

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000095d1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S');

-- One deliverable, two tasks: the shape that proves the last approval carries it and an earlier one
-- does not.
-- The fixture department (ADR-0099 d.2, 23 Sep): a deliverable's department is its own and is no
-- longer derived from the owner, so a fixture that names an owner with no department must say
-- which department the work belongs to. Created here rather than assumed.
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000de0ff', 'aaaaaaaa-0000-0000-0000-000000000001', 'Fixture dept')
on conflict (id) do nothing;

insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id, due_at, owner_user_id, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000095e1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000095d1',
   'KV','in_progress','00000000-0000-0000-0000-00000000a001','2026-10-01 15:00+00', '00000000-0000-0000-0000-00000000a001', 'aaaaaaaa-0000-0000-0000-0000000de0ff');
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000095a1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000095e1',
   '00000000-0000-0000-0000-00000000a003','Retouch','review', 8),
  ('aaaaaaaa-0000-0000-0000-0000000095a2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000095e1',
   '00000000-0000-0000-0000-00000000a003','Colour','review', 8);

-- No reviewer insert: `subtask_seed_reviewer` already appoints the deliverable's reviewer (a001) to
-- every new task, and a reviewer must hold `reviews:moderate` to be appointed at all. Worth knowing
-- for d.1 — the authority to close the container was never MISSING on this path. d.1 removes a check
-- that was always going to pass, so the rule reads as what it is (a rollup of decisions already
-- made) rather than as an act somebody performs on a container.

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);

-- The container's own review state is NOT removed here — see the migration header. Fifteen suites
-- drive it, and unpicking that is its own piece of work (I40.25).

-- ---- the first approval does NOT close it ----
-- Through `public.sub_task_approve`, the wrapper the reviewer inbox actually calls. Poking
-- `app.maybe_complete_sub_task` directly proves nothing about the path a person takes.
select lives_ok(
  $$ select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000095a1') $$,
  'the appointed reviewer approves the first task');

select is(
  (select status::text from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000095a1'),
  'done', 'the task is done (ADR-0038, unchanged)');

select is(
  (select state::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000095e1'),
  'in_progress',
  'and the container does NOT close — one task is still outstanding');

-- ---- the last approval closes it, from in_progress, which is where containers actually sit ----
select lives_ok(
  $$ select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000095a2') $$,
  'the reviewer approves the last task');

select is(
  (select state::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000095e1'),
  'approved',
  'the container closes when its contents are done — ADR-0058 d.6, finally reachable from in_progress');

-- ---- the bookkeeping the guard does is NOT skipped ----
select is(
  (select count(*)::int from sla_events
    where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000095e1' and event_type = 'approved'),
  1,
  'the sign-off is recorded as an sla_event, exactly as a manual one would be');

-- ---- it still cannot close over live work ----
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id, due_at, owner_user_id, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000095e2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000095d1',
   'Film','in_progress','00000000-0000-0000-0000-00000000a001','2026-10-01 15:00+00', '00000000-0000-0000-0000-00000000a001', 'aaaaaaaa-0000-0000-0000-0000000de0ff');
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000095a3','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000095e2',
   '00000000-0000-0000-0000-00000000a003','Edit','in_progress', 8);

select throws_ok(
  $$ update deliverables set state = 'approved' where id = 'aaaaaaaa-0000-0000-0000-0000000095e2' $$,
  '55000',
  null,
  'a container cannot close while a task on it is still being worked on (ADR-0038, unchanged)');

-- ---- a cancelled-only deliverable is left exactly as it is (d.6) ----
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id, due_at, owner_user_id, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000095e3','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000095d1',
   'Abandoned','in_progress','00000000-0000-0000-0000-00000000a001','2026-10-01 15:00+00', '00000000-0000-0000-0000-00000000a001', 'aaaaaaaa-0000-0000-0000-0000000de0ff');
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000095a4','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000095e3',
   '00000000-0000-0000-0000-00000000a003','Called off','cancelled', 8);
select is(
  (select state::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000095e3'),
  'in_progress',
  'work that was CALLED OFF is not recorded as approved — nothing was ever agreed (d.6)');

-- I40.24: and it cannot be closed by somebody without sign-off authority. `cancelled` counts as
-- SETTLED for the readiness gate, so without the "something was actually approved" test in the
-- authority branch the rollup path would wave this through for anyone who could reach the row.
-- a002 is the scheduler: project_tasks:manage, no reviews:moderate.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select throws_ok(
  $$ update deliverables set state = 'approved' where id = 'aaaaaaaa-0000-0000-0000-0000000095e3' $$,
  '42501',
  null,
  'and it cannot be signed off by somebody without reviews:moderate — there is nothing to roll up');

-- ---- task review is untouched: the sixteen live ones keep working ----
select is(
  (select status::text from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000095a3'),
  'in_progress',
  'nothing here reads or writes a task status except to ask whether it is settled (d.7)');

select * from finish();
rollback;
