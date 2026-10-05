-- ADR-0013 adversarial suite: leave authority is a dedicated `leave` grant, not
-- a seeded role. A `leave:manage` role writes leave/holiday within its scope;
-- it cannot touch maintenance, cannot reclassify a leave row into maintenance,
-- and the category enum is enforced. Schedulers (blackouts:manage) are
-- unaffected; deny-by-default and tenant isolation hold. (maestro-rls-testing)
begin;
select plan(12);
\ir helpers/seed.sql

-- Fixture: an admin-composed HR/leave role in Tenant A — exactly what an admin
-- builds on the Roles screen. Tenant scope (the default) => org-wide reach.
-- Granted leave:view + leave:manage ONLY (no blackouts:manage, no bookings…).
insert into roles (tenant_id, key, name, description, is_system, default_route, scope)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'people_ops', 'People Ops',
        'admin-composed HR/leave role', false, '/people/leave', 'tenant');
insert into role_grants (tenant_id, role_id, resource, action)
select 'aaaaaaaa-0000-0000-0000-000000000001', r.id, v.resource, v.action
from roles r
cross join (values ('leave','view'), ('leave','manage')) as v(resource, action)
where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = 'people_ops';

-- An HR user carrying that role (sub must exist for the audit FK on write).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a004', 'hr-a@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id)
select '00000000-0000-0000-0000-00000000a004', 'aaaaaaaa-0000-0000-0000-000000000001', 'HR A', r.id
from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = 'people_ops';

-- Register the HR claim in test_claims (built as superuser, readable to all) —
-- role ids are generated, and once we SET ROLE authenticated the roles table is
-- RLS-hidden until a claim is set, so the claim can't look up its own role id.
insert into test_claims
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
from user_profiles up where up.id = '00000000-0000-0000-0000-00000000a004';

-- 1) The permission pair exists in the global catalog.
select is(
  (select count(*)::int from permission_catalog where resource = 'leave'),
  2, 'leave:view + leave:manage present in the permission catalog');

-- 2) Power Admin holds both automatically (catalog trigger — never falls behind).
select is(
  (select count(*)::int from role_grants rg join roles r on r.id = rg.role_id
    where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and r.key = 'power_admin' and rg.resource = 'leave'),
  2, 'power_admin auto-holds both leave grants');

-- === HR/leave role (leave:manage, tenant scope) ===
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a004'), true);

-- 3) Can record leave (org-wide: Sarah is any staff member in the tenant).
select lives_ok($$
  insert into resource_unavailability (tenant_id, resource_id, kind, starts_at, ends_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-00000000d001',
          'leave', '2026-09-01T00:00:00Z', '2026-09-01T23:59:59Z')
$$, 'leave:manage can record leave');

-- 4) Can NOT set a per-person "holiday" any more — ADR-0079 moved holidays onto the OFFICE
--    (office_closures, test 110). The leave policy's 'holiday' arm was retired with it.
select throws_ok($$
  insert into resource_unavailability (tenant_id, resource_id, kind, starts_at, ends_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-00000000d001',
          'holiday', '2026-09-05T00:00:00Z', '2026-09-05T23:59:59Z')
$$, '42501', null, 'a per-person holiday is refused — holidays belong to the office (ADR-0079)');

-- 5) Emergency leave is a category of a leave row.
select lives_ok($$
  insert into resource_unavailability (tenant_id, resource_id, kind, category, starts_at, ends_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-00000000d001',
          'leave', 'emergency', '2026-09-10T00:00:00Z', '2026-09-11T23:59:59Z')
$$, 'leave:manage can record emergency leave (category)');

-- 6) But NOT maintenance — the kind-fence keeps ops out of HR's reach.
select throws_ok($$
  insert into resource_unavailability (tenant_id, resource_id, kind, starts_at, ends_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-00000000d001',
          'maintenance', '2026-09-12T00:00:00Z', '2026-09-12T23:59:59Z')
$$, '42501', null, 'leave:manage cannot write maintenance (kind-fenced RLS)');

-- 7) The category enum is enforced by the table CHECK.
select throws_ok($$
  insert into resource_unavailability (tenant_id, resource_id, kind, category, starts_at, ends_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-00000000d001',
          'leave', 'bogus', '2026-09-13T00:00:00Z', '2026-09-13T23:59:59Z')
$$, '23514', null, 'category is constrained to planned/emergency/sick/unpaid');

-- 8) Cannot escape the fence by reclassifying an existing leave row.
select throws_ok($$
  update resource_unavailability set kind = 'maintenance'
  where kind = 'leave' and category is null
$$, '42501', null, 'cannot reclassify a leave row into maintenance (WITH CHECK)');

-- 9) Legitimate edit of a leave row (kind unchanged) is allowed.
select lives_ok($$
  update resource_unavailability set reason = 'updated'
  where kind = 'leave' and category is null
$$, 'leave:manage can edit its own leave rows');

-- === Deny-by-default: team member has neither grant ===
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select throws_ok($$
  insert into resource_unavailability (tenant_id, resource_id, kind, starts_at, ends_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-00000000d001',
          'leave', '2026-09-14T00:00:00Z', '2026-09-14T23:59:59Z')
$$, '42501', null, 'team_member without leave:manage is refused');

-- === Scheduler (blackouts:manage) is unaffected by the new policy ===
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);
select lives_ok($$
  insert into resource_unavailability (tenant_id, resource_id, kind, starts_at, ends_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-00000000d001',
          'maintenance', '2026-09-15T00:00:00Z', '2026-09-15T23:59:59Z')
$$, 'scheduler with blackouts:manage still writes maintenance');

-- === Tenant isolation: HR in A cannot record leave against a Tenant B resource ===
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a004'), true);
select throws_ok($$
  insert into resource_unavailability (tenant_id, resource_id, kind, starts_at, ends_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          'bbbbbbbb-0000-0000-0000-00000000d001',
          'leave', '2026-09-16T00:00:00Z', '2026-09-16T23:59:59Z')
$$, '42501', null, 'leave writes cannot reach another tenant''s resource');

select * from finish();
rollback;
