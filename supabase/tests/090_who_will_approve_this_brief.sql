-- I40 — the "Brief approvers" list on step 5, and the two ways it used to be wrong.
--
-- It was built from a role list written in the client, so it named every `department_lead`,
-- `team_lead` and `deputy_team_lead` in the department. Edward, 5 Sep: *"it shows the brief
-- approvers as the assigned owner, the Department Lead and 2 other team leaders and a team member
-- for the same department."* Two properties fix that, and both are asserted here:
--
--   * ROLE NAMES ARE NOT THE ANSWER (ADR-0072). A per-user PERMISSION grant must appear and a
--     revoked one must vanish, because that is the documented way to hand approval to a stand-in
--     (ADR-0036) and the old list could not see it at all. A per-user SCOPE grant is a different
--     thing and is asserted the other way (I40.15): it widens what somebody may write, not whose
--     brief they answer for, and reading it as the latter named five uninvolved people live.
--   * SCOPE DECIDES WHO IS RELEVANT. A team lead whose team the campaign never touches is not this
--     brief's approver, and the agency-wide failsafe is absent without any exclusion being written
--     for it — `tenant` and `account` scope simply do not match a department, which is ADR-0070
--     d.3's whole argument.
--
-- And one anti-drift assertion: `app.user_has_permission` asked about a person must agree with
-- `app.has_permission` asked BY that person. They are the same rule over different inputs, and the
-- screen naming somebody the RPC would refuse is the failure this file exists to prevent.
begin;
select plan(18);
\ir helpers/seed.sql
select app.seed_tenant_brief_approval_grants(id) from tenants;
select app.seed_account_director('aaaaaaaa-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------- fixtures ----
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a010', 'art-lead@a.test'),
  ('00000000-0000-0000-0000-00000000a011', 'copy-lead@a.test'),
  ('00000000-0000-0000-0000-00000000a012', 'art-maker@a.test'),
  ('00000000-0000-0000-0000-00000000a013', 'director@a.test'),
  ('00000000-0000-0000-0000-00000000a014', 'account-mgr@a.test');

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000de001','aaaaaaaa-0000-0000-0000-000000000001','Creative');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f001','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000de001','Art'),
  ('aaaaaaaa-0000-0000-0000-00000000f002','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000de001','Copy');

-- a003 leads Creative. The other three are its Art lead, its Copy lead, and an Art maker.
update user_profiles
   set role_id = (select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                    and key = 'department_lead'),
       department_id = 'aaaaaaaa-0000-0000-0000-0000000de001'
 where id = '00000000-0000-0000-0000-00000000a003';

insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
          and r.key = v.role_key),
       'aaaaaaaa-0000-0000-0000-0000000de001', v.team::uuid
from (values
  ('00000000-0000-0000-0000-00000000a010','Art Lead',  'team_lead',  'aaaaaaaa-0000-0000-0000-00000000f001'),
  ('00000000-0000-0000-0000-00000000a011','Copy Lead', 'team_lead',  'aaaaaaaa-0000-0000-0000-00000000f002'),
  ('00000000-0000-0000-0000-00000000a012','Art Maker', 'team_member','aaaaaaaa-0000-0000-0000-00000000f001')
) as v(id, name, role_key, team);

-- The two account-scoped people, who belong to no department at all. a014 is made this campaign's
-- account manager below, which is the only thing that is supposed to bring them into it.
insert into user_profiles (id, tenant_id, display_name, role_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
          and r.key = v.role_key)
from (values
  ('00000000-0000-0000-0000-00000000a013','Director',    'account_director'),
  ('00000000-0000-0000-0000-00000000a014','Account Mgr', 'account_manager')
) as v(id, name, role_key);

update campaigns set account_manager_id = '00000000-0000-0000-0000-00000000a014'
 where id = 'aaaaaaaa-0000-0000-0000-00000000e001';

-- `test_claims` is built by helpers/seed.sql from the profiles that existed THEN, so people added
-- afterwards have no claim to sign in with — and `set_config` with a null lands them outside every
-- tenant, which reads as "brief not found" rather than as a missing fixture.
insert into test_claims (id, jwt)
select up.id,
       json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id in ('00000000-0000-0000-0000-00000000a010',
                 '00000000-0000-0000-0000-00000000a011',
                 '00000000-0000-0000-0000-00000000a012',
                 '00000000-0000-0000-0000-00000000a013',
                 '00000000-0000-0000-0000-00000000a014');

insert into campaign_briefs (id, tenant_id, campaign_id, department_id, brief_type, values) values
  ('aaaaaaaa-0000-0000-0000-0000000cb001','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','aaaaaaaa-0000-0000-0000-0000000de001','creative','{}');

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000c5001','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','Main');

-- Two Creative deliverables — Creative because their OWNERS are, which is the only way it can be
-- (stamped from the owner, ADR-0050 d.2). One is assigned to the Art LEAD, one to an Art MAKER.
-- Nothing here gives Copy anything to do, and that is the point: Copy's lead sits in the same
-- department and must still not appear.
insert into deliverables (id, tenant_id, stream_id, name, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d1001','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000c5001','Key Visual','00000000-0000-0000-0000-00000000a010'),
  ('aaaaaaaa-0000-0000-0000-0000000d1002','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000c5001','Cutdowns','00000000-0000-0000-0000-00000000a012');

select is(
  (select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1001'),
  'aaaaaaaa-0000-0000-0000-0000000de001'::uuid,
  'fixture check: the deliverable is Creative''s, stamped from its owner');

-- ---------------------------------------------------------------- the list ----
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);

select results_eq($q$
  select display_name::text, is_assigned_owner
    from public.department_brief_approvers('aaaaaaaa-0000-0000-0000-00000000e001')
   order by display_name
$q$, $q$ values ('Art Lead', true), ('Creative A', false) $q$,
  'the person this campaign ASSIGNED, and the department''s lead — nobody else');

-- Each exclusion stated on its own, because each was a name on Edward's screen.
select is_empty($q$
  select 1 from public.department_brief_approvers('aaaaaaaa-0000-0000-0000-00000000e001')
   where display_name = 'Copy Lead'
$q$, 'a lead in the same department who was assigned nothing is NOT its approver');

-- Assigned, and still not listed. Being given work does not make somebody able to ACCEPT it —
-- that is d.2's whole separation — and naming an owner the RPC would refuse is the drift this
-- file exists to prevent.
select is_empty($q$
  select 1 from public.department_brief_approvers('aaaaaaaa-0000-0000-0000-00000000e001')
   where display_name = 'Art Maker'
$q$, 'an assigned owner who does not hold briefs:approve is NOT named');

select is_empty($q$
  select 1 from public.department_brief_approvers('aaaaaaaa-0000-0000-0000-00000000e001')
   where display_name in ('Admin A', 'Booker A')
$q$, 'the agency-wide failsafe is absent — it can approve everything, so it answers nothing (d.6)');

-- I40.15. A per-user SCOPE grant over the department is not a reason to be named. Copy's lead holds
-- `briefs:approve`, sits in this department, and is now given Creative as a scope target — the exact
-- shape that put three Account Managers, the Account Director and a Team Leader under CREATIVE on
-- Edward's screen on 6 Sep. It says what they may WRITE, not whose brief they answer for. They can
-- still approve it; they are simply not the answer to "who do I chase about this brief".
set local role postgres;
insert into user_scope_grants (tenant_id, user_id, department_id)
values ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000a011',
        'aaaaaaaa-0000-0000-0000-0000000de001');
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);

select is_empty($q$
  select 1 from public.department_brief_approvers('aaaaaaaa-0000-0000-0000-00000000e001')
   where display_name = 'Copy Lead'
$q$, 'a per-user SCOPE grant over the department does not put somebody on the list (I40.15)');

-- ---------------------------------------------------------------- the overlay ----
-- The thing the old role list could not see. ADR-0036's per-user grants are how a stand-in is
-- appointed while a lead is away; an approver list blind to them names the wrong people. It is the
-- PERMISSION half that is read — `briefs:approve` handed to one person — and it decides the answer
-- for somebody the campaign actually gave work to.
set local role postgres;
insert into user_grants (tenant_id, user_id, resource, action, effect)
values ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000a012',
        'briefs','approve','allow');
insert into user_scope_grants (tenant_id, user_id, department_id)
values ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000a012',
        'aaaaaaaa-0000-0000-0000-0000000de001');
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);

select isnt_empty($q$
  select 1 from public.department_brief_approvers('aaaaaaaa-0000-0000-0000-00000000e001')
   where display_name = 'Art Maker'
$q$, 'an owner given briefs:approve by per-user grant IS listed — a role list would never find them');

-- And a deny overrides, exactly as app.has_permission does.
set local role postgres;
update user_grants set effect = 'deny'
 where user_id = '00000000-0000-0000-0000-00000000a012' and resource = 'briefs';
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);

select is_empty($q$
  select 1 from public.department_brief_approvers('aaaaaaaa-0000-0000-0000-00000000e001')
   where display_name = 'Art Maker'
$q$, 'a deny removes them again — the overlay is read in both directions');

-- ---------------------------------------------------------------- the draft ----
-- The path step 5 actually takes. A draft has NO deliverable rows — they are written once, at
-- submit (ADR-0067) — so a listing that read only the `deliverables` table would show every
-- department brief as having nobody to approve it, on the one screen where the question is asked.
set local role postgres;
insert into campaigns (id, tenant_id, client_id, name, status, brief) values
  ('aaaaaaaa-0000-0000-0000-00000000e002', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Still In The Wizard', 'draft',
   '{"proposition":"p","deliverables":[{"name":"Key Visual",'
   '"ownerUserId":"00000000-0000-0000-0000-00000000a010"},{"name":"Untyped","ownerUserId":""}]}');
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);

-- The second row's owner is an empty string, which is what a half-filled line holds. It must skip
-- that row rather than abort the listing.
select results_eq($q$
  select display_name::text
    from public.department_brief_approvers('aaaaaaaa-0000-0000-0000-00000000e002')
   order by display_name
$q$, $q$ values ('Art Lead'), ('Creative A') $q$,
  'a DRAFT is read from the brief the wizard saved — same answer, one step before the rows exist');

-- ---------------------------------------------------------------- and they can ----
-- The list would be a lie if the RPC then refused them. ADR-0070 d.3 says *"A team lead may approve
-- their own department's brief"*; until I40 the code did not, because `approve_department_brief`
-- asks with no team named and the `team` branch required one. Nothing caught it — 082 exercises a
-- Department Lead and the failsafe, never a team lead.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a010'),true);
select lives_ok($q$
  select public.approve_department_brief('aaaaaaaa-0000-0000-0000-0000000cb001')
$q$, 'the Art lead accepts CREATIVE''s brief — what ADR-0070 d.3 always said they could');

-- And the widening is exactly as narrow as it claims. A question that NAMES a team still binds
-- them to their own, so nothing reaches a sibling team's work.
select ok(
  not app.in_write_scope('aaaaaaaa-0000-0000-0000-0000000de001',
                         'aaaaaaaa-0000-0000-0000-00000000f002', null),
  'naming Copy''s team still refuses the Art lead — only a department-level question widened');

-- ---------------------------------------------------------------- the failsafe ----
-- The list above names none of these people ON PURPOSE (ADR-0070 d.6) — they can approve anything,
-- so naming them would put the same names under every department. Being off the list must not mean
-- being unable, which is the difference between a quiet display choice and a broken failsafe. This
-- asserts the RPC's own guard, verbatim, as each of them.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select ok(app.has_permission('briefs','approve')
          and app.in_write_scope('aaaaaaaa-0000-0000-0000-0000000de001', null, null),
  'Power Admin can still accept any department''s brief');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select ok(app.has_permission('briefs','approve')
          and app.in_write_scope('aaaaaaaa-0000-0000-0000-0000000de001', null, null),
  'the Traffic Manager can still accept any department''s brief — the absence failsafe (d.3)');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a013'),true);
select ok(app.has_permission('briefs','approve')
          and app.in_write_scope('aaaaaaaa-0000-0000-0000-0000000de001', null, null),
  'the Account Director can too — ADR-0073 d.6, a fallback rather than a default');

-- The Account Manager of THIS campaign. ADR-0070 d.2 was amended on 3 Sep — Edward: *"the account
-- manager can approve their own brief, even if they created it"* — and the permission catalog says
-- so in as many words. Asserted here because `approve_department_brief` asks
-- `in_write_scope(department, null, null)`, and an account-scoped person is matched by the MANAGER
-- argument, which that call does not pass.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a014'),true);
select ok(app.has_permission('briefs','approve')
          and app.in_write_scope('aaaaaaaa-0000-0000-0000-0000000de001', null,
                                 app.campaign_account_manager('aaaaaaaa-0000-0000-0000-00000000e001')),
  'the campaign''s Account Manager holds the grant and is in scope of their own campaign');

-- And the same question through the FUNCTION, which is the only version that matters. It asks
-- `in_write_scope(department, null, null)` — no manager argument — so being the campaign's account
-- manager cannot be what lets them in. The Art lead's approval above is cleared first, because
-- approving twice returns silently by design (d.8) and would make this pass for the wrong reason.
set local role postgres;
update campaign_briefs set approved_at = null, approved_by = null
 where id = 'aaaaaaaa-0000-0000-0000-0000000cb001';
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a014'),true);
select lives_ok($q$
  select public.approve_department_brief('aaaaaaaa-0000-0000-0000-0000000cb001')
$q$, 'the campaign''s Account Manager accepts a brief on it (ADR-0070 d.2, amended 3 Sep)');

-- ---------------------------------------------------------------- no drift ----
-- Asked ABOUT a person, and asked BY that person, must give the same answer.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select is(
  app.user_has_permission('00000000-0000-0000-0000-00000000a003', 'briefs', 'approve'),
  app.has_permission('briefs', 'approve'),
  'user_has_permission agrees with has_permission for the department lead');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a012'),true);
select is(
  app.user_has_permission('00000000-0000-0000-0000-00000000a012', 'briefs', 'approve'),
  app.has_permission('briefs', 'approve'),
  'and for somebody a deny grant has just removed it from');

select * from finish();
rollback;
