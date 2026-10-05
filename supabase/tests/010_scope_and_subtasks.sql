-- ADR-0009/0010: role WRITE-scope + sub_tasks. Reads stay tenant-wide; writes
-- gated to the caller's slice (team/department/account/tenant). Uses tenant A
-- (from seed) plus scoped fixtures. Adversarial: each lead denied outside its slice.
begin;
select plan(12);
\ir helpers/seed.sql

-- ---- scoped fixtures on tenant A (superuser) ----
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-0000000000e1', 'dl@a.test'),
  ('aaaaaaaa-0000-0000-0000-0000000000e2', 'tl@a.test'),
  ('aaaaaaaa-0000-0000-0000-0000000000e3', 'am@a.test');
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative'),
  ('aaaaaaaa-0000-0000-0000-0000000000d2', 'aaaaaaaa-0000-0000-0000-000000000001', 'Production');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000001a', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000d1', 'Art&Video'),
  ('aaaaaaaa-0000-0000-0000-00000000001b', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000d1', 'CopySocial'),
  ('aaaaaaaa-0000-0000-0000-00000000002c', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000d2', 'PostProd');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, v.nm,
  (select id from roles where tenant_id='aaaaaaaa-0000-0000-0000-000000000001' and key=v.rk),
  nullif(v.dept,'')::uuid, nullif(v.team,'')::uuid
from (values
  ('aaaaaaaa-0000-0000-0000-0000000000e1','DL','department_lead','aaaaaaaa-0000-0000-0000-0000000000d1',''),
  ('aaaaaaaa-0000-0000-0000-0000000000e2','TL','team_lead','aaaaaaaa-0000-0000-0000-0000000000d1','aaaaaaaa-0000-0000-0000-00000000001a'),
  ('aaaaaaaa-0000-0000-0000-0000000000e3','AM','account_manager','','')
) as v(id,nm,rk,dept,team);
insert into clients (id, tenant_id, name, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-0000000000cc', 'aaaaaaaa-0000-0000-0000-000000000001', 'AM Client', 'aaaaaaaa-0000-0000-0000-0000000000e3');
insert into campaigns (id, tenant_id, client_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000000ca', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000cc', 'AM Campaign');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000000fa', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000ca', 'AM Stream');
insert into deliverables (id, tenant_id, stream_id, name, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000000fb', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000fa', 'AM Deliverable', '00000000-0000-0000-0000-00000000a001');
insert into resources (id, tenant_id, kind, name, capacity_model, load_ceiling_pct, warn_at_pct, department_id, team_id) values
  ('aaaaaaaa-0000-0000-0000-0000000000f1','aaaaaaaa-0000-0000-0000-000000000001','human','RX','load_based',120,100,'aaaaaaaa-0000-0000-0000-0000000000d1','aaaaaaaa-0000-0000-0000-00000000001a'),
  ('aaaaaaaa-0000-0000-0000-0000000000f2','aaaaaaaa-0000-0000-0000-000000000001','human','RY','load_based',120,100,'aaaaaaaa-0000-0000-0000-0000000000d2','aaaaaaaa-0000-0000-0000-00000000002c');
-- ADR-0014: team-only resources (department_id NULL) — reach must be inferred from the team's department.
insert into resources (id, tenant_id, kind, name, capacity_model, load_ceiling_pct, warn_at_pct, department_id, team_id) values
  ('aaaaaaaa-0000-0000-0000-0000000000f3','aaaaaaaa-0000-0000-0000-000000000001','human','RZ','load_based',120,100,null,'aaaaaaaa-0000-0000-0000-00000000001a'),
  ('aaaaaaaa-0000-0000-0000-0000000000f4','aaaaaaaa-0000-0000-0000-000000000001','human','RW','load_based',120,100,null,'aaaaaaaa-0000-0000-0000-00000000002c');

-- Claims built as SUPERUSER (RLS off here), like seed's test_claims, so role ids resolve.
create temp table scope_claims as
select up.id, json_build_object('sub', up.id, 'app_metadata', json_build_object(
  'tenant_id', up.tenant_id, 'app_role_id', up.role_id,
  'department_id', up.department_id, 'team_id', up.team_id))::text as jwt
from user_profiles up
where up.id in ('aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-0000000000e2','aaaaaaaa-0000-0000-0000-0000000000e3');
grant select on scope_claims to public;

set local role authenticated;

-- Team Lead: own team allowed, other team denied.
select set_config('request.jwt.claims', (select jwt from scope_claims where id='aaaaaaaa-0000-0000-0000-0000000000e2'), true);
select lives_ok($$insert into sub_tasks(tenant_id,deliverable_id,department_id,team_id,title) values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000000fb','aaaaaaaa-0000-0000-0000-0000000000d1','aaaaaaaa-0000-0000-0000-00000000001a','tl-own')$$, 'team lead assigns within own team');
select throws_ok($$insert into sub_tasks(tenant_id,deliverable_id,department_id,team_id,title) values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000000fb','aaaaaaaa-0000-0000-0000-0000000000d1','aaaaaaaa-0000-0000-0000-00000000001b','tl-other')$$, '42501', null, 'team lead denied outside own team');

-- Department Lead: own department (any team) allowed, other department denied.
select set_config('request.jwt.claims', (select jwt from scope_claims where id='aaaaaaaa-0000-0000-0000-0000000000e1'), true);
select lives_ok($$insert into sub_tasks(tenant_id,deliverable_id,department_id,team_id,title) values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000000fb','aaaaaaaa-0000-0000-0000-0000000000d1','aaaaaaaa-0000-0000-0000-00000000001b','dl-own-dept')$$, 'department lead assigns across own department');
select throws_ok($$insert into sub_tasks(tenant_id,deliverable_id,department_id,team_id,title) values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000000fb','aaaaaaaa-0000-0000-0000-0000000000d2','aaaaaaaa-0000-0000-0000-00000000002c','dl-other')$$, '42501', null, 'department lead denied outside own department');

-- Account Manager: refused even on their own campaign — a deliverable's tasks are its department's (I74.53, ADR-0140
-- addendum, 4 Oct); she changes the deliverable and asks a lead for a person. Refused outside their campaigns too.
select set_config('request.jwt.claims', (select jwt from scope_claims where id='aaaaaaaa-0000-0000-0000-0000000000e3'), true);
select throws_ok($$insert into sub_tasks(tenant_id,deliverable_id,department_id,team_id,title) values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000000fb','aaaaaaaa-0000-0000-0000-0000000000d2','aaaaaaaa-0000-0000-0000-00000000002c','am-own-camp')$$, '42501', null, 'account manager may not add a task even on their own campaign (I74.53)');
select throws_ok($$insert into sub_tasks(tenant_id,deliverable_id,department_id,team_id,title) values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f101','aaaaaaaa-0000-0000-0000-0000000000d1','aaaaaaaa-0000-0000-0000-00000000001a','am-other')$$, '42501', null, 'account manager denied on a deliverable outside their campaigns');

-- Team Member: cannot assign.
select set_config('request.jwt.claims', (select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'), true);
select throws_ok($$insert into sub_tasks(tenant_id,deliverable_id,department_id,team_id,title) values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000000fb','aaaaaaaa-0000-0000-0000-0000000000d1','aaaaaaaa-0000-0000-0000-00000000001a','mem')$$, '42501', null, 'team member cannot assign sub-tasks');

-- Reads stay tenant-wide: the member sees every sub-task created above (2 — the account manager's was refused).
select is((select count(*)::int from sub_tasks), 2, 'reads are tenant-wide (member sees all sub-tasks)');

-- Booking scope via the resource's team.
select set_config('request.jwt.claims', (select jwt from scope_claims where id='aaaaaaaa-0000-0000-0000-0000000000e2'), true);
select lives_ok($$insert into bookings(tenant_id,resource_id,starts_at,ends_at) values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000000f1','2026-09-01 09:00+00','2026-09-01 12:00+00')$$, 'team lead books a resource in their team');
-- ADR-0139 d.1 (3 Oct; reverses ADR-0098 d.1): a team lead books her own team only — another team, even in her own
-- department, is a request to its lead.
select throws_ok($$insert into bookings(tenant_id,resource_id,starts_at,ends_at) values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000000f2','2026-09-01 09:00+00','2026-09-01 12:00+00')$$, '42501', null, 'team lead is refused a resource outside their team (ADR-0139 d.1)');

-- ADR-0014: department lead reaches a team-only resource by the team's parent department.
select set_config('request.jwt.claims', (select jwt from scope_claims where id='aaaaaaaa-0000-0000-0000-0000000000e1'), true);
select lives_ok($$insert into bookings(tenant_id,resource_id,starts_at,ends_at) values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000000f3','2026-09-02 09:00+00','2026-09-02 12:00+00')$$, 'ADR-0014: dept lead books a team-only resource whose team is in their department (dept inferred)');
-- ADR-0139 d.1 (3 Oct; reverses ADR-0098 d.1): a department lead books his own department only.
select throws_ok($$insert into bookings(tenant_id,resource_id,starts_at,ends_at) values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000000f4','2026-09-02 09:00+00','2026-09-02 12:00+00')$$, '42501', null, 'dept lead is refused a resource outside their department (ADR-0139 d.1)');

reset role;
select * from finish();
rollback;
