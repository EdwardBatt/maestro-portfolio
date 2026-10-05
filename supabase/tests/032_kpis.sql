-- ADR-0029 (I7.4): customisable KPIs — individual targets, read-restriction, team→dept rollup.
-- Proves: the kpi:manage grant reaches the lead roles (not members); period + per-person-period
-- constraints; the read-restriction (self / team-lead / dept-lead / health:view see; peers + other
-- tenants denied); write-scoping (a lead writes within scope, not outside; a member cannot);
-- and app.kpi_rollup aggregation (avg vs sum) up the team→department hierarchy.
begin;
select plan(20);
\ir helpers/seed.sql

-- ---- org fixtures on tenant A (superuser; RLS bypassed) ----
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000032d1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Dept32');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000032a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000032d1', 'Team32-1'),
  ('aaaaaaaa-0000-0000-0000-0000000032a2', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000032d1', 'Team32-2');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000032e1', 'tl32@a.test'),
  ('00000000-0000-0000-0000-0000000032e2', 'dl32@a.test'),
  ('00000000-0000-0000-0000-0000000032f1', 'm1-32@a.test'),
  ('00000000-0000-0000-0000-0000000032f2', 'm2-32@a.test'),
  ('00000000-0000-0000-0000-0000000032f3', 'm3-32@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.nm,
       (select id from roles where tenant_id='aaaaaaaa-0000-0000-0000-000000000001' and key=v.rk),
       v.dept::uuid, v.team::uuid
from (values
  ('00000000-0000-0000-0000-0000000032e1','TL32','team_lead',       'aaaaaaaa-0000-0000-0000-0000000032d1','aaaaaaaa-0000-0000-0000-0000000032a1'),
  ('00000000-0000-0000-0000-0000000032e2','DL32','department_lead', 'aaaaaaaa-0000-0000-0000-0000000032d1', null),
  ('00000000-0000-0000-0000-0000000032f1','M1', 'team_member',      'aaaaaaaa-0000-0000-0000-0000000032d1','aaaaaaaa-0000-0000-0000-0000000032a1'),
  ('00000000-0000-0000-0000-0000000032f2','M2', 'team_member',      'aaaaaaaa-0000-0000-0000-0000000032d1','aaaaaaaa-0000-0000-0000-0000000032a1'),
  ('00000000-0000-0000-0000-0000000032f3','M3', 'team_member',      'aaaaaaaa-0000-0000-0000-0000000032d1','aaaaaaaa-0000-0000-0000-0000000032a2')
) as v(id, nm, rk, dept, team);

-- ---- KPI catalogue + individual targets ----
insert into kpi_definitions (id, tenant_id, name, aggregation) values
  ('aaaaaaaa-0000-0000-0000-0000000032b1', 'aaaaaaaa-0000-0000-0000-000000000001', 'On-time %', 'avg'),
  ('aaaaaaaa-0000-0000-0000-0000000032b2', 'aaaaaaaa-0000-0000-0000-000000000001', 'Posts',     'sum');
insert into kpi_targets (tenant_id, kpi_definition_id, user_id, period_start, period_end, target, actual) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000032b1','00000000-0000-0000-0000-0000000032f1','2026-08-01','2026-08-31',90,80),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000032b2','00000000-0000-0000-0000-0000000032f1','2026-08-01','2026-08-31',10,8),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000032b1','00000000-0000-0000-0000-0000000032f2','2026-08-01','2026-08-31',90,60),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000032b2','00000000-0000-0000-0000-0000000032f2','2026-08-01','2026-08-31',10,12),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000032b1','00000000-0000-0000-0000-0000000032f3','2026-08-01','2026-08-31',90,100),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000032b2','00000000-0000-0000-0000-0000000032f3','2026-08-01','2026-08-31',20,20);

-- ---- authority wiring (structural) ----
select is((select count(*)::int from permission_catalog where resource='kpi' and action='manage'), 1,
  'kpi:manage exists in the permission catalog');
select is((select count(*)::int from role_grants rg join roles r on r.id=rg.role_id
    where r.tenant_id='aaaaaaaa-0000-0000-0000-000000000001' and r.key='department_lead' and rg.resource='kpi' and rg.action='manage'), 1,
  'Department Lead holds kpi:manage');
select is((select count(*)::int from role_grants rg join roles r on r.id=rg.role_id
    where r.tenant_id='aaaaaaaa-0000-0000-0000-000000000001' and r.key='team_lead' and rg.resource='kpi' and rg.action='manage'), 1,
  'Team Leader holds kpi:manage');
select is((select count(*)::int from role_grants rg join roles r on r.id=rg.role_id
    where r.tenant_id='aaaaaaaa-0000-0000-0000-000000000001' and r.key='team_member' and rg.resource='kpi' and rg.action='manage'), 0,
  'a Team Member does NOT hold kpi:manage');

-- ---- constraints (role-independent) ----
select throws_ok($$ insert into kpi_targets (tenant_id, kpi_definition_id, user_id, period_start, period_end)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000032b1','00000000-0000-0000-0000-0000000032f1','2026-09-30','2026-09-01') $$,
  '23514', null, 'period_start after period_end is rejected');
select throws_ok($$ insert into kpi_targets (tenant_id, kpi_definition_id, user_id, period_start, period_end)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000032b1','00000000-0000-0000-0000-0000000032f1','2026-08-01','2026-08-31') $$,
  '23505', null, 'a duplicate (definition, person, period) is rejected');

-- ---- claims for the scoped users ----
create temp table k_claims as
select up.id, json_build_object('sub', up.id, 'app_metadata', json_build_object(
  'tenant_id', up.tenant_id, 'app_role_id', up.role_id,
  'department_id', up.department_id, 'team_id', up.team_id))::text as jwt
from user_profiles up
where up.id in ('00000000-0000-0000-0000-0000000032e1','00000000-0000-0000-0000-0000000032e2',
                '00000000-0000-0000-0000-0000000032f1','00000000-0000-0000-0000-0000000032f2','00000000-0000-0000-0000-0000000032f3');
grant select on k_claims to public;

set local role authenticated;

-- read-restriction --------------------------------------------------------
-- M1 sees their own two rows, and NONE of M2's (peers are denied).
select set_config('request.jwt.claims',(select jwt from k_claims where id='00000000-0000-0000-0000-0000000032f1'),true);
select is((select count(*)::int from kpi_targets where user_id='00000000-0000-0000-0000-0000000032f1'), 2,
  'the subject reads their own KPI rows');
select is((select count(*)::int from kpi_targets where user_id='00000000-0000-0000-0000-0000000032f2'), 0,
  'a peer cannot read another member''s KPI rows');

-- the Team Leader sees M1 (own team) but not M3 (a different team).
select set_config('request.jwt.claims',(select jwt from k_claims where id='00000000-0000-0000-0000-0000000032e1'),true);
select is((select count(*)::int from kpi_targets where user_id='00000000-0000-0000-0000-0000000032f1'), 2,
  'the Team Leader reads a member of their team');
select is((select count(*)::int from kpi_targets where user_id='00000000-0000-0000-0000-0000000032f3'), 0,
  'the Team Leader cannot read a member of another team');

-- the Department Lead sees M3 (a different team, same department).
select set_config('request.jwt.claims',(select jwt from k_claims where id='00000000-0000-0000-0000-0000000032e2'),true);
select is((select count(*)::int from kpi_targets where user_id='00000000-0000-0000-0000-0000000032f3'), 2,
  'the Department Lead reads across teams within their department');

-- Power Admin (health:view + tenant kpi:manage) sees any individual.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select is((select count(*)::int from kpi_targets where user_id='00000000-0000-0000-0000-0000000032f1'), 2,
  'Power Admin / health:view reads any individual''s KPIs');

-- cross-tenant sees nothing.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b002'),true);
select is((select count(*)::int from kpi_targets), 0, 'another tenant sees no KPI rows');

-- write-scoping ------------------------------------------------------------
-- the Team Leader may set a target for their own team member…
select set_config('request.jwt.claims',(select jwt from k_claims where id='00000000-0000-0000-0000-0000000032e1'),true);
select lives_ok($$ insert into kpi_targets (tenant_id, kpi_definition_id, user_id, period_start, period_end, target, actual)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000032b1','00000000-0000-0000-0000-0000000032f1','2026-09-01','2026-09-30',95,88) $$,
  'a Team Leader sets a target for a member of their team');
-- …but not for a member of another team.
select throws_ok($$ insert into kpi_targets (tenant_id, kpi_definition_id, user_id, period_start, period_end, target)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000032b1','00000000-0000-0000-0000-0000000032f3','2026-09-01','2026-09-30',95) $$,
  '42501', null, 'a Team Leader cannot set a target outside their scope');
-- a plain member cannot set targets at all (even for themselves).
select set_config('request.jwt.claims',(select jwt from k_claims where id='00000000-0000-0000-0000-0000000032f1'),true);
select throws_ok($$ insert into kpi_targets (tenant_id, kpi_definition_id, user_id, period_start, period_end, target)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000032b2','00000000-0000-0000-0000-0000000032f1','2026-10-01','2026-10-31',5) $$,
  '42501', null, 'a member cannot set KPI targets (kpi:manage required)');

-- rollup (as Power Admin, who reads every underlying row) -------------------
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select is((select actual from app.kpi_rollup('2026-08-01','2026-08-31')
    where kpi_definition_id='aaaaaaaa-0000-0000-0000-0000000032b1' and scope_kind='team' and scope_id='aaaaaaaa-0000-0000-0000-0000000032a1'),
  70::numeric, 'team rollup averages the rate KPI over its members (80,60 → 70)');
select is((select actual from app.kpi_rollup('2026-08-01','2026-08-31')
    where kpi_definition_id='aaaaaaaa-0000-0000-0000-0000000032b2' and scope_kind='team' and scope_id='aaaaaaaa-0000-0000-0000-0000000032a1'),
  20::numeric, 'team rollup sums the count KPI over its members (8,12 → 20)');
select is((select actual from app.kpi_rollup('2026-08-01','2026-08-31')
    where kpi_definition_id='aaaaaaaa-0000-0000-0000-0000000032b1' and scope_kind='department' and scope_id='aaaaaaaa-0000-0000-0000-0000000032d1'),
  85::numeric, 'department rollup averages its team means for the rate KPI (70,100 → 85)');
select is((select actual from app.kpi_rollup('2026-08-01','2026-08-31')
    where kpi_definition_id='aaaaaaaa-0000-0000-0000-0000000032b2' and scope_kind='department' and scope_id='aaaaaaaa-0000-0000-0000-0000000032d1'),
  40::numeric, 'department rollup sums its team sums for the count KPI (20,20 → 40)');

select * from finish();
rollback;
