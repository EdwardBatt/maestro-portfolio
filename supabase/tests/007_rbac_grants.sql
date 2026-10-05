-- ADR-0008 adversarial suite: grants decide everything, deny by default,
-- system roles fenced, Power Admin never falls behind (maestro-rls-testing).
begin;
select plan(13);
\ir helpers/seed.sql

-- 1) Power Admin holds the complete catalog — full access by coverage.
select is(
  (select count(*)::int from role_grants rg
    join roles r on r.id = rg.role_id
    where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = 'power_admin'),
  (select count(*)::int from permission_catalog),
  'power_admin grant count equals full catalog');

-- 2) Catalog growth auto-grants to every tenant''s Power Admin (both tenants).
insert into permission_catalog (resource, action, description)
values ('future_area', 'manage', 'added by a later migration');
select is(
  (select count(*)::int from role_grants rg
    join roles r on r.id = rg.role_id
    where r.key = 'power_admin' and rg.resource = 'future_area' and rg.action = 'manage'),
  2, 'new catalog entry auto-granted to power_admin in all tenants');

-- === Scheduler A: has bookings:create, lacks users:manage ===
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);

select lives_ok($$
  insert into bookings (tenant_id, resource_id, starts_at, ends_at, state)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-00000000d001',
          '2026-09-01T09:00Z', '2026-09-01T13:00Z', 'tentative')
$$, 'scheduler with bookings:create can book');

-- RLS filters foreign rows silently on UPDATE (0 rows, no error) — so the
-- adversarial assertion is that nothing changed:
update user_profiles set display_name = 'X'
  where id = '00000000-0000-0000-0000-00000000a003';
select is(
  (select display_name from user_profiles where id = '00000000-0000-0000-0000-00000000a003'),
  'Creative A', 'profile unchanged — no users:manage, no reach');

select throws_ok($$
  insert into roles (tenant_id, key, name)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'rogue', 'Rogue')
$$, '42501', null, 'scheduler without roles:manage cannot create roles');

select throws_ok($$
  insert into role_grants (tenant_id, role_id, resource, action)
  select 'aaaaaaaa-0000-0000-0000-000000000001', r.id, 'users', 'manage'
  from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = 'scheduler'
$$, '42501', null, 'scheduler cannot self-escalate by inserting a grant');

-- === Team member A: booking write (deny-by-default) ===
-- A team_member holds no bookings:create grant, so a PostgREST-direct booking insert is refused.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select throws_ok($$
  insert into bookings (tenant_id, resource_id, starts_at, ends_at, state)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-00000000d001',
          '2026-09-02T09:00Z', '2026-09-02T13:00Z', 'tentative')
$$, '42501', null, 'team member cannot create a booking (deny-by-default)');

-- === Forged claim: tenant A caller pointing app_role_id at tenant B''s power_admin ===
select set_config('request.jwt.claims',
  (select json_build_object('sub', '00000000-0000-0000-0000-00000000a003',
    'app_metadata', json_build_object(
      'tenant_id', 'aaaaaaaa-0000-0000-0000-000000000001',
      'app_role_id', (select r.id from roles r
                      where r.tenant_id = 'bbbbbbbb-0000-0000-0000-000000000001'
                        and r.key = 'power_admin')))::text), true);
select throws_ok($$
  insert into bookings (tenant_id, resource_id, starts_at, ends_at, state)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-00000000d001',
          '2026-09-03T09:00Z', '2026-09-03T13:00Z', 'tentative')
$$, '42501', null, 'cross-tenant role id in the claim grants NOTHING (tenant pin in has_permission)');

-- === Power Admin A: roles:manage works; system fencing holds even for them ===
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

select lives_ok($$
  insert into roles (tenant_id, key, name, description)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'producer', 'Producer', 'created from the rules screen')
$$, 'power_admin with roles:manage can create a role');

select lives_ok($$
  insert into role_grants (tenant_id, role_id, resource, action)
  select 'aaaaaaaa-0000-0000-0000-000000000001', r.id, 'schedule', 'view'
  from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = 'producer'
$$, 'power_admin can grant to a custom role');

select throws_ok($$
  delete from roles
  where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'power_admin'
$$, 'P0001', null, 'system role cannot be deleted, even by power_admin');

select throws_ok($$
  delete from role_grants rg
  using roles r
  where r.id = rg.role_id and r.key = 'power_admin'
    and rg.resource = 'users' and rg.action = 'manage'
$$, 'P0001', null, 'power_admin grants cannot be stripped (never falls behind)');

-- === Tenant isolation on the RBAC tables themselves ===
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000b002'), true);
select is(
  (select count(*)::int from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0, 'B cannot read A roles');

select * from finish();
rollback;
