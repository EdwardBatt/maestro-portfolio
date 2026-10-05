-- ADR-0079 / I41.11 / I41.12 — a closed day belongs to the office, not to each person.
--
-- Properties:
--   * office_closures is tenant-scoped, RLS-forced and audited;
--   * leave:manage writes a closure; a team member cannot; an office in another tenant is refused;
--   * a resource created AFTER the closure was entered is covered by it (the whole point of d.1);
--   * declaring a closure moves no booking (d.5), and the stranded list names the booking that
--     sits on the closed day, with its owner (d.6);
--   * the leave policy no longer accepts kind 'holiday' (ADR-0079 retires ADR-0013's arm);
--   * it is not readable across tenants.
begin;
select plan(13);
\ir helpers/seed.sql

-- ---------------------------------------------------------------- shape ----
select has_table('public', 'office_closures', 'office_closures exists (d.1)');
select col_not_null('public', 'office_closures', 'tenant_id', 'tenant-scoped');
select has_trigger('public', 'office_closures', 'audit_row_change', 'and audited (AGENTS.md §6)');

-- ---------------------------------------------------------------- fixtures ----
-- An HR role holding leave:manage only (the shape 012 uses).
insert into roles (tenant_id, key, name, description, is_system, default_route, scope)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'people_ops', 'People Ops', 'HR', false, '/people/leave', 'tenant');
insert into role_grants (tenant_id, role_id, resource, action)
select 'aaaaaaaa-0000-0000-0000-000000000001', r.id, v.resource, v.action
from roles r cross join (values ('leave','view'), ('leave','manage')) as v(resource, action)
where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = 'people_ops';

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000a110', 'hr110@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id)
select '00000000-0000-0000-0000-00000000a110', 'aaaaaaaa-0000-0000-0000-000000000001', 'HR 110', r.id
from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = 'people_ops';
insert into test_claims
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
from user_profiles up where up.id = '00000000-0000-0000-0000-00000000a110';

-- Two offices: Baghdad in tenant A, one in tenant B.
insert into offices (id, tenant_id, name, timezone, working_days) values
  ('aaaaaaaa-0000-0000-0000-0000000f0110', 'aaaaaaaa-0000-0000-0000-000000000001', 'Baghdad 110', 'Asia/Baghdad', '{7,1,2,3,4}'),
  ('bbbbbbbb-0000-0000-0000-0000000f0110', 'bbbbbbbb-0000-0000-0000-000000000001', 'Erbil 110',   'Asia/Baghdad', '{7,1,2,3,4}');

-- Sarah (d001) works in Baghdad and is already booked on the day that is about to be closed.
update resources set office_id = 'aaaaaaaa-0000-0000-0000-0000000f0110'
  where id = 'aaaaaaaa-0000-0000-0000-00000000d001';
insert into bookings (id, tenant_id, resource_id, state, starts_at, ends_at, load_pct, title) values
  ('aaaaaaaa-0000-0000-0000-0000000b0110', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000d001', 'confirmed',
   '2026-10-05T06:00:00Z', '2026-10-05T14:00:00Z', 100, 'Panels on the closed day');

set local role authenticated;

-- ---------------------------------------------------------------- a team member cannot ----
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select throws_ok($$
  insert into office_closures (tenant_id, office_id, starts_on, ends_on, kind, name)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000f0110',
          '2026-10-05', '2026-10-06', 'public_holiday', 'Eid 110')
$$, '42501', null, 'a team member cannot declare a closure (d.7)');

-- ---------------------------------------------------------------- HR can ----
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a110'),true);
select lives_ok($$
  insert into office_closures (id, tenant_id, office_id, starts_on, ends_on, kind, name)
  values ('aaaaaaaa-0000-0000-0000-0000000c0110', 'aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-0000000f0110', '2026-10-05', '2026-10-06', 'public_holiday', 'Eid 110')
$$, 'leave:manage declares a closure on the office (d.1/d.7)');
select is(
  (select created_by from office_closures where id = 'aaaaaaaa-0000-0000-0000-0000000c0110'),
  '00000000-0000-0000-0000-00000000a110'::uuid, 'who entered it is stamped from auth.uid()');

-- An office in another tenant is refused even with the grant.
select throws_ok($$
  insert into office_closures (tenant_id, office_id, starts_on, ends_on, kind, name)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-0000000f0110',
          '2026-10-05', '2026-10-05', 'company_closed', 'Wrong office')
$$, '42501', null, 'an office in another tenant is not a tenant fence (traps.md) — refused');

-- ---------------------------------------------------------------- the leave arm is gone ----
select throws_ok($$
  insert into resource_unavailability (tenant_id, resource_id, kind, starts_at, ends_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001',
          'holiday', '2026-10-05T00:00:00Z', '2026-10-05T23:59:59Z')
$$, '42501', null, 'a per-person "holiday" can no longer be written — it is an office closure now');

-- ---------------------------------------------------------------- nothing moved (d.5) ----
select is(
  (select starts_at from bookings where id = 'aaaaaaaa-0000-0000-0000-0000000b0110'),
  '2026-10-05T06:00:00Z'::timestamptz, 'declaring the closure moved no booking (d.5)');

-- ---------------------------------------------------------------- the stranded list (d.6) ----
select results_eq($$
  select booking_id, resource_name, title
  from public.office_closure_stranded_bookings('aaaaaaaa-0000-0000-0000-0000000c0110')
$$, $$
  values ('aaaaaaaa-0000-0000-0000-0000000b0110'::uuid, 'Sarah'::text, 'Panels on the closed day'::text)
$$, 'the booking sitting on the closed day is listed with its resource (d.6)');

-- ---------------------------------------------------------------- hired after (d.1) ----
reset role;
insert into resources (id, tenant_id, kind, name, capacity_model, load_ceiling_pct, warn_at_pct, office_id) values
  ('aaaaaaaa-0000-0000-0000-00000000d110', 'aaaaaaaa-0000-0000-0000-000000000001',
   'human', 'Hired After 110', 'load_based', 120.0, 100.0, 'aaaaaaaa-0000-0000-0000-0000000f0110');
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select ok(
  app.is_office_closed((select office_id from resources where id = 'aaaaaaaa-0000-0000-0000-00000000d110'), '2026-10-06'),
  'a person hired AFTER the closure was entered is covered by it (d.1)');
select ok(
  not app.is_office_closed('aaaaaaaa-0000-0000-0000-0000000f0110', '2026-10-07'),
  'and the day after the closure is open');

-- ---------------------------------------------------------------- tenant isolation ----
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b001'),true);
select is(
  (select count(*)::int from office_closures),
  0, 'tenant B sees none of tenant A''s closures');

select * from finish();
rollback;
