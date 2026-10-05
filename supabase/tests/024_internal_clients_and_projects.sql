-- ADR-0029 (I7.1): internal clients + internal projects; role rename; per-project PM.
-- Proves: the internal-client shape constraint + `app.is_internal_client`; internal-project SETUP is
-- the org-wide **Traffic Manager** (formerly Scheduler) / Power Admin via existing `projects:manage`
-- (a Team Leader cannot); the Scheduler role is now titled "Traffic Manager"; an internal project's
-- deliverable resolves its AM to the internal client's account manager; and the appointed **PM**
-- (the job's owner) may manage that project's sub-tasks ACROSS departments while a non-PM cannot.
begin;
select plan(11);
\ir helpers/seed.sql

-- ---- scoped fixtures on tenant A (superuser; RLS bypassed) ----
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000a054', 'tl54@a.test');
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000054d1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative54');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000054a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000054d1', 'TeamA54'),
  ('aaaaaaaa-0000-0000-0000-0000000054b1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000054d1', 'TeamB54');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select '00000000-0000-0000-0000-00000000a054', 'aaaaaaaa-0000-0000-0000-000000000001', 'TL54',
  (select id from roles where tenant_id='aaaaaaaa-0000-0000-0000-000000000001' and key='team_lead'),
  'aaaaaaaa-0000-0000-0000-0000000054d1', 'aaaaaaaa-0000-0000-0000-0000000054a1';

-- an internal client owned by TeamA54, AM = a001; and an internal project (job) whose PM = a003.
insert into clients (id, tenant_id, name, is_internal, internal_kind, internal_team_id, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-0000000054c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'TeamA54 Internal', true, 'team', 'aaaaaaaa-0000-0000-0000-0000000054a1', '00000000-0000-0000-0000-00000000a001');
insert into jobs (id, tenant_id, client_id, name, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000054f1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000054c1', 'Internal project', '00000000-0000-0000-0000-00000000a003');
insert into deliverables (id, tenant_id, job_id, name, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000054e1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000054f1', 'Internal deliverable', '00000000-0000-0000-0000-00000000a001');

-- ---- shape constraint (role-independent) ----
select throws_ok($$ insert into clients (tenant_id, name, is_internal, internal_kind) values
  ('aaaaaaaa-0000-0000-0000-000000000001','bad-team',true,'team') $$,
  '23514', null, 'internal team client without a team is rejected');
select throws_ok($$ insert into clients (tenant_id, name, is_internal, internal_kind) values
  ('aaaaaaaa-0000-0000-0000-000000000001','bad-dept',true,'department') $$,
  '23514', null, 'internal department client without a department is rejected');
select lives_ok($$ insert into clients (id, tenant_id, name, is_internal, internal_kind, internal_department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000054c2','aaaaaaaa-0000-0000-0000-000000000001','Dept54 Internal',true,'department','aaaaaaaa-0000-0000-0000-0000000054d1') $$,
  'a well-formed internal department client is accepted');
select is(app.is_internal_client('aaaaaaaa-0000-0000-0000-0000000054c1'), true, 'is_internal_client true for an internal client');
select is(app.is_internal_client('aaaaaaaa-0000-0000-0000-00000000c001'), false, 'is_internal_client false for the external seed client');

-- ---- the Scheduler role is now titled Traffic Manager ----
select is((select name from roles where key='scheduler' and tenant_id='aaaaaaaa-0000-0000-0000-000000000001'),
  'Traffic Manager', 'the Scheduler role is retitled Traffic Manager');

set local role authenticated;

-- SETUP: the Traffic Manager (a002 = scheduler, tenant scope, projects:manage) creates an internal job.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select lives_ok($$ insert into jobs (id, tenant_id, client_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000054f2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000054c1','TM internal job') $$,
  'Traffic Manager creates an internal project (via org-wide projects:manage)');

-- a Team Leader (no projects:manage, no internal grant) cannot set one up.
create temp table tl_claim as
select json_build_object('sub', up.id, 'app_metadata', json_build_object(
  'tenant_id', up.tenant_id, 'app_role_id', up.role_id,
  'department_id', up.department_id, 'team_id', up.team_id))::text as jwt
from user_profiles up where up.id = '00000000-0000-0000-0000-00000000a054';
grant select on tl_claim to public;
select set_config('request.jwt.claims', (select jwt from tl_claim), true);
select throws_ok($$ insert into jobs (id, tenant_id, client_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000054f3','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000054c1','TL internal job') $$,
  '42501', null, 'a Team Leader cannot set up an internal project');

-- AM resolution: internal deliverable's AM = the internal client's account manager.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select is(app.deliverable_account_manager('aaaaaaaa-0000-0000-0000-0000000054e1'),
  '00000000-0000-0000-0000-00000000a001', 'internal project deliverable resolves its AM to the internal client AM');

-- PM authority: a003 is the appointed PM (job owner) and may add a sub-task to their project even in
-- a team they don't belong to; a003 is NOT the PM of the seed job, so there they're denied.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select lives_ok($$ insert into sub_tasks (id, tenant_id, deliverable_id, department_id, team_id, title) values
  ('aaaaaaaa-0000-0000-0000-0000000054a9','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000054e1','aaaaaaaa-0000-0000-0000-0000000054d1','aaaaaaaa-0000-0000-0000-0000000054a1','PM cross-dept task') $$,
  'the appointed PM manages their project''s sub-tasks across departments');
select throws_ok($$ insert into sub_tasks (id, tenant_id, deliverable_id, title) values
  ('aaaaaaaa-0000-0000-0000-0000000054aa','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f101','not-my-project') $$,
  '42501', null, 'a non-PM (self scope) cannot add sub-tasks to a project they do not manage');

select * from finish();
rollback;
