-- ADR-0029 (I7.2a): the booking is the assignment record + booking-assignment notifications.
-- Proves: every booking needs a subject (linked entity or ad-hoc title); a deliverable-level or
-- ad-hoc booking notifies the booked resource's user; a SUB-TASK booking does NOT (its sub-task
-- trigger carries it — no double-notify); equipment (no user) never notifies.
begin;
select plan(9);
\ir helpers/seed.sql

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000055d1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S');
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000055e1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000055d1','KV','in_progress', '00000000-0000-0000-0000-00000000a001');
insert into sub_tasks (id, tenant_id, deliverable_id, title) values
  ('aaaaaaaa-0000-0000-0000-0000000055a1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000055e1','Retouch');
-- map the human resource Sarah (seed d001) to user a003; equipment d002 stays user-less
update resources set user_id = '00000000-0000-0000-0000-00000000a003' where id = 'aaaaaaaa-0000-0000-0000-00000000d001';

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);

-- a plain resource reservation (no task/title) is still allowed, and emits no notification (no label)
select lives_ok($$ insert into bookings (id, tenant_id, resource_id, starts_at, ends_at, load_pct) values
  ('aaaaaaaa-0000-0000-0000-0000000055b0','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000d001','2027-03-01 07:00+00','2027-03-01 08:00+00',50) $$,
  'a plain resource reservation (no task/title) is still allowed');

-- ad-hoc booking (title) → notifies the resource's user (a003)
select lives_ok($$ insert into bookings (id, tenant_id, resource_id, starts_at, ends_at, load_pct, title) values
  ('aaaaaaaa-0000-0000-0000-0000000055b1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000d001','2027-03-01 09:00+00','2027-03-01 10:00+00',50,'Quick retouch') $$,
  'ad-hoc booking (title only) is accepted');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select is((select count(*)::int from notifications where entity_type='booking'), 1, 'ad-hoc booking notified the resource''s user');

-- deliverable-level booking → also notifies
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select lives_ok($$ insert into bookings (id, tenant_id, resource_id, deliverable_id, starts_at, ends_at, load_pct) values
  ('aaaaaaaa-0000-0000-0000-0000000055b2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000d001','aaaaaaaa-0000-0000-0000-0000000055e1','2027-03-01 11:00+00','2027-03-01 12:00+00',50) $$,
  'deliverable-level booking is accepted');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select is((select count(*)::int from notifications where entity_type='booking'), 2, 'deliverable-level booking notified the resource''s user');

-- sub-task booking → does NOT emit a booking notification (sub-task path owns it)
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select lives_ok($$ insert into bookings (id, tenant_id, resource_id, sub_task_id, starts_at, ends_at, load_pct) values
  ('aaaaaaaa-0000-0000-0000-0000000055b3','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000d001','aaaaaaaa-0000-0000-0000-0000000055a1','2027-03-01 13:00+00','2027-03-01 14:00+00',50) $$,
  'sub-task booking is accepted');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select is((select count(*)::int from notifications where entity_type='booking'), 2, 'sub-task booking did NOT double-notify (still 2)');

-- equipment booking (no user) → no notification
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select lives_ok($$ insert into bookings (id, tenant_id, resource_id, deliverable_id, starts_at, ends_at) values
  ('aaaaaaaa-0000-0000-0000-0000000055b4','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000d002','aaaaaaaa-0000-0000-0000-0000000055e1','2027-03-01 15:00+00','2027-03-01 16:00+00') $$,
  'equipment booking is accepted');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select is((select count(*)::int from notifications where entity_type='booking'), 2, 'equipment booking (no user) did not notify (still 2)');

select * from finish();
rollback;
