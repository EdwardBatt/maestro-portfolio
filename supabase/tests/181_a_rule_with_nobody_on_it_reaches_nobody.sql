-- I59 E9 at its source (20260926160000): a rule saved with no roles and no people is listed by
-- `escalation_rules_reaching_nobody()` straight away — before any cause of it has come due — and a
-- rule that still names a role, or still names a person on the piece, is not. Tenant-scoped: the
-- other tenant's empty rule is not listed. The history branch (fell back / unreached) is 177's.
--
-- Cast: a001 Admin A (power_admin, organization:manage) · a002 Traffic Manager (no organization:manage).
begin;
select plan(6);
\ir helpers/seed.sql
-- The Account Director role first, as 177 does: 'extension_am' is seeded with it, and a tenant
-- without the role gets that rule with nobody on it — which this function rightly lists.
select app.seed_account_director(id) from tenants;
select app.seed_tenant_escalation_rules(id) from tenants;

set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select is_empty($$ select * from public.escalation_rules_reaching_nobody() $$,
  'every seeded rule names somebody: nothing reaches nobody');
reset role;

-- extension_am: its roles removed, its people already none → nobody on it.
update tenant_escalation_rules set role_ids = '{}', relative = '{}'
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'extension_am';
-- blocked: people removed, a role still named → it reaches that role.
update tenant_escalation_rules set role_ids = array[(select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'scheduler')], relative = '{}'
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'blocked';
-- task_list: roles removed, a person on the piece still named → it reaches that person.
update tenant_escalation_rules set role_ids = '{}', relative = array['account_manager']
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'task_list';
-- The other tenant's empty rule is theirs.
update tenant_escalation_rules set role_ids = '{}', relative = '{}'
 where tenant_id <> 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'unassigned';
select ok((select count(*) from tenant_escalation_rules where tenant_id <> 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'unassigned') > 0,
  'fixture: another tenant has an unassigned rule, now empty');

set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select results_eq($$ select kind, fell_back, unreached, last_at, reasons from public.escalation_rules_reaching_nobody() $$,
  $$ values ('extension_am'::text, 0, 0, null::timestamptz, null::text[]) $$,
  'E9: the rule with no roles and no people is listed at once, with nothing sent yet');
select ok(not exists (select 1 from public.escalation_rules_reaching_nobody() where kind in ('blocked', 'task_list')),
  'a rule with a role, or with a person on the piece, is not "reaching nobody"');
select ok(not exists (select 1 from public.escalation_rules_reaching_nobody() where kind = 'unassigned'),
  'another tenant''s empty rule is not listed');
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);
select throws_ok($$ select * from public.escalation_rules_reaching_nobody() $$, '42501', null,
  'only an administrator reads it');
reset role;

select * from finish();
rollback;
