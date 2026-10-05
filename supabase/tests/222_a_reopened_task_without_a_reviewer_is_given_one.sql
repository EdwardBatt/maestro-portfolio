-- I74 fix-up (Edward, 3 Oct — the reviewer rule) — a re-opened task that nobody reviews is given reviewers.
--
-- An approved Creative piece with two finished tasks, both made by the maker: "Brunos 222" has NO reviewer (as the
-- seeded "Brunos post 7"), "Resize 222" has the team lead. Re-opening goes back to the maker, and an assigned live task
-- must have a reviewer (app.tg_sub_task_reviewer_required) — so:
--   * the re-open without reviewers for the bare task is refused in words (22023, hint reviewer_required), not 23514;
--   * with reviewers chosen (the first required, the rest optional) it re-opens and saves them, and they are told;
--   * the maker is never her own reviewer;
--   * a task that has reviewers keeps them — whatever is passed for it is ignored (reviewing does not change).
-- Deferred checks are made IMMEDIATE so the assignment check runs inside this rolled-back test.
begin;
select plan(9);
\ir helpers/seed.sql

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de2220', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 222');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000007e222', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000de2220', 'Design 222');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a221', 'creativelead222@a.test'),
  ('00000000-0000-0000-0000-00000000a222', 'designlead222@a.test'),
  ('00000000-0000-0000-0000-00000000a223', 'maker222@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid, v.team::uuid
from (values
  ('00000000-0000-0000-0000-00000000a221','Creative lead 222', 'department_lead','aaaaaaaa-0000-0000-0000-000000de2220', null),
  ('00000000-0000-0000-0000-00000000a222','Design lead 222',   'team_lead',      'aaaaaaaa-0000-0000-0000-000000de2220', 'aaaaaaaa-0000-0000-0000-00000007e222'),
  ('00000000-0000-0000-0000-00000000a223','Maker 222',         'team_member',    'aaaaaaaa-0000-0000-0000-000000de2220', 'aaaaaaaa-0000-0000-0000-00000007e222')
) as v(id, name, role_key, dept, team);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id in ('00000000-0000-0000-0000-00000000a221','00000000-0000-0000-0000-00000000a222','00000000-0000-0000-0000-00000000a223');

insert into campaigns (id, tenant_id, client_id, name, status, kind) values
  ('aaaaaaaa-0000-0000-0000-000000002220','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'), 'Season 222','approved','campaign');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f222','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000002220','Season 222');
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d2220','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f222',
   'Brunos 222','in_progress', now() + interval '20 days', '00000000-0000-0000-0000-00000000a221');
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-000000002220');

-- Finished as the system wrote them: "Brunos 222" with nobody reviewing (history from before the rule — the deferred
-- check is skipped for the fixture by writing it in replica mode), "Resize 222" with the team lead.
set local session_replication_role = replica;
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order, department_id, team_id,
                       assignee_id, due_at, approved_at, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000a2221','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d2220',
   'Brunos 222','done',1,'aaaaaaaa-0000-0000-0000-000000de2220','aaaaaaaa-0000-0000-0000-00000007e222',
   '00000000-0000-0000-0000-00000000a223', now() - interval '2 days', now() - interval '1 day', 4),
  ('aaaaaaaa-0000-0000-0000-0000000a2222','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d2220',
   'Resize 222','done',2,'aaaaaaaa-0000-0000-0000-000000de2220','aaaaaaaa-0000-0000-0000-00000007e222',
   '00000000-0000-0000-0000-00000000a223', now() - interval '2 days', now() - interval '1 day', 2);
set local session_replication_role = origin;
insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory, approved_at, responded_at)
values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000a2222','00000000-0000-0000-0000-00000000a222',
        true, now() - interval '1 day', now() - interval '1 day');
set local app.system_op = 'on';
update deliverables set state = 'approved' where id = 'aaaaaaaa-0000-0000-0000-0000000d2220';
set local app.system_op = 'off';
set constraints all immediate;

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a221'),true);

select throws_ok($$ select public.reopen_task('aaaaaaaa-0000-0000-0000-0000000a2221', 'New logo', now() + interval '5 days', 'client_amendment') $$,
  '22023', '"Brunos 222" has no reviewer — choose who reviews it before it is re-opened',
  'a task nobody reviews is not re-opened without reviewers — said in words, not the commit-time 23514');
select throws_ok($$ select public.reopen_task('aaaaaaaa-0000-0000-0000-0000000a2221', 'New logo', now() + interval '5 days', 'client_amendment',
                      null, '[{"user_id":"00000000-0000-0000-0000-00000000a223","is_mandatory":true}]'::jsonb) $$,
  '22023', null, 'the maker is never her own reviewer');

select lives_ok($$ select public.reopen_task('aaaaaaaa-0000-0000-0000-0000000a2221', 'New logo', now() + interval '5 days', 'client_amendment',
                     null, '[{"user_id":"00000000-0000-0000-0000-00000000a222","is_mandatory":true},
                             {"user_id":"00000000-0000-0000-0000-00000000a221","is_mandatory":false}]'::jsonb) $$,
  'with reviewers chosen — the first required, the next optional — it re-opens');
reset role;
select is((select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a2221'), 'todo',
  'the task is back to To do');
select is((select assignee_id from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a2221'),
  '00000000-0000-0000-0000-00000000a223'::uuid, 'with its maker');
select results_eq($$ select user_id, is_mandatory from sub_task_reviewers
                      where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a2221' order by is_mandatory desc $$,
  $$ values ('00000000-0000-0000-0000-00000000a222'::uuid, true), ('00000000-0000-0000-0000-00000000a221'::uuid, false) $$,
  'the reviewers chosen are saved — the first required, the other optional');
select is((select count(*)::int from notifications where type = 'task_reopened' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000a2221'
            and user_id = '00000000-0000-0000-0000-00000000a222'), 1,
  'the new required reviewer is told with the maker');

-- A task that has reviewers keeps them: what is passed for it is ignored.
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a221'),true);
select lives_ok($$ select public.reopen_task('aaaaaaaa-0000-0000-0000-0000000a2222', 'Resize again', now() + interval '5 days', 'own_fix',
                     null, '[{"user_id":"00000000-0000-0000-0000-00000000a221","is_mandatory":true}]'::jsonb) $$,
  'a task that has a reviewer re-opens');
reset role;
select results_eq($$ select user_id from sub_task_reviewers where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a2222' $$,
  $$ values ('00000000-0000-0000-0000-00000000a222'::uuid) $$,
  'and keeps its reviewer — re-opening does not change who reviews');

select * from finish();
rollback;
