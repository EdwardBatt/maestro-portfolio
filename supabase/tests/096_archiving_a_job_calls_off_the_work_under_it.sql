-- ADR-0080 / I42.1 — archiving a job calls off the work under it (9 Sep).
--
-- The defect this covers was not that archiving did something wrong. It did nothing, and the
-- nothing was invisible: the container left the live list, the task under it kept its assignee, and
-- it sat on that person's My Work with no route to remove it — the assignee has no authority to
-- cancel, the modal hides every task control on a finished container, and `archived` is terminal.
--
-- So the assertions that carry weight are the ones about what must NOT change. Cancelling one task
-- of several must leave the others alone (the first question anyone asks), an approved task must
-- survive its container being archived because it is a record of something that happened, and the
-- notification must actually be written — a rule that removes work from somebody's list silently is
-- the failure this ADR exists to prevent, wearing a different coat.
begin;
select plan(13);
\ir helpers/seed.sql

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000096d1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S');

-- A CAMPAIGN deliverable with three tasks — ADR-0080 d.5 applies the rule to campaign work too, and
-- three is the smallest number that can show "one is cancelled, the others are not".
-- The fixture department (ADR-0099 d.2, 23 Sep): a deliverable's department is its own and is no
-- longer derived from the owner, so a fixture that names an owner with no department must say
-- which department the work belongs to. Created here rather than assumed.
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000de0ff', 'aaaaaaaa-0000-0000-0000-000000000001', 'Fixture dept')
on conflict (id) do nothing;

insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id, owner_user_id, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000096e1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000096d1',
   'KV','in_progress','00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a001', 'aaaaaaaa-0000-0000-0000-0000000de0ff');

insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000096a1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000096e1',
   '00000000-0000-0000-0000-00000000a003','Retouch','todo', 8),
  -- Inserted straight into `review` so it can be approved through the real RPC below. Marking a
  -- task `done` by hand is refused by `app.tg_sub_task_completion_guard` — "a task becomes done when
  -- its reviewers approve it, not by being marked done" — which is the right refusal and caught the
  -- first cut of this suite.
  ('aaaaaaaa-0000-0000-0000-0000000096a2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000096e1',
   '00000000-0000-0000-0000-00000000a003','Colour','review', 8),
  ('aaaaaaaa-0000-0000-0000-0000000096a3','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000096e1',
   '00000000-0000-0000-0000-00000000a003','Retouch v2','todo', 8);

-- Bookings on two of them. Cancelled work must stop consuming capacity, and a booking left behind
-- is how the schedule keeps telling everyone a person is busy on work nobody will ever do.
insert into bookings (id, tenant_id, resource_id, sub_task_id, starts_at, ends_at, state) values
  ('aaaaaaaa-0000-0000-0000-0000000096b1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000d0a3','aaaaaaaa-0000-0000-0000-0000000096a1',
   '2026-09-14T06:00Z','2026-09-14T14:00Z','confirmed'),
  ('aaaaaaaa-0000-0000-0000-0000000096b2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000d0a3','aaaaaaaa-0000-0000-0000-0000000096a2',
   '2026-09-15T06:00Z','2026-09-15T14:00Z','confirmed');

-- ------------------------------------------------------------------------------------------
-- Cancelling ONE task leaves the rest alone. Edward's first question, and the property that
-- separates "call off this piece of work" from "call off the job".
-- ------------------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);

select lives_ok(
  $$ select public.sub_task_cancel('aaaaaaaa-0000-0000-0000-0000000096a1') $$,
  'a task can be cancelled on its own');

select is(
  (select count(*)::int from sub_tasks
    where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000096e1' and status = 'cancelled'),
  1, 'cancelling one task cancels exactly one — the other two are untouched');

select is(
  (select state::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000096e1'),
  'in_progress',
  'and the container is NOT archived while live work remains');

-- One of the two remaining is approved, so the archive has something it must refuse to rewrite.
-- Through `public.sub_task_approve`, the path a reviewer actually takes: `subtask_seed_reviewer`
-- already appointed the deliverable's reviewer (a001) to every task, and a001 is not the assignee,
-- so no self-review rule is in the way.
select lives_ok(
  $$ select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000096a2') $$,
  'the appointed reviewer approves the second task');

-- ------------------------------------------------------------------------------------------
-- Archiving the container calls off what is still live, and nothing else.
-- ------------------------------------------------------------------------------------------
select lives_ok(
  $$ update deliverables set state = 'archived' where id = 'aaaaaaaa-0000-0000-0000-0000000096e1' $$,
  'the container is archived by somebody who may manage it');

select is(
  (select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000096a3'),
  'cancelled',
  'ADR-0080 d.1: the live task is called off with the job');

select is(
  (select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000096a2'),
  'done',
  'the APPROVED task survives — it is the record of something that happened (d.1)');

select is(
  (select approved_at is not null from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000096a2'),
  true,
  'and its approval is not voided by the archive');

-- The bookings. a1 lost its booking to its own cancellation; a2 keeps one because a done task is
-- not called off; a3 must lose its booking to the archive.
select is(
  (select count(*)::int from bookings
    where sub_task_id in ('aaaaaaaa-0000-0000-0000-0000000096a1','aaaaaaaa-0000-0000-0000-0000000096a3')),
  0, 'cancelled work stops consuming capacity — its bookings are released');

-- ------------------------------------------------------------------------------------------
-- The assignee is TOLD. ADR-0080 d.4 — this is the clause that makes d.6's widened authority
-- acceptable, so it is asserted rather than assumed.
--
-- `reset role` first. `notifications` is recipient-scoped under RLS, so read as a001 — the person
-- who pressed Archive — these counts are ZERO whether or not the trigger wrote anything, and the
-- suite passes by being blind. The row is what is being asserted, not who may read it.
-- ------------------------------------------------------------------------------------------
reset role;

select is(
  (select count(*)::int from notifications
    where entity_id = 'aaaaaaaa-0000-0000-0000-0000000096a3'
      and type = 'cancelled'
      and user_id = '00000000-0000-0000-0000-00000000a003'),
  1, 'd.4: the assignee is notified that the archive called off their task');

select is(
  (select count(*)::int from notifications
    where entity_id = 'aaaaaaaa-0000-0000-0000-0000000096a2' and type = 'cancelled'),
  0, 'and nobody is told about the approved task, which was not cancelled');

-- ------------------------------------------------------------------------------------------
-- Two deliverables archived in ONE transaction. This is the case the first cut of the trigger
-- got wrong: it collected the tasks into a temporary table, which fails on the second firing
-- with "relation already exists". Ordinary, and it would have shipped.
-- ------------------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);

insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id, due_at, owner_user_id, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000096e2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000096d1',
   'KV two','in_progress','00000000-0000-0000-0000-00000000a001','2026-10-01 15:00+00', '00000000-0000-0000-0000-00000000a001', 'aaaaaaaa-0000-0000-0000-0000000de0ff'),
  ('aaaaaaaa-0000-0000-0000-0000000096e3','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000096d1',
   'KV three','in_progress','00000000-0000-0000-0000-00000000a001','2026-10-01 15:00+00', '00000000-0000-0000-0000-00000000a001', 'aaaaaaaa-0000-0000-0000-0000000de0ff');
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000096a4','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000096e2',
   '00000000-0000-0000-0000-00000000a003','Two','todo', 8),
  ('aaaaaaaa-0000-0000-0000-0000000096a5','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000096e3',
   '00000000-0000-0000-0000-00000000a003','Three','todo', 8);

select lives_ok(
  $$ update deliverables set state = 'archived'
      where id in ('aaaaaaaa-0000-0000-0000-0000000096e2','aaaaaaaa-0000-0000-0000-0000000096e3') $$,
  'two containers can be archived in one statement');

select is(
  (select count(*)::int from sub_tasks
    where id in ('aaaaaaaa-0000-0000-0000-0000000096a4','aaaaaaaa-0000-0000-0000-0000000096a5')
      and status = 'cancelled'),
  2, 'and both their tasks are called off — the trigger is re-entrant within a transaction');

select * from finish();
rollback;
