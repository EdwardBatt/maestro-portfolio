-- I18 (ADR-0051) — the deliverable taxonomy as tenant data.
--
-- Assertion 4 is the one that justifies the central decision: **a tenant adds a seventh
-- client_approval value with no migration.** ADR-0051 d.10 rejected Postgres enums for the six
-- attribute lists on exactly that ground — an enum is global to the estate, so "closed" would mean
-- closed for every agency forever, and a pharma client needing "Medical Sign-off" would be a
-- release rather than a row. If that assertion ever fails, the decision has been undone.

begin;
select plan(10);
\ir helpers/seed.sql

reset role;

-- Migrations seed the tenants that exist WHEN THEY RUN, and future tenants get theirs through
-- `public.seed_tenant_roles`. This fixture creates its tenants afterwards and calls
-- `app.seed_tenant_roles` directly, bypassing that wrapper — so it seeds them here. Same shape as
-- 058 does for brief templates.
select app.seed_tenant_deliverable_taxonomy(id) from tenants;

-- ============================================================ 1-3. the seed ====
select is((select count(*)::int from deliverable_categories
            where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 16,
  'sixteen categories seeded');

select is((select count(*)::int from deliverable_types
            where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 240,
  'two hundred and forty types seeded');

select is((select count(*)::int from deliverable_attribute_values
            where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 48,
  'forty-eight attribute values across six attributes');

-- ============================== 4. THE ONE. no migration for a seventh value ====
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

select lives_ok(
  $$insert into deliverable_attribute_values (tenant_id, attribute, code, label_en, label_ar)
    values ('aaaaaaaa-0000-0000-0000-000000000001','client_approval','SHARIAH_BOARD',
            'Shariah Board Review','مراجعة الهيئة الشرعية')$$,
  'a tenant adds a seventh client_approval level with no migration — the reason these are rows, not an enum');

-- ================================= 5. and only with organization:manage ====
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select throws_ok(
  $$insert into deliverable_types (tenant_id, code, category_code, name_en)
    values ('aaaaaaaa-0000-0000-0000-000000000001','XXX-999','STR','Sneaky type')$$,
  '42501', null,
  'a team member cannot invent a deliverable type');

-- ============================================= 6. the code is the key, not the name ====
-- Twelve names appear under two codes. If the name were ever treated as unique this returns 1.
reset role;
select is((select count(*)::int from deliverable_types
            where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and name_en = 'Reel'), 2,
  'two rows are called Reel — SOC-004 and VID-008 — and the category is what tells them apart');

select is(
  (select string_agg(category_code, ',' order by category_code) from deliverable_types
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and name_en = 'Reel'),
  'SOC,VID', 'and they sit in different categories, which is what ADR-0054 disambiguates on');

-- ================================== 7. the tenant fence is structural, not a policy ====
-- A category that exists in tenant A only. FKs ignore RLS, so the composite (tenant_id, code)
-- reference is the only thing that can stop B pointing at it.
insert into deliverable_categories (tenant_id, code, name_en)
values ('aaaaaaaa-0000-0000-0000-000000000001','ZZZ','A-only category');

select throws_ok(
  $$insert into deliverable_types (tenant_id, code, category_code, name_en)
    values ('bbbbbbbb-0000-0000-0000-000000000001','ZZZ-001','ZZZ','Borrowed')$$,
  '23503', null,
  'tenant B cannot point a type at tenant A''s category — the composite FK refuses it');

-- ============================================== 8. an untyped deliverable is legal ====
-- The owner is fixture, not the subject. Assertion 5's claims are still in force — `reset role`
-- does not clear them — so this is a real caller, and ADR-0100 d.8 requires one to name an owner:
-- the owner is who approves the task list before anybody can be assigned, so work with none is
-- work nobody can start. What is asserted is unchanged, and it is about the TYPE, which a
-- deliverable may permanently have none of (d.7).
select lives_ok(
  $$insert into deliverables (tenant_id, job_id, name, owner_user_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-00000000f001','Untyped thing',
            '00000000-0000-0000-0000-00000000a003')$$,
  'a deliverable with no type is a permanent legal state, not a migration failure (d.7)');

-- ==================================== 9. seed-then-edit survives a re-run ====
-- `on conflict do nothing` is what makes d.3 true rather than aspirational: a tenant that renamed
-- a type keeps its name when provisioning re-runs.
update deliverable_types set name_en = 'Hero Film'
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and code = 'VID-002';
select app.seed_tenant_deliverable_taxonomy('aaaaaaaa-0000-0000-0000-000000000001');
select is(
  (select name_en from deliverable_types
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and code = 'VID-002'),
  'Hero Film',
  're-seeding never overwrites a row the tenant has edited');

select finish();
rollback;
