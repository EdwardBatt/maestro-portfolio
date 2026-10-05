-- Every deliverable type gets a default workflow template (ADR-0052).
--
-- Edward, 29 Aug: "not one single type creates a task list" — 0 of 269, because the picker asked
-- for 269 choices before the feature did anything. The assertions that matter are the two that
-- would let that happen again silently: that NO type is left without a template, and that setting
-- a type on a deliverable now actually materialises the tasks.
--
-- The third is the one that makes this seed-then-edit rather than an override: a template somebody
-- chose themselves must survive the seeder running again.

begin;
select plan(8);
\ir helpers/seed.sql

reset role;

-- This fixture creates its tenants after the migrations ran and calls `app.seed_tenant_roles`
-- directly, bypassing the provisioning wrapper — so it seeds them here, in wrapper order.
select app.seed_tenant_deliverable_taxonomy(id) from tenants;
select app.seed_tenant_taxonomy_amendments(id) from tenants;
select app.seed_tenant_workflow_templates(id) from tenants;
select app.seed_tenant_default_workflows(id) from tenants;

-- ------------------------------------------------- nothing is left without one ----
select is(
  (select count(*)::int from deliverable_types
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and default_workflow_template_id is null),
  0, 'every deliverable type has a workflow template — the number that was 269');

select is(
  (select wt.code from deliverable_types dt
     join workflow_templates wt on wt.id = dt.default_workflow_template_id
    where dt.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and dt.code = 'SOC-004'),
  'WF-02', 'a Reel maps to Social Content');

select is(
  (select wt.code from deliverable_types dt
     join workflow_templates wt on wt.id = dt.default_workflow_template_id
    where dt.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and dt.code = 'VID-001'),
  'WF-03', 'a TVC maps to Video Production');

-- The four production pipelines carry Physical Media / Ingest / Backup steps and belong to types
-- somebody chooses on purpose. A whole category defaulting into one would put an ingest stage on
-- work that has no footage.
select is(
  (select count(*)::int from deliverable_types dt
     join workflow_templates wt on wt.id = dt.default_workflow_template_id
    where dt.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and wt.code in ('WF-11', 'WF-12', 'WF-13', 'WF-14')),
  0, 'and no category was defaulted onto one of the four heavy production pipelines');

-- ------------------------------------------------- a tenant's own choice wins ----
update deliverable_types
   set default_workflow_template_id = (select id from workflow_templates
     where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and code = 'WF-14')
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and code = 'SOC-004';

select lives_ok(
  $$select app.seed_tenant_default_workflows('aaaaaaaa-0000-0000-0000-000000000001')$$,
  'the seeder is idempotent');
select is(
  (select wt.code from deliverable_types dt
     join workflow_templates wt on wt.id = dt.default_workflow_template_id
    where dt.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and dt.code = 'SOC-004'),
  'WF-14',
  'and re-running it does NOT overwrite a template the tenant chose — blanks only');

-- ------------------------------------------------- the point of all of it ----
-- The end-to-end claim: setting a type on a deliverable creates its task list. This is what was
-- false for every type in the system until now, while every I19 task sat ticked.
insert into deliverables (id, tenant_id, job_id, name, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000071e1', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001', 'A TVC', '00000000-0000-0000-0000-00000000a001');

update deliverables
   set deliverable_type_id = (select id from deliverable_types
     where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and code = 'VID-001')
 where id = 'aaaaaaaa-0000-0000-0000-0000000071e1';

select ok(
  (select count(*) from sub_tasks
    where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000071e1') > 0,
  'setting a type on a deliverable now materialises its task list');

select is(
  (select count(*)::int from sub_tasks
    where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000071e1' and assignee_id is not null),
  0, 'and every one of them arrives unassigned, as ADR-0052 d.5 requires');

select * from finish();
rollback;
