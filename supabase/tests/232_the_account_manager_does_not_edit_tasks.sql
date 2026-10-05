-- I74.53 (ADR-0140 addendum, Edward 4 Oct: "AM should not edit other departments' tasks either").
--
-- A deliverable's tasks are its department's. The account manager — even on her own client's job, where the account
-- branch of in_write_scope used to let her in — is refused every task write: editing one (save_sub_task, through the
-- row policy), adding one, removing one, reordering the list, cancelling one. The deliverable's owner and the
-- department's team lead still edit; another department's team lead is still refused.
--
-- Runs as `authenticated` with each caller's own claims (the policies and functions read has_permission and
-- in_write_scope, so a superuser run proves nothing).
begin;
select plan(19);
\ir helpers/seed.sql

-- ---------------------------------------------------------------- fixtures ----
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000de321', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 232'),
  ('aaaaaaaa-0000-0000-0000-0000000de322', 'aaaaaaaa-0000-0000-0000-000000000001', 'Content 232');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000007e321', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000de321', 'Design 232'),
  ('aaaaaaaa-0000-0000-0000-00000007e322', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000de322', 'Copy 232');

insert into auth.users (id, email)
select v.id::uuid, v.email from (values
  ('00000000-0000-0000-0000-0000000a2321', 'owner232@a.test'),
  ('00000000-0000-0000-0000-0000000a2322', 'teamlead232@a.test'),
  ('00000000-0000-0000-0000-0000000a2323', 'othertl232@a.test'),
  ('00000000-0000-0000-0000-0000000a2324', 'am232@a.test')
) as v(id, email);

insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid, v.team::uuid
  from (values
  ('00000000-0000-0000-0000-0000000a2321', 'Owner 232',     'team_member',     'aaaaaaaa-0000-0000-0000-0000000de321', 'aaaaaaaa-0000-0000-0000-00000007e321'),
  ('00000000-0000-0000-0000-0000000a2322', 'Team Lead 232', 'team_lead',       'aaaaaaaa-0000-0000-0000-0000000de321', 'aaaaaaaa-0000-0000-0000-00000007e321'),
  ('00000000-0000-0000-0000-0000000a2323', 'Copy Lead 232', 'team_lead',       'aaaaaaaa-0000-0000-0000-0000000de322', 'aaaaaaaa-0000-0000-0000-00000007e322'),
  ('00000000-0000-0000-0000-0000000a2324', 'AM 232',        'account_manager', null, null)
  ) as v(id, name, role_key, dept, team);

insert into test_claims
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.display_name like '% 232' or display_name = 'Maker 232x';

-- Her own client's job: she is its account manager.
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-0000000e2320', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Job 232', 'approved', 'single_job',
   '00000000-0000-0000-0000-0000000a2324');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000c2320', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000e2320', 'Job 232');
insert into deliverables (id, tenant_id, stream_id, name, owner_user_id, reviewer_id, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d2320', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000c2320', 'Statics 232', '00000000-0000-0000-0000-0000000a2321',
   '00000000-0000-0000-0000-00000000a001', 'aaaaaaaa-0000-0000-0000-0000000de321');
insert into sub_tasks (id, tenant_id, deliverable_id, department_id, team_id, title, status, sort_order, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000f2321', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d2320',
   'aaaaaaaa-0000-0000-0000-0000000de321', 'aaaaaaaa-0000-0000-0000-00000007e321', 'Develop Concept', 'todo', 1, 4),
  ('aaaaaaaa-0000-0000-0000-0000000f2322', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d2320',
   'aaaaaaaa-0000-0000-0000-0000000de321', 'aaaaaaaa-0000-0000-0000-00000007e321', 'Create Artwork', 'todo', 2, 8),
  ('aaaaaaaa-0000-0000-0000-0000000f2323', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d2320',
   'aaaaaaaa-0000-0000-0000-0000000de321', 'aaaaaaaa-0000-0000-0000-00000007e321', 'Motion Version', 'todo', 3, 3);

-- ---------------------------------------------------------------- the account manager: refused ----
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-0000000a2324'), true);
set local role authenticated;
select throws_ok(
  $$ select public.save_sub_task('aaaaaaaa-0000-0000-0000-0000000f2321', 'aaaaaaaa-0000-0000-0000-0000000d2320',
       'Develop Concept, renamed', null, null, null, null, null, 9, null, null, null, null, null) $$,
  '42501', null, 'the account manager may not edit a task on her own client''s job');
select throws_ok(
  $$ select public.save_sub_task(null, 'aaaaaaaa-0000-0000-0000-0000000d2320',
       'Extra task', null, null, null, null, null, 2, null, null, null, null, null) $$,
  '42501', null, 'nor add one');
select throws_ok(
  $$ select public.remove_sub_task('aaaaaaaa-0000-0000-0000-0000000f2323') $$,
  '42501', null, 'nor remove one');
select throws_ok(
  $$ select public.resequence_deliverable_tasks('aaaaaaaa-0000-0000-0000-0000000d2320',
       array['aaaaaaaa-0000-0000-0000-0000000f2322', 'aaaaaaaa-0000-0000-0000-0000000f2321',
             'aaaaaaaa-0000-0000-0000-0000000f2323']::uuid[]) $$,
  '42501', null, 'nor reorder the list');
select throws_ok(
  $$ select public.sub_task_cancel('aaaaaaaa-0000-0000-0000-0000000f2322') $$,
  '42501', null, 'nor cancel one');
reset role;
select is(
  (select array_agg(title || ':' || status || ':' || sla_hours::int || ':' || sort_order order by id)
     from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2320'),
  array['Develop Concept:todo:4:1', 'Create Artwork:todo:8:2', 'Motion Version:todo:3:3'],
  'and nothing on the list changed');

-- ---------------------------------------------------------------- another department's lead: refused ----
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-0000000a2323'), true);
set local role authenticated;
select throws_ok(
  $$ select public.save_sub_task('aaaaaaaa-0000-0000-0000-0000000f2321', 'aaaaaaaa-0000-0000-0000-0000000d2320',
       'Develop Concept', null, null, null, null, null, 5, null, null, null, null, null) $$,
  '42501', null, 'another department''s team lead is still refused');
reset role;

-- ---------------------------------------------------------------- the owner and the department's lead: allowed ----
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-0000000a2321'), true);
set local role authenticated;
select lives_ok(
  $$ select public.save_sub_task('aaaaaaaa-0000-0000-0000-0000000f2321', 'aaaaaaaa-0000-0000-0000-0000000d2320',
       'Develop Concept', null, null, null, null, null, 6, null, null, null, null, null) $$,
  'the deliverable''s owner still edits its tasks');
reset role;
select is((select sla_hours::int from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000f2321'), 6,
  'and the change is saved');

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-0000000a2322'), true);
set local role authenticated;
select lives_ok(
  $$ select public.save_sub_task('aaaaaaaa-0000-0000-0000-0000000f2322', 'aaaaaaaa-0000-0000-0000-0000000d2320',
       'Create Artwork', null, null, null, null, null, 10, null, null, null, null, null) $$,
  'the department''s team lead still edits its tasks');
select lives_ok(
  $$ select public.sub_task_cancel('aaaaaaaa-0000-0000-0000-0000000f2323') $$,
  'and cancels one');
reset role;
select is((select status::text from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000f2323'), 'cancelled',
  'the cancellation is saved');

-- ---------------------------------------------------------------- her ask carries who checks it (A) ----
-- She asks the Design team for a person on a task with no reviewer. The ask names the reviewer; the task is not
-- touched until the lead books it, and the booking writes the reviewer onto the task.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000a2325', 'maker232@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
values ('00000000-0000-0000-0000-0000000a2325', 'aaaaaaaa-0000-0000-0000-000000000001', 'Maker 232x',
        (select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'team_member'),
        'aaaaaaaa-0000-0000-0000-0000000de321', 'aaaaaaaa-0000-0000-0000-00000007e321');
insert into resources (id, tenant_id, kind, name, capacity_model, load_ceiling_pct, warn_at_pct, user_id, department_id, team_id) values
  ('aaaaaaaa-0000-0000-0000-0000000b2325', 'aaaaaaaa-0000-0000-0000-000000000001', 'human', 'Maker 232', 'load_based', 120.0, 100.0,
   '00000000-0000-0000-0000-0000000a2325', 'aaaaaaaa-0000-0000-0000-0000000de321', 'aaaaaaaa-0000-0000-0000-00000007e321');
insert into deliverables (id, tenant_id, stream_id, name, owner_user_id, reviewer_id, department_id, due_at, tasks_approved_at) values
  ('aaaaaaaa-0000-0000-0000-0000000d2321', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000c2320', 'Banner 232', '00000000-0000-0000-0000-0000000a2322',
   '00000000-0000-0000-0000-00000000a001', 'aaaaaaaa-0000-0000-0000-0000000de321', '2026-12-20 14:00+00', now());
insert into sub_tasks (id, tenant_id, deliverable_id, department_id, team_id, title, status, sort_order, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000f2324', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d2321',
   'aaaaaaaa-0000-0000-0000-0000000de321', 'aaaaaaaa-0000-0000-0000-00000007e321', 'Create Artwork', 'todo', 1, 4);

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-0000000a2324'), true);
set local role authenticated;
select throws_ok(
  $$ select public.request_task_booking('aaaaaaaa-0000-0000-0000-0000000f2324', 'aaaaaaaa-0000-0000-0000-00000007e321') $$,
  '22023', null, 'an ask naming nobody to check a task that has nobody is still refused (reviewer_required)');
select lives_ok(
  $$ select public.request_task_booking('aaaaaaaa-0000-0000-0000-0000000f2324', 'aaaaaaaa-0000-0000-0000-00000007e321',
       p_assignee => '00000000-0000-0000-0000-0000000a2325', p_hours => 6,
       p_reviewers => '[{"user_id": "00000000-0000-0000-0000-00000000a001", "is_mandatory": true}]'::jsonb) $$,
  'the account manager asks for the maker, naming who checks it — no task edit');
reset role;
select is((select reviewers -> 0 ->> 'user_id' from sub_task_assignment_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000f2324'),
  '00000000-0000-0000-0000-00000000a001', 'the ask records who checks it');
select is((select count(*)::int from sub_task_reviewers where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000f2324'), 0,
  'and the task itself is untouched until it is booked');

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-0000000a2322'), true);
set local role authenticated;
select lives_ok(
  $$ select public.answer_task_request((select id from sub_task_assignment_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000f2324'),
       'book', '00000000-0000-0000-0000-0000000a2325', '2026-12-07 06:00+00', '2026-12-07 12:00+00') $$,
  'the Design team lead books the ask');
reset role;
select is((select user_id from sub_task_reviewers where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000f2324'),
  '00000000-0000-0000-0000-00000000a001'::uuid, 'the booking writes the ask''s reviewer onto the task');
select is((select assignee_id from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000f2324'),
  '00000000-0000-0000-0000-0000000a2325'::uuid, 'and gives the task to the maker');

select * from finish();
rollback;
