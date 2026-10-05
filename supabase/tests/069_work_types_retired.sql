-- I21 (ADR-0056) — `work_types` is gone, and nothing that mattered went with it.
--
-- A migration that DROPS things earns a different kind of test from one that adds them: the useful
-- assertions are about what survived, not about what was removed. Four things have to hold.
--
--   1. The table and its five FK columns are actually gone — not renamed, not left behind.
--   2. Provisioning a NEW TENANT still works and still seeds everything. This is the one that would
--      not surface until the next customer, months later, and it is the reason ADR-0056 d.8 exists.
--   3. `app.effective_sla` still resolves. Its two work-type tiers were removed from the middle of
--      the chain, which is exactly where an off-by-one in a rewrite hides. (031 covers the
--      precedence in full; this is the smoke test that the function still runs at all.)
--   4. One default SLA profile per tenant is still enforced, by the index that replaced
--      `uq_sla_profile_wt_default`.
--
-- The REFUSAL (the migration's safety check) is deliberately not tested here. It runs once, inside
-- the migration, against a database where the answer is already known to be zero — pgTAP runs after
-- every migration has applied, so by the time this file executes there is nothing left to refuse.
-- Testing it would mean re-creating the dropped table to prove a check that has already passed.
begin;
select plan(11);
\ir helpers/seed.sql

-- ---- 1. the table and the columns ----
select hasnt_table('public', 'work_types', 'work_types is gone');

select hasnt_column('public', 'streams',         'work_type_id', 'streams.work_type_id is gone');
select hasnt_column('public', 'jobs',            'work_type_id', 'jobs.work_type_id is gone');
select hasnt_column('public', 'bookings',        'work_type_id', 'bookings.work_type_id is gone');
select hasnt_column('public', 'sla_profiles',    'work_type_id', 'sla_profiles.work_type_id is gone');
select hasnt_column('public', 'kpi_definitions', 'work_type_id', 'kpi_definitions.work_type_id is gone');

-- d.6: renamed onto the axis that replaced it, rather than dropped outright.
select has_column('public', 'kpi_definitions', 'deliverable_type_id',
  'kpi_definitions carries deliverable_type_id in its place');

-- ---- 2. provisioning a new tenant (d.8) ----
-- The failure that would not appear until the next customer. `public.seed_tenant_roles` called
-- `app.seed_tenant_disciplines` as one of five seeders; dropping the discipline seeder without
-- rewriting the wrapper leaves a wrapper calling a function that no longer exists.
insert into tenants (id, name, slug) values
  ('cccccccc-0000-0000-0000-000000000001', 'Tenant C (new customer)', 'tenant-c');

select lives_ok(
  $$select public.seed_tenant_roles('cccccccc-0000-0000-0000-000000000001')$$,
  'provisioning a brand-new tenant still succeeds');

-- And still seeds everything, not merely "does not error". A wrapper copied from the wrong
-- migration would drop brief templates, the taxonomy or the workflow templates silently.
select ok(
  (select count(*) from roles where tenant_id = 'cccccccc-0000-0000-0000-000000000001') > 0
  and (select count(*) from deliverable_types where tenant_id = 'cccccccc-0000-0000-0000-000000000001') > 0
  and (select count(*) from workflow_templates where tenant_id = 'cccccccc-0000-0000-0000-000000000001') > 0
  and (select count(*) from brief_templates where tenant_id = 'cccccccc-0000-0000-0000-000000000001') > 0,
  'and it seeds roles, the deliverable taxonomy, workflow templates and brief templates');

-- ---- 3. effective_sla still resolves with its middle tiers removed ----
insert into sla_profiles (id, tenant_id, name, turnaround_hours, is_default) values
  ('aaaaaaaa-0000-0000-0000-0000000069b1','aaaaaaaa-0000-0000-0000-000000000001','tenant default',72,true);
insert into deliverables (id, tenant_id, job_id, name, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000069e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001','SLA smoke','00000000-0000-0000-0000-00000000a001');
insert into sub_tasks (id, tenant_id, deliverable_id, title) values
  ('aaaaaaaa-0000-0000-0000-0000000069a1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000069e1','ST');

select is(
  (select app.effective_sla('aaaaaaaa-0000-0000-0000-0000000069a1')), 72::numeric,
  'effective_sla still resolves to the tenant default with the work-type tiers removed');

-- ---- 4. one default per tenant, by the index that replaced uq_sla_profile_wt_default ----
select throws_ok($$
  insert into sla_profiles (tenant_id, name, turnaround_hours, is_default)
  values ('aaaaaaaa-0000-0000-0000-000000000001','a second default',24,true) $$,
  '23505', null,
  'the one-default-per-tenant invariant survived the column it used to be scoped by');

select * from finish();
rollback;
