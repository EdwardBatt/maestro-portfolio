-- I44 (ADR-0090), amended by ADR-0100 d.2 (23 Sep) — ALL work waits for its OWNER to approve the
-- task list. A campaign used to be asked a different question — had the DEPARTMENT approved its
-- brief? — and that gate is gone along with the fork it lived in.
--
-- Five properties, three of them refusals:
--
--   * On a SINGLE JOB, assignment is refused while `tasks_approved_at` is null, and the message
--     names the deliverable and its owner (d.3). The refusal comes from the real trigger, as a
--     real caller who otherwise holds every grant to assign.
--   * `approve_deliverable_tasks` admits the owner of record and anyone with
--     `deliverable_owner:manage` within the DEPARTMENT's scope (d.4 — the Traffic Manager, the
--     failsafe); refuses a team member who is neither, and (amended 12 Sep) the campaign's ACCOUNT
--     MANAGER, who approves the campaign but not the department's task list; is not reachable across
--     tenants; and is idempotent — the first stamp stands.
--   * After approval the same assignment lives (d.3).
--   * A CAMPAIGN is held by the SAME gate (ADR-0100 d.2). Its department brief decides nothing in
--     either direction: approved, the work is still held while `tasks_approved_at` is null;
--     unapproved, the owner's approval still releases it. Campaigns approved before
--     `app_settings.task_list_gate_from` are exempt (d.7) — the seed's campaign carries no
--     `approved_at` at all, so it is governed, which is what makes it the right subject here.
--   * Ad-hoc work is not governed (d.6 / ADR-0048 d.8's null-campaign rule).
--
-- Runs as `authenticated` with the caller's own claims throughout; the functions and the trigger
-- read `app.has_permission()` and `app.in_write_scope()`, so a superuser run proves nothing.
begin;
select plan(25);
\ir helpers/seed.sql

-- ---------------------------------------------------------------- shape ----
select has_column('public', 'deliverables', 'tasks_approved_at', 'a deliverable records when its task list was approved (d.2)');
select has_column('public', 'deliverables', 'tasks_approved_by', 'and by whom (d.2)');
select col_is_null('public', 'deliverables', 'tasks_approved_at',
  'NULL is unapproved — the absence of a timestamp, no parallel status (d.1/d.2)');

-- ---------------------------------------------------------------- fixtures ----
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000de001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative');

-- a003 becomes the Creative department lead: the OWNER (ADR-0083 d.8). Before the deliverables
-- are inserted, because department_id is defaulted from the owner once, at creation (ADR-0099 d.2,
-- superseding ADR-0050 d.2 — it is never restamped afterwards).
update user_profiles
   set role_id = (select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                    and key = 'department_lead'),
       department_id = 'aaaaaaaa-0000-0000-0000-0000000de001'
 where id = '00000000-0000-0000-0000-00000000a003';

-- A team member who is nobody's owner.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000a020', 'member@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
values ('00000000-0000-0000-0000-00000000a020', 'aaaaaaaa-0000-0000-0000-000000000001', 'Member A',
        (select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'team_member'),
        'aaaaaaaa-0000-0000-0000-0000000de001');
-- The job's account manager: account scope, deliverable_owner:manage by role (ADR-0055 d.3b).
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000a021', 'am@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id)
values ('00000000-0000-0000-0000-00000000a021', 'aaaaaaaa-0000-0000-0000-000000000001', 'AM A',
        (select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'account_manager'));
insert into test_claims
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id in ('00000000-0000-0000-0000-00000000a020', '00000000-0000-0000-0000-00000000a021');

-- THE SINGLE JOB: released (approved), its single-execution brief approved by the AM at release
-- (ADR-0084 d.4) — which is exactly why the brief gate is passed and the list gate is needed.
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-0000000e9001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Ramadan teaser posts', 'approved', 'single_job',
   '00000000-0000-0000-0000-00000000a021');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000c9001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000e9001', 'Ramadan teaser posts');
insert into campaign_briefs (tenant_id, campaign_id, department_id, brief_type, values, approved_at, approved_by) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000e9001',
   'aaaaaaaa-0000-0000-0000-0000000de001', 'single_execution', '{"task":"Three statics"}', now(),
   '00000000-0000-0000-0000-00000000a001');
insert into deliverables (id, tenant_id, stream_id, name, owner_user_id, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d9001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000c9001', 'Teaser statics x3', '00000000-0000-0000-0000-00000000a003',
   '00000000-0000-0000-0000-00000000a001'),
  -- A second one for the failsafe case, same owner.
  ('aaaaaaaa-0000-0000-0000-0000000d9002', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000c9001', 'Teaser copy', '00000000-0000-0000-0000-00000000a003',
   '00000000-0000-0000-0000-00000000a001'),
  -- A third for the account manager's case.
  ('aaaaaaaa-0000-0000-0000-0000000d9009', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000c9001', 'Teaser story', '00000000-0000-0000-0000-00000000a003',
   '00000000-0000-0000-0000-00000000a001');
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000f9001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000d9001', 'Create Artwork', 'todo', 1, 8),
  ('aaaaaaaa-0000-0000-0000-0000000f9002', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000d9002', 'Write Copy', 'todo', 1, 8);

-- THE CAMPAIGN: the shared seed's approved campaign, a Creative brief on it, a Creative deliverable.
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000c9002', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001', 'Main');
insert into campaign_briefs (id, tenant_id, campaign_id, department_id, brief_type, values, approved_at, approved_by) values
  ('aaaaaaaa-0000-0000-0000-0000000cb901', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001', 'aaaaaaaa-0000-0000-0000-0000000de001', 'creative', '{}', now(),
   '00000000-0000-0000-0000-00000000a003');
insert into deliverables (id, tenant_id, stream_id, name, owner_user_id, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d9003', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000c9002', 'Campaign KV', '00000000-0000-0000-0000-00000000a003',
   '00000000-0000-0000-0000-00000000a001');
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000f9003', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000d9003', 'Develop Concept', 'todo', 1, 8);

-- AD-HOC: the shared seed's f101, no campaign.
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000f9004', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f101', 'Retouch', 'todo', 1, 8);

select is(
  (select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d9001'),
  'aaaaaaaa-0000-0000-0000-0000000de001'::uuid,
  'fixture check: the single job''s deliverable is Creative''s, defaulted from its owner at creation');

-- ---------------------------------------------------------------- the gate, held ----
-- a002 is the Traffic Manager: tenant scope, project_tasks:manage — every grant to assign.
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);

select throws_ok($$
  update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a003'
   where id = 'aaaaaaaa-0000-0000-0000-0000000f9001'
$$, '42501',
  'the task list for "Teaser statics x3" has not been approved by Creative A yet, so its work cannot be assigned',
  'a single job''s work is HELD until the owner approves the list — the message names both (d.3)');

-- The campaign beside it is held by the same rule, and this is the assertion ADR-0100 turned on
-- its head: it used to say an approved department brief made a campaign's work assignable with
-- `tasks_approved_at` still null, which is now precisely what d.2 forbids. One rule for every kind
-- of work — the person accountable for the deliverable reads the list and accepts it — so a brief
-- somebody else approved releases nothing.
select throws_ok($$
  update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a003'
   where id = 'aaaaaaaa-0000-0000-0000-0000000f9003'
$$, '42501',
  'the task list for "Campaign KV" has not been approved by Creative A yet, so its work cannot be assigned',
  'a CAMPAIGN is held by the SAME gate, its department brief approved or not (ADR-0100 d.2)');

-- And ad-hoc work is not governed at all.
select lives_ok($$
  update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a003'
   where id = 'aaaaaaaa-0000-0000-0000-0000000f9004'
$$, 'ad-hoc work is not gated — it has no campaign');

-- ---------------------------------------------------------------- who may approve ----
-- A team member: not the owner, no deliverable_owner:manage.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a020'), true);
select throws_ok($$
  select public.approve_deliverable_tasks('aaaaaaaa-0000-0000-0000-0000000d9001')
$$, '42501', null, 'a team member who is not the owner cannot approve the list (d.4)');

-- Tenant B: the row does not exist for them.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000b001'), true);
select throws_ok($$
  select public.approve_deliverable_tasks('aaaaaaaa-0000-0000-0000-0000000d9001')
$$, 'P0002', null, 'tenant B cannot approve tenant A''s list — not found');

-- Found by review: the two columns were writable by bare PATCH through deliverables_tenant_write
-- (any project_tasks:manage holder, tenant-wide) and deliverables_reviewer_update, so the RPC's
-- refusal above was decoration. Fenced in 20260911130600. The Traffic Manager holds every grant to
-- reach the row and is refused on the column; the member is refused too.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);
select throws_ok($$
  update deliverables
     set tasks_approved_at = now(), tasks_approved_by = '00000000-0000-0000-0000-00000000a003'
   where id = 'aaaaaaaa-0000-0000-0000-0000000d9001'
$$, '42501', null, 'the stamp cannot be written by hand, even by somebody who may approve — the RPC is the only door (d.2)');
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a020'), true);
select throws_ok($$
  update deliverables
     set tasks_approved_at = now(), tasks_approved_by = '00000000-0000-0000-0000-00000000a003'
   where id = 'aaaaaaaa-0000-0000-0000-0000000d9001'
$$, '42501', null, '… and not by a team member forging the owner''s name');
select is(
  (select tasks_approved_at from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d9001'),
  null, 'the list is still unapproved');

-- The owner.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select lives_ok($$
  select public.approve_deliverable_tasks('aaaaaaaa-0000-0000-0000-0000000d9001')
$$, 'the OWNER approves their own list (d.4)');
select is(
  (select tasks_approved_by from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d9001'),
  '00000000-0000-0000-0000-00000000a003'::uuid,
  'tasks_approved_by is stamped from auth.uid()');
select isnt(
  (select tasks_approved_at from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d9001'),
  null, 'and tasks_approved_at is set');

-- Idempotent: a second approval by somebody else authorised changes nothing.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);
select lives_ok($$
  select public.approve_deliverable_tasks('aaaaaaaa-0000-0000-0000-0000000d9001')
$$, 'approving an approved list is not an error (d.4)');
select is(
  (select tasks_approved_by from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d9001'),
  '00000000-0000-0000-0000-00000000a003'::uuid,
  'and the FIRST approval stands — the stamp is not rewritten');

-- The failsafe: the Traffic Manager approves for an absent owner, by deliverable_owner:manage and
-- tenant scope, with no role named anywhere (d.4).
select lives_ok($$
  select public.approve_deliverable_tasks('aaaaaaaa-0000-0000-0000-0000000d9002')
$$, 'deliverable_owner:manage in scope approves for an absent owner (d.4)');
select is(
  (select tasks_approved_by from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d9002'),
  '00000000-0000-0000-0000-00000000a002'::uuid,
  'and it records who did');

-- The campaign's account manager is REFUSED (ADR-0090 d.4, amended 12 Sep). They hold
-- deliverable_owner:manage by role, but the account branch of in_write_scope is no longer offered
-- to this gate: the AM approves the CAMPAIGN, the department owns and accepts the task list.
-- Accountability sits where the responsibility belongs.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a021'), true);
select throws_ok($$
  select public.approve_deliverable_tasks('aaaaaaaa-0000-0000-0000-0000000d9009')
$$, '42501', null, 'the account manager CANNOT approve the task list on their own job (d.4, amended 12 Sep)');
select is(
  (select tasks_approved_at from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d9009'),
  null, 'and the list stays unapproved');

-- The UI reads the SAME predicate through the can_approve_tasks computed column, so the button is
-- offered to exactly whom the RPC admits — never the account manager.
select is(
  (select public.can_approve_tasks(d) from deliverables d where d.id = 'aaaaaaaa-0000-0000-0000-0000000d9009'),
  false, 'can_approve_tasks is false for the account manager — the button is not offered to them');
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select is(
  (select public.can_approve_tasks(d) from deliverables d where d.id = 'aaaaaaaa-0000-0000-0000-0000000d9009'),
  true, 'can_approve_tasks is true for the owner — the same answer the RPC gives');

-- ---------------------------------------------------------------- the gate, opened ----
-- Back to the Traffic Manager, who holds every grant to assign.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);
select lives_ok($$
  update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a003'
   where id = 'aaaaaaaa-0000-0000-0000-0000000f9001'
$$, 'and only then can the single job''s work be assigned (d.3)');

-- ------------------------------------------- the campaign gate, now in the owner's hands ----
-- The proof that the old gate is GONE rather than merely quiet, and it has to be made from the
-- state that used to refuse everything. Take the department brief's approval away — yesterday this
-- alone produced the ADR-0070 refusal on every assignment — and then let the deliverable's OWNER
-- approve the task list. The work assigns. Nothing reads the brief any more (ADR-0100 d.2, which
-- retires ADR-0070's approver machinery rather than deleting it); the only thing now standing
-- between a campaign's work and its people is the person accountable for it having read the list.
reset role;
select set_config('request.jwt.claims', '', true);
update campaign_briefs set approved_at = null, approved_by = null
 where id = 'aaaaaaaa-0000-0000-0000-0000000cb901';

-- Through the RPC, as the owner — the only door to the stamp (d.2), and a campaign deliverable was
-- always a legal subject for it: neither the RPC nor app.may_approve_deliverable_tasks ever forked
-- on the campaign's kind, because the restriction to single jobs lived in the GATE.
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select public.approve_deliverable_tasks('aaaaaaaa-0000-0000-0000-0000000d9003');

select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);
select lives_ok($$
  update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a003'
   where id = 'aaaaaaaa-0000-0000-0000-0000000f9003'
$$, 'the OWNER''s approval releases a CAMPAIGN''s work, with its department brief UNapproved (ADR-0100 d.2)');

select * from finish();
rollback;
