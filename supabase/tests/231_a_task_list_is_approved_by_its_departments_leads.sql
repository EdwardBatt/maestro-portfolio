-- I74.51 (ADR-0100 addendum, Edward 4 Oct) — who approves a deliverable's task list: its owner, the leads of
-- its department (department lead, team leads, deputy team leads), and the Traffic Manager and the Power Admin
-- as the failsafe. Never the account manager or the Account Director; never another department's leads; never
-- a C-level role (tenant reach, books nobody); never a team member who is not the owner.
--
-- Asked through `public.can_approve_tasks` — the column the button reads — and proved through the real
-- `approve_deliverable_tasks`, as each caller with their own claims (the predicate reads has_permission and
-- in_write_scope, so a superuser run proves nothing).
begin;
select plan(17);
\ir helpers/seed.sql

-- ---------------------------------------------------------------- fixtures ----
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000de231', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 231'),
  ('aaaaaaaa-0000-0000-0000-0000000de232', 'aaaaaaaa-0000-0000-0000-000000000001', 'Content 231');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000007e231', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000de231', 'Design 231'),
  ('aaaaaaaa-0000-0000-0000-00000007e232', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000de232', 'Copy 231');

insert into auth.users (id, email)
select v.id::uuid, v.email from (values
  ('00000000-0000-0000-0000-0000000a2311', 'owner231@a.test'),
  ('00000000-0000-0000-0000-0000000a2312', 'deptlead231@a.test'),
  ('00000000-0000-0000-0000-0000000a2313', 'teamlead231@a.test'),
  ('00000000-0000-0000-0000-0000000a2314', 'deputy231@a.test'),
  ('00000000-0000-0000-0000-0000000a2315', 'othertl231@a.test'),
  ('00000000-0000-0000-0000-0000000a2316', 'otherdl231@a.test'),
  ('00000000-0000-0000-0000-0000000a2317', 'am231@a.test'),
  ('00000000-0000-0000-0000-0000000a2318', 'ad231@a.test'),
  ('00000000-0000-0000-0000-0000000a2319', 'ceo231@a.test'),
  ('00000000-0000-0000-0000-0000000a231a', 'member231@a.test')
) as v(id, email);

-- The Account Director role is not among the defaults a test tenant gets (as test 087).
select app.seed_account_director('aaaaaaaa-0000-0000-0000-000000000001');

insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid, v.team::uuid
  from (values
  ('00000000-0000-0000-0000-0000000a2311', 'Owner 231',       'team_member',      'aaaaaaaa-0000-0000-0000-0000000de231', 'aaaaaaaa-0000-0000-0000-00000007e231'),
  ('00000000-0000-0000-0000-0000000a2312', 'Dept Lead 231',   'department_lead',  'aaaaaaaa-0000-0000-0000-0000000de231', null),
  ('00000000-0000-0000-0000-0000000a2313', 'Team Lead 231',   'team_lead',        'aaaaaaaa-0000-0000-0000-0000000de231', 'aaaaaaaa-0000-0000-0000-00000007e231'),
  ('00000000-0000-0000-0000-0000000a2314', 'Deputy 231',      'deputy_team_lead', 'aaaaaaaa-0000-0000-0000-0000000de231', 'aaaaaaaa-0000-0000-0000-00000007e231'),
  ('00000000-0000-0000-0000-0000000a2315', 'Copy Lead 231',   'team_lead',        'aaaaaaaa-0000-0000-0000-0000000de232', 'aaaaaaaa-0000-0000-0000-00000007e232'),
  ('00000000-0000-0000-0000-0000000a2316', 'Content Lead 231','department_lead',  'aaaaaaaa-0000-0000-0000-0000000de232', null),
  ('00000000-0000-0000-0000-0000000a2317', 'AM 231',          'account_manager',  null, null),
  ('00000000-0000-0000-0000-0000000a2318', 'AD 231',          'account_director', null, null),
  ('00000000-0000-0000-0000-0000000a2319', 'CEO 231',         'ceo',              null, null),
  ('00000000-0000-0000-0000-0000000a231a', 'Member 231',      'team_member',      'aaaaaaaa-0000-0000-0000-0000000de231', 'aaaaaaaa-0000-0000-0000-00000007e231')
  ) as v(id, name, role_key, dept, team);

insert into test_claims
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.display_name like '% 231';

-- A Creative deliverable on the seed's approved campaign, owned by a team member, its list not approved.
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000c2310', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001', 'Stream 231');
insert into deliverables (id, tenant_id, stream_id, name, owner_user_id, reviewer_id, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d2310', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000c2310', 'Key visual 231', '00000000-0000-0000-0000-0000000a2311',
   '00000000-0000-0000-0000-00000000a001', 'aaaaaaaa-0000-0000-0000-0000000de231'),
  ('aaaaaaaa-0000-0000-0000-0000000d2311', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000c2310', 'Poster 231', '00000000-0000-0000-0000-0000000a2311',
   '00000000-0000-0000-0000-00000000a001', 'aaaaaaaa-0000-0000-0000-0000000de231');
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000f2310', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000d2310', 'Create Artwork', 'todo', 1, 8),
  ('aaaaaaaa-0000-0000-0000-0000000f2311', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000d2311', 'Create Artwork', 'todo', 1, 8);

-- ---------------------------------------------------------------- may approve? (the button's column) ----
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-0000000a2311'), true);
set local role authenticated;
select is((select public.can_approve_tasks(d) from deliverables d where d.id = 'aaaaaaaa-0000-0000-0000-0000000d2310'), true, 'the owner may approve');
reset role;

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-0000000a2312'), true);
set local role authenticated;
select is((select public.can_approve_tasks(d) from deliverables d where d.id = 'aaaaaaaa-0000-0000-0000-0000000d2310'), true, 'the department''s department lead may approve');
reset role;

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-0000000a2313'), true);
set local role authenticated;
select is((select public.can_approve_tasks(d) from deliverables d where d.id = 'aaaaaaaa-0000-0000-0000-0000000d2310'), true, 'a team lead of the department (not the owner) may approve');
reset role;

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-0000000a2314'), true);
set local role authenticated;
select is((select public.can_approve_tasks(d) from deliverables d where d.id = 'aaaaaaaa-0000-0000-0000-0000000d2310'), true, 'a deputy team lead of the department may approve');
reset role;

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);
set local role authenticated;
select is((select public.can_approve_tasks(d) from deliverables d where d.id = 'aaaaaaaa-0000-0000-0000-0000000d2310'), true, 'the Traffic Manager may approve — the failsafe');
reset role;

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
set local role authenticated;
select is((select public.can_approve_tasks(d) from deliverables d where d.id = 'aaaaaaaa-0000-0000-0000-0000000d2310'), true, 'the Power Admin may approve — the failsafe');
reset role;

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-0000000a2315'), true);
set local role authenticated;
select is((select public.can_approve_tasks(d) from deliverables d where d.id = 'aaaaaaaa-0000-0000-0000-0000000d2310'), false, 'a team lead of ANOTHER department may not');
reset role;

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-0000000a2316'), true);
set local role authenticated;
select is((select public.can_approve_tasks(d) from deliverables d where d.id = 'aaaaaaaa-0000-0000-0000-0000000d2310'), false, 'the department lead of ANOTHER department may not');
reset role;

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-0000000a2317'), true);
set local role authenticated;
select is((select public.can_approve_tasks(d) from deliverables d where d.id = 'aaaaaaaa-0000-0000-0000-0000000d2310'), false, 'the account manager may not');
reset role;

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-0000000a2318'), true);
set local role authenticated;
select is((select public.can_approve_tasks(d) from deliverables d where d.id = 'aaaaaaaa-0000-0000-0000-0000000d2310'), false, 'the Account Director may not');
reset role;

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-0000000a2319'), true);
set local role authenticated;
select is((select public.can_approve_tasks(d) from deliverables d where d.id = 'aaaaaaaa-0000-0000-0000-0000000d2310'), false, 'the CEO (tenant reach, books nobody) may not');
reset role;

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-0000000a231a'), true);
set local role authenticated;
select is((select public.can_approve_tasks(d) from deliverables d where d.id = 'aaaaaaaa-0000-0000-0000-0000000d2310'), false, 'a team member who is not the owner may not');
reset role;

-- ---------------------------------------------------------------- the real approval ----
-- The account manager is refused by the RPC itself, and nothing is stamped.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-0000000a2317'), true);
set local role authenticated;
select throws_ok(
  $$ select public.approve_deliverable_tasks('aaaaaaaa-0000-0000-0000-0000000d2310') $$,
  '42501', null, 'approve_deliverable_tasks refuses the account manager');
reset role;
select is((select tasks_approved_at from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d2310'), null,
  'and the list is still unapproved');

-- Another department's team lead is refused too.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-0000000a2315'), true);
set local role authenticated;
select throws_ok(
  $$ select public.approve_deliverable_tasks('aaaaaaaa-0000-0000-0000-0000000d2310') $$,
  '42501', null, 'approve_deliverable_tasks refuses another department''s team lead');
reset role;

-- The department's team lead, not the owner, approves it.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-0000000a2313'), true);
set local role authenticated;
select lives_ok(
  $$ select public.approve_deliverable_tasks('aaaaaaaa-0000-0000-0000-0000000d2310') $$,
  'the department''s team lead approves the list');
reset role;
select is((select tasks_approved_by from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d2310'),
  '00000000-0000-0000-0000-0000000a2313'::uuid, 'and the approval is stamped with her name');

select * from finish();
rollback;
