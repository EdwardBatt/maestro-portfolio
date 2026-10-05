-- ADR-0075 d.3 / I46.1 — a task keeps the span it was committed to (11 Sep).
--
-- ADR-0075's own words for what this suite must hold: "that a rescheduled task keeps its committed
-- date, that the move is logged with its actor, and that a deliverable's due date is unchanged by
-- any of it." And the pgTAP "asserts the log, not the columns" — a missed path is a silent hole in
-- exactly the record that makes the metric trustworthy, so the move is made the way the schedule
-- makes it (a booking on the assignee's calendar, and the span sync) and the way a dialog makes it
-- (`update_task_assignment`), and the log is read after each.
begin;
select plan(23);
\ir helpers/seed.sql

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000097d1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S97');

-- The promise: 25 Sep, 18:00 Iraq. It must still read 25 Sep at the end.
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id, due_at) values
  ('aaaaaaaa-0000-0000-0000-0000000097e1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097d1',
   'KV 97','in_progress','00000000-0000-0000-0000-00000000a001','2026-09-25 15:00:00+00');
-- 20 Sep: the department has accepted this work (ADR-0072 d.6) — see helpers/seed.sql.
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-00000000e001');

-- Unassigned, but dated: a plan with nobody on it has no commitment (d.3 — stamped at assignment).
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, starts_at, due_at, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000097a1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097e1',
   'Design 97','todo','2026-09-14 06:00:00+00','2026-09-16 15:00:00+00', 8),
  -- Assigned bare — the scheduler will date it later. Its commitment must arrive with the dates.
  ('aaaaaaaa-0000-0000-0000-0000000097a2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097e1',
   'Retouch 97','todo', null, null, 8);
update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a003'
 where id = 'aaaaaaaa-0000-0000-0000-0000000097a2';

select is(
  (select committed_due_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000097a1'),
  null, 'an unassigned task has no commitment, whatever dates it carries');

-- ------------------------------------------------------------------------------------------
-- Assignment stamps the span and writes deadline_set with the actor.
-- ------------------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);

select lives_ok(
  $$ select public.update_task_assignment(
       'aaaaaaaa-0000-0000-0000-0000000097a1', 'Design 97', '00000000-0000-0000-0000-00000000a003',
       '[{"user_id": "00000000-0000-0000-0000-00000000a001", "is_mandatory": true}]'::jsonb,
       '2026-09-14 06:00:00+00', '2026-09-16 15:00:00+00', 8) $$,
  'the task is assigned with its span');

select is(
  (select array[committed_starts_at::text, committed_due_at::text, committed_hours::text]
     from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000097a1'),
  array['2026-09-14 06:00:00+00', '2026-09-16 15:00:00+00', '8.00'],
  'd.3: the committed SPAN — start, deadline and hours — is stamped at assignment');

select is(
  (select count(*)::int from sla_events
    where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a1'
      and deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000097e1'
      and event_type = 'deadline_set'
      and actor_user_id = '00000000-0000-0000-0000-00000000a001'),
  1, 'deadline_set is written to the log, pointing at the task AND its deliverable, with the actor');

-- ------------------------------------------------------------------------------------------
-- The schedule moves the plan: a booking on the assignee's calendar, and the span sync rewrites
-- starts_at / due_at (ADR-0039). The commitment does not move; the move is logged.
-- ------------------------------------------------------------------------------------------
reset role;   -- claims persist: auth.uid() is still a001, the person placing the work
insert into bookings (id, tenant_id, resource_id, sub_task_id, starts_at, ends_at, state, booked_by)
values ('aaaaaaaa-0000-0000-0000-0000000097b1','aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-00000000d0a3','aaaaaaaa-0000-0000-0000-0000000097a1',
        '2026-09-14 06:00:00+00','2026-09-14 14:00:00+00','confirmed',
        '00000000-0000-0000-0000-00000000a001');

select is(
  (select due_at::text from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000097a1'),
  '2026-09-14 14:00:00+00', 'the plan followed the booking (ADR-0039): due_at is now the 14th');

select is(
  (select committed_due_at::text from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000097a1'),
  '2026-09-16 15:00:00+00', 'and the commitment did NOT follow it — a breach can no longer delete itself');

select is(
  (select count(*)::int from sla_events
    where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a1' and event_type = 'deadline_changed'
      and actor_user_id = '00000000-0000-0000-0000-00000000a001'
      and (payload ->> 'due_at_from')::timestamptz = '2026-09-16 15:00:00+00'
      and (payload ->> 'due_at_to')::timestamptz   = '2026-09-14 14:00:00+00'
      and (payload ->> 'past_commitment')::boolean = false),
  1, 'the move is logged as deadline_changed with the actor, both values, and whether it passed the commitment');

-- Dragged past the commitment: the log says so, which is what lets a dialog offer the request
-- (ADR-0088 d.10).
update bookings set starts_at = '2026-09-18 06:00:00+00', ends_at = '2026-09-18 14:00:00+00'
 where id = 'aaaaaaaa-0000-0000-0000-0000000097b1';

-- Found by content: every row in this suite shares one transaction's now(), so "the latest" cannot
-- be read off created_at here.
select is(
  (select (payload ->> 'past_commitment')::boolean from sla_events
    where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a1' and event_type = 'deadline_changed'
      and (payload ->> 'due_at_to')::timestamptz = '2026-09-18 14:00:00+00'),
  true, 'a drag past the committed date is logged as past the commitment');

-- The same day at a different hour is not a move. The scheduler stamps due_at from the end of the
-- last booking seconds after every assignment; logging that would put a row on every task.
update bookings set ends_at = '2026-09-18 12:00:00+00' where id = 'aaaaaaaa-0000-0000-0000-0000000097b1';

select is(
  (select count(*)::int from sla_events
    where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a1' and event_type = 'deadline_changed'),
  2, 'a change of hour on the same Iraq day is not a move and writes nothing');

-- ------------------------------------------------------------------------------------------
-- The dialog moves the plan (`update_task_assignment` with a new due date). Same rule.
-- ------------------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);

select lives_ok(
  $$ select public.update_task_assignment(
       'aaaaaaaa-0000-0000-0000-0000000097a1', 'Design 97', '00000000-0000-0000-0000-00000000a003',
       null, null, '2026-09-21 15:00:00+00', null) $$,
  'ADR-0075 d.3: rescheduling is not blocked and demands no reason');

select is(
  (select committed_due_at::text from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000097a1'),
  '2026-09-16 15:00:00+00', 'the dialog reschedule leaves the commitment where it was');

-- Counted by content, not by number: `update_task_assignment` also retitles the task's bookings,
-- and that bookings write fires the span sync, which puts due_at straight back to the booking's
-- day (the dialog then calls `subtask-schedule` to re-spread the work). Two moves, both logged —
-- which is the point: the record says exactly what happened, bounce included.
select is(
  (select count(*)::int from sla_events
    where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a1' and event_type = 'deadline_changed'
      and (payload ->> 'due_at_to')::timestamptz = '2026-09-21 15:00:00+00'),
  1, 'and it is logged — every path that moves a task''s dates logs it');

-- ------------------------------------------------------------------------------------------
-- The promise is untouched by any of it (d.2).
-- ------------------------------------------------------------------------------------------
select is(
  (select due_at::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000097e1'),
  '2026-09-25 15:00:00+00', 'd.2: the deliverable''s due date is unchanged by every move above');

-- ------------------------------------------------------------------------------------------
-- The committed columns are not writable by hand — not even by tenant scope. They change by the
-- stamp and by an approved extension (ADR-0088 d.6), and nothing else.
-- ------------------------------------------------------------------------------------------
select throws_ok(
  $$ update sub_tasks set committed_due_at = '2026-09-30 15:00:00+00'
      where id = 'aaaaaaaa-0000-0000-0000-0000000097a1' $$,
  '42501', null,
  'a Power Admin cannot rewrite a commitment by hand — only the stamp and an approved extension may');

select lives_ok(
  $$ select public.save_sub_task('aaaaaaaa-0000-0000-0000-0000000097a1',
       'aaaaaaaa-0000-0000-0000-0000000097e1', 'Design 97', null, p_sla_hours => 8) $$,
  'a save that does not touch the committed columns is not refused (control)');

-- ------------------------------------------------------------------------------------------
-- A task assigned bare and dated later: the first dates it receives ARE the commitment.
-- ------------------------------------------------------------------------------------------
select is(
  (select committed_due_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000097a2'),
  null, 'assigned without dates: nothing to commit to yet');

select lives_ok(
  $$ select public.update_task_assignment(
       'aaaaaaaa-0000-0000-0000-0000000097a2', 'Retouch 97', '00000000-0000-0000-0000-00000000a003',
       '[{"user_id": "00000000-0000-0000-0000-00000000a001"}]'::jsonb,
       '2026-09-20 06:00:00+00', '2026-09-22 15:00:00+00', 4) $$,
  'the scheduler dates it');

select is(
  (select committed_due_at::text from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000097a2'),
  '2026-09-22 15:00:00+00', 'and those first dates become its commitment, logged as deadline_set');

-- ------------------------------------------------------------------------------------------
-- Found by review: unassign → move the plan → reassign was a working extension with no request.
-- A commitment, once made, survives an unassignment and is not restamped by the next assignment;
-- it moves by an approved extension and by nothing else (ADR-0088 d.1).
-- ------------------------------------------------------------------------------------------
select lives_ok(
  $$ update sub_tasks set assignee_id = null where id = 'aaaaaaaa-0000-0000-0000-0000000097a2' $$,
  'the task is unassigned');
select is(
  (select committed_due_at::text from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000097a2'),
  '2026-09-22 15:00:00+00', 'the commitment stays on the row while nobody holds the work');
update sub_tasks set due_at = '2026-09-30 15:00:00+00' where id = 'aaaaaaaa-0000-0000-0000-0000000097a2';
select is(
  (select count(*)::int from sla_events
    where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a2' and event_type = 'deadline_changed'
      and (payload ->> 'due_at_to')::timestamptz = '2026-09-30 15:00:00+00'),
  1, 'a plan moved while the task sits unassigned is still a move away from the promise, and is logged');
update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a003'
 where id = 'aaaaaaaa-0000-0000-0000-0000000097a2';
select is(
  (select committed_due_at::text from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000097a2'),
  '2026-09-22 15:00:00+00', 'reassigning does not restamp — the moved plan is measured against the original commitment');
select is(
  (select count(*)::int from sla_events
    where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a2' and event_type like 'extension_%'),
  0, '… and no extension was ever asked, which is what the at-risk arithmetic will now say');

select * from finish();
rollback;
