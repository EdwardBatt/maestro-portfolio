-- I59.24 / ADR-0108 d.3 — an escalation goes to the rule's roles plus the people relative to the
-- piece; each relative resolves as ADR-0108 says; the roles stand in when a relative is nobody.
--
-- The cast (Tenant A):
--   a002  Booker A — Traffic Manager (scheduler)
--   a171  AM 171 — the campaign's account manager
--   a172  Dept lead 171 — scope 'department', Creative 171
--   a173  Former dept lead 171 — scope 'department', Creative 171, DEACTIVATED
--   a174  Team lead 171 — scope 'team', team Studio 171 — also the piece's OWNER
--   a175  Deputy 171 — scope 'team', team Studio 171
--   a176  Maker 171 — team member, team Studio 171 — the task's assignee
--   a001  Admin A — reviewer, not yet answered;  a177  Other lead 171 — reviewer, answered
--   a178  Lone lead 171 — scope 'department' in Empty 171, a department with no other lead
begin;
select plan(14);
\ir helpers/seed.sql
select app.seed_tenant_escalation_rules(id) from tenants;

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de1710', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 171'),
  ('aaaaaaaa-0000-0000-0000-000000de1711', 'aaaaaaaa-0000-0000-0000-000000000001', 'Empty 171');
insert into teams (id, tenant_id, name, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000e1710', 'aaaaaaaa-0000-0000-0000-000000000001', 'Studio 171', 'aaaaaaaa-0000-0000-0000-000000de1710');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a171', 'am171@a.test'),
  ('00000000-0000-0000-0000-00000000a172', 'dl171@a.test'),
  ('00000000-0000-0000-0000-00000000a173', 'olddl171@a.test'),
  ('00000000-0000-0000-0000-00000000a174', 'tl171@a.test'),
  ('00000000-0000-0000-0000-00000000a175', 'dep171@a.test'),
  ('00000000-0000-0000-0000-00000000a176', 'maker171@a.test'),
  ('00000000-0000-0000-0000-00000000a177', 'other171@a.test'),
  ('00000000-0000-0000-0000-00000000a178', 'lone171@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id, is_active)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid, v.team::uuid, v.active
from (values
  ('00000000-0000-0000-0000-00000000a171', 'AM 171',              'account_manager',  null,                                   null,                                   true),
  ('00000000-0000-0000-0000-00000000a172', 'Dept lead 171',       'department_lead',  'aaaaaaaa-0000-0000-0000-000000de1710', null,                                   true),
  ('00000000-0000-0000-0000-00000000a173', 'Former dept lead 171','department_lead',  'aaaaaaaa-0000-0000-0000-000000de1710', null,                                   false),
  ('00000000-0000-0000-0000-00000000a174', 'Team lead 171',       'team_lead',        'aaaaaaaa-0000-0000-0000-000000de1710', 'aaaaaaaa-0000-0000-0000-0000000e1710', true),
  ('00000000-0000-0000-0000-00000000a175', 'Deputy 171',          'deputy_team_lead', 'aaaaaaaa-0000-0000-0000-000000de1710', 'aaaaaaaa-0000-0000-0000-0000000e1710', true),
  ('00000000-0000-0000-0000-00000000a176', 'Maker 171',           'team_member',      'aaaaaaaa-0000-0000-0000-000000de1710', 'aaaaaaaa-0000-0000-0000-0000000e1710', true),
  ('00000000-0000-0000-0000-00000000a177', 'Other lead 171',      'department_lead',  'aaaaaaaa-0000-0000-0000-0000000de0ff', null,                                   true),
  ('00000000-0000-0000-0000-00000000a178', 'Lone lead 171',       'team_lead',        'aaaaaaaa-0000-0000-0000-000000de1711', null,                                   true)
) as v(id, name, role_key, dept, team, active);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id = '00000000-0000-0000-0000-00000000a176';

insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id, approved_at) values
  ('aaaaaaaa-0000-0000-0000-00000000c171', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'Season 171', 'approved', 'campaign', '00000000-0000-0000-0000-00000000a171', now());
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000c171', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c171', 'Season 171');
insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id, department_id) values
  ('aaaaaaaa-0000-0000-0000-00000000d171', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c171',
   'Poster 171', 'in_progress', '00000000-0000-0000-0000-00000000a174', 'aaaaaaaa-0000-0000-0000-000000de1710'),
  -- owned by the lone lead of a department with nobody else scoped to it
  ('aaaaaaaa-0000-0000-0000-00000000d172', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c171',
   'Flyer 171', 'in_progress', '00000000-0000-0000-0000-00000000a178', 'aaaaaaaa-0000-0000-0000-000000de1711');
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order, assignee_id, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-00000000f171', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d171',
   'Design 171', 'review', 1, '00000000-0000-0000-0000-00000000a176', 8);
delete from sub_task_reviewers where sub_task_id = 'aaaaaaaa-0000-0000-0000-00000000f171';
insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f171', '00000000-0000-0000-0000-00000000a001', true),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f171', '00000000-0000-0000-0000-00000000a177', false);
select set_config('app.reviewer_verdict', 'on', true);
update sub_task_reviewers set responded_at = now(), response = 'no_comment'
 where sub_task_id = 'aaaaaaaa-0000-0000-0000-00000000f171' and user_id = '00000000-0000-0000-0000-00000000a177';
select set_config('app.reviewer_verdict', '', true);

create temp table got as select null::uuid as user_id, null::text[] as reasons limit 0;

-- ---------------------------------------------------------------- the defaults ----
select results_eq($$
  select user_id, reasons from app.escalation_recipients('unassigned', 'aaaaaaaa-0000-0000-0000-00000000d171', null) order by user_id
$$, $$ values ('00000000-0000-0000-0000-00000000a002'::uuid, array['role']),
              ('00000000-0000-0000-0000-00000000a174'::uuid, array['owner']) $$,
  'nobody assigned: the Traffic Manager (by role) and the owner');

select results_eq($$
  select user_id, reasons from app.escalation_recipients('task_list', 'aaaaaaaa-0000-0000-0000-00000000d171', null) order by user_id
$$, $$ values ('00000000-0000-0000-0000-00000000a002'::uuid, array['role']),
              ('00000000-0000-0000-0000-00000000a171'::uuid, array['account_manager']) $$,
  'a task list not approved: the Traffic Manager and the campaign''s account manager');

select results_eq($$
  select user_id, reasons from app.escalation_recipients('change_request', 'aaaaaaaa-0000-0000-0000-00000000d171', null) order by user_id
$$, $$ values ('00000000-0000-0000-0000-00000000a171'::uuid, array['account_manager']),
              ('00000000-0000-0000-0000-00000000a172'::uuid, array['owner_department_lead']) $$,
  'owner_department_lead: the ACTIVE scope-department user of the owner''s department — the deactivated one is not told');

select results_eq($$
  select user_id, reasons from app.escalation_recipients('review_remind', null, 'aaaaaaaa-0000-0000-0000-00000000f171') order by user_id
$$, $$ values ('00000000-0000-0000-0000-00000000a001'::uuid, array['reviewers']) $$,
  'reviewers: only the reviewer who has not answered this round (the deliverable is found from the task)');

select results_eq($$
  select user_id, reasons from app.escalation_recipients('review_escalate', null, 'aaaaaaaa-0000-0000-0000-00000000f171') order by user_id
$$, $$ values ('00000000-0000-0000-0000-00000000a171'::uuid, array['account_manager']),
              ('00000000-0000-0000-0000-00000000a174'::uuid, array['owner']) $$,
  'a review escalation: the account manager and the owner');

-- ---------------------------------------------------------------- the assignee's team lead ----
update tenant_escalation_rules set relative = array['assignee_team_lead']
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'blocked';
select results_eq($$
  select user_id, reasons from app.escalation_recipients('blocked', null, 'aaaaaaaa-0000-0000-0000-00000000f171') order by user_id
$$, $$ values ('00000000-0000-0000-0000-00000000a174'::uuid, array['assignee_team_lead']),
              ('00000000-0000-0000-0000-00000000a175'::uuid, array['assignee_team_lead']) $$,
  'assignee_team_lead: the team lead AND the deputy of the assignee''s team (both scope team)');
select is_empty($$
  select 1 from app.escalation_recipients('blocked', 'aaaaaaaa-0000-0000-0000-00000000d171', null)
$$, 'with no task, there is no assignee and so no team lead');

-- ---------------------------------------------------------------- one person, two reasons ----
update tenant_escalation_rules set relative = array['owner', 'assignee_team_lead']
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'blocked';
select results_eq($$
  select user_id, reasons from app.escalation_recipients('blocked', null, 'aaaaaaaa-0000-0000-0000-00000000f171') order by user_id
$$, $$ values ('00000000-0000-0000-0000-00000000a174'::uuid, array['assignee_team_lead', 'owner']),
              ('00000000-0000-0000-0000-00000000a175'::uuid, array['assignee_team_lead']) $$,
  'a person reached two ways is told once, with both reasons');

-- ---------------------------------------------------------------- the fallback ----
select is_empty($$
  select 1 from app.escalation_recipients('extension_owner', 'aaaaaaaa-0000-0000-0000-00000000d172', null)
$$, 'the owner''s department has no other lead and the rule names no role: nobody (the sweep then waits)');
update tenant_escalation_rules
   set role_ids = array[(select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'scheduler')]
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'extension_owner';
select results_eq($$
  select user_id, reasons from app.escalation_recipients('extension_owner', 'aaaaaaaa-0000-0000-0000-00000000d172', null)
$$, $$ values ('00000000-0000-0000-0000-00000000a002'::uuid, array['role']) $$,
  'the relative resolves to nobody: the rule''s role recipients stand in (ADR-0108 Consequences)');
select results_eq($$
  select user_id, reasons from app.escalation_recipients('extension_owner', 'aaaaaaaa-0000-0000-0000-00000000d171', null) order by user_id
$$, $$ values ('00000000-0000-0000-0000-00000000a002'::uuid, array['role']),
              ('00000000-0000-0000-0000-00000000a172'::uuid, array['owner_department_lead']) $$,
  'and where the relative does resolve, both are told');

-- ---------------------------------------------------------------- tenant walls ----
update tenant_escalation_rules
   set role_ids = array[(select id from roles where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000001' and key = 'scheduler')]
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'unassigned';
select results_eq($$
  select user_id from app.escalation_recipients('unassigned', 'aaaaaaaa-0000-0000-0000-00000000d171', null)
$$, $$ values ('00000000-0000-0000-0000-00000000a174'::uuid) $$,
  'a role id from another tenant reaches nobody there — only the owner is told');

delete from tenant_escalation_rules where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'task_list';
select is_empty($$
  select 1 from app.escalation_recipients('task_list', 'aaaaaaaa-0000-0000-0000-00000000d171', null)
$$, 'no rule for the kind: nobody');

-- ---------------------------------------------------------------- not for callers ----
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a176'), true);
select throws_ok($$
  select * from app.escalation_recipients('unassigned', 'aaaaaaaa-0000-0000-0000-00000000d171', null)
$$, '42501', null, 'a signed-in user cannot call the resolver (service role only)');
reset role;

select * from finish();
rollback;
