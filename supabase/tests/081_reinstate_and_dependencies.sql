-- I36.2 / I36.3 / I36.5 (ADR-0068, ADR-0069) — undoing a cancellation, and what a requirement means.
--
-- Four properties carry these two changes, and each is one where getting it wrong is silent:
--
--   * Reinstate must NOT bring the bookings back (ADR-0068 d.5). The calendar may have been given
--     to somebody else while the task was cancelled, and quietly re-taking it is the invisible
--     change ADR-0061 exists to stop. A test that only checked `status = 'todo'` would pass on an
--     implementation that re-took the capacity.
--   * Reinstate must clear the assignee, for the same reason: a name on an unscheduled task claims
--     somebody is doing work that is on nobody's calendar.
--   * A dependency is satisfied on APPROVE, not on submit (ADR-0069 d.2). The old rule accepted
--     `review`, so the assertion that matters is the one proving a task IN REVIEW still holds its
--     dependent.
--   * The notification fires when the LAST requirement clears, once — not once per prerequisite.
--
-- Every case runs as `authenticated` with the caller's own JWT claims, never as superuser: the
-- guards read `app.has_permission()` and `app.in_write_scope()`, so a superuser run would prove
-- nothing at all.
begin;
select plan(20);
\ir helpers/seed.sql

-- ---------------------------------------------------------------- extra fixtures ----
-- a002 (scheduler) holds project_tasks:manage and is account-scoped in the seed, so it can manage
-- work anywhere in tenant A — the authority `sub_task_cancel` and `sub_task_reinstate` share.
insert into deliverables (id, tenant_id, job_id, name, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-00000000ca01','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001','Dependency fixture','00000000-0000-0000-0000-00000000a001');

insert into sub_tasks (id, tenant_id, deliverable_id, title, status, assignee_id, sort_order, sla_hours) values
  -- A: the prerequisite.
  ('aaaaaaaa-0000-0000-0000-0000000da001','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000ca01','Storyboard','review','00000000-0000-0000-0000-00000000a003', 1, 8),
  -- B: waits on A.
  ('aaaaaaaa-0000-0000-0000-0000000da002','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000ca01','Animation','todo','00000000-0000-0000-0000-00000000a003', 2, 8),
  -- C: a second prerequisite for B, so "one message, not three" is testable.
  ('aaaaaaaa-0000-0000-0000-0000000da003','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000ca01','Script','todo','00000000-0000-0000-0000-00000000a002', 3, 8),
  -- D: to be cancelled and reinstated.
  ('aaaaaaaa-0000-0000-0000-0000000da004','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000ca01','To cancel','todo','00000000-0000-0000-0000-00000000a003', 4, 8);

insert into sub_task_dependencies (tenant_id, sub_task_id, depends_on_sub_task_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000da002','aaaaaaaa-0000-0000-0000-0000000da001'),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000da002','aaaaaaaa-0000-0000-0000-0000000da003');

-- A booking on D, so reinstate has something it could wrongly bring back.
insert into bookings (id, tenant_id, resource_id, sub_task_id, starts_at, ends_at, load_pct, state) values
  ('aaaaaaaa-0000-0000-0000-0000000b1001','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000d001','aaaaaaaa-0000-0000-0000-0000000da004',
   '2026-09-10 06:00+00','2026-09-10 10:00+00', 50, 'confirmed');

-- ================================================================ ADR-0069 d.2 ====
-- A is in `review` — submitted, not approved.
select ok(app.sub_task_has_unmet_prereqs('aaaaaaaa-0000-0000-0000-0000000da002'),
  'a prerequisite IN REVIEW does NOT satisfy — the old rule released work about to be sent back');

select set_config('app.system_op','on',true);
update sub_tasks set status = 'done' where id = 'aaaaaaaa-0000-0000-0000-0000000da001';
select set_config('app.system_op','off',true);
select ok(app.sub_task_has_unmet_prereqs('aaaaaaaa-0000-0000-0000-0000000da002'),
  'one approved prerequisite is not enough while another is outstanding');

select set_config('app.system_op','on',true);
update sub_tasks set status = 'done' where id = 'aaaaaaaa-0000-0000-0000-0000000da003';
select set_config('app.system_op','off',true);
select ok(not app.sub_task_has_unmet_prereqs('aaaaaaaa-0000-0000-0000-0000000da002'),
  'satisfied once EVERY prerequisite is approved');

-- A prerequisite that will never happen must not hold its dependent for ever.
update sub_tasks set status = 'cancelled' where id = 'aaaaaaaa-0000-0000-0000-0000000da003';
select ok(not app.sub_task_has_unmet_prereqs('aaaaaaaa-0000-0000-0000-0000000da002'),
  'a CANCELLED prerequisite satisfies — deliberately, or nothing could ever free the dependent');

-- An outstanding external input holds the task even with every dependency met.
update sub_tasks set status = 'done' where id = 'aaaaaaaa-0000-0000-0000-0000000da003';
insert into deliverable_pending_inputs (tenant_id, deliverable_id, description)
values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000ca01','Acme logo pack');
select ok(app.sub_task_has_unmet_prereqs('aaaaaaaa-0000-0000-0000-0000000da002'),
  'an outstanding EXTERNAL input holds the task too — one predicate covers both (d.6)');

update deliverable_pending_inputs set satisfied_at = now()
 where deliverable_id = 'aaaaaaaa-0000-0000-0000-00000000ca01';
select ok(not app.sub_task_has_unmet_prereqs('aaaaaaaa-0000-0000-0000-0000000da002'),
  'clearing the input releases it');

-- Soft, still: nothing here is a gate. `blocked` was dropped by ADR-0030 and stays dropped.
select is_empty($$
  select 1 from pg_constraint c
   where c.conrelid = 'sub_tasks'::regclass and c.conname = 'sub_tasks_status_check'
     and pg_get_constraintdef(c.oid) like '%blocked%'
$$, 'there is still NO `blocked` status — dependencies are shown, never enforced (d.3)');

-- ================================================================ ADR-0069 d.4 ====
-- Reset: B waiting on two, both outstanding, and no notification yet.
update sub_tasks set status = 'todo'
 where id in ('aaaaaaaa-0000-0000-0000-0000000da001','aaaaaaaa-0000-0000-0000-0000000da003');
delete from notifications where type = 'dependency_ready';

-- Approval is the moment, and the trigger hangs off the status REACHING `done` precisely so every
-- route to it behaves the same way — which is what these assertions are about, rather than about
-- `sub_task_approve` (suite 076 covers that).
--
-- Driven as superuser, deliberately. `app.tg_sub_task_completion_guard` refuses a signed-in user
-- who marks a task done without a reviewer's approval — correct, and not worked around here: the
-- guard's OWN escape is `auth.uid() is null`, on the stated grounds that "a migration or a seeder
-- is not a signed-in user". That is exactly what this fixture is.
update sub_tasks set status = 'done' where id = 'aaaaaaaa-0000-0000-0000-0000000da001';
select is((select count(*) from notifications where type = 'dependency_ready')::int, 0,
  'NOTHING is sent while another requirement is outstanding — "you can start now" must be true');

update sub_tasks set status = 'done' where id = 'aaaaaaaa-0000-0000-0000-0000000da003';
select is((select count(*) from notifications where type = 'dependency_ready')::int, 1,
  'exactly ONE message when the LAST requirement clears — not one per prerequisite');

select is(
  (select user_id from notifications where type = 'dependency_ready'),
  '00000000-0000-0000-0000-00000000a003'::uuid,
  'it goes to the assignee of the WAITING task');

-- ================================================================ ADR-0068 ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);

select lives_ok($$
  select public.sub_task_cancel('aaaaaaaa-0000-0000-0000-0000000da004')
$$, 'a task can be cancelled');

select is((select count(*) from bookings where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000da004')::int, 0,
  'cancelling frees the calendar (ADR-0061) — this is what makes reinstate lossy');

select lives_ok($$
  select public.sub_task_reinstate('aaaaaaaa-0000-0000-0000-0000000da004')
$$, 'a cancelled task can be reinstated');

-- The headline assertion. A reinstate that quietly re-took the calendar would pass a status check.
select results_eq($$
  select status, assignee_id is null,
         (select count(*) from bookings where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000da004')::int
    from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000da004'
$$, $$ values ('todo', true, 0) $$,
  'it comes back todo, UNASSIGNED and UNSCHEDULED — the calendar is not silently re-taken (d.5)');

select throws_ok($$
  select public.sub_task_reinstate('aaaaaaaa-0000-0000-0000-0000000da004')
$$, '22023', null, 'only a CANCELLED task can be reinstated — a second call is refused');

-- Authority mirrors cancelling exactly: a003 (team_member) may not reinstate what a002 cancelled.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select lives_ok($$
  select public.sub_task_cancel('aaaaaaaa-0000-0000-0000-0000000da002')
$$, 'a002 cancels a second task');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select throws_ok($$
  select public.sub_task_reinstate('aaaaaaaa-0000-0000-0000-0000000da002')
$$, '42501', null,
  'a Team Member cannot reinstate — the authority mirrors sub_task_cancel rather than being its own rule');

-- ================================================ ADR-0068 d.4 × ADR-0061 d.6 ====
-- AD-HOC CANCELLATION IS DELIBERATELY IRREVERSIBLE, and this is what says so.
--
-- `sub_task_cancel` archives an ad-hoc deliverable once its last live task goes (ADR-0061 d.6:
-- "an ad-hoc deliverable IS its task"), and `archived` is TERMINAL in the transition graph
-- (ADR-0024: `when 'archived' then array[]`). Reinstating the task alone would therefore leave
-- live work under a container nothing can revive — worse than no undo at all.
--
-- Making it reversible would mean amending ADR-0024's state machine. Edward, 3 Sep: not worth it,
-- because ad-hoc assignment is being retired — so the WARNING changes rather than the mechanism,
-- and both surfaces now say ad-hoc work "cannot be reinstated" instead of offering an undo that
-- does not exist. These assertions exist so that anyone who later makes `archived` reversible
-- finds the decision rather than a silent change of behaviour.
reset role;
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order) values
  ('aaaaaaaa-0000-0000-0000-0000000da005','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000ca01','Lone ad-hoc task','todo', 5);

-- Everything else under it is settled, so this is the LAST live task.
update sub_tasks set status = 'cancelled'
 where deliverable_id = 'aaaaaaaa-0000-0000-0000-00000000ca01'
   and id <> 'aaaaaaaa-0000-0000-0000-0000000da005';

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
update deliverables set state = 'in_progress' where id = 'aaaaaaaa-0000-0000-0000-00000000ca01';

select lives_ok($$
  select public.sub_task_cancel('aaaaaaaa-0000-0000-0000-0000000da005')
$$, 'cancelling the last live ad-hoc task');

select is(
  (select state::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-00000000ca01'),
  'archived',
  'cancelling the last live task ARCHIVES an ad-hoc deliverable (ADR-0061 d.6)');

-- The refusal IS the behaviour. A green assertion here is what keeps the surfaces honest.
select throws_ok($$
  select public.sub_task_reinstate('aaaaaaaa-0000-0000-0000-0000000da005')
$$, '22023', null,
  'reinstating ad-hoc work is REFUSED while its job is archived — archived is terminal (ADR-0024)');

select * from finish();
rollback;
