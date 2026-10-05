-- ADR-0102 (24 Sep) / I57.18 — a deliverable's department follows its owner.
--
-- Edward: "We need to assign to people, not departments… The dept should be based on the assigned
-- owner." Each rule, with work that would read differently under the old one (ADR-0099 d.3):
--
--   * d.1 CREATION — the owner's department, even when the insert names another.
--   * d.1 OWNER CHANGE — a new owner moves the deliverable to their department.
--   * d.4 TASKS — the UNASSIGNED task follows the deliverable; the ASSIGNED one keeps its assignee's.
--   * d.3 NO DEPARTMENT — an owner with none leaves the deliverable where it was.
--   * d.2 WORKSTREAMS — joining a group of another department changes nothing; changing a group's
--     department moves none of its work.
--   * d.1 NOT CHOSEN — a write naming another department is put back to the owner's.
--
-- The one-off re-stamp of live work (d.5) runs inside the migration, before any fixture exists, so it
-- is proved by the migration's own output, not here.
begin;
select plan(10);
\ir helpers/seed.sql

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de1560', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 156'),
  ('aaaaaaaa-0000-0000-0000-000000de1561', 'aaaaaaaa-0000-0000-0000-000000000001', 'Content 156'),
  ('aaaaaaaa-0000-0000-0000-000000de1562', 'aaaaaaaa-0000-0000-0000-000000000001', 'Production 156');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000007e156', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000de1561', 'Copy 156');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a160', 'am156@a.test'),
  ('00000000-0000-0000-0000-00000000a161', 'creativelead156@a.test'),
  ('00000000-0000-0000-0000-00000000a162', 'contentlead156@a.test'),
  ('00000000-0000-0000-0000-00000000a163', 'contentmaker156@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid, v.team::uuid
from (values
  ('00000000-0000-0000-0000-00000000a160','AM 156',            'account_manager', null, null),
  ('00000000-0000-0000-0000-00000000a161','Creative lead 156', 'department_lead','aaaaaaaa-0000-0000-0000-000000de1560', null),
  ('00000000-0000-0000-0000-00000000a162','Content lead 156',  'department_lead','aaaaaaaa-0000-0000-0000-000000de1561', null),
  ('00000000-0000-0000-0000-00000000a163','Content maker 156', 'team_member',    'aaaaaaaa-0000-0000-0000-000000de1561', 'aaaaaaaa-0000-0000-0000-00000007e156')
) as v(id, name, role_key, dept, team);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id = '00000000-0000-0000-0000-00000000a160';

insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-000000001560','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Season 156','approved','campaign','00000000-0000-0000-0000-00000000a160');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f156','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001560','Season 156');
insert into workstreams (id, tenant_id, campaign_id, name, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000e5156','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001560',
   'Design 156','aaaaaaaa-0000-0000-0000-000000de1560');

-- ============================================================ d.1 CREATION ====
-- Owned by Content's lead, and the insert NAMES Creative: the owner wins.
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d1560','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f156',
   'posts 156','in_progress', now() + interval '10 days', '00000000-0000-0000-0000-00000000a162',
   'aaaaaaaa-0000-0000-0000-000000de1560');
select is((select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1560'),
  'aaaaaaaa-0000-0000-0000-000000de1561'::uuid,
  'at creation the department is the owner''s, even when the insert names another (d.1)');

-- One task the Content maker has, one nobody has.
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order, department_id, team_id, assignee_id, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000a1561','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1560',
   'Write copy 156','todo',1,'aaaaaaaa-0000-0000-0000-000000de1561','aaaaaaaa-0000-0000-0000-00000007e156','00000000-0000-0000-0000-00000000a163', 8),
  ('aaaaaaaa-0000-0000-0000-0000000a1562','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1560',
   'Write copy 156 b','todo',2,'aaaaaaaa-0000-0000-0000-000000de1561','aaaaaaaa-0000-0000-0000-00000007e156',null, null);

-- ============================================================ d.1 OWNER CHANGE ====
update deliverables set owner_user_id = '00000000-0000-0000-0000-00000000a161'
 where id = 'aaaaaaaa-0000-0000-0000-0000000d1560';
select is((select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1560'),
  'aaaaaaaa-0000-0000-0000-000000de1560'::uuid,
  'a new owner moves the deliverable to their department — Content''s work given to Creative''s lead is Creative''s (d.1)');

-- ============================================================ d.4 TASKS ====
select results_eq($$
  select id, department_id from sub_tasks
   where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d1560' order by sort_order
$$, $$ values
  ('aaaaaaaa-0000-0000-0000-0000000a1561'::uuid, 'aaaaaaaa-0000-0000-0000-000000de1561'::uuid),
  ('aaaaaaaa-0000-0000-0000-0000000a1562'::uuid, 'aaaaaaaa-0000-0000-0000-000000de1560'::uuid)
$$, 'the UNASSIGNED task followed the deliverable; the assigned one keeps its assignee''s department (d.4)');

-- ============================================================ d.3 NO DEPARTMENT ====
update deliverables set owner_user_id = '00000000-0000-0000-0000-00000000a160'
 where id = 'aaaaaaaa-0000-0000-0000-0000000d1560';
select is((select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1560'),
  'aaaaaaaa-0000-0000-0000-000000de1560'::uuid,
  'an owner with no department leaves the deliverable where it was — never emptied (d.3)');

-- Back to Content's lead: Content again.
update deliverables set owner_user_id = '00000000-0000-0000-0000-00000000a162'
 where id = 'aaaaaaaa-0000-0000-0000-0000000d1560';
select is((select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1560'),
  'aaaaaaaa-0000-0000-0000-000000de1561'::uuid,
  'and a Content owner makes it Content''s again (d.1)');

-- ============================================================ d.2 WORKSTREAMS ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a160'),true);

select lives_ok($$
  select public.move_deliverable_to_workstream('aaaaaaaa-0000-0000-0000-0000000d1560', 'aaaaaaaa-0000-0000-0000-0000000e5156')
$$, 'the account manager puts Content''s deliverable into the Creative group');
select results_eq($$
  select workstream_id, department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1560'
$$, $$ values ('aaaaaaaa-0000-0000-0000-0000000e5156'::uuid, 'aaaaaaaa-0000-0000-0000-000000de1561'::uuid) $$,
  'it is in the Creative group and still Content''s — a group does not set the department (d.2)');

select lives_ok($$
  select public.save_workstream('aaaaaaaa-0000-0000-0000-000000001560', 'Design 156',
    'aaaaaaaa-0000-0000-0000-000000de1562', null, 'aaaaaaaa-0000-0000-0000-0000000e5156')
$$, 'the group is moved to Production');
select results_eq($$
  select (select department_id from workstreams where id = 'aaaaaaaa-0000-0000-0000-0000000e5156'),
         (select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1560')
$$, $$ values ('aaaaaaaa-0000-0000-0000-000000de1562'::uuid, 'aaaaaaaa-0000-0000-0000-000000de1561'::uuid) $$,
  'the group is Production''s and its work is still its owner''s — changing a group moves none of it (d.2)');

-- ============================================================ d.1 NOT CHOSEN ====
reset role;
update deliverables set department_id = 'aaaaaaaa-0000-0000-0000-000000de1562'
 where id = 'aaaaaaaa-0000-0000-0000-0000000d1560';
select is((select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1560'),
  'aaaaaaaa-0000-0000-0000-000000de1561'::uuid,
  'a write naming another department is put back to the owner''s — it is never chosen separately (d.1)');

select * from finish();
rollback;
