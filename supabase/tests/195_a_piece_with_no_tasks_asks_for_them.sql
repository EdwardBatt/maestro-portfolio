-- 20260929120000 (I66.3) — a deliverable with no live task has no task list to approve. Its owner's card is
-- `task_list_undefined` ("define the tasks"), not `task_list`, and the owner's notices record `no_tasks`.
--
-- a001 (power admin) owns everything and acts; a951, a Creative team lead (a deliverable is owned by a lead),
-- is the new owner the notices go to. The notices are read as the database, after every action.
-- d1 has an open task, d2 none, d3 only a cancelled one.
begin;
select plan(9);
\ir helpers/seed.sql

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000a951', 'tl-195@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select '00000000-0000-0000-0000-00000000a951', 'aaaaaaaa-0000-0000-0000-000000000001', 'TL 195',
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = 'team_lead'),
       'aaaaaaaa-0000-0000-0000-0000000de0ff';

insert into campaigns (id, tenant_id, client_id, name, status, kind, approved_at) values
  ('aaaaaaaa-0000-0000-0000-0000000195e1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'Released 195', 'approved', 'single_job', now() - interval '1 hour'),
  ('aaaaaaaa-0000-0000-0000-0000000195e2', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'Pending 195', 'pending_approval', 'single_job', null);
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000195c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000195e1', 'Main'),
  ('aaaaaaaa-0000-0000-0000-0000000195c2', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000195e2', 'Main');
insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id, due_at) values
  ('aaaaaaaa-0000-0000-0000-0000000195d1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000195c1',
   'A With tasks', 'draft', '00000000-0000-0000-0000-00000000a001', now() + interval '10 days'),
  ('aaaaaaaa-0000-0000-0000-0000000195d2', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000195c1',
   'B No tasks', 'draft', '00000000-0000-0000-0000-00000000a001', now() + interval '10 days'),
  ('aaaaaaaa-0000-0000-0000-0000000195d3', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000195c1',
   'C All cancelled', 'draft', '00000000-0000-0000-0000-00000000a001', now() + interval '10 days'),
  ('aaaaaaaa-0000-0000-0000-0000000195d4', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000195c2',
   'P With tasks', 'draft', '00000000-0000-0000-0000-00000000a951', now() + interval '10 days'),
  ('aaaaaaaa-0000-0000-0000-0000000195d5', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000195c2',
   'Q No tasks', 'draft', '00000000-0000-0000-0000-00000000a951', now() + interval '10 days');
insert into sub_tasks (id, tenant_id, deliverable_id, title, status) values
  ('aaaaaaaa-0000-0000-0000-0000000195a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000195d1', 'Design', 'todo'),
  ('aaaaaaaa-0000-0000-0000-0000000195a3', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000195d3', 'Called off', 'cancelled'),
  ('aaaaaaaa-0000-0000-0000-0000000195a4', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000195d4', 'Design', 'todo');

set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

-- 1) the card
select results_eq(
  $$ select kind from public.my_pending_approvals()
      where target_id in ('aaaaaaaa-0000-0000-0000-0000000195d1', 'aaaaaaaa-0000-0000-0000-0000000195d2',
                          'aaaaaaaa-0000-0000-0000-0000000195d3') order by title $$,
  $$ values ('task_list'::text), ('task_list_undefined'), ('tasks_all_cancelled') $$,
  'a piece with an open task asks for its list to be approved; one with none asks for tasks; one whose every task was cancelled asks to add one or close it (I66.11)');
select is((select count(*)::int from public.my_pending_approvals() where kind = 'task_list'
            and target_id::text like 'aaaaaaaa-0000-0000-0000-0000000195d%'), 1,
  'so "task lists not approved" counts only the list that has tasks');

-- 2)-4) the actions: release a pending job, add a piece with no type, hand two pieces to a new owner
select lives_ok($$ select public.approve_campaign('aaaaaaaa-0000-0000-0000-0000000195e2') $$, 'the pending job is approved');
select lives_ok($$ select public.add_campaign_deliverable('aaaaaaaa-0000-0000-0000-0000000195e1', 'D Added', '00000000-0000-0000-0000-00000000a951',
                                                          null, 1, now() + interval '10 days') $$, 'a piece is added with no type');
update deliverables set owner_user_id = '00000000-0000-0000-0000-00000000a951'
 where id in ('aaaaaaaa-0000-0000-0000-0000000195d1', 'aaaaaaaa-0000-0000-0000-0000000195d2');

reset role;

-- 2) the release notice
select is((select detail -> 'no_tasks_count' from notifications
            where type = 'campaign_approved' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000195e2'
              and user_id = '00000000-0000-0000-0000-00000000a951')::int, 1,
  'the owner''s release notice counts the pieces with no tasks');
select results_eq(
  $$ select (x ->> 'name'), (x ->> 'no_tasks')::boolean
       from notifications n, jsonb_array_elements(n.detail -> 'deliverables') x
      where n.type = 'campaign_approved' and n.entity_id = 'aaaaaaaa-0000-0000-0000-0000000195e2'
      order by 1 $$,
  $$ values ('P With tasks'::text, false), ('Q No tasks', true) $$,
  'and marks each one');

-- 3) a piece added to a released job, no type, so no workflow and no tasks
select is((select (detail ->> 'no_tasks')::boolean from notifications
            where type = 'deliverable_added' and label = 'D Added' and user_id = '00000000-0000-0000-0000-00000000a951'), true,
  'its owner is told it has no tasks');

-- 4) a new owner
select is((select (detail ->> 'no_tasks')::boolean from notifications
            where type = 'deliverable_reassigned' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000195d2'), true,
  'a new owner of a piece with no tasks is told to define them');
select is((select (detail ->> 'no_tasks')::boolean from notifications
            where type = 'deliverable_reassigned' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000195d1'), false,
  'and of one with tasks, is not');

select * from finish();
rollback;
