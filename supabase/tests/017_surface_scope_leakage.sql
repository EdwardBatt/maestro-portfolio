-- ADR-0024 (Phase I) role-scope leakage audit over the new work surfaces (I2.6 / M6.5).
-- The three surfaces (Team Lead breakdown, Creative My Work, Pipeline board) all sit on two
-- write paths: the sub_tasks manage/self policies and the deliverable transition guard. 010 proved
-- sub_task INSERT scope + booking scope; 015 proved transition authority + cross-tenant on
-- deliverables. This closes the gaps those leave: sub_task UPDATE/DELETE scope, the UPDATE
-- self-path (assignee may progress their own, nothing else), cross-tenant sub_task isolation, and
-- it PINS the documented interim that deliverable transitions are grant-only (not scope-gated).
--
-- RLS reminder that shapes the assertions: an out-of-scope row fails the USING clause and is
-- silently skipped (0 rows, no error); a row that is in scope but whose NEW values leave scope
-- fails WITH CHECK and raises 42501. So "you may not touch that row" is asserted as unchanged,
-- while "you may not move it out of your scope" is asserted as a 42501 throw.
begin;
select plan(16);
\ir helpers/seed.sql

-- ---- scoped fixtures on tenant A (superuser; RLS bypassed here) ----
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-0000000000e2', 'tl@a.test');
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000001a', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000d1', 'Art&Video'),
  ('aaaaaaaa-0000-0000-0000-00000000001b', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000d1', 'CopySocial');
-- Team Lead in Creative / Art&Video (scope = team).
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select 'aaaaaaaa-0000-0000-0000-0000000000e2', 'aaaaaaaa-0000-0000-0000-000000000001', 'TL',
  (select id from roles where tenant_id='aaaaaaaa-0000-0000-0000-000000000001' and key='team_lead'),
  'aaaaaaaa-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-00000000001a';

-- A stream-anchored deliverable (under the seeded campaign) + sub-tasks in three scopes.
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000b701', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001', 'Audit Stream');
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-00000000b801', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000b701', 'Audit Deliverable', 'draft', '00000000-0000-0000-0000-00000000a001');
insert into sub_tasks (id, tenant_id, deliverable_id, department_id, team_id, assignee_id, title, sla_hours, status) values
  -- ST1: assigned to Creative A (a003), directed at Art&Video.
  ('aaaaaaaa-0000-0000-0000-00000000b901', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000b801',
   'aaaaaaaa-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-00000000001a', '00000000-0000-0000-0000-00000000a003', 'st1-selfown', 8, 'todo'),
  -- ST_TL: unassigned, directed at Art&Video (the TL's team → in scope).
  ('aaaaaaaa-0000-0000-0000-00000000b902', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000b801',
   'aaaaaaaa-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-00000000001a', null, 'st-tl-team1a', null, 'todo'),
  -- ST_1b: unassigned, directed at CopySocial (same department, different team → out of TL scope).
  ('aaaaaaaa-0000-0000-0000-00000000b903', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000b801',
   'aaaaaaaa-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-00000000001b', null, 'st-team1b', 3, 'todo');

-- Scope claim for the Team Lead (dept + team in app_metadata), built as superuser like 010.
create temp table audit_claims as
select up.id, json_build_object('sub', up.id, 'app_metadata', json_build_object(
  'tenant_id', up.tenant_id, 'app_role_id', up.role_id,
  'department_id', up.department_id, 'team_id', up.team_id))::text as jwt
from user_profiles up where up.id = 'aaaaaaaa-0000-0000-0000-0000000000e2';
grant select on audit_claims to public;

set local role authenticated;

-- ======================================================================
-- Team Member self-path: may progress ONLY the sub-task assigned to them.
-- a003 holds project_tasks:manage (seed fixture) but scope=self → the manage path never opens; only
-- assignee_id = auth.uid() lets them act. (Proves the grant alone is not enough — scope is.)
-- ======================================================================
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select lives_ok($$ update sub_tasks set status='in_progress' where id='aaaaaaaa-0000-0000-0000-00000000b901' $$,
  'member progresses their own sub-task (self path)');
select is((select status from sub_tasks where id='aaaaaaaa-0000-0000-0000-00000000b901'),
  'in_progress', 'own sub-task actually advanced');
select throws_ok($$ update sub_tasks set assignee_id='00000000-0000-0000-0000-00000000a001' where id='aaaaaaaa-0000-0000-0000-00000000b901' $$,
  '42501', null, 'member cannot hand their sub-task to someone else (WITH CHECK)');
select is((select title from sub_tasks where id='aaaaaaaa-0000-0000-0000-00000000b902'),
  'st-tl-team1a', 'member update of a sub-task NOT theirs touches nothing (USING → 0 rows)');
select is((select count(*)::int from sub_tasks where id='aaaaaaaa-0000-0000-0000-00000000b901'),
  1, 'member cannot delete their own sub-task (delete has no self path)');

-- ======================================================================
-- Team Lead: manage within own team only; may not drag a sub-task out of scope.
-- ======================================================================
select set_config('request.jwt.claims',(select jwt from audit_claims where id='aaaaaaaa-0000-0000-0000-0000000000e2'),true);
select lives_ok($$ update sub_tasks set sla_hours=5 where id='aaaaaaaa-0000-0000-0000-00000000b902' $$,
  'team lead updates a sub-task in their own team');
select is((select sla_hours::int from sub_tasks where id='aaaaaaaa-0000-0000-0000-00000000b902'),
  5, 'in-team update applied');
select is((select sla_hours::int from sub_tasks where id='aaaaaaaa-0000-0000-0000-00000000b903'),
  3, 'team lead update of another team''s sub-task touches nothing (USING → 0 rows)');
select throws_ok($$ update sub_tasks set team_id='aaaaaaaa-0000-0000-0000-00000000001b' where id='aaaaaaaa-0000-0000-0000-00000000b902' $$,
  '42501', null, 'team lead cannot reassign a sub-task to another team (WITH CHECK)');
select lives_ok($$ delete from sub_tasks where id='aaaaaaaa-0000-0000-0000-00000000b902' $$,
  'team lead deletes a sub-task in their own team');
select is((select count(*)::int from sub_tasks where id='aaaaaaaa-0000-0000-0000-00000000b902'),
  0, 'in-team delete applied');
select is((select count(*)::int from sub_tasks where id='aaaaaaaa-0000-0000-0000-00000000b903'),
  1, 'team lead delete of another team''s sub-task removes nothing (USING → 0 rows)');

-- ======================================================================
-- Cross-tenant: Tenant B sees none of Tenant A's sub-tasks and cannot change them.
-- ======================================================================
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b002'),true);
select is((select count(*)::int from sub_tasks),
  0, 'tenant B sees zero of tenant A''s sub-tasks (read isolation)');
update sub_tasks set sla_hours=7 where id='aaaaaaaa-0000-0000-0000-00000000b903';
-- verify from tenant A that B's write hit nothing
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select is((select sla_hours::int from sub_tasks where id='aaaaaaaa-0000-0000-0000-00000000b903'),
  3, 'tenant B write blocked by RLS (still 3, verified in tenant A)');

-- ======================================================================
-- Documented interim (ADR-0009/0010): deliverable WRITES are grant-only, NOT scope-gated.
-- A team-scoped lead can therefore transition a deliverable unrelated to their team. Pinned so
-- that when deliverables are later scoped to the Account Manager's campaigns, this flips
-- deliberately rather than silently.
-- ======================================================================
select set_config('request.jwt.claims',(select jwt from audit_claims where id='aaaaaaaa-0000-0000-0000-0000000000e2'),true);
select lives_ok($$ update deliverables set state='in_progress' where id='aaaaaaaa-0000-0000-0000-00000000b801' $$,
  'INTERIM: team-scoped lead transitions any deliverable (deliverables are grant-only, not scoped)');
select is((select state::text from deliverables where id='aaaaaaaa-0000-0000-0000-00000000b801'),
  'in_progress', 'grant-only transition applied (documents the scope follow-up)');

reset role;
select * from finish();
rollback;
