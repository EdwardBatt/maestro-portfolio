-- I31.8 (ADR-0062 d.10) — who is entitled to a conversation.
--
-- The rule this proves replaced a gate that admitted four kinds of person and HAD NO NOTION OF A
-- REVIEWER: on the live tenant it refused a large share of users, including the C-suite
-- and every Team Member. The reviewer case below is the headline assertion of the whole suite —
-- the one surface where two people must talk was the one the old gate refused.
--
-- Every case runs as `authenticated` with the caller's own JWT claims, never as superuser: the
-- functions read `auth.uid()` and `app.current_scope()`, so a superuser run would prove nothing.
begin;
select plan(22);
\ir helpers/seed.sql

-- ---------------------------------------------------------------- extra fixtures ----
-- The shared seed has no departments, and the scope axis is meaningless without them.
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000dd001','aaaaaaaa-0000-0000-0000-000000000001','Creative'),
  ('aaaaaaaa-0000-0000-0000-0000000dd002','aaaaaaaa-0000-0000-0000-000000000001','Production');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000ee001','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000dd001','Art'),
  ('aaaaaaaa-0000-0000-0000-0000000ee002','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000dd002','Film');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a010','maker@a.test'),      -- assignee, Creative/Art
  ('00000000-0000-0000-0000-00000000a011','reviewer@a.test'),   -- reviewer only, Production/Film
  ('00000000-0000-0000-0000-00000000a012','stranger@a.test'),   -- on nothing, Production/Film
  ('00000000-0000-0000-0000-00000000a013','deptlead@a.test'),   -- Department Lead over Creative
  ('00000000-0000-0000-0000-00000000a014','teamlead@a.test'),   -- Team Leader of Film only
  ('00000000-0000-0000-0000-00000000a015','ceo@a.test'),        -- chat_oversight
  ('00000000-0000-0000-0000-00000000a016','portal@a.test');     -- client portal

insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, v.tenant::uuid, v.name,
       (select r.id from roles r where r.tenant_id = v.tenant::uuid and r.key = v.role_key),
       v.dept::uuid, v.team::uuid
from (values
  ('00000000-0000-0000-0000-00000000a010','aaaaaaaa-0000-0000-0000-000000000001','Maker',    'team_member',     'aaaaaaaa-0000-0000-0000-0000000dd001','aaaaaaaa-0000-0000-0000-0000000ee001'),
  ('00000000-0000-0000-0000-00000000a011','aaaaaaaa-0000-0000-0000-000000000001','Reviewer', 'team_member',     'aaaaaaaa-0000-0000-0000-0000000dd002','aaaaaaaa-0000-0000-0000-0000000ee002'),
  ('00000000-0000-0000-0000-00000000a012','aaaaaaaa-0000-0000-0000-000000000001','Stranger', 'team_member',     'aaaaaaaa-0000-0000-0000-0000000dd002','aaaaaaaa-0000-0000-0000-0000000ee002'),
  ('00000000-0000-0000-0000-00000000a013','aaaaaaaa-0000-0000-0000-000000000001','Dept Lead','department_lead', 'aaaaaaaa-0000-0000-0000-0000000dd001','aaaaaaaa-0000-0000-0000-0000000ee001'),
  ('00000000-0000-0000-0000-00000000a014','aaaaaaaa-0000-0000-0000-000000000001','Team Lead','team_lead',       'aaaaaaaa-0000-0000-0000-0000000dd002','aaaaaaaa-0000-0000-0000-0000000ee002'),
  ('00000000-0000-0000-0000-00000000a015','aaaaaaaa-0000-0000-0000-000000000001','Chief',    'ceo',             null, null),
  ('00000000-0000-0000-0000-00000000a016','aaaaaaaa-0000-0000-0000-000000000001','Portal',   'client_portal',   null, null)
) as v(id, tenant, name, role_key, dept, team);

-- The claims table is built from user_profiles at seed time, so late arrivals add their own.
insert into test_claims
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
from user_profiles up where up.id::text like '%a01%';

-- ADR-0043 refuses an appointment unless the chosen person can moderate reviews. Granted through
-- the ADR-0036 overlay rather than by changing a011's role: a team_member's scope is 'self', so
-- when they are admitted below it can only be because they are the REVIEWER.
-- `granted_by` is SERVER-STAMPED from auth.uid() (L6.1), so it is not supplied — it is claimed.
-- Claims are read from the GUC, not from the current role, so this works while still superuser.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
insert into user_grants (tenant_id, user_id, resource, action, effect, reason) values
  ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000a011',
   'reviews','moderate','allow','fixture: appointable');

-- Campaign work: a stream under the seed's approved campaign, one deliverable, one task.
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000bb001','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','Key visual');
-- The fixture department (ADR-0099 d.2, 23 Sep): a deliverable's department is its own and is no
-- longer derived from the owner, so a fixture that names an owner with no department must say
-- which department the work belongs to. Created here rather than assumed.
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000de0ff', 'aaaaaaaa-0000-0000-0000-000000000001', 'Fixture dept')
on conflict (id) do nothing;

insert into deliverables (id, tenant_id, stream_id, name, reviewer_id, owner_user_id, due_at, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000fa201','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000bb001','Hero KV','00000000-0000-0000-0000-00000000a001',
   '00000000-0000-0000-0000-00000000a002','2026-10-01 15:00+00', 'aaaaaaaa-0000-0000-0000-0000000de0ff');
insert into sub_tasks (id, tenant_id, deliverable_id, title, assignee_id, created_by, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000ab001','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000fa201','Draft the KV','00000000-0000-0000-0000-00000000a010',
   '00000000-0000-0000-0000-00000000a002','todo', 8);
-- ADR-0043: the reviewer lives ONLY here. The old gate never looked.
insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000ab001',
   '00000000-0000-0000-0000-00000000a011', true);

-- Ad-hoc work: the seed's job-anchored deliverable, whose job carries NO campaign.
insert into sub_tasks (id, tenant_id, deliverable_id, title, assignee_id, created_by, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000ab002','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f101','Tweak it','00000000-0000-0000-0000-00000000a010',
   '00000000-0000-0000-0000-00000000a002','todo', 8);

set local role authenticated;

-- ---------------------------------------------------------------- participants ----
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a010'),true);
select ok(app.can_read_conversation('deliverable','aaaaaaaa-0000-0000-0000-0000000fa201'),
  'the ASSIGNEE may read the thread on their own work');

-- THE headline case. a011 is a reviewer and nothing else: not the assignee, not the AM, holds no
-- manage grant, and is in a different department from the maker so the scope axis cannot save them.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a011'),true);
select ok(app.can_read_conversation('deliverable','aaaaaaaa-0000-0000-0000-0000000fa201'),
  'the REVIEWER may read it — the case the old gate refused');
select ok(app.can_read_conversation('sub_task','aaaaaaaa-0000-0000-0000-0000000ab001'),
  'the reviewer reaches the task thread too');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select ok(app.can_read_conversation('deliverable','aaaaaaaa-0000-0000-0000-0000000fa201'),
  'the ASSIGNER/owner may read it');

-- A colleague on nothing, in a department that owns none of this work.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a012'),true);
select ok(not app.can_read_conversation('deliverable','aaaaaaaa-0000-0000-0000-0000000fa201'),
  'a colleague on none of the work is refused');
select ok(not app.can_manage_conversation_members('deliverable','aaaaaaaa-0000-0000-0000-0000000fa201'),
  'and cannot add anybody to it');

-- ---------------------------------------------------------------- scope ----
-- The Creative lead reaches it because the MAKER is theirs — not because of any grant.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a013'),true);
select ok(app.can_read_conversation('deliverable','aaaaaaaa-0000-0000-0000-0000000fa201'),
  'a Department Lead reads their own person''s conversation');

-- The Film team leader has no one on this work: the reviewer is in their DEPARTMENT but a team
-- scope is exact, and a011 is on their team... so this must PASS. Proven the other way below.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a014'),true);
select ok(app.can_read_conversation('deliverable','aaaaaaaa-0000-0000-0000-0000000fa201'),
  'a Team Leader reaches a conversation their own team member is in');

-- ---------------------------------------------------------------- oversight ----
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a015'),true);
select ok(app.can_read_conversation('deliverable','aaaaaaaa-0000-0000-0000-0000000fa201'),
  'chat_oversight reaches a work conversation its holder has no other connection to');
select ok(app.can_manage_conversation_members('deliverable','aaaaaaaa-0000-0000-0000-0000000fa201'),
  'and may add people — management are full participants, not observers');
-- ADR-0062 d.4: the fence that keeps private messaging a free decision.
select ok(not app.can_read_conversation('dm','aaaaaaaa-0000-0000-0000-0000000fa201'),
  'chat_oversight does NOT reach a dm conversation');
select ok(not app.can_read_conversation('group','aaaaaaaa-0000-0000-0000-0000000fa201'),
  'chat_oversight does NOT reach a group conversation');

-- ---------------------------------------------------------------- ad-hoc ----
-- The bug ADR-0046 was written for: no campaign is not a refusal.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a010'),true);
select ok(app.can_read_conversation('deliverable','aaaaaaaa-0000-0000-0000-00000000f101'),
  'ad-hoc work has a thread: its assignee is admitted although it has no campaign');
select ok(
  exists (select 1 from app.conversation_participants('deliverable','aaaaaaaa-0000-0000-0000-00000000f101')
           where user_id = '00000000-0000-0000-0000-00000000a010' and reason = 'assignee')
  and exists (select 1 from app.conversation_participants('deliverable','aaaaaaaa-0000-0000-0000-00000000f101')
           where user_id = '00000000-0000-0000-0000-00000000a002' and reason = 'assigner'),
  'ad-hoc participants resolve WITHOUT a campaign — assignee and assigner both named');

-- ---------------------------------------------------------------- the campaign anchor ----
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a010'),true);
select ok(app.can_read_conversation('campaign','aaaaaaaa-0000-0000-0000-00000000e001'),
  'the campaign room admits somebody assigned under it');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a012'),true);
select ok(not app.can_read_conversation('campaign','aaaaaaaa-0000-0000-0000-00000000e001'),
  'the campaign room refuses somebody on none of its work');

-- ---------------------------------------------------------------- invitations ----
set local role postgres;
insert into conversations (id, tenant_id, kind, context_type, context_id, created_by) values
  ('aaaaaaaa-0000-0000-0000-0000000cc201','aaaaaaaa-0000-0000-0000-000000000001','group',
   'deliverable','aaaaaaaa-0000-0000-0000-0000000fa201','00000000-0000-0000-0000-00000000a002');
-- a012 was refused above; an invitation is the only thing that changes.
insert into conversation_members (conversation_id, tenant_id, user_id, added_by) values
  ('aaaaaaaa-0000-0000-0000-0000000cc201','aaaaaaaa-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000a012','00000000-0000-0000-0000-00000000a002');
-- A derived join record for somebody with no claim: it must confer NOTHING.
insert into conversation_members (conversation_id, tenant_id, user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000cc201','aaaaaaaa-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000a016');
set local role authenticated;

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a012'),true);
select ok(app.can_read_conversation('deliverable','aaaaaaaa-0000-0000-0000-0000000fa201'),
  'an INVITED member reads a thread they have no other claim on');
select ok(not app.can_manage_conversation_members('deliverable','aaaaaaaa-0000-0000-0000-0000000fa201'),
  'an invited member may NOT invite a third — an invitation cannot fan out');

-- ---------------------------------------------------------------- the portal fence ----
-- a016 holds a membership row, so this proves the fence beats a row rather than merely coinciding
-- with one. It is `app.is_portal_user`, not a scope test: the portal role's scope is 'self', the
-- same value every Team Member carries.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a016'),true);
select ok(not app.can_read_conversation('deliverable','aaaaaaaa-0000-0000-0000-0000000fa201'),
  'the client portal is refused even holding a conversation_members row');

-- ---------------------------------------------------------------- cross-tenant ----
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b002'),true);
select ok(not app.can_read_conversation('deliverable','aaaaaaaa-0000-0000-0000-0000000fa201'),
  'another tenant is refused');
select is((select count(*)::int from app.conversation_participants('deliverable','aaaaaaaa-0000-0000-0000-0000000fa201')),
  0, 'and cannot even enumerate who is on it');

-- ---------------------------------------------------------------- reviewer removed ----
set local role postgres;
delete from sub_task_reviewers where user_id = '00000000-0000-0000-0000-00000000a011';
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a011'),true);
select ok(not app.can_read_conversation('sub_task','aaaaaaaa-0000-0000-0000-0000000ab001'),
  'a REMOVED reviewer loses access at once — entitlement is recomputed, never cached');

select * from finish();
rollback;
