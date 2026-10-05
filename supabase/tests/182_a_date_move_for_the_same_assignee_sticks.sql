-- 20260926162000 — a date move for the SAME assignee through `update_task_assignment` sticks.
--
-- The task is assigned and booked (the span sync makes its dates the booking's). The same person is
-- then given it on later days through the RPC — the team view's "Move it anyway" along a row. Before
-- the fix, the RPC's bookings rename fired the span sync after the task update and put the old days
-- back in the same call. A move to another person, and a rename alone, are checked too.
begin;
select plan(7);
\ir helpers/seed.sql

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000182d1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S182');
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id, due_at) values
  ('aaaaaaaa-0000-0000-0000-0000000182e1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000182d1',
   'KV 182','in_progress','00000000-0000-0000-0000-00000000a001','2026-10-30 15:00:00+00');
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-00000000e001');
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000182a1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000182e1',
   'Design 182','todo', 4);

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select lives_ok(
  $$ select public.update_task_assignment(
       'aaaaaaaa-0000-0000-0000-0000000182a1', 'Design 182', '00000000-0000-0000-0000-00000000a003',
       '[{"user_id": "00000000-0000-0000-0000-00000000a001", "is_mandatory": true}]'::jsonb,
       '2026-10-11 06:00:00+00', '2026-10-11 10:00:00+00', 4) $$,
  'fixture: assigned to a003 on the 11th');
reset role;
-- The scheduler's booking on a003's calendar, on the 11th (resource d0a3 is a003's).
insert into bookings (id, tenant_id, resource_id, sub_task_id, starts_at, ends_at, state, booked_by)
values ('aaaaaaaa-0000-0000-0000-0000000182b1','aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-00000000d0a3','aaaaaaaa-0000-0000-0000-0000000182a1',
        '2026-10-11 06:00:00+00','2026-10-11 10:00:00+00','confirmed','00000000-0000-0000-0000-00000000a001');

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select is(
  (select reschedule_needed from public.update_task_assignment(
     'aaaaaaaa-0000-0000-0000-0000000182a1', 'Design 182', '00000000-0000-0000-0000-00000000a003', null,
     '2026-10-15 06:00:00+00', '2026-10-15 10:00:00+00', 4)),
  true, 'the same person on later days: a reschedule is asked for');
select is(
  (select array[starts_at::text, due_at::text] from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000182a1'),
  array['2026-10-15 06:00:00+00', '2026-10-15 10:00:00+00'],
  'THE FIX: the new days stick — the bookings rename no longer puts the old ones back');
select is(
  (select title from bookings where id = 'aaaaaaaa-0000-0000-0000-0000000182b1'),
  'Design 182', 'the booking still carries the task''s title');

-- A rename with the same dates: the bookings take the title, the dates are untouched.
select lives_ok(
  $$ select public.update_task_assignment(
       'aaaaaaaa-0000-0000-0000-0000000182a1', 'Design 182 renamed', '00000000-0000-0000-0000-00000000a003', null,
       null, null, null) $$,
  'a rename alone');
select is(
  (select array[b.title, t.title] from bookings b join sub_tasks t on t.id = b.sub_task_id
    where b.id = 'aaaaaaaa-0000-0000-0000-0000000182b1'),
  array['Design 182 renamed', 'Design 182 renamed'],
  'a rename reaches the bookings (ADR-0071 addendum), as before');
reset role;
-- The booking follows the scheduler as `subtask-schedule` would move it; the span follows the booking.
update bookings set starts_at = '2026-10-15 06:00:00+00', ends_at = '2026-10-15 10:00:00+00'
 where id = 'aaaaaaaa-0000-0000-0000-0000000182b1';
select is(
  (select array[starts_at::text, due_at::text] from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000182a1'),
  array['2026-10-15 06:00:00+00', '2026-10-15 10:00:00+00'],
  'once re-booked, the span sync agrees with the moved dates (ADR-0039 unchanged)');

select * from finish();
rollback;
