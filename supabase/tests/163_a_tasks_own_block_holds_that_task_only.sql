-- I59.21 (ADR-0107 d.1, d.2) — a task-level input holds THAT task only, and raising it tells the
-- deliverable's owner and its account manager.
--
-- Every reader of the inputs that decides something: app.sub_task_has_unmet_prereqs (and through it
-- `started_ahead` on Start and ADR-0069 d.4's "you can start" notice), and the task_blocked notice.
begin;
select plan(16);
\ir helpers/seed.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a164', 'lead163@a.test'),
  ('00000000-0000-0000-0000-00000000a165', 'am163@a.test'),
  ('00000000-0000-0000-0000-00000000a166', 'maker163@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid
from (values
  ('00000000-0000-0000-0000-00000000a164','Lead 163','department_lead','aaaaaaaa-0000-0000-0000-0000000de0ff'),
  ('00000000-0000-0000-0000-00000000a165','AM 163',  'account_manager', null),
  ('00000000-0000-0000-0000-00000000a166','Maker 163','team_member','aaaaaaaa-0000-0000-0000-0000000de0ff')
) as v(id, name, role_key, dept);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id in ('00000000-0000-0000-0000-00000000a164','00000000-0000-0000-0000-00000000a165',
                                        '00000000-0000-0000-0000-00000000a166');

insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id, approved_at) values
  ('aaaaaaaa-0000-0000-0000-000000001630','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000c001',
   'Season 163','approved','campaign','00000000-0000-0000-0000-00000000a165', now());
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f163','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001630','S163');
insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id, department_id, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d1630','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f163',
   'Poster 163','in_progress','00000000-0000-0000-0000-00000000a164','aaaaaaaa-0000-0000-0000-0000000de0ff','00000000-0000-0000-0000-00000000a001');
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-000000001630');
-- TA design (a003) · TB copy (Maker 163), waits on TA · TC retouch (Maker 163), waits on TA ·
-- TD resize (a003), waits on nothing · TE crop (a003), waits on nothing but its own block.
insert into sub_tasks (id, tenant_id, deliverable_id, title, assignee_id, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000016f1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1630','Design','00000000-0000-0000-0000-00000000a003','in_progress', 8),
  ('aaaaaaaa-0000-0000-0000-0000000016f2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1630','Copy','00000000-0000-0000-0000-00000000a166','todo', 8),
  ('aaaaaaaa-0000-0000-0000-0000000016f3','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1630','Retouch','00000000-0000-0000-0000-00000000a166','todo', 8),
  ('aaaaaaaa-0000-0000-0000-0000000016f4','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1630','Resize','00000000-0000-0000-0000-00000000a003','todo', 8),
  ('aaaaaaaa-0000-0000-0000-0000000016f5','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1630','Crop','00000000-0000-0000-0000-00000000a003','todo', 8);
insert into sub_task_dependencies (tenant_id, sub_task_id, depends_on_sub_task_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000016f2','aaaaaaaa-0000-0000-0000-0000000016f1'),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000016f3','aaaaaaaa-0000-0000-0000-0000000016f1');

-- ====================================================== raising tells two people ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select lives_ok($$ insert into deliverable_pending_inputs
    (id, tenant_id, deliverable_id, sub_task_id, kind, description, awaited_from)
  values ('aaaaaaaa-0000-0000-0000-0000000016e3','aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-0000000d1630','aaaaaaaa-0000-0000-0000-0000000016f1',
          'decision','Which of the two layouts','Lead 163') $$,
  'a003 is blocked on Design');
reset role;
select is((select array_agg(user_id::text order by user_id) from notifications where type = 'task_blocked'),
  array['00000000-0000-0000-0000-00000000a164','00000000-0000-0000-0000-00000000a165'],
  'the owner and the account manager are told — once each, and not the maker');
select ok((select detail->>'task' = 'Design' and detail->>'kind' = 'decision'
             and detail->>'awaited_from' = 'Lead 163' and detail->>'description' = 'Which of the two layouts'
             and entity_type = 'sub_task' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000016f1'
             from notifications where type = 'task_blocked' and user_id = '00000000-0000-0000-0000-00000000a164'),
  'the notice names the task, the kind, who has it and what is needed');

-- ============================================= the predicate: that task only ====
select ok(app.sub_task_has_unmet_prereqs('aaaaaaaa-0000-0000-0000-0000000016f1'),
  'Design is waiting on its own block');
select ok(not app.sub_task_has_unmet_prereqs('aaaaaaaa-0000-0000-0000-0000000016f4'),
  'Resize, on the same deliverable, is NOT — a task''s own block does not cascade');

-- Copy and Crop get their own blocks; Retouch does not.
insert into deliverable_pending_inputs (tenant_id, deliverable_id, sub_task_id, kind, description, awaited_from)
values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1630','aaaaaaaa-0000-0000-0000-0000000016f2',
        'client','The brand''s Arabic tagline','Kite Card'),
       ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1630','aaaaaaaa-0000-0000-0000-0000000016f5',
        'file','The layered source file','Maker 163');

-- ========================================= ADR-0069 d.4, the "you can start" notice ====
-- Design is approved: whoever waited on it and has nothing else outstanding is told.
-- Reaching done is what fires it (tg_sub_task_dependents_ready) — the fixture stands in for the
-- approval, with Design's own block still open.
-- No user on the session, as tg_sub_task_completion_guard admits a fixture (auth.uid() null).
select set_config('request.jwt.claims', '', true);
select lives_ok($$ update sub_tasks set status = 'done' where id = 'aaaaaaaa-0000-0000-0000-0000000016f1' $$,
  'Design reaches done');
select is((select count(*)::int from notifications where type = 'dependency_ready'
            and entity_id = 'aaaaaaaa-0000-0000-0000-0000000016f3'), 1,
  'Retouch is told it can start — Design''s own block is Design''s, not Retouch''s');
select is((select count(*)::int from notifications where type = 'dependency_ready'
            and entity_id = 'aaaaaaaa-0000-0000-0000-0000000016f2'), 0,
  'Copy is not — its own block is still open');

-- ============================================================ started ahead ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select lives_ok($$ select app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000016f4') $$, 'Resize is started');
select is((select started_ahead from task_time_entries where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000016f4'), false,
  'not started ahead: another task''s block is not its prerequisite');
select lives_ok($$ select app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000016f5') $$, 'Crop is started anyway (soft, ADR-0069 d.3)');
select is((select started_ahead from task_time_entries where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000016f5'), true,
  'started ahead of its own open block');

-- ============================================== the deliverable's input still cascades ====
reset role;
insert into deliverable_pending_inputs (id, tenant_id, deliverable_id, description, awaited_from)
values ('aaaaaaaa-0000-0000-0000-0000000016e4','aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-0000000d1630','The logo pack','Kite Card');
select ok(app.sub_task_has_unmet_prereqs('aaaaaaaa-0000-0000-0000-0000000016f4'),
  'a deliverable-level input still holds every task on it (ADR-0069 d.7)');
select is((select count(*)::int from notifications where type = 'task_blocked'), 6,
  'and raises no task_blocked — only the three task-level blocks did (two recipients each)');

-- ====================================================== clearing releases the task ====
update deliverable_pending_inputs set satisfied_at = now()
 where id in ('aaaaaaaa-0000-0000-0000-0000000016e3','aaaaaaaa-0000-0000-0000-0000000016e4');
select ok(not app.sub_task_has_unmet_prereqs('aaaaaaaa-0000-0000-0000-0000000016f1'),
  'cleared, Design waits on nothing');
select ok(app.sub_task_has_unmet_prereqs('aaaaaaaa-0000-0000-0000-0000000016f2'),
  'Copy still waits on its own');

select * from finish();
rollback;
