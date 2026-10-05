-- ADR-0029 (I7.1 UI): public.create_internal_project get-or-creates the internal client + the job
-- (+ deliverables) in one call, gated on projects:manage.
begin;
select plan(5);
\ir helpers/seed.sql

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000036d1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative36');

set local role authenticated;

-- the Traffic Manager (a002, projects:manage) sets up a department-owned internal project
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
-- I22.5 (ADR-0055, 28 Aug): the 5th argument is the PM and is now REQUIRED. An internal project is
-- a project with an internal client, so its deliverables carry owners like any other project's, and
-- they take the PM as that owner. This call passed `null` when nothing needed one.
select lives_ok($$ select public.create_internal_project(
    'department', 'Brand refresh', 'aaaaaaaa-0000-0000-0000-0000000036d1'::uuid, null,
    '00000000-0000-0000-0000-00000000a003'::uuid, '[{"name":"Logo"}]'::jsonb) $$,
  'the Traffic Manager creates an internal project');
select is((select count(*)::int from clients
    where is_internal and internal_kind='department' and internal_department_id='aaaaaaaa-0000-0000-0000-0000000036d1'), 1,
  'the internal client was get-or-created');
select is((select count(*)::int from jobs j join clients c on c.id=j.client_id where c.is_internal and j.name='Brand refresh'), 1,
  'the internal project (job) was created under the internal client');
select is((select count(*)::int from deliverables d join jobs j on j.id=d.job_id where j.name='Brand refresh' and d.name='Logo'), 1,
  'the deliverable was created under the job');

-- a team member (no projects:manage) cannot set one up
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select throws_ok($$ select public.create_internal_project('tenant','Sneaky', null, null, null, '[]'::jsonb) $$,
  '42501', null, 'a team member cannot set up an internal project');

select * from finish();
rollback;
