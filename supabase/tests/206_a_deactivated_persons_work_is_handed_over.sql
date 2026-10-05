-- I70 (ADR-0133, accepted 30 Sep): a deactivated person loses access at once, and their work is handed over before the
-- deactivation completes.
--
--   START     — only users:manage may start it; the person is Leaving (still is_active); the list goes to their
--               department's lead; for Client Services the Account Director; none (or they ARE the lead) → the Traffic
--               Manager and the Power Admins. Holding nothing, they are Deactivated at once.
--   NO NEW WORK — a Leaving person cannot be made a task's assignee or a reviewer (the triggers, on any write path).
--   THE LIST  — the six groups, for a recipient or a users:manage holder; refused to anyone else, and across tenants.
--   HAND-OVER — each kind through its own write; a Leaving target refused; another person's hand-over refused.
--   COMPLETE  — the last item completes it: is_active false, the calendar row off, the recipients and the starter told.
--   ESCALATE  — an unfinished hand-over after the rule's hours → the Traffic Manager and the Power Admins.
--   GUARD     — the leaving columns are not the person's to clear on themselves; the service role (update-user) may.
--
-- `notifications` is recipient-scoped: every count over it is read after `reset role` (traps.md).
begin;
select plan(28);
\ir helpers/seed.sql
select app.seed_account_director('aaaaaaaa-0000-0000-0000-000000000001');
select app.seed_tenant_escalation_rules('aaaaaaaa-0000-0000-0000-000000000001');

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de2060', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 206'),
  ('aaaaaaaa-0000-0000-0000-000000de2061', 'aaaaaaaa-0000-0000-0000-000000000001', 'Client Services 206'),
  ('aaaaaaaa-0000-0000-0000-000000de2062', 'aaaaaaaa-0000-0000-0000-000000000001', 'Content 206');
insert into auth.users (id, email)
select v.id::uuid, v.email from (values
  ('00000000-0000-0000-0000-00000000c060','lead206@a.test'),
  ('00000000-0000-0000-0000-00000000c061','maker206@a.test'),
  ('00000000-0000-0000-0000-00000000c062','maker2-206@a.test'),
  ('00000000-0000-0000-0000-00000000c063','director206@a.test'),
  ('00000000-0000-0000-0000-00000000c064','am206@a.test'),
  ('00000000-0000-0000-0000-00000000c065','am2-206@a.test'),
  ('00000000-0000-0000-0000-00000000c066','writer206@a.test'),
  ('00000000-0000-0000-0000-00000000c067','empty206@a.test'),
  ('00000000-0000-0000-0000-00000000c068','teamlead206@a.test')) v(id, email);
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid
from (values
  ('00000000-0000-0000-0000-00000000c060','Lead 206',     'department_lead',  'aaaaaaaa-0000-0000-0000-000000de2060'),
  ('00000000-0000-0000-0000-00000000c061','Maker 206',    'team_lead',        'aaaaaaaa-0000-0000-0000-000000de2060'),
  ('00000000-0000-0000-0000-00000000c062','Maker2 206',   'team_member',      'aaaaaaaa-0000-0000-0000-000000de2060'),
  ('00000000-0000-0000-0000-00000000c063','Director 206', 'account_director', 'aaaaaaaa-0000-0000-0000-000000de2061'),
  ('00000000-0000-0000-0000-00000000c064','AM 206',       'account_manager',  'aaaaaaaa-0000-0000-0000-000000de2061'),
  ('00000000-0000-0000-0000-00000000c065','AM2 206',      'account_manager',  'aaaaaaaa-0000-0000-0000-000000de2061'),
  ('00000000-0000-0000-0000-00000000c066','Writer 206',   'team_member',      'aaaaaaaa-0000-0000-0000-000000de2062'),
  ('00000000-0000-0000-0000-00000000c067','Empty 206',    'team_member',      'aaaaaaaa-0000-0000-0000-000000de2060'),
  ('00000000-0000-0000-0000-00000000c068','Teamlead 206', 'team_lead',        'aaaaaaaa-0000-0000-0000-000000de2060')
) as v(id, name, role_key, dept);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id::text like '00000000-0000-0000-0000-00000000c06%';
insert into resources (id, tenant_id, kind, name, capacity_model, load_ceiling_pct, warn_at_pct, user_id, department_id)
select ('aaaaaaaa-0000-0000-0000-0000000e2' || right(v.u, 3))::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', 'human', v.n,
       'load_based', 120.0, 100.0, v.u::uuid, v.d::uuid
  from (values
    ('00000000-0000-0000-0000-00000000c060', 'Lead 206',     'aaaaaaaa-0000-0000-0000-000000de2060'),
    ('00000000-0000-0000-0000-00000000c061', 'Maker 206',    'aaaaaaaa-0000-0000-0000-000000de2060'),
    ('00000000-0000-0000-0000-00000000c062', 'Maker2 206',   'aaaaaaaa-0000-0000-0000-000000de2060'),
    ('00000000-0000-0000-0000-00000000c066', 'Writer 206',   'aaaaaaaa-0000-0000-0000-000000de2062'),
    ('00000000-0000-0000-0000-00000000c067', 'Empty 206',    'aaaaaaaa-0000-0000-0000-000000de2060'),
    ('00000000-0000-0000-0000-00000000c068', 'Teamlead 206', 'aaaaaaaa-0000-0000-0000-000000de2060')) v(u, n, d);

-- The account manager's clients and campaigns: client X (no campaigns), campaign K on another client.
insert into clients (id, tenant_id, name, account_manager_id, status) values
  ('aaaaaaaa-0000-0000-0000-00000000c206', 'aaaaaaaa-0000-0000-0000-000000000001', 'Client 206',
   '00000000-0000-0000-0000-00000000c064', 'active');
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-00000000206a', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'K 206', 'approved', 'campaign', '00000000-0000-0000-0000-00000000c064'),
  ('aaaaaaaa-0000-0000-0000-00000000206b', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'W 206', 'approved', 'campaign', null);
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f206', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000206b', 'S206');
insert into workstreams (id, tenant_id, campaign_id, name, department_id, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000b2060', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000206b',
   'Launch 206', 'aaaaaaaa-0000-0000-0000-000000de2060', '00000000-0000-0000-0000-00000000c068');
-- D1: the lead's, where the maker's work is. D2: the team lead's, in the workstream.
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id, department_id, reviewer_id, workstream_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d2061', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f206',
   'Poster 206', 'in_progress', now() + interval '20 days', '00000000-0000-0000-0000-00000000c060',
   'aaaaaaaa-0000-0000-0000-000000de2060', '00000000-0000-0000-0000-00000000c060', null),
  ('aaaaaaaa-0000-0000-0000-0000000d2062', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f206',
   'Banner 206', 'in_progress', now() + interval '20 days', '00000000-0000-0000-0000-00000000c068',
   'aaaaaaaa-0000-0000-0000-000000de2060', '00000000-0000-0000-0000-00000000c060', 'aaaaaaaa-0000-0000-0000-0000000b2060');
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-00000000206b');

set local app.system_op = 'on';
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order, assignee_id, sla_hours, starts_at, due_at) values
  -- T1: the maker's open task. T2: the other maker's, which the maker reviews. T3: the writer's.
  ('aaaaaaaa-0000-0000-0000-0000000a2061', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d2061',
   'Design 206', 'todo', 1, '00000000-0000-0000-0000-00000000c061', 4, now() + interval '2 days', now() + interval '3 days'),
  ('aaaaaaaa-0000-0000-0000-0000000a2062', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d2061',
   'Resize 206', 'todo', 2, '00000000-0000-0000-0000-00000000c062', 2, now() + interval '2 days', now() + interval '3 days'),
  ('aaaaaaaa-0000-0000-0000-0000000a2063', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d2061',
   'Copy 206', 'todo', 3, '00000000-0000-0000-0000-00000000c066', 2, now() + interval '2 days', now() + interval '3 days');
insert into sub_task_reviewers (id, tenant_id, sub_task_id, user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000f2061', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000a2062',
   '00000000-0000-0000-0000-00000000c061');
-- A task's department follows its assignee (ADR-0060 d.9), as every real task's does.
update sub_tasks t set department_id = up.department_id
  from user_profiles up where up.id = t.assignee_id and t.deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2061';
set local app.system_op = 'off';

create temp table r206 (who text, result jsonb);
grant all on r206 to authenticated;

-- ================================================================ START ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select throws_ok($$ select public.start_deactivation('00000000-0000-0000-0000-00000000c061') $$, '42501', null,
  'start: only someone who manages users may deactivate a person');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
insert into r206 select 'maker', public.start_deactivation('00000000-0000-0000-0000-00000000c061');
insert into r206 select 'am',    public.start_deactivation('00000000-0000-0000-0000-00000000c064');
insert into r206 select 'writer', public.start_deactivation('00000000-0000-0000-0000-00000000c066');
insert into r206 select 'empty', public.start_deactivation('00000000-0000-0000-0000-00000000c067');
select is((select result ->> 'total' from r206 where who = 'maker'), '2', 'start: the maker holds two items (a task, a review)');

reset role;
select ok((select leaving_since is not null and is_active from user_profiles where id = '00000000-0000-0000-0000-00000000c061'),
  'start: the maker is Leaving — marked, still active until the hand-over is done');
select results_eq($$ select user_id from notifications
                     where type = 'handover_list' and entity_id = '00000000-0000-0000-0000-00000000c061' $$,
  $$ values ('00000000-0000-0000-0000-00000000c060'::uuid) $$,
  'start: the maker''s list goes to Creative''s department lead, and only to them');
select results_eq($$ select user_id from notifications
                     where type = 'handover_list' and entity_id = '00000000-0000-0000-0000-00000000c064' $$,
  $$ values ('00000000-0000-0000-0000-00000000c063'::uuid) $$,
  'start: an account manager''s list goes to the Account Director (Client Services'' lead)');
select results_eq($$ select user_id from notifications
                     where type = 'handover_list' and entity_id = '00000000-0000-0000-0000-00000000c066' order by user_id $$,
  $$ values ('00000000-0000-0000-0000-00000000a001'::uuid), ('00000000-0000-0000-0000-00000000a002'::uuid) $$,
  'start: no department lead → the Traffic Manager and the Power Admins');
select ok((select not is_active from user_profiles where id = '00000000-0000-0000-0000-00000000c067')
          and (select not is_active from resources where user_id = '00000000-0000-0000-0000-00000000c067')
          and (select (result ->> 'completed')::boolean from r206 where who = 'empty'),
  'start: holding nothing, they are Deactivated at once — calendar row off');

-- ================================================================ NO NEW WORK ====
select throws_ok($$ update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000c061'
                     where id = 'aaaaaaaa-0000-0000-0000-0000000a2063' $$, '22023', 'Maker 206 is leaving and cannot be given new work',
  'no new work: a Leaving person cannot be made a task''s assignee');
select throws_ok($$ insert into sub_task_reviewers (tenant_id, sub_task_id, user_id)
                     values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000a2063',
                             '00000000-0000-0000-0000-00000000c061') $$, '22023', null,
  'no new work: nor a reviewer');

-- ================================================================ THE LIST ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000c060'),true);
select ok(exists (select 1 from public.my_pending_approvals() a
                   where a.kind = 'handover' and a.target_id = '00000000-0000-0000-0000-00000000c061' and a.title = 'Maker 206'),
  'list: the department lead has the hand-over on Needs you');
select results_eq($$ select kind, item_id from public.handover_items('00000000-0000-0000-0000-00000000c061') order by kind $$,
  $$ values ('review'::text, 'aaaaaaaa-0000-0000-0000-0000000f2061'::uuid), ('task'::text, 'aaaaaaaa-0000-0000-0000-0000000a2061'::uuid) $$,
  'list: the maker''s open task and the review they owe');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000c062'),true);
select throws_ok($$ select * from public.handover_items('00000000-0000-0000-0000-00000000c061') $$, '42501', null,
  'list: refused to someone who is neither a recipient nor manages users');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b001'),true);
select throws_ok($$ select * from public.handover_items('00000000-0000-0000-0000-00000000c061') $$, '42501', null,
  'list: refused to another tenant, even its Power Admin');
select throws_ok($$ select public.hand_over_item('task', 'aaaaaaaa-0000-0000-0000-0000000a2061', '00000000-0000-0000-0000-00000000c062') $$,
  '42501', null, 'hand-over: another tenant cannot act on it');

-- ================================================================ HAND-OVER ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000c060'),true);
select throws_ok($$ select public.hand_over_item('task', 'aaaaaaaa-0000-0000-0000-0000000a2063', '00000000-0000-0000-0000-00000000c062') $$,
  '42501', null, 'hand-over: the writer''s hand-over is Traffic''s and the Power Admins'', not the Creative lead''s');
select throws_ok($$ select public.hand_over_item('task', 'aaaaaaaa-0000-0000-0000-0000000a2061', '00000000-0000-0000-0000-00000000c066') $$,
  '22023', 'Writer 206 is leaving and cannot be given new work', 'hand-over: never to someone who is leaving');
select lives_ok($$ select public.hand_over_item('review', 'aaaaaaaa-0000-0000-0000-0000000f2061', '00000000-0000-0000-0000-00000000c060') $$,
  'hand-over: the review goes to the lead');
insert into r206 select 'maker-task', public.hand_over_item('task', 'aaaaaaaa-0000-0000-0000-0000000a2061', '00000000-0000-0000-0000-00000000c062');
select is((select (result ->> 'completed')::boolean from r206 where who = 'maker-task'), true,
  'hand-over: the last item completes the deactivation');

reset role;
select results_eq($$ select user_id from sub_task_reviewers where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a2062' order by user_id $$,
  $$ values ('00000000-0000-0000-0000-00000000c060'::uuid) $$,
  'review: the maker is no longer a reviewer; the lead is');
select is((select assignee_id from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a2061'),
  '00000000-0000-0000-0000-00000000c062'::uuid, 'task: through the Schedule''s reassignment, to the other maker');
select ok((select not is_active from user_profiles where id = '00000000-0000-0000-0000-00000000c061')
          and (select not is_active from resources where user_id = '00000000-0000-0000-0000-00000000c061'),
  'complete: the maker is Deactivated and off the bookable pool (ADR-0014 d.3, now here)');
select results_eq($$ select user_id from notifications
                     where type = 'deactivation_complete' and entity_id = '00000000-0000-0000-0000-00000000c061' order by user_id $$,
  $$ values ('00000000-0000-0000-0000-00000000a001'::uuid), ('00000000-0000-0000-0000-00000000c060'::uuid) $$,
  'complete: the lead and whoever started it are told');

-- The account manager's: the Account Director hands the client and the campaign to another account manager.
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000c063'),true);
select public.hand_over_item('client', 'aaaaaaaa-0000-0000-0000-00000000c206', '00000000-0000-0000-0000-00000000c065');
insert into r206 select 'am-campaign', public.hand_over_item('campaign', 'aaaaaaaa-0000-0000-0000-00000000206a', '00000000-0000-0000-0000-00000000c065');
reset role;
select ok((select account_manager_id from clients where id = 'aaaaaaaa-0000-0000-0000-00000000c206') = '00000000-0000-0000-0000-00000000c065'
          and (select account_manager_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000206a') = '00000000-0000-0000-0000-00000000c065'
          and (select (result ->> 'completed')::boolean from r206 where who = 'am-campaign'),
  'client and campaign: to the other account manager; the account manager''s deactivation completes');

-- The team lead's deliverable and workstream, handed over by a Power Admin (users:manage) — not only the recipients.
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select public.start_deactivation('00000000-0000-0000-0000-00000000c068');
select public.hand_over_item('workstream', 'aaaaaaaa-0000-0000-0000-0000000b2060', '00000000-0000-0000-0000-00000000c060');
insert into r206 select 'tl-deliverable', public.hand_over_item('deliverable', 'aaaaaaaa-0000-0000-0000-0000000d2062', '00000000-0000-0000-0000-00000000c060');
reset role;
select ok((select owner_user_id from workstreams where id = 'aaaaaaaa-0000-0000-0000-0000000b2060') = '00000000-0000-0000-0000-00000000c060'
          and (select owner_user_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d2062') = '00000000-0000-0000-0000-00000000c060'
          and (select (result ->> 'completed')::boolean from r206 where who = 'tl-deliverable'),
  'workstream and deliverable: to the department lead; the team lead''s deactivation completes');

-- ================================================================ ESCALATE ====
-- The writer still holds a task; started leaving 25 hours ago.
set local app.system_op = 'on';
update user_profiles set leaving_since = now() - interval '25 hours' where id = '00000000-0000-0000-0000-00000000c066';
set local app.system_op = 'off';
select ok(exists (select 1 from app.escalation_due(now()) e
                   where e.kind = 'handover' and e.subject_id = '00000000-0000-0000-0000-00000000c066'
                     and (e.extra ->> 'total')::int = 1),
  'escalate: an unfinished hand-over is due after 24 hours, naming what still waits');
select app.run_escalation_sweep(now(), false, 'handover');
select results_eq($$ select user_id from notifications
                     where type = 'escalated' and detail ->> 'kind' = 'handover'
                       and entity_id = '00000000-0000-0000-0000-00000000c066' order by user_id $$,
  $$ values ('00000000-0000-0000-0000-00000000a001'::uuid), ('00000000-0000-0000-0000-00000000a002'::uuid) $$,
  'escalate: to the Traffic Manager and the Power Admins');

-- ================================================================ GUARD ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000c066'),true);
select throws_ok($$ update user_profiles set leaving_since = null where id = '00000000-0000-0000-0000-00000000c066' $$,
  '42501', null, 'guard: a leaving person cannot clear it on themselves');
reset role;
select set_config('request.jwt.claims', '', true);
select lives_ok($$ update user_profiles set leaving_since = null, leaving_started_by = null
                    where id = '00000000-0000-0000-0000-00000000c066' $$,
  'guard: the service role (update-user reactivating them) may');

select * from finish();
rollback;
