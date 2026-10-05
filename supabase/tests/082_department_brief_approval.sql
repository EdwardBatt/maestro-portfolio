-- I37.1 / I37.2 (ADR-0070) — who may accept a department's brief, and what waits for it.
--
-- Four properties, and three of them are about REFUSAL:
--
--   * A department lead approves their OWN department and not another's. Scope is what limits
--     them, and it is the existing primitive rather than a rule written twice.
--   * Power Admin and Traffic Manager approve ANY department — the failsafe (d.3). It is asserted
--     because it is the thing standing between this feature and the 29 August deadlock, where a
--     campaign under a client with no account manager could be approved by nobody.
--   * An account manager holding `projects:manage` — the permission that EDITS a brief — cannot
--     approve one. That separation is the whole of d.2, and nothing else enforces it.
--   * Work waits. And it waits on the DELIVERABLE's department, not the task's: `department_id` on
--     a sub-task is stamped from the assignee, so the two genuinely differ and reading the wrong
--     one would gate a Production step against a brief it has nothing to do with.
--
-- Every case runs as `authenticated` with the caller's own JWT claims, never as superuser: the
-- checks read `app.has_permission()` and `app.in_write_scope()`, so a superuser run would prove
-- nothing at all.
begin;
select plan(17);
\ir helpers/seed.sql

-- ---------------------------------------------------------------- extra fixtures ----
-- `helpers/seed.sql` calls `app.seed_tenant_roles`, the INNER seeder. Production provisions a
-- tenant through `public.seed_tenant_roles`, the wrapper, which composes eight more seeders on top
-- of it — so the grants those add are invisible to every suite unless it asks for them. (That is
-- also why the two seeders which fell out of the wrapper on 27 August, repaired in
-- `20260903100300`, broke no test: nothing ever exercised them.) Power Admin still gets this grant
-- without the call, from the permission_catalog after-insert trigger; the other four do not.
select app.seed_tenant_brief_approval_grants(id) from tenants;

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000de001','aaaaaaaa-0000-0000-0000-000000000001','Creative'),
  ('aaaaaaaa-0000-0000-0000-0000000de002','aaaaaaaa-0000-0000-0000-000000000001','Production');

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000c5001','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','Main');


insert into campaign_briefs (id, tenant_id, campaign_id, department_id, brief_type, values) values
  ('aaaaaaaa-0000-0000-0000-0000000cb001','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','aaaaaaaa-0000-0000-0000-0000000de001','creative','{}'),
  ('aaaaaaaa-0000-0000-0000-0000000cb002','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','aaaaaaaa-0000-0000-0000-0000000de002','production','{}');

-- a003 is a Team Member; give them the department_lead role for Creative so the SCOPE half is what
-- decides, not the role name. a002 is the Traffic Manager (scheduler) from the shared seed.
--
-- This runs BEFORE the deliverable is inserted, and that order is load-bearing:
-- `app.tg_deliverable_stamp_department` derives `deliverables.department_id` from the OWNER's
-- department and NULLS it outright when there is no owner (ADR-0050 d.2). A fixture that sets
-- `department_id` directly has it silently erased — which is what the first draft of this suite
-- did, and it read as the gate being wrong rather than the fixture.
update user_profiles
   set role_id = (select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                    and key = 'department_lead'),
       department_id = 'aaaaaaaa-0000-0000-0000-0000000de001'
 where id = '00000000-0000-0000-0000-00000000a003';

-- A Creative deliverable — Creative because its OWNER is, which is the only way it can be. Its
-- brief is Creative's whoever ends up doing the steps.
insert into deliverables (id, tenant_id, stream_id, name, owner_user_id, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d1001','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000c5001','Key Visual','00000000-0000-0000-0000-00000000a003',
   '00000000-0000-0000-0000-00000000a001');

select is(
  (select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1001'),
  'aaaaaaaa-0000-0000-0000-0000000de001'::uuid,
  'fixture check: the deliverable really is Creative''s, stamped from its owner (ADR-0050 d.2)');

-- ---------------------------------------------------------------- shape ----
select has_column('public','campaign_briefs','approved_at','a brief records when it was accepted');
select col_is_null('public','campaign_briefs','approved_at',
  'NULL is unapproved — the absence of a timestamp, not a parallel status column (d.1)');

select isnt_empty($$
  select 1 from permission_catalog where resource = 'briefs' and action = 'approve'
$$, 'briefs:approve exists and is NOT projects:manage (d.2)');

-- Who holds it, exactly. The Account Manager is on this list by Edward's decision of 3 Sep —
-- *"the account manager can approve their own brief, even if they created it"* — which overrules
-- the writer/approver separation d.2 first argued for. Their `account` scope is what keeps that to
-- campaigns they own. A Team Member is NOT on it, which is what the permission is still for.
select results_eq($$
  select r.key::text from role_grants rg
    join roles r on r.id = rg.role_id
   where rg.resource = 'briefs' and rg.action = 'approve'
     and r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   order by r.key
$$, $$ values ('account_manager'), ('department_lead'), ('deputy_team_lead'), ('power_admin'),
              ('scheduler'), ('team_lead') $$,
  'held by the department''s people, the account manager, and the two roles that carry the agency');

select is_empty($$
  select 1 from role_grants rg
    join roles r on r.id = rg.role_id
   where r.key = 'team_member'
     and rg.resource = 'briefs' and rg.action = 'approve'
$$, 'a Team Member cannot accept work on their department''s behalf');

-- ---------------------------------------------------------------- who may ----
set local role authenticated;

-- The department's own lead.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select lives_ok($$
  select public.approve_department_brief('aaaaaaaa-0000-0000-0000-0000000cb001')
$$, 'a Department Lead approves their OWN department''s brief');

select isnt(
  (select approved_at from campaign_briefs where id = 'aaaaaaaa-0000-0000-0000-0000000cb001'),
  null, 'and it is recorded');

select is(
  (select approved_by from campaign_briefs where id = 'aaaaaaaa-0000-0000-0000-0000000cb001'),
  '00000000-0000-0000-0000-00000000a003'::uuid,
  'approved_by is stamped from auth.uid(), never sent by the caller');

-- Not somebody else's department. Scope is what refuses, not a rule written a second time.
select throws_ok($$
  select public.approve_department_brief('aaaaaaaa-0000-0000-0000-0000000cb002')
$$, '42501', null,
  'a Creative lead may NOT approve Production''s brief — scope is what limits them (d.3)');

-- The failsafe. This is what stands between ADR-0070 and the 29 August deadlock.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select lives_ok($$
  select public.approve_department_brief('aaaaaaaa-0000-0000-0000-0000000cb002')
$$, 'the Traffic Manager approves ANY department — the failsafe for absence (d.3)');

-- Approving twice must not move the timestamp: the FIRST acceptance is the fact.
select lives_ok($$
  select public.approve_department_brief('aaaaaaaa-0000-0000-0000-0000000cb002')
$$, 'approving twice is not an error');
select is(
  (select approved_by from campaign_briefs where id = 'aaaaaaaa-0000-0000-0000-0000000cb002'),
  '00000000-0000-0000-0000-00000000a002'::uuid,
  'and the first acceptance stands — a second click does not rewrite when it happened');

-- ---------------------------------------------------------------- the gate ----
-- Reset Creative's brief so its work is genuinely waiting.
reset role;
select set_config('request.jwt.claims', '', true);
update campaign_briefs set approved_at = null, approved_by = null
 where id = 'aaaaaaaa-0000-0000-0000-0000000cb001';

-- A task on the CREATIVE deliverable, but stamped Production — which is what happens when the
-- assignee is a Production person (ADR-0050 d.2). Reading the task's own department would gate it
-- against Production's brief, which is approved, and the Creative brief it actually belongs to
-- would be ignored.
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, department_id, sort_order) values
  ('aaaaaaaa-0000-0000-0000-0000000fa001','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000d1001','Retouch','todo','aaaaaaaa-0000-0000-0000-0000000de002', 1);

select ok(not app.sub_task_brief_is_approved('aaaaaaaa-0000-0000-0000-0000000fa001'),
  'the DELIVERABLE''s department decides, not the task''s — Creative is unapproved (d.4)');

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select throws_ok($$
  update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a003'
   where id = 'aaaaaaaa-0000-0000-0000-0000000fa001'
$$, '42501', null,
  'work cannot be ASSIGNED while its department brief is unapproved');

select lives_ok($$
  select public.approve_department_brief('aaaaaaaa-0000-0000-0000-0000000cb001')
$$, 'the brief is approved');

-- ADR-0100 d.2 (23 Sep): approving the brief no longer releases the work. The second gate is the
-- DELIVERABLE OWNER approving its task list, so the assignment below is still refused — and it is
-- refused for the new reason, which is the point worth asserting.
select throws_like($$
  update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a003'
   where id = 'aaaaaaaa-0000-0000-0000-0000000fa001'
$$, '%task list%has not been approved%',
  'but approving the brief no longer releases the work — the owner''s task list does (ADR-0100 d.2)');

select * from finish();
rollback;
