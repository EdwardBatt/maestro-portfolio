-- I59.24 / ADR-0108 d.2, d.3, d.6 — every escalation is a tenant setting; the defaults exist for every
-- tenant, today's and tomorrow's; the rules are read in the tenant and written by organization:manage.
--
-- Seed: a001 Power Admin (organization:manage), a002 Traffic Manager (scheduler), a003 Team Member;
-- b001 is Tenant B's Power Admin.
begin;
select plan(20);
\ir helpers/seed.sql

-- The fixture's tenants are made after the migrations ran, through app.seed_tenant_roles — seed their
-- rules the way the provisioning wrapper does.
select app.seed_tenant_reminder_settings(id) from tenants;
select app.seed_account_director(id) from tenants;
select app.seed_tenant_escalation_rules(id) from tenants;

-- ---------------------------------------------------------------- the defaults ----
select is((select count(*)::int from tenants t
            where (select count(*) from tenant_escalation_rules r where r.tenant_id = t.id) <> 12),
  0, 'every tenant has all twelve escalation rows (I59 E8 split task_list and campaign_brief; ADR-0133 added handover; ADR-0139 task_request; ADR-0141 deliverable_change)');

select results_eq($$
  select kind, hours, relative from tenant_escalation_rules
   where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' order by kind
$$, $$ values
  ('blocked', 24, array['owner','account_manager']),
  ('campaign_brief', 24, array[]::text[]),
  ('change_request', 8, array['owner_department_lead','account_manager']),
  ('deliverable_change', 4, array[]::text[]),
  ('extension_am', 8, array[]::text[]),
  ('extension_owner', 8, array['owner_department_lead']),
  ('handover', 24, array[]::text[]),
  ('review_escalate', 48, array['account_manager','owner']),
  ('review_remind', 24, array['reviewers']),
  ('task_list', 24, array['account_manager']),
  ('task_request', 4, array[]::text[]),
  ('unassigned', 24, array['owner'])
$$, 'the hours and the relatives are ADR-0108 d.2''s table');

select is((select role_ids from tenant_escalation_rules
            where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'unassigned'),
  array[(select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'scheduler')],
  'nobody assigned goes to the Traffic Manager (the scheduler role)');
select is((select role_ids from tenant_escalation_rules
            where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'task_list'),
  array[(select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'scheduler')],
  'a task list not approved goes to the Traffic Manager');
select is((select role_ids from tenant_escalation_rules
            where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'extension_am'),
  array[(select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'account_director')],
  'the AM''s extension step goes to the Account Director');
select is((select over_capacity_pct from tenant_reminder_settings where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  110, 'over capacity defaults to 110% (d.6)');

-- A second seed never overwrites an edit.
update tenant_escalation_rules set hours = 12 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'blocked';
select app.seed_tenant_escalation_rules('aaaaaaaa-0000-0000-0000-000000000001');
select is((select hours from tenant_escalation_rules where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'blocked'),
  12, 're-seeding keeps the tenant''s own hours');

-- A tenant created tomorrow gets them through the provisioning wrapper.
insert into tenants (id, name, slug) values ('cccccccc-0000-0000-0000-000000000170', 'Tenant C 170', 'tenant-c-170');
select public.seed_tenant_roles('cccccccc-0000-0000-0000-000000000170');
select is((select count(*)::int from tenant_escalation_rules where tenant_id = 'cccccccc-0000-0000-0000-000000000170'),
  12, 'a newly provisioned tenant has the twelve rules');
select is((select role_ids from tenant_escalation_rules where tenant_id = 'cccccccc-0000-0000-0000-000000000170' and kind = 'extension_am'),
  array[(select id from roles where tenant_id = 'cccccccc-0000-0000-0000-000000000170' and key = 'account_director')],
  'and its Account Director is named (the seed runs after that role exists)');

-- ---------------------------------------------------------------- the shape ----
select throws_ok($$
  insert into tenant_escalation_rules (tenant_id, kind, hours) values ('cccccccc-0000-0000-0000-000000000170', 'lunch', 1)
$$, '23514', null, 'an unknown kind is refused');
select throws_ok($$
  update tenant_escalation_rules set hours = 0 where tenant_id = 'cccccccc-0000-0000-0000-000000000170' and kind = 'blocked'
$$, '23514', null, 'hours must be above zero');
select throws_ok($$
  update tenant_escalation_rules set relative = array['owner','the_ceo'] where tenant_id = 'cccccccc-0000-0000-0000-000000000170' and kind = 'blocked'
$$, '23514', null, 'a relative outside the five is refused');

-- ---------------------------------------------------------------- RLS ----
set local role authenticated;

-- A team member reads the rules (the clock on screen needs the hours) and cannot change them.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select is((select count(*)::int from tenant_escalation_rules), 12, 'a team member reads their tenant''s twelve rules');
select is((select count(*)::int from tenant_escalation_rules where tenant_id <> 'aaaaaaaa-0000-0000-0000-000000000001'),
  0, 'and never another tenant''s');
update tenant_escalation_rules set hours = 1 where kind = 'unassigned';
select is((select hours from tenant_escalation_rules where kind = 'unassigned'), 24,
  'a team member''s update changes nothing (no write policy reaches them)');

-- The Traffic Manager holds no organization:manage: read, not write.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);
select throws_ok($$
  insert into tenant_escalation_rules (tenant_id, kind, hours) values ('aaaaaaaa-0000-0000-0000-000000000001', 'blocked', 5)
$$, '42501', null, 'an insert without organization:manage is refused by RLS');

-- The Power Admin edits their tenant's rows.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
update tenant_escalation_rules set hours = 6, relative = array['owner'] where kind = 'change_request';
select is((select hours from tenant_escalation_rules where kind = 'change_request'), 6,
  'organization:manage edits the hours and the recipients');
select is((select updated_by from tenant_escalation_rules where kind = 'change_request'),
  '00000000-0000-0000-0000-00000000a001'::uuid, 'and the row says who changed it');

-- Tenant B's admin cannot reach Tenant A's rows, nor write into Tenant A.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000b001'), true);
update tenant_escalation_rules set hours = 99 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';
select throws_ok($$
  insert into tenant_escalation_rules (tenant_id, kind, hours) values ('aaaaaaaa-0000-0000-0000-000000000001', 'blocked', 5)
$$, '42501', null, 'a cross-tenant insert is refused');
reset role;
select is((select count(*)::int from tenant_escalation_rules
            where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and hours = 99),
  0, 'a cross-tenant update touched nothing');

select * from finish();
rollback;
