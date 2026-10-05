-- ADR-0031 (I9): workday attendance — profile expectation, measured day, deviations, scoped reads.
-- Proves: the deviation resolver (late / short / missing / no-checkout, suppressed on weekends and
-- approved leave); the self-service RPCs (auto check-in via heartbeat, explicit Start/End, idempotence,
-- double-close guard); the service-role nightly close inferring a checkout; the scoped read
-- (self / team-lead / dept-lead see; peer + other tenant denied) and the no-direct-write rule.
begin;
select plan(26);
\ir helpers/seed.sql

-- ---- org fixtures on tenant A (superuser; RLS bypassed) ----
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000033d1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Dept33');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000033a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000033d1', 'Team33-1'),
  ('aaaaaaaa-0000-0000-0000-0000000033a2', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000033d1', 'Team33-2');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000033e1', 'tl33@a.test'),
  ('00000000-0000-0000-0000-0000000033e2', 'dl33@a.test'),
  ('00000000-0000-0000-0000-0000000033f1', 'm1-33@a.test'),
  ('00000000-0000-0000-0000-0000000033f3', 'm3-33@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.nm,
       (select id from roles where tenant_id='aaaaaaaa-0000-0000-0000-000000000001' and key=v.rk),
       v.dept::uuid, v.team::uuid
from (values
  ('00000000-0000-0000-0000-0000000033e1','TL33','team_lead',       'aaaaaaaa-0000-0000-0000-0000000033d1','aaaaaaaa-0000-0000-0000-0000000033a1'),
  ('00000000-0000-0000-0000-0000000033e2','DL33','department_lead', 'aaaaaaaa-0000-0000-0000-0000000033d1', null),
  ('00000000-0000-0000-0000-0000000033f1','MM1','team_member',      'aaaaaaaa-0000-0000-0000-0000000033d1','aaaaaaaa-0000-0000-0000-0000000033a1'),
  ('00000000-0000-0000-0000-0000000033f3','MM3','team_member',      'aaaaaaaa-0000-0000-0000-0000000033d1','aaaaaaaa-0000-0000-0000-0000000033a2')
) as v(id, nm, rk, dept, team);

-- tenant-default attendance profile: 09:00 start, 8h day, 15-min grace, Mon–Fri.
insert into attendance_profiles (id, tenant_id, name, expected_check_in, expected_minutes, grace_minutes, is_default) values
  ('aaaaaaaa-0000-0000-0000-0000000033b1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Standard', '09:00', 480, 15, true);

-- a human resource for MM3 + an approved leave covering 2026-08-19 (for the suppression test).
insert into resources (id, tenant_id, kind, name, capacity_model, load_ceiling_pct, warn_at_pct, user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000033c3', 'aaaaaaaa-0000-0000-0000-000000000001', 'human', 'MM3 Res', 'load_based', 120.0, 100.0, '00000000-0000-0000-0000-0000000033f3');
insert into resource_unavailability (id, tenant_id, resource_id, kind, starts_at, ends_at) values
  ('aaaaaaaa-0000-0000-0000-0000000033ab', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000033c3', 'leave', '2026-08-19 00:00+00', '2026-08-20 00:00+00');

-- measured days (2026-08-17 Mon, 08-18 Tue, 08-19 Wed workdays; 08-16 Sun weekend)
insert into attendance_days (id, tenant_id, user_id, work_date, checked_in_at, checked_out_at, check_in_source, check_out_source, worked_minutes, last_activity_at) values
  ('aaaaaaaa-0000-0000-0000-000000330171','aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000033f1','2026-08-17','2026-08-17 09:30+00','2026-08-17 17:00+00','explicit','explicit',450,'2026-08-17 17:00+00'),
  ('aaaaaaaa-0000-0000-0000-000000330173','aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000033f3','2026-08-17','2026-08-17 09:10+00','2026-08-17 17:10+00','explicit','explicit',480,'2026-08-17 17:10+00'),
  ('aaaaaaaa-0000-0000-0000-000000330161','aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000033f1','2026-08-16','2026-08-16 10:00+00',null,'auto',null,null,'2026-08-16 10:00+00'),
  ('aaaaaaaa-0000-0000-0000-000000330181','aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000033f1','2026-08-18','2026-08-18 08:55+00','2026-08-18 17:15+00','auto','inferred',500,'2026-08-18 17:15+00'),
  ('aaaaaaaa-0000-0000-0000-000000330193','aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000033f3','2026-08-19','2026-08-19 10:00+00',null,'auto',null,null,'2026-08-19 10:00+00'),
  ('aaaaaaaa-0000-0000-0000-000000330153','aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000033f3','2026-08-15','2026-08-15 09:00+00',null,'auto',null,null,'2026-08-15 15:00+00');

-- ---- deviation resolver (superuser reads all; resolver is invoker-stable) ----
select is((select late  from app.attendance_deviation('00000000-0000-0000-0000-0000000033f1','2026-08-17')), true,  'a 09:30 check-in past the 09:15 grace is late');
select is((select short from app.attendance_deviation('00000000-0000-0000-0000-0000000033f1','2026-08-17')), true,  '450 worked minutes under the 480 expected is short');
select is((select late  from app.attendance_deviation('00000000-0000-0000-0000-0000000033f3','2026-08-17')), false, 'a 09:10 check-in within grace is not late');
select is((select short from app.attendance_deviation('00000000-0000-0000-0000-0000000033f3','2026-08-17')), false, '480 worked minutes meeting the expectation is not short');
select is((select missing from app.attendance_deviation('00000000-0000-0000-0000-0000000033f3','2026-08-18')), true, 'a workday with no attendance row is missing');
select is((select no_checkout from app.attendance_deviation('00000000-0000-0000-0000-0000000033f1','2026-08-18')), true, 'an inferred checkout raises the no-checkout flag');
select is((select suppressed from app.attendance_deviation('00000000-0000-0000-0000-0000000033f1','2026-08-16')), true, 'a weekend is suppressed (no deviations)');
select is((select suppressed from app.attendance_deviation('00000000-0000-0000-0000-0000000033f3','2026-08-19')), true, 'an approved-leave day is suppressed despite a late check-in');

-- ---- claims for the scoped users ----
create temp table a_claims as
select up.id, json_build_object('sub', up.id, 'app_metadata', json_build_object(
  'tenant_id', up.tenant_id, 'app_role_id', up.role_id,
  'department_id', up.department_id, 'team_id', up.team_id))::text as jwt
from user_profiles up
where up.id in ('00000000-0000-0000-0000-0000000033e1','00000000-0000-0000-0000-0000000033e2',
                '00000000-0000-0000-0000-0000000033f1','00000000-0000-0000-0000-0000000033f3');
grant select on a_claims to public;

set local role authenticated;

-- self-service RPCs (as MM1, today) ---------------------------------------
select set_config('request.jwt.claims',(select jwt from a_claims where id='00000000-0000-0000-0000-0000000033f1'),true);
select lives_ok($$ select app.attendance_heartbeat() $$, 'heartbeat auto-checks-in for the day');
select is((select check_in_source from attendance_days where user_id='00000000-0000-0000-0000-0000000033f1' and work_date=current_date), 'auto',
  'the first heartbeat stamps an auto check-in');
select lives_ok($$ select app.attendance_heartbeat() $$, 'a second heartbeat is idempotent (no new day)');
select is((select count(*)::int from attendance_days where user_id='00000000-0000-0000-0000-0000000033f1' and work_date=current_date), 1,
  'still a single day row after two heartbeats');
select lives_ok($$ select app.attendance_start_day() $$, 'explicit Start day overrides the auto check-in');
select is((select check_in_source from attendance_days where user_id='00000000-0000-0000-0000-0000000033f1' and work_date=current_date), 'explicit',
  'Start day marks the check-in explicit');
select lives_ok($$ select app.attendance_end_day() $$, 'explicit End day closes the day');
select is((select check_out_source from attendance_days where user_id='00000000-0000-0000-0000-0000000033f1' and work_date=current_date), 'explicit',
  'End day marks the checkout explicit');
select throws_ok($$ select app.attendance_end_day() $$, '55000', null, 'ending an already-closed day is rejected');

-- no direct client write path (check-in/out only via the RPCs) ------------
select throws_ok($$ insert into attendance_days (tenant_id, user_id, work_date, checked_in_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000033f1','2026-08-10', now()) $$,
  '42501', null, 'a client cannot write attendance_days directly (RPC-only)');

-- scoped reads -------------------------------------------------------------
select is((select count(*)::int from attendance_days where user_id='00000000-0000-0000-0000-0000000033f1' and work_date='2026-08-17'), 1,
  'the subject reads their own attendance');
select is((select count(*)::int from attendance_days where user_id='00000000-0000-0000-0000-0000000033f3'), 0,
  'a peer cannot read another member''s attendance');
select set_config('request.jwt.claims',(select jwt from a_claims where id='00000000-0000-0000-0000-0000000033e1'),true);
select is((select count(*)::int from attendance_days where user_id='00000000-0000-0000-0000-0000000033f1' and work_date='2026-08-17'), 1,
  'the Team Leader reads a member of their team');
select is((select count(*)::int from attendance_days where user_id='00000000-0000-0000-0000-0000000033f3'), 0,
  'the Team Leader cannot read a member of another team');
select set_config('request.jwt.claims',(select jwt from a_claims where id='00000000-0000-0000-0000-0000000033e2'),true);
select is((select count(*)::int from attendance_days where user_id='00000000-0000-0000-0000-0000000033f3' and work_date='2026-08-17'), 1,
  'the Department Lead reads across teams within their department');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b002'),true);
select is((select count(*)::int from attendance_days), 0, 'another tenant sees no attendance rows');

-- nightly close (service role) --------------------------------------------
set local role service_role;
select is((select app.attendance_nightly_close('2026-08-15')), 1, 'the nightly close closes the one still-open day');
select is((select check_out_source from attendance_days where id='aaaaaaaa-0000-0000-0000-000000330153'), 'inferred',
  'the inferred checkout is flagged, never presented as a clean clock-out');

select * from finish();
rollback;
