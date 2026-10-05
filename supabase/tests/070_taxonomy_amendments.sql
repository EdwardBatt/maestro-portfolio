-- Taxonomy amendments approved by Edward, 29 Aug 2026.
--
-- What is worth asserting about a seed is not that every row landed — that is a list, and a list
-- tests itself the moment anyone opens the screen. It is the four things that could be silently
-- wrong: that a NEW tenant gets the amendments too, that the renames do not trample a tenant's own
-- wording, that a deactivated type still labels the work already carrying it, and that the new
-- categories are fenced by tenant like every other row.

begin;
select plan(12);
\ir helpers/seed.sql

reset role;

-- The migration seeds the tenants that existed WHEN IT RAN, and provisioning seeds new ones through
-- `public.seed_tenant_roles`. This fixture creates its tenants afterwards and calls
-- `app.seed_tenant_roles` directly, bypassing that wrapper — so it seeds them here. Same shape as
-- `064`, and the reason assertion 12 below exercises the wrapper properly on a fresh tenant.
select app.seed_tenant_deliverable_taxonomy(id) from tenants;
select app.seed_tenant_taxonomy_amendments(id) from tenants;

-- ---------------------------------------------------- the amendments landed ----
select is(
  (select count(*)::int from deliverable_categories
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and code in ('INF', 'MED', 'AUD')),
  3, 'the three new categories exist');

select is(
  (select count(*)::int from deliverable_types
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and code like 'INF-%'),
  6, 'INFLUENCER & CREATOR has six types — the department had none at all before this');

select is(
  (select count(*)::int from deliverable_types
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and code in ('STR-013','STR-014','STR-015','STR-016','STR-017')),
  5, 'the strategy cluster landed in the EXISTING category, needing no new one');

select is(
  (select name_en from deliverable_types
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and code = 'CNT-021'),
  'Content Calendar',
  'a content calendar can be named — PRT-018 "Calendar" is a printed one and was a trap');

-- ---------------------------------------------------- the renames ----
select is(
  (select name_en from deliverable_types
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and code = 'CNT-015'),
  'Newsletter Copy', 'the copy and the printed piece no longer share one word');
select is(
  (select name_en from deliverable_types
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and code = 'PRT-009'),
  'Printed Newsletter', 'both halves of the rename applied');

-- ADR-0051 d.3: seed-then-edit means the TENANT'S edit outranks ours. Re-running the seeder over a
-- row somebody has renamed themselves must leave their wording alone — the guard is on the current
-- value, not on a flag, so this is the assertion that proves it.
update deliverable_types set name_en = 'Client Newsletter'
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and code = 'CNT-015';
select lives_ok(
  $$select app.seed_tenant_taxonomy_amendments('aaaaaaaa-0000-0000-0000-000000000001')$$,
  'the amendment seeder is idempotent');
select is(
  (select name_en from deliverable_types
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and code = 'CNT-015'),
  'Client Newsletter',
  'and re-running it does NOT overwrite a name the tenant chose for itself');

-- ---------------------------------------------------- the deactivations ----
-- Deactivated, never deleted. A type is a record of what was agreed on work already done, so a
-- deliverable already carrying it keeps displaying it (ADR-0051 d.13).
select is(
  (select count(*)::int from deliverable_types
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and code in ('STR-012', 'ENV-006', 'VID-013') and not is_active),
  3, 'the three duplicate codes are switched off');

insert into deliverables (id, tenant_id, job_id, name, deliverable_type_id, reviewer_id)
select 'aaaaaaaa-0000-0000-0000-0000000070e1', 'aaaaaaaa-0000-0000-0000-000000000001',
       'aaaaaaaa-0000-0000-0000-00000000f001', 'Work booked under the old code', dt.id,
       '00000000-0000-0000-0000-00000000a001'
  from deliverable_types dt
 where dt.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and dt.code = 'STR-012';
select is(
  (select dt.name_en from deliverables d
     join deliverable_types dt on dt.id = d.deliverable_type_id
    where d.id = 'aaaaaaaa-0000-0000-0000-0000000070e1'),
  'Campaign Strategy',
  'and work already carrying a switched-off type still reads its label');

-- ---------------------------------------------------- a NEW tenant gets them ----
-- The failure that would not surface until the next customer: the amendments live in their own
-- function, so the provisioning wrapper has to call it. If it does not, tenant A has 269 types and
-- everybody after it has 240, and nobody finds out for months.
insert into tenants (id, name, slug) values
  ('dddddddd-0000-0000-0000-000000000001', 'Tenant D (new customer)', 'tenant-d');
select lives_ok(
  $$select public.seed_tenant_roles('dddddddd-0000-0000-0000-000000000001')$$,
  'provisioning a brand-new tenant still succeeds');
select ok(
  (select count(*) from deliverable_categories
    where tenant_id = 'dddddddd-0000-0000-0000-000000000001' and code in ('INF','MED','AUD')) = 3
  and (select count(*) from deliverable_types
    where tenant_id = 'dddddddd-0000-0000-0000-000000000001' and code like 'AUD-%') = 5,
  'and it gets the amendments, not just the original 240');

select * from finish();
rollback;
