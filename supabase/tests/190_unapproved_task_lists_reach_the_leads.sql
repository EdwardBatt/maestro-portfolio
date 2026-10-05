-- 20260927200000 (ADR-0119, I59.61) — a task list waiting for approval reaches the department's leads, and
-- no campaign is exempt from the task-list gate any more.
--
-- People (tenant A): a901 Creative's department lead; a902 a Design team lead (Creative), the OWNER;
-- a904 a Motion team lead (also Creative); a903 a Copy team lead (Content); a905 a Creative team member.
-- Team leads hold deliverable_owner:manage, as production grants it on the Permissions page.
-- Work: "Old piece" on a campaign approved BEFORE the task-list gate, "New piece" on one approved after.
begin;
select plan(12);
\ir helpers/seed.sql
select app.seed_tenant_escalation_rules(id) from tenants;

insert into role_grants (tenant_id, role_id, resource, action)
select r.tenant_id, r.id, 'deliverable_owner', 'manage' from roles r where r.key = 'team_lead'
on conflict do nothing;

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000de901', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 190'),
  ('aaaaaaaa-0000-0000-0000-0000000de902', 'aaaaaaaa-0000-0000-0000-000000000001', 'Content 190');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000fe901', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000de901', 'Design'),
  ('aaaaaaaa-0000-0000-0000-0000000fe902', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000de902', 'Copy'),
  ('aaaaaaaa-0000-0000-0000-0000000fe903', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000de901', 'Motion');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a901', 'lead-190@a.test'),
  ('00000000-0000-0000-0000-00000000a902', 'design-tl-190@a.test'),
  ('00000000-0000-0000-0000-00000000a903', 'copy-tl-190@a.test'),
  ('00000000-0000-0000-0000-00000000a904', 'motion-tl-190@a.test'),
  ('00000000-0000-0000-0000-00000000a905', 'member-190@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid, v.team::uuid
from (values
  ('00000000-0000-0000-0000-00000000a901', 'Lead 190',      'department_lead', 'aaaaaaaa-0000-0000-0000-0000000de901', null),
  ('00000000-0000-0000-0000-00000000a902', 'Design TL 190', 'team_lead',       'aaaaaaaa-0000-0000-0000-0000000de901', 'aaaaaaaa-0000-0000-0000-0000000fe901'),
  ('00000000-0000-0000-0000-00000000a903', 'Copy TL 190',   'team_lead',       'aaaaaaaa-0000-0000-0000-0000000de902', 'aaaaaaaa-0000-0000-0000-0000000fe902'),
  ('00000000-0000-0000-0000-00000000a904', 'Motion TL 190', 'team_lead',       'aaaaaaaa-0000-0000-0000-0000000de901', 'aaaaaaaa-0000-0000-0000-0000000fe903'),
  ('00000000-0000-0000-0000-00000000a905', 'Member 190',    'team_member',     'aaaaaaaa-0000-0000-0000-0000000de901', 'aaaaaaaa-0000-0000-0000-0000000fe901')
) as v(id, name, role_key, dept, team);
insert into test_claims
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id::text like '00000000-0000-0000-0000-00000000a90%';

-- Both dates are pinned: the gate a day ago (a fresh database stamps it at migration time, seconds before
-- this runs), and the backlog clock "at this release", now.
update app_settings set value = (now() - interval '1 day')::text where key = 'task_list_gate_from';
update app_settings set value = now()::text where key = 'task_list_backlog_from';

insert into campaigns (id, tenant_id, client_id, name, status, kind, approved_at) values
  ('aaaaaaaa-0000-0000-0000-0000000ee901', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'Old campaign 190', 'approved', 'campaign',
   (select value::timestamptz from app_settings where key = 'task_list_gate_from') - interval '10 days'),
  ('aaaaaaaa-0000-0000-0000-0000000ee902', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'New campaign 190', 'approved', 'campaign', now() - interval '2 hours');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000cc901', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000ee901', 'Main'),
  ('aaaaaaaa-0000-0000-0000-0000000cc902', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000ee902', 'Main');
insert into deliverables (id, tenant_id, stream_id, name, owner_user_id, reviewer_id, department_id, due_at) values
  ('aaaaaaaa-0000-0000-0000-0000000dd901', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000cc901',
   'Old piece 190', '00000000-0000-0000-0000-00000000a902', '00000000-0000-0000-0000-00000000a001',
   'aaaaaaaa-0000-0000-0000-0000000de901', now() + interval '10 days'),
  ('aaaaaaaa-0000-0000-0000-0000000dd902', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000cc902',
   'New piece 190', '00000000-0000-0000-0000-00000000a902', '00000000-0000-0000-0000-00000000a001',
   'aaaaaaaa-0000-0000-0000-0000000de901', now() + interval '10 days');
-- I66.3: a list to approve has a task on it; a piece with none asks for tasks instead (test 195).
insert into sub_tasks (tenant_id, deliverable_id, title, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000dd901', 'Design', 'todo'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000dd902', 'Design', 'todo');

-- ---------------------------------------------------------------- d.1: no campaign is exempt ----
select isnt(app.deliverable_work_acceptance_refusal('aaaaaaaa-0000-0000-0000-0000000dd901'), null,
  'work on a campaign approved before the gate waits for its task list like any other (d.1)');

-- ---------------------------------------------------------------- d.3: the clocks ----
select is(app.task_list_waiting_since('campaign',
            (select approved_at from campaigns where id = 'aaaaaaaa-0000-0000-0000-0000000ee901')),
          (select value::timestamptz from app_settings where key = 'task_list_backlog_from'),
  'an older list waits from this release, not from its campaign''s approval (d.3)');
select is(app.task_list_waiting_since('campaign',
            (select approved_at from campaigns where id = 'aaaaaaaa-0000-0000-0000-0000000ee902')),
          (select approved_at from campaigns where id = 'aaaaaaaa-0000-0000-0000-0000000ee902'),
  'a newer one waits from its campaign''s approval, as before');
select is_empty($$
  select 1 from app.escalation_due(now()) where kind = 'task_list' and subject_id = 'aaaaaaaa-0000-0000-0000-0000000dd901'
$$, 'so the older list does not escalate on release day');
select isnt_empty($$
  select 1 from app.escalation_due(now() + interval '25 hours') where kind = 'task_list' and subject_id = 'aaaaaaaa-0000-0000-0000-0000000dd901'
$$, 'but does once it has waited a day past release (d.3)');

-- ---------------------------------------------------------------- d.2: who is shown it ----
set local role authenticated;

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a902'), true);
select results_eq($$
  select target_id from public.my_pending_approvals() where kind = 'task_list' order by title
$$, $$ values ('aaaaaaaa-0000-0000-0000-0000000dd902'::uuid), ('aaaaaaaa-0000-0000-0000-0000000dd901'::uuid) $$,
  'the owner is shown both lists, the older one included (d.1)');

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a901'), true);
select results_eq($$
  select target_id from public.my_pending_approvals() where kind = 'task_list' order by title
$$, $$ values ('aaaaaaaa-0000-0000-0000-0000000dd902'::uuid), ('aaaaaaaa-0000-0000-0000-0000000dd901'::uuid) $$,
  'the department lead, who does not own them, is shown both (d.2)');

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a904'), true);
select results_eq($$
  select target_id from public.my_pending_approvals() where kind = 'task_list' order by title
$$, $$ values ('aaaaaaaa-0000-0000-0000-0000000dd902'::uuid), ('aaaaaaaa-0000-0000-0000-0000000dd901'::uuid) $$,
  'so is a team lead of another team in the same department (d.2)');
select is((select since from public.my_pending_approvals() where target_id = 'aaaaaaaa-0000-0000-0000-0000000dd901'),
          (select value::timestamptz from app_settings where key = 'task_list_backlog_from'),
  'and the card''s clock is the escalation''s: the older list waits from this release');

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a903'), true);
select is_empty($$ select 1 from public.my_pending_approvals() where kind = 'task_list' $$,
  'a team lead in another department is not');

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a905'), true);
select is_empty($$ select 1 from public.my_pending_approvals() where kind = 'task_list' $$,
  'nor a team member');

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a904'), true);
select lives_ok($$ select public.approve_deliverable_tasks('aaaaaaaa-0000-0000-0000-0000000dd901') $$,
  'and the team lead shown it can approve it');

select * from finish();
rollback;
