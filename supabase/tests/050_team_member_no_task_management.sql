-- 20260825110000: Team Member holds no task management, and the grant 20260824170000 dropped is back.
--
-- Two independent claims, both about the SEEDER (what a new tenant gets), so both are asserted by
-- seeding a fresh tenant rather than by reading the fixture's own rows — the fixture deliberately
-- adds project_tasks:manage back to a003 for the scope suites, so asserting against tenant A would
-- test the fixture instead of the product.

begin;
select plan(6);
\ir helpers/seed.sql

-- A tenant seeded the way a real new one is.
insert into tenants (id, name, slug) values
  ('cccccccc-0000-0000-0000-000000000001', 'Seeded Fresh', 'tenant-c');
select app.seed_tenant_roles('cccccccc-0000-0000-0000-000000000001');

-- ------------------------------------------------- team member: no manage ----
select is(
  (select count(*)::int from role_grants g join roles r on r.id = g.role_id
    where r.tenant_id = 'cccccccc-0000-0000-0000-000000000001' and r.key = 'team_member'
      and g.resource = 'project_tasks' and g.action = 'manage'),
  0,
  'a newly seeded Team Member does NOT hold project_tasks:manage');

-- What it still holds — the grant removal must not have taken anything else with it.
select is(
  (select count(*)::int from role_grants g join roles r on r.id = g.role_id
    where r.tenant_id = 'cccccccc-0000-0000-0000-000000000001' and r.key = 'team_member'
      and (g.resource, g.action) in (('my_tasks','view'), ('my_calendar','view'),
                                     ('media','manage'), ('schedule','view'))),
  4,
  'and still holds my_tasks/my_calendar/media/schedule — the work it actually does');

-- --------------------------------------- account manager: eligibility back ----
-- 20260823140000 granted it; 20260824170000 reproduced the seeder from an older base and lost it.
select is(
  (select count(*)::int from role_grants g join roles r on r.id = g.role_id
    where r.tenant_id = 'cccccccc-0000-0000-0000-000000000001' and r.key = 'account_manager'
      and g.resource = 'account_manager' and g.action = 'manage'),
  1,
  'a newly seeded Account Manager IS eligible to be named as a client AM (the grant 20260824170000 lost)');

-- The I12.6 booking grants added at the same time must still be there.
select is(
  (select count(*)::int from role_grants g join roles r on r.id = g.role_id
    where r.tenant_id = 'cccccccc-0000-0000-0000-000000000001' and r.key = 'account_manager'
      and (g.resource, g.action) in (('bookings','create'), ('bookings','update'), ('bookings','delete'))),
  3,
  'and still holds the bookings grants I12.6 gave it (ADR-0040 needs them)');

-- ------------------------------------------------------- ADR-0033 pin ----
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'seed_tenant_roles'
      and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')),
  1,
  'the seeder carries its search_path pin — CREATE OR REPLACE resets proconfig, so it must be inline');

-- --------------------------------- the member path still works without it ----
-- The reason removing the grant is safe: progressing your own task never consulted it.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
set local role authenticated;
select lives_ok(
  $$update sub_tasks set status = 'in_progress' where id = 'aaaaaaaa-0000-0000-0000-00000000b901'$$,
  'a Team Member still progresses their OWN task — the self path, not the manage path');

select * from finish();
rollback;
