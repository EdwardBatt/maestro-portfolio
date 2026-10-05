-- I67.10 (ADR-0119 addendum, 1 Oct): approving a task list removes, for every recipient, the bell notices that asked
-- for it.
--
--   ASKS      — on the approved deliverable: the task_list escalation, the owner's "added" / "reassigned" / "type
--               changed" asks and a single job's approval notice go (d.1); the all-cancelled escalation, another
--               rung's escalation, a non-owner's "added" line and `deliverable_edited` stay (d.3).
--   CAMPAIGN  — the owner's campaign-level `campaign_approved` stays while another piece of theirs still waits, and goes
--               with the last (d.2); a recipient who owns nothing keeps theirs.
--   RLS       — the owner approving deletes notices addressed to OTHER people, which RLS alone would refuse (d.5); a
--               client may not call the trigger function.
begin;
select plan(8);
\ir helpers/seed.sql

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de2080', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 208');
insert into auth.users (id, email)
select v.id::uuid, v.email from (values
  ('00000000-0000-0000-0000-00000000c080','owner208@a.test'),
  ('00000000-0000-0000-0000-00000000c081','traffic208@a.test'),
  ('00000000-0000-0000-0000-00000000c082','am208@a.test')) v(id, email);
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       'aaaaaaaa-0000-0000-0000-000000de2080'
from (values
  ('00000000-0000-0000-0000-00000000c080','Owner 208',   'department_lead'),
  ('00000000-0000-0000-0000-00000000c081','Traffic 208', 'team_member'),
  ('00000000-0000-0000-0000-00000000c082','AM 208',      'team_member')
) as v(id, name, role_key);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id::text like '00000000-0000-0000-0000-00000000c08%';

insert into campaigns (id, tenant_id, client_id, name, status, kind) values
  ('aaaaaaaa-0000-0000-0000-00000000208b', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'W 208', 'approved', 'campaign');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f208', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000208b', 'S208');
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d2081', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f208',
   'Poster 208', 'in_progress', now() + interval '20 days', '00000000-0000-0000-0000-00000000c080',
   'aaaaaaaa-0000-0000-0000-000000de2080'),
  ('aaaaaaaa-0000-0000-0000-0000000d2082', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f208',
   'Reel 208', 'in_progress', now() + interval '20 days', '00000000-0000-0000-0000-00000000c080',
   'aaaaaaaa-0000-0000-0000-000000de2080');

-- Each piece has a live task, so it has a list to approve (I66.3). The notices are written as their emitters left
-- them; the triggers are paused so the fixture sends no mail and no broadcast.
set local app.system_op = 'on';
set local session_replication_role = replica;
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order, sla_hours, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000a2081', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d2081',
   'Design 208', 'todo', 1, 4, 'aaaaaaaa-0000-0000-0000-000000de2080'),
  ('aaaaaaaa-0000-0000-0000-0000000a2082', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d2082',
   'Edit 208', 'todo', 1, 4, 'aaaaaaaa-0000-0000-0000-000000de2080');

insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, detail)
select 'aaaaaaaa-0000-0000-0000-000000000001', v.u::uuid, v.t, v.l, v.et, v.e::uuid, v.d::jsonb
  from (values
    -- on Poster (D1)
    ('00000000-0000-0000-0000-00000000c081', 'escalated',               'n1 escalated list',       'deliverable', 'aaaaaaaa-0000-0000-0000-0000000d2081', '{"kind":"task_list"}'),
    ('00000000-0000-0000-0000-00000000c081', 'escalated',               'n2 escalated cancelled',  'deliverable', 'aaaaaaaa-0000-0000-0000-0000000d2081', '{"kind":"task_list","all_cancelled":true}'),
    ('00000000-0000-0000-0000-00000000c081', 'escalated',               'n3 escalated unassigned', 'deliverable', 'aaaaaaaa-0000-0000-0000-0000000d2081', '{"kind":"unassigned"}'),
    ('00000000-0000-0000-0000-00000000c080', 'deliverable_added',       'n4 added owner',          'deliverable', 'aaaaaaaa-0000-0000-0000-0000000d2081', '{"for_owner":true}'),
    ('00000000-0000-0000-0000-00000000c082', 'deliverable_added',       'n5 added other',          'deliverable', 'aaaaaaaa-0000-0000-0000-0000000d2081', '{}'),
    ('00000000-0000-0000-0000-00000000c080', 'deliverable_reassigned',  'n6 reassigned',           'deliverable', 'aaaaaaaa-0000-0000-0000-0000000d2081', '{"tasks_approved":false}'),
    ('00000000-0000-0000-0000-00000000c080', 'deliverable_type_changed','n7 type changed',         'deliverable', 'aaaaaaaa-0000-0000-0000-0000000d2081', '{}'),
    ('00000000-0000-0000-0000-00000000c080', 'deliverable_edited',      'n8 edited',               'deliverable', 'aaaaaaaa-0000-0000-0000-0000000d2081', '{"added":1}'),
    -- on the campaign
    ('00000000-0000-0000-0000-00000000c080', 'campaign_approved',       'n9 campaign owner',       'campaign',    'aaaaaaaa-0000-0000-0000-00000000208b', '{}'),
    ('00000000-0000-0000-0000-00000000c082', 'campaign_approved',       'n10 campaign other',      'campaign',    'aaaaaaaa-0000-0000-0000-00000000208b', '{}'),
    -- on Reel (D2)
    ('00000000-0000-0000-0000-00000000c081', 'escalated',               'n11 escalated reel',      'deliverable', 'aaaaaaaa-0000-0000-0000-0000000d2082', '{"kind":"task_list"}')
  ) v(u, t, l, et, e, d);
set local session_replication_role = origin;
set local app.system_op = 'off';

create temp view left208 as
  select label from notifications where label like 'n%' and tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and user_id::text like '00000000-0000-0000-0000-00000000c08%';

-- ================================================================ ASKS ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000c080'),true);
select lives_ok($$ select public.approve_deliverable_tasks('aaaaaaaa-0000-0000-0000-0000000d2081') $$,
  'the owner approves Poster''s task list');
reset role;

select set_eq($$ select label from left208 $$,
  array['n2 escalated cancelled', 'n3 escalated unassigned', 'n5 added other', 'n8 edited',
        'n9 campaign owner', 'n10 campaign other', 'n11 escalated reel'],
  'asks: the list''s escalation and the owner''s asks on Poster are gone, for Traffic too; the rest stay');

-- ============================================================ CAMPAIGN ====
select ok(exists (select 1 from left208 where label = 'n9 campaign owner'),
  'campaign: the owner''s campaign notice stays while Reel still waits');

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000c080'),true);
select lives_ok($$ select public.approve_deliverable_tasks('aaaaaaaa-0000-0000-0000-0000000d2082') $$,
  'the owner approves Reel''s task list');
reset role;

select set_eq($$ select label from left208 $$,
  array['n2 escalated cancelled', 'n3 escalated unassigned', 'n5 added other', 'n8 edited', 'n10 campaign other'],
  'campaign: with Reel approved the owner''s campaign notice and Reel''s escalation go; a non-owner keeps theirs');

-- ================================================================= RLS ====
select ok(not has_function_privilege('authenticated', 'app.tg_deliverable_clears_task_list_asks()', 'execute'),
  'rls: a client may not call the trigger function');

-- A list approved a second time (idempotent) deletes nothing more.
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000c080'),true);
select lives_ok($$ select public.approve_deliverable_tasks('aaaaaaaa-0000-0000-0000-0000000d2082') $$,
  'a second approval is accepted');
reset role;
select is((select count(*)::int from left208), 5, 'a second approval removes nothing more');

select * from finish();
rollback;
