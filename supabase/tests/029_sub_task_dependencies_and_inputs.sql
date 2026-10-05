-- ADR-0030 (I8.3): soft dependencies, external inputs, started-ahead; no `blocked` sub-task status.
-- Proves: a dependency can be created; a cycle and a self-dependency are rejected; Start flags
-- `started_ahead` when a dependency is unsubmitted OR the deliverable has an outstanding input, and
-- not otherwise; `blocked` is no longer a valid sub-task status.
begin;
select plan(10);
\ir helpers/seed.sql

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000059d1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S');
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000059e1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000059d1','D1','in_progress', '00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-0000000059e2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000059d1','D2','in_progress', '00000000-0000-0000-0000-00000000a001');
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000059a1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000059e1','00000000-0000-0000-0000-00000000a003','A','todo', 8),
  ('aaaaaaaa-0000-0000-0000-0000000059a2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000059e1','00000000-0000-0000-0000-00000000a003','B','todo', 8),
  ('aaaaaaaa-0000-0000-0000-0000000059a3','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000059e1','00000000-0000-0000-0000-00000000a003','C','todo', 8),
  ('aaaaaaaa-0000-0000-0000-0000000059a4','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000059e2','00000000-0000-0000-0000-00000000a003','E','todo', 8);
-- D2 has an outstanding external input
insert into deliverable_pending_inputs (id, tenant_id, deliverable_id, description) values
  ('aaaaaaaa-0000-0000-0000-0000000059b1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000059e2','Client logo pack from Acme');

set local role authenticated;

-- a manager wires B depends on A; a cycle and a self-dependency are rejected
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select lives_ok($$ insert into sub_task_dependencies (tenant_id, sub_task_id, depends_on_sub_task_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000059a2','aaaaaaaa-0000-0000-0000-0000000059a1') $$,
  'B depends on A');
select throws_ok($$ insert into sub_task_dependencies (tenant_id, sub_task_id, depends_on_sub_task_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000059a1','aaaaaaaa-0000-0000-0000-0000000059a2') $$,
  '22023', null, 'a cycle (A depends on B) is rejected');
select throws_ok($$ insert into sub_task_dependencies (tenant_id, sub_task_id, depends_on_sub_task_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000059a1','aaaaaaaa-0000-0000-0000-0000000059a1') $$,
  '23514', null, 'a self-dependency is rejected');

-- started-ahead: assignee starts B while A is unsubmitted → flagged
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select lives_ok($$ select app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000059a2') $$, 'start B (dependency A unmet)');
select is((select started_ahead from task_time_entries where sub_task_id='aaaaaaaa-0000-0000-0000-0000000059a2'), true,
  'B was started ahead (its dependency is unsubmitted)');

-- C has no dependency and its deliverable has no pending input → not started-ahead
select lives_ok($$ select app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000059a3') $$, 'start C (no prerequisites)');
select is((select started_ahead from task_time_entries where sub_task_id='aaaaaaaa-0000-0000-0000-0000000059a3'), false,
  'C was not started ahead');

-- E's deliverable has an outstanding external input → started ahead
select lives_ok($$ select app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000059a4') $$, 'start E (deliverable input outstanding)');
select is((select started_ahead from task_time_entries where sub_task_id='aaaaaaaa-0000-0000-0000-0000000059a4'), true,
  'E was started ahead (its deliverable awaits an external input)');

-- `blocked` is no longer a valid sub-task status (run as a manager so RLS passes and the CHECK is hit)
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select throws_ok($$ insert into sub_tasks (tenant_id, deliverable_id, title, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000059e1','X','blocked') $$,
  '23514', null, 'a sub-task can no longer be blocked');

select * from finish();
rollback;
