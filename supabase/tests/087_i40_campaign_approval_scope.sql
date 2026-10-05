-- I40 (ADR-0073) — approving a campaign is decided by grant + scope, never by a uid comparison.
--
-- Every assertion here fails against the function as it stood before `20260905190200`. That version
-- ended its authorization at `if v_am is distinct from auth.uid() then raise 42501`, which meant a
-- Power Admin holding every grant in the catalog could not approve a campaign, and a campaign whose
-- account manager had left could be approved by nobody — ADR-0048 d.8 then making everything under
-- it permanently unassignable. That is the 29 August deadlock, and it survived at this layer for
-- nine days because nothing asserted the negative.
--
-- The suite is deliberately adversarial about the FAILSAFE rather than the happy path: the assigned
-- manager approving their own campaign is the case that already worked.

begin;
select plan(15);
\ir helpers/seed.sql

-- The shared fixture inserts its roles directly rather than running the provisioning wrapper, so
-- the Account Director is not there — the migration's backfill ran before this tenant existed.
-- Seeding it here is also, in passing, the assertion that the seed function is idempotent and
-- re-runnable, which is what makes the backfill safe.
select app.seed_account_director('aaaaaaaa-0000-0000-0000-000000000001');
select app.seed_account_director('aaaaaaaa-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------- the role exists ----
select is(
  (select count(*)::int from roles
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'account_director'),
  1, 'ADR-0073 d.3: the account_director role is seeded');

-- ADR-0074 amends ADR-0073 d.3's MECHANISM, not its decision. The reach was `account` plus an
-- exception reading `roles.key = 'account_director'` inside `app.in_write_scope`; it is now a reach
-- the role is SET to. Still not `tenant` — that is the systems tier and would hand over
-- administration, which is the original judgement and is unchanged.
select is(
  (select scope from roles
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'account_director'),
  'all_accounts',
  'ADR-0074 d.2: the reach is a setting on the role, not its name written into a function');

-- Copied from the Account Manager rather than retyped, so the two cannot drift.
select ok(
  (select count(*)::int from role_grants rg join roles r on r.id = rg.role_id
     where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = 'account_director')
  >=
  (select count(*)::int from role_grants rg join roles r on r.id = rg.role_id
     where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = 'account_manager'),
  'it holds at least everything the Account Manager holds');

select ok(
  exists (select 1 from role_grants rg join roles r on r.id = rg.role_id
           where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
             and r.key = 'account_director'
             and rg.resource = 'briefs' and rg.action = 'approve'),
  'ADR-0073 d.6: it holds briefs:approve, as the fallback approver');

-- It is an OVERSIGHT role, not an administrative one. This is the assertion that stops somebody
-- "helpfully" widening it later: the whole reason it exists is so that reach across accounts does
-- not require Power Admin.
select ok(
  not exists (select 1 from role_grants rg join roles r on r.id = rg.role_id
               where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                 and r.key = 'account_director'
                 and (rg.resource like 'admin.%' or rg.resource in ('audit', 'roles'))),
  'it holds NO administrative grant — not users, not roles, not audit');

-- ---------------------------------------------------------------- fixtures ----
-- A campaign whose account manager is somebody real, and one with nobody at all. The second is the
-- case that used to be unapprovable for ever.
-- `user_profiles.id` references `auth.users(id)`, so the identity comes first.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a010', 'am-one@a.test'),
  ('00000000-0000-0000-0000-00000000a011', 'am-two@a.test'),
  ('00000000-0000-0000-0000-00000000a012', 'director@a.test'),
  ('00000000-0000-0000-0000-00000000a013', 'lead@a.test');

insert into user_profiles (id, tenant_id, display_name, role_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r
         where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key)
from (values
  ('00000000-0000-0000-0000-00000000a010', 'AM One',    'account_manager'),
  ('00000000-0000-0000-0000-00000000a011', 'AM Two',    'account_manager'),
  ('00000000-0000-0000-0000-00000000a012', 'Director',  'account_director'),
  ('00000000-0000-0000-0000-00000000a013', 'Dept Lead', 'department_lead')
) as v(id, name, role_key);

insert into test_claims
select up.id,
       json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
from user_profiles up
where up.id in ('00000000-0000-0000-0000-00000000a010','00000000-0000-0000-0000-00000000a011',
                '00000000-0000-0000-0000-00000000a012','00000000-0000-0000-0000-00000000a013');

insert into campaigns (id, tenant_id, client_id, name, status, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-00000000e010', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Owned by AM One', 'pending_approval',
   '00000000-0000-0000-0000-00000000a010'),
  ('aaaaaaaa-0000-0000-0000-00000000e011', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Orphan', 'pending_approval', null),
  ('aaaaaaaa-0000-0000-0000-00000000e012', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'For the Director', 'pending_approval',
   '00000000-0000-0000-0000-00000000a010'),
  ('aaaaaaaa-0000-0000-0000-00000000e013', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'For the lead to fail on', 'pending_approval',
   '00000000-0000-0000-0000-00000000a010');

-- The client has no account manager either, so `coalesce(campaign, client)` really does resolve to
-- null on the orphan. Without this the orphan case would silently test the wrong thing.
update clients set account_manager_id = null
 where id = 'aaaaaaaa-0000-0000-0000-00000000c001';

set local role authenticated;

-- ---------------------------------------------------------------- the assigned manager ----
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a010'), true);

select lives_ok(
  $$select app.approve_campaign('aaaaaaaa-0000-0000-0000-00000000e010')$$,
  'the assigned account manager still approves their own campaign — nothing was taken away');

select is(
  (select status from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e010'),
  'approved', 'and the campaign is actually approved');

-- ---------------------------------------------------------------- another manager ----
-- `account` scope is bounded by the responsible manager, so a second AM must NOT reach it. This is
-- the assertion that proves scoping is real rather than a boolean that always passes.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a011'), true);

select throws_ok(
  $$select app.approve_campaign('aaaaaaaa-0000-0000-0000-00000000e012')$$,
  '42501',
  'you cannot approve this campaign',
  'a DIFFERENT account manager is refused — account scope is bounded by the responsible manager');

-- ---------------------------------------------------------------- the department lead ----
-- Holds projects:manage (inherited from Scheduler since 16 Aug — the fact ADR-0072 first got
-- wrong), and is department-scoped, so the grant alone must not be enough.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a013'), true);

select ok(app.has_permission('projects', 'manage'),
  'the department lead DOES hold projects:manage — inherited from the Scheduler grant copy');

select throws_ok(
  $$select app.approve_campaign('aaaaaaaa-0000-0000-0000-00000000e013')$$,
  '42501',
  'you cannot approve this campaign',
  'and is still refused: the grant is necessary and never sufficient (ADR-0073 d.1)');

-- ---------------------------------------------------------------- the Account Director ----
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a012'), true);

select lives_ok(
  $$select app.approve_campaign('aaaaaaaa-0000-0000-0000-00000000e012')$$,
  'the Account Director reaches an account they do not manage (ADR-0073 d.3)');

-- ---------------------------------------------------------------- and it is the REACH ----
-- ADR-0074 d.2/d.3. The pair of assertions that prove nothing consults the role's NAME any more:
-- take the reach away and the same person, in the same role, is refused. If an exception like
-- ADR-0073's were still in `app.in_write_scope`, this would pass regardless and the next oversight
-- role would silently need a migration.
set local role postgres;
update roles set scope = 'account'
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'account_director';
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a012'), true);

select throws_ok(
  $$select app.approve_campaign('aaaaaaaa-0000-0000-0000-00000000e013')$$,
  '42501',
  'you cannot approve this campaign',
  'set back to `account`, the Account Director is refused — the name buys nothing');

-- And the inverse: the reach works for a role that is not this one. A Department Lead given
-- `all_accounts` reaches an account they do not manage, which is what makes a second oversight role
-- a setting on the Roles screen rather than a code change.
set local role postgres;
update roles set scope = 'all_accounts'
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'department_lead';
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a013'), true);

select lives_ok(
  $$select app.approve_campaign('aaaaaaaa-0000-0000-0000-00000000e013')$$,
  'any role set to `all_accounts` reaches every account — reach is configuration (ADR-0074 d.3)');

-- ---------------------------------------------------------------- Power Admin, the orphan ----
-- The case Edward hit on 5 Sep, and the one that could deadlock for ever: no manager anywhere, so
-- the old uid comparison refused everybody including the role that holds every grant.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

select lives_ok(
  $$select app.approve_campaign('aaaaaaaa-0000-0000-0000-00000000e011')$$,
  'a Power Admin approves a campaign with NO account manager — the deadlock is gone (ADR-0073 d.4)');

select is(
  (select approved_by from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e011'),
  '00000000-0000-0000-0000-00000000a001'::uuid,
  'and the failsafe is recorded, which is what makes d.7 auditable rather than invisible');

select * from finish();
rollback;
