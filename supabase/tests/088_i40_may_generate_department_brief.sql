-- I40 (ADR-0072) — who may generate a department brief, and when.
--
-- The four answers matter separately. Before `20260905190400` the only question asked was "do you
-- hold projects:manage anywhere in the tenant", which said yes to a Creative lead generating
-- Production's brief on a campaign they have nothing to do with, and yes to generating against a
-- draft campaign whose deliverables the account manager may still delete.

begin;
select plan(9);
\ir helpers/seed.sql

select app.seed_account_director('aaaaaaaa-0000-0000-0000-000000000001');

-- Two departments, so "your own" and "somebody else's" are distinguishable.
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000088d1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 88'),
  ('aaaaaaaa-0000-0000-0000-0000000088d2', 'aaaaaaaa-0000-0000-0000-000000000001', 'Production 88');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a020', 'lead-creative@a.test'),
  ('00000000-0000-0000-0000-00000000a021', 'am-owner@a.test'),
  ('00000000-0000-0000-0000-00000000a022', 'director88@a.test'),
  ('00000000-0000-0000-0000-00000000a023', 'member88@a.test');

insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r
         where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid
from (values
  ('00000000-0000-0000-0000-00000000a020', 'Lead Creative', 'department_lead',
   'aaaaaaaa-0000-0000-0000-0000000088d1'),
  ('00000000-0000-0000-0000-00000000a021', 'AM Owner', 'account_manager', null),
  ('00000000-0000-0000-0000-00000000a022', 'Director 88', 'account_director', null),
  ('00000000-0000-0000-0000-00000000a023', 'Member 88', 'team_member',
   'aaaaaaaa-0000-0000-0000-0000000088d1')
) as v(id, name, role_key, dept);

insert into test_claims
select up.id,
       json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id,
                           'department_id', up.department_id))::text
from user_profiles up
where up.id::text like '00000000-0000-0000-0000-00000000a02%';

insert into campaigns (id, tenant_id, client_id, name, status, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-0000000088e1', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Approved 88', 'approved',
   '00000000-0000-0000-0000-00000000a021'),
  ('aaaaaaaa-0000-0000-0000-0000000088e2', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Draft 88', 'draft',
   '00000000-0000-0000-0000-00000000a021');

set local role authenticated;

-- ------------------------------------------------- the department's own lead ----
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a020'), true);

select is(
  public.may_generate_department_brief(
    'aaaaaaaa-0000-0000-0000-0000000088e1', 'aaaaaaaa-0000-0000-0000-0000000088d1'),
  'ok', 'the department''s own lead may generate its brief on an approved campaign');

-- The case the tenant-wide boolean said yes to.
select is(
  public.may_generate_department_brief(
    'aaaaaaaa-0000-0000-0000-0000000088e1', 'aaaaaaaa-0000-0000-0000-0000000088d2'),
  'forbidden', 'but NOT another department''s — scope, not just the grant (ADR-0072 d.2)');

-- ADR-0072 d.3, and the reason is distinct from a refusal.
select is(
  public.may_generate_department_brief(
    'aaaaaaaa-0000-0000-0000-0000000088e2', 'aaaaaaaa-0000-0000-0000-0000000088d1'),
  'campaign_not_approved',
  'a draft campaign is refused with its OWN reason, not a permission error (ADR-0072 d.3)');

-- ------------------------------------------------- somebody with no grant ----
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a023'), true);

select is(
  public.may_generate_department_brief(
    'aaaaaaaa-0000-0000-0000-0000000088e1', 'aaaaaaaa-0000-0000-0000-0000000088d1'),
  'forbidden',
  'a team member in that very department is refused — the grant is necessary too');

-- ------------------------------------------------- the campaign's account manager ----
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a021'), true);

select is(
  public.may_generate_department_brief(
    'aaaaaaaa-0000-0000-0000-0000000088e1', 'aaaaaaaa-0000-0000-0000-0000000088d2'),
  'ok', 'the campaign''s account manager reaches every department ON THAT CAMPAIGN (d.4 fallback)');

-- ------------------------------------------------- the Account Director ----
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a022'), true);

select is(
  public.may_generate_department_brief(
    'aaaaaaaa-0000-0000-0000-0000000088e1', 'aaaaaaaa-0000-0000-0000-0000000088d1'),
  'ok', 'the Account Director reaches a campaign they do not manage (ADR-0073 d.3)');

-- ------------------------------------------------- Power Admin, the failsafe ----
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

select is(
  public.may_generate_department_brief(
    'aaaaaaaa-0000-0000-0000-0000000088e1', 'aaaaaaaa-0000-0000-0000-0000000088d2'),
  'ok', 'a Power Admin reaches any department — tenant scope, no role named in the function');

-- Even the failsafe waits for approval: d.3 is about the CAMPAIGN, not about the caller.
select is(
  public.may_generate_department_brief(
    'aaaaaaaa-0000-0000-0000-0000000088e2', 'aaaaaaaa-0000-0000-0000-0000000088d1'),
  'campaign_not_approved',
  'and even a Power Admin cannot generate before approval — d.3 binds the campaign, not the caller');

-- ------------------------------------------------- another tenant's campaign ----
-- "not found", never "forbidden": telling a caller that somebody else's campaign exists is a leak.
select is(
  public.may_generate_department_brief(
    'bbbbbbbb-0000-0000-0000-00000000e001', 'aaaaaaaa-0000-0000-0000-0000000088d1'),
  'not_found', 'a campaign in another tenant is not found, not forbidden');

select * from finish();
rollback;
