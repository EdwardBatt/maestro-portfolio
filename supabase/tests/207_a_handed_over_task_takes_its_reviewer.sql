-- I70 follow-up (ADR-0133 d.3, 30 Sep): "offered by the rule that already governs that field — the same write as its
-- own page".
--
--   ROWS      — a task row says whether it has a reviewer and carries its department; a deliverable row carries the
--               deliverable's department (so its owner picker offers that department's leads, ADR-0128).
--   REVIEWER  — a task with no reviewer is refused without one ("a reviewer must be appointed"), and handed over when
--               the reviewers come with it (`p_reviewers`, the Schedule dialog's payload); the reviewer is appointed.
--   COMPLETE  — that task was all the person held: handing it over completes the deactivation.
begin;
select plan(9);
\ir helpers/seed.sql

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de2070', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 207');
insert into auth.users (id, email)
select v.id::uuid, v.email from (values
  ('00000000-0000-0000-0000-00000000c070','lead207@a.test'),
  ('00000000-0000-0000-0000-00000000c071','maker207@a.test'),
  ('00000000-0000-0000-0000-00000000c072','maker2-207@a.test')) v(id, email);
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       'aaaaaaaa-0000-0000-0000-000000de2070'
from (values
  ('00000000-0000-0000-0000-00000000c070','Lead 207',   'department_lead'),
  ('00000000-0000-0000-0000-00000000c071','Maker 207',  'team_member'),
  ('00000000-0000-0000-0000-00000000c072','Maker2 207', 'team_member')
) as v(id, name, role_key);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id::text like '00000000-0000-0000-0000-00000000c07%';
insert into resources (id, tenant_id, kind, name, capacity_model, load_ceiling_pct, warn_at_pct, user_id, department_id)
select ('aaaaaaaa-0000-0000-0000-0000000e2' || right(v.u, 3))::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', 'human', v.n,
       'load_based', 120.0, 100.0, v.u::uuid, 'aaaaaaaa-0000-0000-0000-000000de2070'
  from (values
    ('00000000-0000-0000-0000-00000000c070', 'Lead 207'),
    ('00000000-0000-0000-0000-00000000c071', 'Maker 207'),
    ('00000000-0000-0000-0000-00000000c072', 'Maker2 207')) v(u, n);

insert into campaigns (id, tenant_id, client_id, name, status, kind) values
  ('aaaaaaaa-0000-0000-0000-00000000207b', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'W 207', 'approved', 'campaign');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f207', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000207b', 'S207');
-- D: the lead's, with NO deliverable reviewer — the task under it has none to fall back on.
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d2071', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f207',
   'Poster 207', 'in_progress', now() + interval '20 days', '00000000-0000-0000-0000-00000000c070',
   'aaaaaaaa-0000-0000-0000-000000de2070');
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-00000000207b');

-- An assigned task with no reviewer is what the rule forbids, so it exists only where it was written with the triggers
-- paused — as the demo data and pre-rule history were. That is the case the hand-over has to handle.
set local app.system_op = 'on';
set local session_replication_role = replica;
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order, assignee_id, sla_hours, starts_at, due_at, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000a2071', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d2071',
   'Motion 207', 'todo', 1, '00000000-0000-0000-0000-00000000c071', 4, now() + interval '2 days', now() + interval '3 days',
   'aaaaaaaa-0000-0000-0000-000000de2070');
set local session_replication_role = origin;
set local app.system_op = 'off';

-- ================================================================ ROWS ====
select is((select (detail ->> 'needs_reviewer')::boolean from app.handover_items_of('00000000-0000-0000-0000-00000000c071')
            where kind = 'task'), true,
  'rows: a task with no reviewer says so');
select is((select detail ->> 'department_id' from app.handover_items_of('00000000-0000-0000-0000-00000000c071') where kind = 'task'),
  'aaaaaaaa-0000-0000-0000-000000de2070', 'rows: a task row carries its department');
select is((select detail ->> 'department_id' from app.handover_items_of('00000000-0000-0000-0000-00000000c070')
            where kind = 'deliverable' and item_id = 'aaaaaaaa-0000-0000-0000-0000000d2071'),
  'aaaaaaaa-0000-0000-0000-000000de2070', 'rows: a deliverable row carries the deliverable''s department (ADR-0128)');

-- ================================================================ REVIEWER ====
-- `sub_task_reviewer_required` is a DEFERRED constraint trigger: it answers at commit, which a request reaches and a
-- test's transaction never does. Checked at once here, as the request's commit would.
set constraints all immediate;
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select lives_ok($$ select public.start_deactivation('00000000-0000-0000-0000-00000000c071') $$,
  'setup: the maker starts leaving');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000c070'),true);
select throws_ok($$ select public.hand_over_item('task', 'aaaaaaaa-0000-0000-0000-0000000a2071', '00000000-0000-0000-0000-00000000c072') $$,
  '23514', null, 'reviewer: a task with no reviewer is not handed over without one');
-- The hand-over writes the assignee before the reviewers, as `update_task_assignment` always has: deferred again, then
-- checked below exactly as the request's commit checks it.
set constraints all deferred;
select lives_ok($$ select public.hand_over_item('task', 'aaaaaaaa-0000-0000-0000-0000000a2071', '00000000-0000-0000-0000-00000000c072',
                   '[{"user_id": "00000000-0000-0000-0000-00000000c070", "is_mandatory": true}]'::jsonb) $$,
  'reviewer: with the reviewer the Schedule dialog would send, it is handed over');

select lives_ok($$ set constraints all immediate $$, 'reviewer: the commit''s check passes — the task has its reviewer');

reset role;
select ok((select assignee_id = '00000000-0000-0000-0000-00000000c072' from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a2071')
          and exists (select 1 from sub_task_reviewers where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a2071'
                        and user_id = '00000000-0000-0000-0000-00000000c070'),
  'reviewer: the task is the new person''s, and the reviewer is appointed');

-- ================================================================ COMPLETE ====
select ok((select not is_active from user_profiles where id = '00000000-0000-0000-0000-00000000c071'),
  'complete: that task was all the maker held — the deactivation completed');

select * from finish();
rollback;
