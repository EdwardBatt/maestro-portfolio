-- I48.20 — a NEW tenant, provisioned through the public wrapper, has everything a tenant needs.
--
-- The wrapper has silently lost seeds twice (27 Aug, 5 Sep) because `create or replace` cannot say
-- what the previous body held. This suite provisions a fresh tenant exactly as `invite-user` /
-- tenant creation does and asserts each seed's footprint — so the next reproduction from the wrong
-- base fails here, not in a tenant's first week.
begin;
select plan(13);
\ir helpers/seed.sql

insert into tenants (id, name, slug) values
  ('cccccccc-0000-0000-0000-000000000114', 'Fresh Tenant 114', 'fresh-114');
select lives_ok($$ select public.seed_tenant_roles('cccccccc-0000-0000-0000-000000000114') $$,
  'the public wrapper provisions a fresh tenant');

-- roles
select cmp_ok((select count(*)::int from roles where tenant_id = 'cccccccc-0000-0000-0000-000000000114'), '>=', 11,
  'the role set, incl. the Account Director');
select isnt_empty($$ select 1 from roles where tenant_id = 'cccccccc-0000-0000-0000-000000000114' and key = 'account_director' $$,
  'the Account Director role (ADR-0073)');

-- asset grants (lost 27 Aug and 5 Sep)
select results_eq($$
  select r.key from role_grants g join roles r on r.id = g.role_id
   where g.tenant_id = 'cccccccc-0000-0000-0000-000000000114' and g.resource = 'assets' and g.action = 'manage'
   order by 1
$$, $$ values ('account_director'), ('account_manager'), ('department_lead'), ('deputy_team_lead'), ('power_admin'), ('scheduler'), ('team_lead'), ('team_member') $$,
  'assets:manage reaches the roles that file and upload — the seven seeded ones plus the Account Director, which copies the AM (seed_tenant_asset_grants)');

-- briefs:approve (lost 5 Sep): the department's own people, the AM, Traffic, the deputy, plus the two
-- agency-wide roles.
select results_eq($$
  select r.key from role_grants g join roles r on r.id = g.role_id
   where g.tenant_id = 'cccccccc-0000-0000-0000-000000000114' and g.resource = 'briefs' and g.action = 'approve'
   order by 1
$$, $$ values ('account_director'), ('account_manager'), ('department_lead'), ('deputy_team_lead'), ('power_admin'), ('scheduler'), ('team_lead') $$,
  'briefs:approve reaches the people ADR-0070 d.2 names (seed_tenant_brief_approval_grants)');

-- THE GUARD: every app.seed_* function that exists is named in the wrapper's body. A seed added
-- later and forgotten here fails this line, not a tenant's first week.
select is_empty($$
  select p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname like 'seed\_%' and p.proname <> 'seed_tenant_roles'
     and position('app.' || p.proname in pg_get_functiondef('public.seed_tenant_roles(uuid)'::regprocedure)) = 0
$$, 'every app.seed_* function is called by the provisioning wrapper');

-- storage + reminder rows (lost 27 Aug and 5 Sep)
select isnt_empty($$ select 1 from tenant_storage_settings where tenant_id = 'cccccccc-0000-0000-0000-000000000114' $$,
  'a tenant_storage_settings row (archive residency, ADR-0016)');
select results_eq($$
  select brief_approval_hours, delivery_days_before_go_live, commence_days_before_delivery, review_buffer_working_days
    from tenant_reminder_settings where tenant_id = 'cccccccc-0000-0000-0000-000000000114'
$$, $$ values (24, 2, 4, 1) $$,
  'a tenant_reminder_settings row with the measured defaults (ADR-0066 d.8, I41.10)');

-- the rest of the wrapper's footprint
select isnt_empty($$ select 1 from brief_templates where tenant_id = 'cccccccc-0000-0000-0000-000000000114' and brief_type = 'single_execution' $$,
  'the brief templates, incl. single_execution');
select cmp_ok((select count(*)::int from deliverable_types where tenant_id = 'cccccccc-0000-0000-0000-000000000114'), '>', 100,
  'the deliverable taxonomy');
select isnt_empty($$ select 1 from workflow_templates where tenant_id = 'cccccccc-0000-0000-0000-000000000114' $$,
  'the workflow templates');
select isnt_empty($$ select 1 from brief_deliverable_types where tenant_id = 'cccccccc-0000-0000-0000-000000000114' $$,
  'the brief → deliverable-type map (ADR-0071)');
-- the language list (I56.7) — added to existing tenants by 20260923230000 and to provisioning only
-- by 20260926180000 (I59.37); a new tenant had none until then.
select results_eq($$
  select code from deliverable_attribute_values
   where tenant_id = 'cccccccc-0000-0000-0000-000000000114' and attribute = 'language' and is_active
   order by sort_order
$$, $$ values ('ar'), ('en'), ('ku') $$,
  'the language list: Arabic, English, Kurdish (seed_tenant_languages)');

select * from finish();
rollback;
