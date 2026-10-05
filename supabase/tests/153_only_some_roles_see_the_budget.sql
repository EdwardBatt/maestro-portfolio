-- I56.18 (Edward, 24 Sep) — campaign_budget:view decides who SEES a campaign's advertising budget:
-- the Account Manager, the Account Director, the Power Admin and the Traffic Manager, plus whichever
-- role an administrator gives it to (the Finance lead's). Hidden on screen only — this is a grant,
-- not a lock on campaigns.brief. Department leads must NOT inherit it through the Traffic clone.

begin;
select plan(8);
\ir helpers/seed.sql

-- The Account Director is seeded by its own function in provisioning; the helper seeds roles only.
select app.seed_account_director('aaaaaaaa-0000-0000-0000-000000000001');

create temp table budget_holders on commit drop as
select r.key
  from role_grants g
  join roles r on r.id = g.role_id
 where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   and g.resource = 'campaign_budget' and g.action = 'view';

select ok(
  exists (select 1 from permission_catalog where resource = 'campaign_budget' and action = 'view'),
  'campaign_budget:view is in the permission catalogue, so Admin → Roles can give it to any role');

select ok(exists (select 1 from budget_holders where key = 'account_manager'),  'the Account Manager sees the budget');
select ok(exists (select 1 from budget_holders where key = 'account_director'), 'the Account Director sees the budget (copied from the Account Manager)');
select ok(exists (select 1 from budget_holders where key = 'power_admin'),      'the Power Admin sees the budget');
select ok(exists (select 1 from budget_holders where key = 'scheduler'),        'the Traffic Manager sees the budget');

-- The Traffic block is cloned into the department lead; the budget line sits AFTER that clone.
select ok(not exists (select 1 from budget_holders where key = 'department_lead'),
  'a department lead does not inherit the budget from the Traffic Manager');

select ok(not exists (select 1 from budget_holders where key in ('team_lead', 'deputy_team_lead', 'team_member')),
  'team leads, deputies and makers do not see the budget');

select ok(not exists (select 1 from budget_holders where key = 'client_portal'),
  'the client portal does not see the budget');

select * from finish();
rollback;
