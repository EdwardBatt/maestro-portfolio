-- I52.14 d.3c (22 Sep) — the correction of EXISTING commitment stamps: an old stamp at a booking's
-- end hour moves to 18:00 Asia/Baghdad of its own day; one already there is untouched; one whose
-- UTC instant falls on the next Iraq day keeps the Iraq day; nothing else on the row changes; the
-- deadline log gets no row; a second run changes nothing. The correction is the migration's own
-- UPDATE, replayed here on rows stamped the old way (the trigger admits a superuser, as a
-- migration is).
begin;
select plan(8);
\ir helpers/seed.sql

insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-000000001390','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Campaign 139','approved','campaign','00000000-0000-0000-0000-00000000a001');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000001391','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001390','Campaign 139');
insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id, reviewer_id, due_at) values
  ('aaaaaaaa-0000-0000-0000-000000001392','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001391',
   'Dated 139','draft','00000000-0000-0000-0000-00000000a003','00000000-0000-0000-0000-00000000a001','2026-10-01 15:00+00');
-- Three assigned tasks; the stamp lands at 18:00 Iraq (the current rule), then each is set back
-- to the OLD shape by hand, as a superuser may — which is what the rows on production carry.
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order, assignee_id, starts_at, due_at, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-000000001393','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001392',
   'Booking end 139','todo',1,'00000000-0000-0000-0000-00000000a003','2026-09-17 06:00+00','2026-09-17 10:00+00',4),
  ('aaaaaaaa-0000-0000-0000-000000001394','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001392',
   'Already right 139','todo',2,'00000000-0000-0000-0000-00000000a003','2026-09-17 06:00+00','2026-09-17 10:00+00',4),
  ('aaaaaaaa-0000-0000-0000-000000001395','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001392',
   'Past midnight UTC 139','todo',3,'00000000-0000-0000-0000-00000000a003','2026-09-17 06:00+00','2026-09-17 10:00+00',4);
-- The old shape: a booking's end (13:00 Iraq = 10:00Z); and 23:30Z, which is 02:30 on the 18th in Iraq.
update sub_tasks set committed_due_at = '2026-09-17 10:00+00' where id = 'aaaaaaaa-0000-0000-0000-000000001393';
update sub_tasks set committed_due_at = '2026-09-17 23:30+00' where id = 'aaaaaaaa-0000-0000-0000-000000001395';
select is((select committed_due_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-000000001393'),
  '2026-09-17 10:00+00'::timestamptz, 'fixture: an old stamp at the booking''s end hour');
select is((select committed_due_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-000000001394'),
  '2026-09-17 15:00+00'::timestamptz, 'fixture: a stamp already at the close of its day');

select is((select count(*)::int from sla_events where sub_task_id in (
  'aaaaaaaa-0000-0000-0000-000000001393','aaaaaaaa-0000-0000-0000-000000001394','aaaaaaaa-0000-0000-0000-000000001395')),
  3, 'the three deadline_set rows from the stamps, before the correction');

-- ================================================================ THE CORRECTION ====
update sub_tasks
   set committed_due_at = app.commitment_instant(committed_due_at)
 where committed_due_at is not null
   and committed_due_at is distinct from app.commitment_instant(committed_due_at);

select is((select committed_due_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-000000001393'),
  '2026-09-17 15:00+00'::timestamptz, 'the booking-end stamp moves to 18:00 Iraq of the SAME day');
select is((select committed_due_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-000000001394'),
  '2026-09-17 15:00+00'::timestamptz, 'a stamp already at the close of its day is untouched');
select is((select committed_due_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-000000001395'),
  '2026-09-18 15:00+00'::timestamptz, 'an instant that is already the next day in Iraq keeps the Iraq day (the 18th), not the UTC one');
select results_eq($$
  select starts_at, due_at, committed_starts_at, committed_hours, assignee_id from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-000000001393'
$$, $$ values ('2026-09-17 06:00+00'::timestamptz, '2026-09-17 10:00+00'::timestamptz, '2026-09-17 06:00+00'::timestamptz, 4::numeric, '00000000-0000-0000-0000-00000000a003'::uuid) $$,
  'nothing else on the row changes — the plan, the committed start, the hours, the assignee');
select is((select count(*)::int from sla_events where sub_task_id in (
  'aaaaaaaa-0000-0000-0000-000000001393','aaaaaaaa-0000-0000-0000-000000001394','aaaaaaaa-0000-0000-0000-000000001395')),
  3, 'the deadline log gets NO new row — the day did not move, and this is not a stamp');

select * from finish();
rollback;
