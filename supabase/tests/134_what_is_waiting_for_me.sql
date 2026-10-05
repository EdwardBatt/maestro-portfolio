-- I53.16 — `public.my_pending_approvals()`: every approval the CALLER OWES — as the person the
-- system names for it — and nothing the failsafe merely COULD give (ADR-0070 d.6: "a capability,
-- not a queue"). Edward, 20 Sep, on the first cut: *"all the pending approvals in the system are
-- being displayed in my-work, even though I am neither the Account Manager or the deliverable
-- owner."* Each kind as one who owes it and one who does not, and the door agreeing with the list.
--
-- People: a003 becomes Creative's department lead (briefs:approve, owner of the single job's
-- deliverables, the lead named for its own resource); a021 an account manager (the campaign's);
-- a002 the Traffic Manager and a001 the Power Admin (every grant, tenant scope — the failsafe);
-- a020 a Creative team member (nothing to give).
begin;
select plan(15);
\ir helpers/seed.sql

-- The shared seed's roles predate briefs:approve (ADR-0070 d.2); the same call 082 makes.
select app.seed_tenant_brief_approval_grants(id) from tenants;

-- ---------------------------------------------------------------- people and departments ----
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000de001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative'),
  ('aaaaaaaa-0000-0000-0000-0000000de002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Content');
update user_profiles
   set role_id = (select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'department_lead'),
       department_id = 'aaaaaaaa-0000-0000-0000-0000000de001'
 where id = '00000000-0000-0000-0000-00000000a003';
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a020', 'member@a.test'),
  ('00000000-0000-0000-0000-00000000a021', 'am@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id) values
  ('00000000-0000-0000-0000-00000000a020', 'aaaaaaaa-0000-0000-0000-000000000001', 'Member A',
   (select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'team_member'),
   'aaaaaaaa-0000-0000-0000-0000000de001'),
  ('00000000-0000-0000-0000-00000000a021', 'aaaaaaaa-0000-0000-0000-000000000001', 'AM A',
   (select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'account_manager'),
   null);
-- a003's claims are re-minted: the role changed above and the seed's JWT names the old one.
delete from test_claims where id = '00000000-0000-0000-0000-00000000a003';
insert into test_claims
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id in ('00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-00000000a020',
                 '00000000-0000-0000-0000-00000000a021');

-- ---------------------------------------------------------------- the fixtures ----
-- 1. The shared seed's approved campaign (e001, AM a021 by its client): a Creative brief and a
--    Content brief, both unapproved.
update campaigns set account_manager_id = '00000000-0000-0000-0000-00000000a021'
 where id = 'aaaaaaaa-0000-0000-0000-00000000e001';
insert into campaign_briefs (id, tenant_id, campaign_id, department_id, brief_type, values) values
  ('aaaaaaaa-0000-0000-0000-0000000cb401', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001', 'aaaaaaaa-0000-0000-0000-0000000de001', 'creative', '{"task":"Written 134"}'),
  ('aaaaaaaa-0000-0000-0000-0000000cb402', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001', 'aaaaaaaa-0000-0000-0000-0000000de002', 'social_calendar', '{"objective":"Written 134"}');
-- (They are here to prove a NEGATIVE now: ADR-0100 d.4 took both department-brief rows off the
--  list, so neither a written nor an unwritten one is owed to anybody. The rows themselves stay —
--  d.3 keeps all 216 as the record of what a department was asked to do.)

-- 2. A released single job whose deliverable a003 owns, list unapproved (ADR-0090).
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id, approved_at, approved_by, go_live_at) values
  ('aaaaaaaa-0000-0000-0000-0000000ee401', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Teaser statics', 'approved', 'single_job',
   '00000000-0000-0000-0000-00000000a021', now(), '00000000-0000-0000-0000-00000000a001', now() + interval '14 days');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000cc401', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000ee401', 'Main');
insert into deliverables (id, tenant_id, stream_id, name, owner_user_id, reviewer_id, due_at) values
  ('aaaaaaaa-0000-0000-0000-0000000dd401', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000cc401', 'Teaser statics x3', '00000000-0000-0000-0000-00000000a003',
   '00000000-0000-0000-0000-00000000a001', now() + interval '10 days');

-- 3. A campaign still waiting for its account manager.
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-0000000ee402', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Harbour rebrand', 'pending_approval', 'campaign',
   '00000000-0000-0000-0000-00000000a021');

-- 4. A booking request on the single job's task, raised by the AM for a003's own resource — which
--    sits in Creative, so `assignment_request_approvers` names a003, Creative's lead.
update resources set department_id = 'aaaaaaaa-0000-0000-0000-0000000de001'
 where id = 'aaaaaaaa-0000-0000-0000-00000000d0a3';
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000ff401', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000dd401', 'Create Artwork', 'todo', 1, 8);
insert into sub_task_assignment_requests (id, tenant_id, sub_task_id, resource_id, assignee_id, requested_by, title) values
  ('aaaaaaaa-0000-0000-0000-0000000a9401', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000ff401', 'aaaaaaaa-0000-0000-0000-00000000d0a3',
   '00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-00000000a021', 'Create Artwork');

-- ---------------------------------------------------------------- a003, Creative's lead ----
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);

-- Until ADR-0100 this asked whether the Creative lead was offered Creative's brief and not
-- Content's (ADR-0070 d.3). d.4 stops the document being owed at all, so the question worth asking
-- is the opposite one: the lead of a department with an unapproved brief is asked for nothing.
select is_empty($$
  select 1 from public.my_pending_approvals() where kind = 'department_brief'
$$, 'no department brief is owed — not her own department''s, not anybody''s: the ask left with the document (ADR-0100 d.4)');
select results_eq($$
  select kind, target_id from public.my_pending_approvals() where kind = 'task_list'
$$, $$ values ('task_list', 'aaaaaaaa-0000-0000-0000-0000000dd401'::uuid) $$,
  'and the task list of the deliverable they own (ADR-0090 d.4)');
select is_empty($$
  select 1 from public.my_pending_approvals() where kind = 'campaign'
$$, 'but no campaign approval — that is the account manager''s');
-- The same question — what does a row CALL itself — asked of the kind that replaced the brief as
-- the second gate (ADR-0100 d.2). A task-list row is titled by the work it is owed on, and the
-- campaign it belongs to is carried beside it rather than in the title.
select results_eq($$
  select title, campaign_name from public.my_pending_approvals() where kind = 'task_list'
$$, $$ values ('Teaser statics x3', 'Teaser statics') $$,
  'a task-list row is titled by the deliverable whose list is owed; its campaign is context');
select results_eq($$
  select kind, target_id, deliverable_id from public.my_pending_approvals() where kind = 'booking_request'
$$, $$ values ('booking_request', 'aaaaaaaa-0000-0000-0000-0000000ff401'::uuid, 'aaaaaaaa-0000-0000-0000-0000000dd401'::uuid) $$,
  'and the booking request on their own department''s resource — the lead the request was sent to (ADR-0087 d.6)');

-- ---------------------------------------------------------------- a021, the account manager ----
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a021'), true);
select results_eq($$
  select kind, id from public.my_pending_approvals() where kind = 'campaign'
$$, $$ values ('campaign', 'aaaaaaaa-0000-0000-0000-0000000ee402'::uuid) $$,
  'the account manager is offered the campaign pending their approval (ADR-0072 d.7)');
select is_empty($$
  select 1 from public.my_pending_approvals() where kind = 'department_brief'
$$, 'but not the department briefs — the AM may approve one for an absent department (ADR-0072 d.5), and is not sent them (ADR-0070 d.6)');
select is_empty($$
  select 1 from public.my_pending_approvals() where kind = 'task_list'
$$, 'never a task list — the AM does not approve it (ADR-0090, 12 Sep addendum)');
select is_empty($$
  select 1 from public.my_pending_approvals() where kind = 'booking_request'
$$, 'nor the booking request they raised themselves (ADR-0087)');

-- ---------------------------------------------------------------- a020, a team member ----
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a020'), true);
select is_empty($$ select 1 from public.my_pending_approvals() $$,
  'a team member has nothing to approve and sees an empty list, not a refusal');

-- ---------------------------------------------------------------- the list and the door agree ----
-- What the list offered a003, a003 can do; what it withheld, the RPC refuses.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select lives_ok($$ select public.approve_department_brief('aaaaaaaa-0000-0000-0000-0000000cb401') $$,
  'the brief the list offered is approvable by the same person');
select throws_ok($$ select public.approve_department_brief('aaaaaaaa-0000-0000-0000-0000000cb402') $$,
  '42501', null, 'the brief the list withheld is refused by the same door');

-- ---------------------------------------------------------------- the failsafe is not a queue ----
-- Traffic and the Power Admin can approve every one of these; none is theirs to answer.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);
select is_empty($$ select 1 from public.my_pending_approvals() $$,
  'the Traffic Manager, who could approve any of them, owes none — the failsafe is a capability, not a queue (ADR-0070 d.6)');
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select is_empty($$ select 1 from public.my_pending_approvals() $$,
  'and the Power Admin likewise');
select lives_ok($$ select public.approve_department_brief('aaaaaaaa-0000-0000-0000-0000000cb402') $$,
  'while the door still lets the Power Admin approve for an absent department (ADR-0070 d.3)');


select * from finish();
rollback;
