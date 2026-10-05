-- Structural guarantees + adversarial tenant isolation (maestro-rls-testing).
begin;
select plan(12);
\ir helpers/seed.sql

-- 1) Every public table has RLS enabled AND forced — a table without RLS never merges.
select is(
  (select count(*)::int from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and not (c.relrowsecurity and c.relforcerowsecurity)),
  0, 'all public tables have RLS enabled + forced');

-- 2) Every public table carries tenant_id (allowed exceptions listed explicitly).
select is(
  (select count(*)::int from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname not in ('tenants', 'joint_projects', 'joint_project_grants',
                            'permission_catalog', -- platform vocabulary (ADR-0008)
                            -- Facts the SCHEMA knows about itself, not about a tenant: the
                            -- task-list gate's cutover moment (ADR-0100 d.7). Nothing here is
                            -- edited by a person or differs between tenants, so a tenant_id on it
                            -- would be a column that is always the same lie.
                            'app_settings')
      and not exists (select 1 from pg_attribute a
                      where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)),
  0, 'every tenant-scoped table has tenant_id');

-- === Adversarial: Booker B reads tenant A data → zero rows, every table ===
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000b002'), true);

select is((select count(*)::int from clients   where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0, 'B cannot read A clients');
select is((select count(*)::int from resources where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0, 'B cannot read A resources');
select is((select count(*)::int from campaigns where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0, 'B cannot read A campaigns');
select is((select count(*)::int from deliverables where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0, 'B cannot read A deliverables');
select is((select count(*)::int from user_profiles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0, 'B cannot read A user profiles');
select is((select count(*)::int from tenants where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0, 'B cannot see tenant A row');

-- Existence leak check: counts, not just rows (leaking counts is a leak).
select is((select count(*)::int from clients), 1, 'B sees exactly its own single client');

-- 3) Cross-tenant WRITE: B booker inserting a booking tagged tenant A is denied.
--    NOTE: the exclusivity trigger (BEFORE INSERT) resolves the resource under
--    B''s RLS and fails first (P0002) — the RLS WITH CHECK (42501) would deny
--    it anyway. Either code is a hard deny; the trigger just fires earlier.
select throws_ok($$
  insert into bookings (tenant_id, resource_id, starts_at, ends_at, state)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-00000000d002',
          '2026-08-01T09:00Z', '2026-08-01T12:00Z', 'tentative')
$$, 'P0002', null, 'B cannot insert a booking into tenant A (trigger denies before policy would)');

-- 4) Tenant spoof: B claims its own tenant_id but targets A''s resource — the row
--    would be B-tenant, which is allowed by RLS, but the exclusivity trigger must
--    still find the resource… which B cannot see. STRICT select raises.
select throws_ok($$
  insert into bookings (tenant_id, resource_id, starts_at, ends_at, state)
  values ('bbbbbbbb-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-00000000d002',
          '2026-08-01T09:00Z', '2026-08-01T12:00Z', 'tentative')
$$, 'P0002', null, 'B cannot book A''s resource by spoofing its own tenant tag');

-- 5) Anonymous: no claims → zero visibility.
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from clients), 0, 'no claims → zero rows');

select * from finish();
rollback;
