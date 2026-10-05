-- ADR-0103 (25 Sep) / I58.2–I58.6 — finished work can be re-opened.
--
-- A CLOSED campaign holding an APPROVED Creative deliverable, owned by Creative's lead, with two
-- approved tasks (the maker did them; Creative's team lead reviewed) and one called off. Then:
--
--   * d.1 WHO   — the owner's department lead and team lead, the account manager: yes; another
--                 department's lead and a team member: no — for the deliverable and the campaign.
--   * d.3 FENCE — the bare approved → in_progress move is refused; the RPC is the door.
--   * d.2 WORDS — no reason, no task, a past date, a called-off task: each refused in words.
--   * d.2–d.4 WHAT MOVES — one task picked: it is To do with the same people, its approval and
--                 its reviewer's answer cleared, the new date its commitment; the other task stays
--                 approved; the container is in progress; the closed campaign is open again.
--   * d.2 TOLD  — the maker and the reviewer, each once, with the reason; never the one who did it.
begin;
select plan(24);
\ir helpers/seed.sql

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de1570', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 157'),
  ('aaaaaaaa-0000-0000-0000-000000de1571', 'aaaaaaaa-0000-0000-0000-000000000001', 'Content 157');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000007e157', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000de1570', 'Design 157');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a170', 'am157@a.test'),
  ('00000000-0000-0000-0000-00000000a171', 'creativelead157@a.test'),
  ('00000000-0000-0000-0000-00000000a172', 'designlead157@a.test'),
  ('00000000-0000-0000-0000-00000000a173', 'contentlead157@a.test'),
  ('00000000-0000-0000-0000-00000000a174', 'maker157@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid, v.team::uuid
from (values
  ('00000000-0000-0000-0000-00000000a170','AM 157',            'account_manager', null, null),
  ('00000000-0000-0000-0000-00000000a171','Creative lead 157', 'department_lead','aaaaaaaa-0000-0000-0000-000000de1570', null),
  ('00000000-0000-0000-0000-00000000a172','Design lead 157',   'team_lead',      'aaaaaaaa-0000-0000-0000-000000de1570', 'aaaaaaaa-0000-0000-0000-00000007e157'),
  ('00000000-0000-0000-0000-00000000a173','Content lead 157',  'department_lead','aaaaaaaa-0000-0000-0000-000000de1571', null),
  ('00000000-0000-0000-0000-00000000a174','Maker 157',         'team_member',    'aaaaaaaa-0000-0000-0000-000000de1570', 'aaaaaaaa-0000-0000-0000-00000007e157')
) as v(id, name, role_key, dept, team);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id in ('00000000-0000-0000-0000-00000000a170','00000000-0000-0000-0000-00000000a171',
                 '00000000-0000-0000-0000-00000000a172','00000000-0000-0000-0000-00000000a173',
                 '00000000-0000-0000-0000-00000000a174');

insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-000000001570','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Season 157','approved','campaign','00000000-0000-0000-0000-00000000a170');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f157','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001570','Season 157');
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d1570','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f157',
   'Banner 157','in_progress', now() + interval '20 days', '00000000-0000-0000-0000-00000000a171');
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-000000001570');

-- Two approved tasks and one called off — written as the system, which is how they got there.
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order, department_id, team_id,
                       assignee_id, due_at, approved_at, approved_by, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000a1571','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1570',
   'Artwork 157','done',1,'aaaaaaaa-0000-0000-0000-000000de1570','aaaaaaaa-0000-0000-0000-00000007e157',
   '00000000-0000-0000-0000-00000000a174', now() - interval '2 days', now() - interval '1 day', '00000000-0000-0000-0000-00000000a172', 8),
  ('aaaaaaaa-0000-0000-0000-0000000a1572','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1570',
   'Resize 157','done',2,'aaaaaaaa-0000-0000-0000-000000de1570','aaaaaaaa-0000-0000-0000-00000007e157',
   '00000000-0000-0000-0000-00000000a174', now() - interval '2 days', now() - interval '1 day', '00000000-0000-0000-0000-00000000a172', 8),
  ('aaaaaaaa-0000-0000-0000-0000000a1573','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1570',
   'Animate 157','cancelled',3,'aaaaaaaa-0000-0000-0000-000000de1570','aaaaaaaa-0000-0000-0000-00000007e157',
   null, null, null, null, null);
insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory, approved_at, responded_at)
select 'aaaaaaaa-0000-0000-0000-000000000001', t, '00000000-0000-0000-0000-00000000a172', true, now() - interval '1 day', now() - interval '1 day'
  from unnest(array['aaaaaaaa-0000-0000-0000-0000000a1571','aaaaaaaa-0000-0000-0000-0000000a1572']::uuid[]) t;
set local app.system_op = 'on';
update deliverables set state = 'approved' where id = 'aaaaaaaa-0000-0000-0000-0000000d1570';
update campaigns set status = 'closed', closed_at = now() where id = 'aaaaaaaa-0000-0000-0000-000000001570';
set local app.system_op = 'off';

-- ============================================================ d.1 WHO ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a171'),true);
select ok(app.may_reopen('aaaaaaaa-0000-0000-0000-0000000d1570'), 'the owner''s department lead may re-open (d.1)');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a172'),true);
select ok(app.may_reopen('aaaaaaaa-0000-0000-0000-0000000d1570'), 'a team lead of a team in the owner''s department may re-open (d.1)');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a170'),true);
select ok(app.may_reopen('aaaaaaaa-0000-0000-0000-0000000d1570'), 'the campaign''s account manager may re-open (d.1)');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a173'),true);
select ok(not app.may_reopen('aaaaaaaa-0000-0000-0000-0000000d1570'), 'another department''s lead may not (d.1)');
select throws_ok($$ select public.reopen_deliverable('aaaaaaaa-0000-0000-0000-0000000d1570',
                      array['aaaaaaaa-0000-0000-0000-0000000a1571']::uuid[], 'client change', now() + interval '5 days') $$,
  '42501', null, 'and is refused by the door itself, in words');
select throws_ok($$ select public.reopen_campaign('aaaaaaaa-0000-0000-0000-000000001570') $$,
  '42501', null, 'another department''s lead may not re-open the campaign either (no work of theirs on it)');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a174'),true);
select ok(not app.may_reopen('aaaaaaaa-0000-0000-0000-0000000d1570'), 'a team member may not — even the one who did the work (d.1)');
select throws_ok($$ select public.reopen_task('aaaaaaaa-0000-0000-0000-0000000a1571', 'redo', now() + interval '5 days') $$,
  '42501', null, 'and the task''s own door refuses them too');

-- ============================================================ d.3 FENCE ====
-- As the lead, with the claim set but the table owner's rights, so the trigger and not RLS answers.
reset role;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a171'),true);
select throws_ok($$ update deliverables set state = 'in_progress' where id = 'aaaaaaaa-0000-0000-0000-0000000d1570' $$,
  '42501', 'a finished deliverable is re-opened by choosing which of its tasks need doing again',
  'the bare approved → in_progress move is fenced off — nothing re-opens without a task (d.3)');

-- ============================================================ d.2 WORDS ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a171'),true);
select throws_ok($$ select public.reopen_deliverable('aaaaaaaa-0000-0000-0000-0000000d1570',
                      array['aaaaaaaa-0000-0000-0000-0000000a1571']::uuid[], '  ', now() + interval '5 days') $$,
  '22023', null, 'no reason: refused (d.2)');
select throws_ok($$ select public.reopen_deliverable('aaaaaaaa-0000-0000-0000-0000000d1570',
                      array[]::uuid[], 'client change', now() + interval '5 days') $$,
  '22023', 'choose at least one task to do again', 'no task picked: refused (d.3)');
select throws_ok($$ select public.reopen_deliverable('aaaaaaaa-0000-0000-0000-0000000d1570',
                      array['aaaaaaaa-0000-0000-0000-0000000a1571']::uuid[], 'client change', now() - interval '1 day') $$,
  '22023', 'the new due date is in the past', 'a past date: refused (d.2)');
select throws_ok($$ select public.reopen_task('aaaaaaaa-0000-0000-0000-0000000a1573', 'client change', now() + interval '5 days') $$,
  '22023', null, 'a called-off task does not re-open (d.2)');

-- ============================================================ WHAT MOVES ====
select lives_ok($$ select public.reopen_deliverable('aaaaaaaa-0000-0000-0000-0000000d1570',
                     array['aaaaaaaa-0000-0000-0000-0000000a1571']::uuid[], 'The client changed the headline.',
                     date_trunc('day', now()) + interval '6 days 12 hours') $$,
  'the owner''s lead re-opens the banner by its Artwork task');
reset role;

select is((select state::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1570'), 'in_progress',
  'the container is in progress again (d.3)');
select is((select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a1571'), 'todo',
  'the picked task is To do (d.2)');
select is((select assignee_id from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a1571'),
  '00000000-0000-0000-0000-00000000a174'::uuid,
  'with its maker on it — ADR-0142 d.2 (3 Oct) reverses ADR-0121: a re-open goes back to the person who made it');
select ok((select approved_at is null and approved_by is null from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a1571'),
  'its approval is cleared (d.2)');
select ok((select approved_at is null and responded_at is null from sub_task_reviewers
            where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1571'),
  'and its reviewer — the same one — answers again (d.2)');
select ok((select committed_due_at = app.commitment_instant(due_at) and due_at is not null from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a1571'),
  'it carries the new due date, and a fresh commitment to it (ADR-0142 d.2)');
select is((select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a1572'), 'done',
  'the task NOT picked stays approved (d.3)');
select is((select status from campaigns where id = 'aaaaaaaa-0000-0000-0000-000000001570'), 'approved',
  'the closed campaign re-opened with its work (d.4)');

-- ============================================================ TOLD ====
select results_eq($$
  select user_id, (detail->>'reason') from notifications
   where type = 'task_reopened' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000a1571' order by user_id
$$, $$ values
  ('00000000-0000-0000-0000-00000000a172'::uuid, 'The client changed the headline.'),
  ('00000000-0000-0000-0000-00000000a174'::uuid, 'The client changed the headline.')
$$, 'the reviewer and the maker are told, once each, with the reason (ADR-0142 d.2)');
select is((select count(*)::int from notifications
            where entity_id = 'aaaaaaaa-0000-0000-0000-0000000d1570' and type = 'deliverable_reopened'), 0,
  'the owner re-opened it themself, so is not told (d.2)');

select * from finish();
rollback;
