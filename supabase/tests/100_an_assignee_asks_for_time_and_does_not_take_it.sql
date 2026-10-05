-- ADR-0088 d.11 / I46.2 — an assignee asks for time and does not take it (11 Sep).
--
-- The side door: `sub_tasks_manage_update` lets an assignee update their own row and fences no
-- columns, and `save_sub_task` has no gate of its own. So the person with the strongest motive
-- could move their own deadline, moving no booking and telling nobody. ADR-0088 says "d.11 refuses
-- a write that has always succeeded … which is the point and is why it gets the pgTAP first."
--
-- Half of this suite is the refusal. The other half matters as much: Start and Submit — what the
-- own-row branch was written for — must still work afterwards, or the fence has broken My Work.
begin;
select plan(13);
\ir helpers/seed.sql

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000098d1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S98');
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000098e1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000098d1',
   'KV 98','in_progress','00000000-0000-0000-0000-00000000a001');
-- a003's own task, dated. Inserted assigned so the deliverable's reviewer is seeded onto it.
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, status, starts_at, due_at, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000098a1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000098e1',
   '00000000-0000-0000-0000-00000000a003','Retouch 98','todo','2026-09-14 06:00:00+00','2026-09-16 15:00:00+00', 8);
-- This round's version, so Submit has something to submit (ADR-0058 d.5).
insert into media_records (tenant_id, deliverable_id, sub_task_id, round, object_key, content_type)
values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000098e1',
        'aaaaaaaa-0000-0000-0000-0000000098a1', 1, 'k/retouch98-v1.png','image/png');
-- A booking on a003's own calendar, for the span-sync case below.
insert into bookings (id, tenant_id, resource_id, sub_task_id, starts_at, ends_at, state, booked_by)
values ('aaaaaaaa-0000-0000-0000-0000000098b1','aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-00000000d0a3','aaaaaaaa-0000-0000-0000-0000000098a1',
        '2026-09-14 06:00:00+00','2026-09-16 15:00:00+00','confirmed',
        '00000000-0000-0000-0000-00000000a001');

-- ------------------------------------------------------------------------------------------
-- As the assignee. a003 is `self` scope; the test seed ALSO gives team_member project_tasks:manage
-- on purpose, so this proves the permission alone does not open the door — scope does.
-- ------------------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);

select throws_ok(
  $$ update sub_tasks set due_at = '2026-09-20 15:00:00+00' where id = 'aaaaaaaa-0000-0000-0000-0000000098a1' $$,
  '42501', null,
  'd.11: the assignee cannot move their own due_at with a bare update');

select throws_ok(
  $$ update sub_tasks set starts_at = '2026-09-10 06:00:00+00' where id = 'aaaaaaaa-0000-0000-0000-0000000098a1' $$,
  '42501', null,
  'nor their own starts_at');

select throws_ok(
  $$ select public.save_sub_task('aaaaaaaa-0000-0000-0000-0000000098a1',
       'aaaaaaaa-0000-0000-0000-0000000098e1', 'Retouch 98', null,
       p_due_at => '2026-09-20 15:00:00+00') $$,
  '42501', null,
  'nor through save_sub_task — the RPC ADR-0088 named as the informal extension');

select throws_ok(
  $$ update sub_tasks set committed_due_at = '2026-09-20 15:00:00+00' where id = 'aaaaaaaa-0000-0000-0000-0000000098a1' $$,
  '42501', null,
  'and never the commitment itself');

-- Found by review: the estimate is the numerator of the at-risk arithmetic (ADR-0075 d.4), and
-- the first fence left it open. Same door.
select throws_ok(
  $$ update sub_tasks set sla_hours = 1 where id = 'aaaaaaaa-0000-0000-0000-0000000098a1' $$,
  '42501', null,
  'nor shrink their own estimate — sla_hours is the at-risk numerator (ADR-0088 addendum)');
select throws_ok(
  $$ select public.save_sub_task('aaaaaaaa-0000-0000-0000-0000000098a1',
       'aaaaaaaa-0000-0000-0000-0000000098e1', 'Retouch 98', null,
       p_sla_hours => 1) $$,
  '42501', null,
  '… nor through save_sub_task');

select is(
  (select due_at::text from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000098a1'),
  '2026-09-16 15:00:00+00', 'nothing moved');

-- What the own-row branch was written for still works.
select lives_ok(
  $$ select public.sub_task_start('aaaaaaaa-0000-0000-0000-0000000098a1') $$,
  'the assignee can still START their task');
select is(
  (select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000098a1'),
  'in_progress', 'and it is in progress');

-- ADR-0106 (I59.20): sent in the same transaction as its Start (or never started) — an UNTIMED round, accepted as one.
select lives_ok(
  $$ select public.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000098a1', null, true) $$,
  'the assignee can still SUBMIT their task');
select is(
  (select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000098a1'),
  'review', 'and it is in review');

-- ------------------------------------------------------------------------------------------
-- The span sync passes. A booking that moves past the bookings gate moves the task's dates
-- (ADR-0039) — that is the plan following the calendar, not the side door — and it must do so
-- even when the actor on the claims IS the assignee. The booking is moved as superuser with a003's
-- claims still set (the bookings gate is not what is under test), so the fence sees the assignee as
-- actor and a nested trigger, and must let it through.
-- ------------------------------------------------------------------------------------------
reset role;
update bookings set starts_at = '2026-09-17 06:00:00+00', ends_at = '2026-09-17 14:00:00+00'
 where id = 'aaaaaaaa-0000-0000-0000-0000000098b1';
select is(
  (select due_at::text from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000098a1'),
  '2026-09-17 14:00:00+00', 'a booking move still moves the plan through the span sync, whoever the actor is');

-- And the authority path is untouched: a001 rescheduling by dialog.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
set local role authenticated;
select lives_ok(
  $$ update sub_tasks set due_at = '2026-09-18 15:00:00+00' where id = 'aaaaaaaa-0000-0000-0000-0000000098a1' $$,
  'somebody who holds the reschedule authority still moves the dates directly');

select * from finish();
rollback;
