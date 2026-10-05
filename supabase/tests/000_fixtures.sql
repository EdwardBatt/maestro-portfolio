-- Sanity: the shared fixture set seeds cleanly (superuser path).
begin;
select plan(4);
\ir helpers/seed.sql

select is((select count(*) from tenants)::int, 2, 'two tenants seeded');
select is((select count(*) from user_profiles)::int, 5, 'five users seeded');
-- Six since ADR-0061: the three original fixtures (Sarah, the camera, the lens pool) plus a LINKED
-- human resource for each of tenant A's three people. ADR-0011 gives every internal user one, and
-- the fixture had none — which nothing noticed until d.5 made assignability depend on it.
select is((select count(*) from resources where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001')::int, 6, 'tenant A resources seeded');
select is((select capacity_model from resources where name = 'RED Camera')::text, 'exclusive', 'camera is exclusive');

select * from finish();
rollback;
