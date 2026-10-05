-- ADR-0087 / I45 — booking outside your reach is a request, and the resource's lead answers it.
--
-- ADR-0139 (3 Oct) narrows who is asked: the person's TEAM LEADER (the deputy only when she is on leave; no team or no
-- leader → the department lead), not every scoped lead. So below, the Studio team lead is the one told and the one who
-- answers; the Production department lead is neither (until the request escalates — suite 218). A lead of an unrelated
-- department no longer reaches the calendar at all, and the account manager asks rather than books (section 10).
--
-- ADR-0098 (22 Sep): a department lead, team lead or account manager now reaches EVERY calendar for
-- scheduling, so none of the seeded roles ever raises a request. The request path stands for a
-- caller with the booking grant and none of those scopes — a custom role with a per-user scope grant
-- (ADR-0036). The requester below is therefore a CUSTOM ROLE (scope `self`, a department lead's
-- grants, a scope grant over Creative): she holds the Creative task and cannot reach the Production
-- calendar, exactly the shape every assertion here depends on. What ADR-0098 changed in the
-- deciding set is asserted where it shows: a lead of an unrelated department and the account
-- manager now DECIDE (unnamed), and the account manager's own booking is direct (section 10).
--
-- The property that carries the most weight is the FIRST group: a Creative lead giving a Production
-- person a task produces a `pending` row and touches NOTHING on the task — no assignee, no dates,
-- no bookings. Everything ADR-0060 called a half-built state must stay impossible here.
--
-- The second is d.7's combination of two people's authority: the Production lead who approves does
-- NOT hold Creative, and the assignment goes through all the same. The third is the `090` shape —
-- the notified set equals the deciding set minus the agency-wide failsafe and scope-grant holders —
-- asserted by evaluating the primitives AS each person rather than by reading a role name.
--
-- Fixtures (tenant A): Creative and Production departments, Studio team under Production.
--   a020 Creative Lead     CUSTOM role (scope self) + a scope grant over Creative — the requester
--   a021 Production Lead   department_lead, Production         — may decide, is told
--   a022 Studio Lead       team_lead, Production / Studio       — may decide, is told
--   a023 Studio Maker      team_member, Production / Studio     — the person asked for (resource d020)
--   a024 Unplaced Maker    team_member, no department, no team  — resource d021 (d.13)
--   a025 Copy Lead         team_lead, Creative / Copy, + a per-user SCOPE grant over Production
--                                                              — may decide, NOT told (d.6, I40.15)
--   a026 Media Lead        department_lead, Media               — may decide (ADR-0098), NOT told
--   a027 Account Mgr       account_manager, the campaign's AM   — may decide (ADR-0098), NOT told; books directly
--   a001 Admin A           power_admin (tenant)                 — may decide, NOT told
--   a003 Creative A        team_member (self)                   — cannot request (d.3)
--   b001 Admin B           tenant B                             — sees nothing, answers nothing
begin;
select plan(61);
\ir helpers/seed.sql

-- ---------------------------------------------------------------- fixtures ----
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a020', 'creative-lead@a.test'),
  ('00000000-0000-0000-0000-00000000a021', 'production-lead@a.test'),
  ('00000000-0000-0000-0000-00000000a022', 'studio-lead@a.test'),
  ('00000000-0000-0000-0000-00000000a023', 'studio-maker@a.test'),
  ('00000000-0000-0000-0000-00000000a024', 'unplaced-maker@a.test'),
  ('00000000-0000-0000-0000-00000000a025', 'copy-lead@a.test'),
  ('00000000-0000-0000-0000-00000000a026', 'media-lead@a.test'),
  ('00000000-0000-0000-0000-00000000a027', 'account-mgr@a.test');

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000de001','aaaaaaaa-0000-0000-0000-000000000001','Creative'),
  ('aaaaaaaa-0000-0000-0000-0000000de002','aaaaaaaa-0000-0000-0000-000000000001','Production'),
  ('aaaaaaaa-0000-0000-0000-0000000de003','aaaaaaaa-0000-0000-0000-000000000001','Media');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f001','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000de001','Copy'),
  ('aaaaaaaa-0000-0000-0000-00000000f002','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000de002','Studio');

-- ADR-0098: the requester's role — a department lead's grants without a lead's reach.
insert into roles (id, tenant_id, key, name, scope) values
  ('aaaaaaaa-0000-0000-0000-00000000c098','aaaaaaaa-0000-0000-0000-000000000001','custom_booker','Custom booker','self');
insert into role_grants (tenant_id, role_id, resource, action)
select g.tenant_id, 'aaaaaaaa-0000-0000-0000-00000000c098', g.resource, g.action
  from role_grants g join roles r on r.id = g.role_id
 where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = 'department_lead';

insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
          and r.key = v.role_key),
       v.dept::uuid, v.team::uuid
from (values
  ('00000000-0000-0000-0000-00000000a020','Creative Lead',   'custom_booker',  'aaaaaaaa-0000-0000-0000-0000000de001', null),
  ('00000000-0000-0000-0000-00000000a021','Production Lead', 'department_lead','aaaaaaaa-0000-0000-0000-0000000de002', null),
  ('00000000-0000-0000-0000-00000000a022','Studio Lead',     'team_lead',      'aaaaaaaa-0000-0000-0000-0000000de002','aaaaaaaa-0000-0000-0000-00000000f002'),
  ('00000000-0000-0000-0000-00000000a023','Studio Maker',    'team_member',    'aaaaaaaa-0000-0000-0000-0000000de002','aaaaaaaa-0000-0000-0000-00000000f002'),
  ('00000000-0000-0000-0000-00000000a024','Unplaced Maker',  'team_member',    null, null),
  ('00000000-0000-0000-0000-00000000a025','Copy Lead',       'team_lead',      'aaaaaaaa-0000-0000-0000-0000000de001','aaaaaaaa-0000-0000-0000-00000000f001'),
  ('00000000-0000-0000-0000-00000000a026','Media Lead',      'department_lead','aaaaaaaa-0000-0000-0000-0000000de003', null),
  ('00000000-0000-0000-0000-00000000a027','Account Mgr',     'account_manager', null, null)
) as v(id, name, role_key, dept, team);

-- Copy Lead holds a per-user SCOPE grant over Production (ADR-0036): may decide, is not named.
-- `granted_by` is stamped from auth.uid() by trigger, so the admin's claims are set first.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
insert into user_scope_grants (tenant_id, user_id, department_id)
values ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000a025',
        'aaaaaaaa-0000-0000-0000-0000000de002'),
       -- ADR-0098: the requester reaches Creative through a grant, and nothing else.
       ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000a020',
        'aaaaaaaa-0000-0000-0000-0000000de001');

-- The calendars. d020 is PLACED (Production / Studio); d021 is not placed at all.
insert into resources (id, tenant_id, kind, name, capacity_model, load_ceiling_pct, warn_at_pct, user_id, department_id, team_id) values
  ('aaaaaaaa-0000-0000-0000-0000000097d0','aaaaaaaa-0000-0000-0000-000000000001',
   'human','Studio Maker','load_based',120.0,100.0,'00000000-0000-0000-0000-00000000a023',
   'aaaaaaaa-0000-0000-0000-0000000de002','aaaaaaaa-0000-0000-0000-00000000f002'),
  ('aaaaaaaa-0000-0000-0000-0000000097d1','aaaaaaaa-0000-0000-0000-000000000001',
   'human','Unplaced Maker','load_based',120.0,100.0,'00000000-0000-0000-0000-00000000a024',
   null, null);

-- `test_claims` was built by helpers/seed.sql from the profiles that existed THEN.
insert into test_claims (id, jwt)
select up.id,
       json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id in ('00000000-0000-0000-0000-00000000a020','00000000-0000-0000-0000-00000000a021',
                 '00000000-0000-0000-0000-00000000a022','00000000-0000-0000-0000-00000000a023',
                 '00000000-0000-0000-0000-00000000a024','00000000-0000-0000-0000-00000000a025',
                 '00000000-0000-0000-0000-00000000a026','00000000-0000-0000-0000-00000000a027');

update campaigns set account_manager_id = '00000000-0000-0000-0000-00000000a027'
 where id = 'aaaaaaaa-0000-0000-0000-00000000e001';

-- A CREATIVE deliverable with four Creative tasks, none assigned. The department is Creative's so
-- that the requester holds the task half (d.3) and the approver, from Production, does not (d.7).
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000097f1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','S97');
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id, department_id, due_at, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000097e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000097f1','Shoot 97','in_progress',
   '00000000-0000-0000-0000-00000000a001','aaaaaaaa-0000-0000-0000-0000000de001','2026-10-01 15:00+00', '00000000-0000-0000-0000-00000000a001');
-- 20 Sep: the department has accepted this work (ADR-0072 d.6) — see helpers/seed.sql.
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-00000000e001');
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, department_id, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000097a1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000097e1','Studio day','todo','aaaaaaaa-0000-0000-0000-0000000de001', 8),
  ('aaaaaaaa-0000-0000-0000-0000000097a2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000097e1','Second day','todo','aaaaaaaa-0000-0000-0000-0000000de001', 8),
  ('aaaaaaaa-0000-0000-0000-0000000097a3','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000097e1','Third day','todo','aaaaaaaa-0000-0000-0000-0000000de001', 8),
  ('aaaaaaaa-0000-0000-0000-0000000097a4','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000097e1','Fourth day','todo','aaaaaaaa-0000-0000-0000-0000000de001', 8);

-- The task as it stands, byte for byte, for the "nothing changed" assertions.
create temp table before97 as
  select id, title, assignee_id, department_id, team_id, starts_at, due_at, sla_hours, review_mode,
         schedule_overridden, status, updated_at
    from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000097a1';
grant select on before97 to public;

-- ============================================================ 1. the request ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a020'),true);

-- Fixture check: the requester holds the task and NOT the calendar — otherwise every assertion
-- below would pass for the wrong reason.
select ok(app.has_permission('bookings', 'create')
          and app.in_write_scope('aaaaaaaa-0000-0000-0000-0000000de001', null, null)
          and not app.resource_in_scheduling_scope('aaaaaaaa-0000-0000-0000-0000000097d0'),
  'fixture: the requester may book, holds the Creative task, and cannot reach the Production calendar (ADR-0098: a custom role, not a lead)');

select results_eq($q$
  select outcome, request_id is not null, reschedule_needed
    from public.update_task_assignment(
      'aaaaaaaa-0000-0000-0000-0000000097a1', 'Studio day',
      '00000000-0000-0000-0000-00000000a023',
      '[{"user_id": "00000000-0000-0000-0000-00000000a001", "is_mandatory": true}]'::jsonb,
      '2026-09-14 05:00:00+00', '2026-09-15 13:00:00+00', 16, 'manual')
$q$, $q$ values ('requested', true, false) $q$,
  'an out-of-reach assignment answers "requested" with a request id, and asks for no scheduling');

-- d.4: NOTHING on the task changes while it is pending.
select results_eq($q$
  select title, assignee_id, department_id, team_id, starts_at, due_at, sla_hours, review_mode,
         schedule_overridden, status, updated_at
    from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000097a1'
$q$, $q$
  select title, assignee_id, department_id, team_id, starts_at, due_at, sla_hours, review_mode,
         schedule_overridden, status, updated_at
    from before97
$q$, 'the task is byte-identical: no assignee, no dates, no reviewers written, no department stamped');

select is(
  (select count(*)::int from bookings where bookings.sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a1'),
  0, 'and no booking exists — a pending request holds no capacity (d.10)');

select results_eq($q$
  select status, resource_id, assignee_id, requested_by, title, hours, review_mode, starts_at
    from sub_task_assignment_requests where sub_task_assignment_requests.sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a1'
$q$, $q$
  values ('pending', 'aaaaaaaa-0000-0000-0000-0000000097d0'::uuid, '00000000-0000-0000-0000-00000000a023'::uuid,
          '00000000-0000-0000-0000-00000000a020'::uuid, 'Studio day', 16::numeric, 'manual',
          '2026-09-14 05:00:00+00'::timestamptz)
$q$, 'the record names the calendar, the person, the requester and the payload that will be applied');

-- The requester can see their own request (allow), which the grid and the task both need.
select is(
  (select count(*)::int from sub_task_assignment_requests),
  1, 'sub_task_assignment_requests_tenant_select: the requester sees the row');

-- d.4 again: a second pending request on the same task is refused.
select throws_ok($q$
  select public.update_task_assignment(
      'aaaaaaaa-0000-0000-0000-0000000097a1', 'Studio day',
      '00000000-0000-0000-0000-00000000a023', null, null, null, null, null)
$q$, '22023', null, 'a second pending request on the same task is refused');

-- d.5: the requester cannot answer their own request.
select throws_ok($q$
  select public.decide_assignment_request(
      (select id from sub_task_assignment_requests where status = 'pending'), true)
$q$, '42501', null, 'the requester cannot approve their own request');

select throws_ok($q$
  select public.withdraw_assignment_request('aaaaaaaa-0000-0000-0000-000000000000')
$q$, 'P0002', null, 'withdrawing a request that does not exist says so');

-- ================================================ 2. who is told (d.6) ====
-- `notifications` is recipient-scoped: reset role before reading, or the zero-assertions below
-- pass whether or not the row exists (traps.md).
reset role;
select results_eq($q$
  select user_id from notifications
   where type = 'assignment_requested' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000097a1'
   order by user_id
$q$, $q$ values ('00000000-0000-0000-0000-00000000a022'::uuid) $q$,
  'the Studio''s team lead is told — the person''s own team leader answers (ADR-0139 d.3)');

select is(
  (select count(*)::int from notifications
    where type = 'assignment_requested' and user_id in (
      '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a002')),
  0, 'the tenant-wide failsafe is NOT told — it can approve anything and would receive every request');

select is(
  (select count(*)::int from notifications
    where type = 'assignment_requested' and user_id = '00000000-0000-0000-0000-00000000a025'),
  0, 'a per-user SCOPE-grant holder is NOT told — a scope grant says what they may write, not whose request they answer (I40.15)');

select is(
  (select count(*)::int from notifications
    where type = 'assignment_requested' and user_id in (
      '00000000-0000-0000-0000-00000000a020', '00000000-0000-0000-0000-00000000a026')),
  0, 'neither the requester nor a lead of an unrelated department is told');

select is(
  (select actor_id from notifications
    where type = 'assignment_requested' and user_id = '00000000-0000-0000-0000-00000000a022'),
  '00000000-0000-0000-0000-00000000a020'::uuid,
  'the notification names the requester as actor');

-- -------------------------------------------- the 090 shape: named = deciding − failsafe ----
-- Evaluate d.5's test AS each person in the tenant — the primitives, not a role list — and
-- compare with the listed set. Named must be exactly those who decide by DEPARTMENT or TEAM reach.
-- ADR-0098: `decides` is the SCHEDULING reach (d.5's test as it now stands); `reaches` is the
-- department/team reach that names who is told (d.6, unchanged).
create temp table deciders97 (user_id uuid, decides boolean, reaches boolean, scope text);
grant select on deciders97 to public;
do $$
declare u record;
begin
  for u in select up.id, r.scope from user_profiles up join roles r on r.id = up.role_id
            where up.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and up.is_active loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', u.id, 'app_metadata',
        json_build_object('tenant_id', 'aaaaaaaa-0000-0000-0000-000000000001',
                          'app_role_id', (select role_id from user_profiles where id = u.id)))::text, true);
    insert into deciders97 values (u.id,
      app.has_permission('bookings', 'create')
        and app.resource_in_scheduling_scope('aaaaaaaa-0000-0000-0000-0000000097d0'),
      app.has_permission('bookings', 'create')
        and app.resource_in_write_scope('aaaaaaaa-0000-0000-0000-0000000097d0'),
      u.scope);
  end loop;
end $$;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);

select results_eq($q$
  select user_id from public.assignment_request_approvers('aaaaaaaa-0000-0000-0000-0000000097d0') order by 1
$q$, $q$ values ('00000000-0000-0000-0000-00000000a022'::uuid) $q$,
  'the listed set is the person''s own team leader, and only her (ADR-0139 d.3)');

select ok(
  not exists (select 1 from public.assignment_request_approvers('aaaaaaaa-0000-0000-0000-0000000097d0') a
               join deciders97 d on d.user_id = a.user_id where not d.decides),
  'nobody is named whom decide_assignment_request would refuse');

-- Each of the deciders the list leaves off CAN decide (d.5): the failsafe and the scope grant.
select ok((select decides from deciders97 where user_id = '00000000-0000-0000-0000-00000000a001'),
  'Power Admin reaches the calendar — it books directly, and is not asked');
select ok((select decides from deciders97 where user_id = '00000000-0000-0000-0000-00000000a025'),
  'a per-user scope grant over Production still reaches the calendar, though it is not asked');
select ok(not (select decides from deciders97 where user_id = '00000000-0000-0000-0000-00000000a026'),
  'a lead of an unrelated department no longer reaches the calendar (ADR-0139 d.1)');

-- ======================================== 3. tenant B: sees nothing, answers nothing ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b001'),true);
select is(
  (select count(*)::int from sub_task_assignment_requests),
  0, 'sub_task_assignment_requests_tenant_select: a tenant-B admin sees no tenant-A request');
select throws_ok($q$
  select public.decide_assignment_request('aaaaaaaa-0000-0000-0000-000000000001', true)
$q$, 'P0002', null, 'a tenant-B admin cannot answer it either — it is not found');

-- ============================================ 4. a team member cannot request (d.3) ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select throws_ok($q$
  select public.update_task_assignment(
      'aaaaaaaa-0000-0000-0000-0000000097a2', 'Second day',
      '00000000-0000-0000-0000-00000000a023', null, null, null, null, null)
$q$, '42501', null, 'a Team Member (self scope, no booking grant) is refused, not queued — exactly as they cannot book');
reset role;
select is(
  (select count(*)::int from sub_task_assignment_requests where status = 'pending'),
  1, 'and no request was recorded for them');

-- ================================================ 5. refusal changes nothing (d.8) ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a022'),true);
select results_eq($q$
  select outcome, reschedule_needed from public.decide_assignment_request(
      (select id from sub_task_assignment_requests where status = 'pending'), false, 'Booked on the Kite shoot that week')
$q$, $q$ values ('refused', false) $q$,
  'the Studio team lead refuses — either lead may answer, and the first answer closes it');

reset role;
select results_eq($q$
  select status, decided_by, reason, decided_at is not null
    from sub_task_assignment_requests where sub_task_assignment_requests.sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a1'
$q$, $q$ values ('refused', '00000000-0000-0000-0000-00000000a022'::uuid, 'Booked on the Kite shoot that week', true) $q$,
  'the record says who said no, and why');

select results_eq($q$
  select title, assignee_id, department_id, team_id, starts_at, due_at, sla_hours, review_mode,
         schedule_overridden, status, updated_at
    from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000097a1'
$q$, $q$
  select title, assignee_id, department_id, team_id, starts_at, due_at, sla_hours, review_mode,
         schedule_overridden, status, updated_at
    from before97
$q$, 'a refusal leaves the task byte-identical');

select is(
  (select count(*)::int from notifications
    where type = 'assignment_refused' and user_id = '00000000-0000-0000-0000-00000000a020'
      and actor_id = '00000000-0000-0000-0000-00000000a022'),
  1, 'the requester is told it was refused, by whom');

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a021'),true);
select throws_ok($q$
  select public.decide_assignment_request(
      (select id from sub_task_assignment_requests where sub_task_assignment_requests.sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a1'), true)
$q$, '22023', null, 'a request already answered cannot be answered again');

-- ============================================ 6. approval IS the assignment (d.7) ====
-- Asked again — a refusal is not a bar to asking again (d.8) — and this time the Studio's team lead says yes
-- (ADR-0139 d.3). She holds NO Creative scope; the request holds that half.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a020'),true);
select lives_ok($q$
  select public.update_task_assignment(
      'aaaaaaaa-0000-0000-0000-0000000097a1', 'Studio day',
      '00000000-0000-0000-0000-00000000a023',
      '[{"user_id": "00000000-0000-0000-0000-00000000a001", "is_mandatory": true}]'::jsonb,
      '2026-09-14 05:00:00+00', '2026-09-15 13:00:00+00', 16, 'manual')
$q$, 'the requester may ask again after a refusal');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a022'),true);
select ok(not app.in_write_scope('aaaaaaaa-0000-0000-0000-0000000de001', null, null),
  'fixture: the Studio lead does NOT hold the Creative task''s scope');

select results_eq($q$
  select outcome, reschedule_needed, sub_task_id from public.decide_assignment_request(
      (select id from sub_task_assignment_requests where status = 'pending'), true)
$q$, $q$ values ('approved', true, 'aaaaaaaa-0000-0000-0000-0000000097a1'::uuid) $q$,
  'the Studio lead approves: the task is assigned and the caller is asked to schedule it');

reset role;
select results_eq($q$
  select assignee_id, department_id, team_id, title, starts_at, sla_hours, review_mode, schedule_overridden
    from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000097a1'
$q$, $q$
  values ('00000000-0000-0000-0000-00000000a023'::uuid, 'aaaaaaaa-0000-0000-0000-0000000de002'::uuid,
          'aaaaaaaa-0000-0000-0000-00000000f002'::uuid, 'Studio day', '2026-09-14 05:00:00+00'::timestamptz,
          16::numeric, 'manual', false)
$q$, 'the request''s payload was applied and the department follows the assignee (ADR-0060 d.9)');

select is(
  (select count(*)::int from sub_task_reviewers where sub_task_reviewers.sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a1'
     and user_id = '00000000-0000-0000-0000-00000000a001' and is_mandatory),
  1, 'the reviewers named in the request are appointed on approval');

select results_eq($q$
  select status, decided_by from sub_task_assignment_requests
   where sub_task_assignment_requests.sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a1' and status <> 'refused'
$q$, $q$ values ('approved', '00000000-0000-0000-0000-00000000a022'::uuid) $q$,
  'the record says who approved');

select is(
  (select actor_id from notifications
    where type = 'assigned' and user_id = '00000000-0000-0000-0000-00000000a023'
      and entity_id = 'aaaaaaaa-0000-0000-0000-0000000097a1'),
  '00000000-0000-0000-0000-00000000a022'::uuid,
  'the person is told `assigned` exactly once, when it is true, with the approver as actor');

select is(
  (select count(*)::int from notifications
    where type = 'assignment_approved' and user_id = '00000000-0000-0000-0000-00000000a020'),
  1, 'the requester is told it was approved');

select is(
  (select count(*)::int from notifications
    where type = 'assignment_superseded'),
  0, 'the approval did NOT read as somebody else assigning it');

-- ADR-0040's trigger is untouched and still guards a direct write: the same Creative lead writing
-- the assignee column by hand (not through the RPC) is refused, as test 048 asserts in full.
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a020'),true);
select throws_ok($q$
  update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a023'
   where id = 'aaaaaaaa-0000-0000-0000-0000000097a2'
$q$, '42501', null, 'writing the assignee directly is still refused by ADR-0040''s trigger — only the RPC turns it into a request');

-- ================================================ 7. an unplaced resource (d.13) ====
select throws_ok($q$
  select public.update_task_assignment(
      'aaaaaaaa-0000-0000-0000-0000000097a2', 'Second day',
      '00000000-0000-0000-0000-00000000a024', null, null, null, null, null)
$q$, '42501', null, 'a request to a person nobody scoped can reach is refused, not queued');
reset role;
select is(
  (select count(*)::int from sub_task_assignment_requests where resource_id = 'aaaaaaaa-0000-0000-0000-0000000097d1'),
  0, 'and no request row was written for the unplaced calendar');

-- ========================================================= 8. withdrawing (d.9) ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a020'),true);
select lives_ok($q$
  select public.update_task_assignment(
      'aaaaaaaa-0000-0000-0000-0000000097a2', 'Second day',
      '00000000-0000-0000-0000-00000000a023', null, '2026-09-16 05:00:00+00', '2026-09-16 13:00:00+00', 8, null)
$q$, 'a second task is requested');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a022'),true);
select throws_ok($q$
  select public.withdraw_assignment_request(
      (select id from sub_task_assignment_requests where status = 'pending'))
$q$, '42501', null, 'a lead cannot withdraw somebody else''s request — refusing is their verb');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a020'),true);
select lives_ok($q$
  select public.withdraw_assignment_request(
      (select id from sub_task_assignment_requests where status = 'pending'))
$q$, 'the requester withdraws it');
reset role;
select is(
  (select status from sub_task_assignment_requests where sub_task_assignment_requests.sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a2'),
  'withdrawn', 'withdrawn (ADR-0139: the team lead asked is told — suite 218)');

-- ===================================== 9. closed when it no longer applies (d.9) ====
-- Third task: requested, then assigned by another route — the admin gives it to a003 directly.
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a020'),true);
select lives_ok($q$
  select public.update_task_assignment(
      'aaaaaaaa-0000-0000-0000-0000000097a3', 'Third day',
      '00000000-0000-0000-0000-00000000a023', null, null, null, null, null)
$q$, 'a third task is requested');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select lives_ok($q$
  select public.update_task_assignment(
      'aaaaaaaa-0000-0000-0000-0000000097a3', 'Third day',
      '00000000-0000-0000-0000-00000000a003', null, null, null, null, null)
$q$, 'the admin assigns it to somebody else directly');
reset role;
select is(
  (select status from sub_task_assignment_requests where sub_task_assignment_requests.sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a3'),
  'superseded', 'the pending request is closed as superseded');
select is(
  (select count(*)::int from notifications
    where type = 'assignment_superseded' and user_id = '00000000-0000-0000-0000-00000000a020'
      and entity_id = 'aaaaaaaa-0000-0000-0000-0000000097a3'),
  1, 'and the requester is told — the one moot case they cannot already see');

-- Fourth task: requested, then cancelled. Closed silently.
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a020'),true);
select lives_ok($q$
  select public.update_task_assignment(
      'aaaaaaaa-0000-0000-0000-0000000097a4', 'Fourth day',
      '00000000-0000-0000-0000-00000000a023', null, null, null, null, null)
$q$, 'a fourth task is requested');
select lives_ok($q$ select public.sub_task_cancel('aaaaaaaa-0000-0000-0000-0000000097a4') $q$,
  'and then cancelled by its own lead');
reset role;
select is(
  (select status from sub_task_assignment_requests where sub_task_assignment_requests.sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a4'),
  'superseded', 'cancelling the task closes its request');
select is(
  (select count(*)::int from notifications where type = 'assignment_superseded'),
  1, 'without telling the requester — they cancelled it themselves and can see it');

-- ================================== 10. edge (b): an account manager asks ====
-- ADR-0087 had this as "a request, always"; ADR-0098 d.1 made it direct; ADR-0139 d.1 (3 Oct) makes it a request
-- again — the account scope reaches no calendar.
update sub_tasks set status = 'todo' where id = 'aaaaaaaa-0000-0000-0000-0000000097a4';
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a027'),true);
select results_eq($q$
  select outcome from public.update_task_assignment(
      'aaaaaaaa-0000-0000-0000-0000000097a4', 'Fourth day',
      '00000000-0000-0000-0000-00000000a023', null, null, null, null, null)
$q$, $q$ values ('requested') $q$,
  'the campaign''s account manager placing a person on the schedule sends a request (ADR-0139 d.1)');

-- ============================ 11. a request meets the assignment gates first (d.11) ====
-- Found by review: the request branch returned before any sub_tasks write, so the two gates
-- tg_sub_task_assignment_gate holds every assignment to (ADR-0048 d.8 campaign approval,
-- ADR-0090 d.3 the owner's task-list approval) were never asked of the REQUESTER — the lead was
-- told, and their approval was then refused. d.11: the approver has no dead end.
reset role;
-- A released single job (its brief approved with it, ADR-0084 d.4), a Creative deliverable whose
-- owner (the Copy lead — an owner must be a lead; the requester's custom role is not) has NOT yet
-- approved the task list, one Creative task.
insert into campaigns (id, tenant_id, client_id, name, status, kind) values
  ('aaaaaaaa-0000-0000-0000-0000000e9801','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001','Single job 98','approved','single_job');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000c9801','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000e9801','Single job 98');
insert into campaign_briefs (tenant_id, campaign_id, department_id, brief_type, values, approved_at, approved_by) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000e9801',
   'aaaaaaaa-0000-0000-0000-0000000de001','single_execution','{"task":"One static"}', now(),
   '00000000-0000-0000-0000-00000000a001');
insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id, reviewer_id, department_id, due_at) values
  ('aaaaaaaa-0000-0000-0000-0000000d9801','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000c9801','Static 98','in_progress',
   '00000000-0000-0000-0000-00000000a025','00000000-0000-0000-0000-00000000a001',
   'aaaaaaaa-0000-0000-0000-0000000de001','2026-10-01 15:00+00');
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, department_id, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000f9801','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000d9801','Create Artwork','todo','aaaaaaaa-0000-0000-0000-0000000de001', 8);
-- And a campaign the account manager has not approved yet, with a Creative task.
insert into campaigns (id, tenant_id, client_id, name, status) values
  ('aaaaaaaa-0000-0000-0000-0000000e9802','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001','Pending campaign 98','pending_approval');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000c9802','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000e9802','Pending 98');
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id, department_id, due_at, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d9802','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000c9802','Pending static 98','in_progress',
   '00000000-0000-0000-0000-00000000a001','aaaaaaaa-0000-0000-0000-0000000de001','2026-10-01 15:00+00', '00000000-0000-0000-0000-00000000a001');
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, department_id, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000f9802','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000d9802','Create Artwork','todo','aaaaaaaa-0000-0000-0000-0000000de001', 8);

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a020'),true);
select throws_ok($q$
  select public.update_task_assignment(
      'aaaaaaaa-0000-0000-0000-0000000f9801', 'Create Artwork',
      '00000000-0000-0000-0000-00000000a023', null, null, null, null, null)
$q$, '42501', null,
  'a request for a single job whose task list is not yet approved is refused at request time (ADR-0090 d.3), not at approval');
select throws_ok($q$
  select public.update_task_assignment(
      'aaaaaaaa-0000-0000-0000-0000000f9802', 'Create Artwork',
      '00000000-0000-0000-0000-00000000a023', null, null, null, null, null)
$q$, '42501', null,
  'and so is a request on a campaign the account manager has not approved (ADR-0048 d.8)');
reset role;
select is(
  (select count(*)::int from sub_task_assignment_requests
    where sub_task_id in ('aaaaaaaa-0000-0000-0000-0000000f9801','aaaaaaaa-0000-0000-0000-0000000f9802')),
  0, 'no request row was written for either');
select is(
  (select count(*)::int from notifications
    where type = 'assignment_requested'
      and entity_id in ('aaaaaaaa-0000-0000-0000-0000000f9801','aaaaaaaa-0000-0000-0000-0000000f9802')),
  0, 'and no lead was told about work they could not have assigned');

-- The owner approves the list; the same request now goes through, and the approval that follows
-- meets no gate it did not already pass.
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a025'),true);
select lives_ok($q$ select public.approve_deliverable_tasks('aaaaaaaa-0000-0000-0000-0000000d9801') $q$,
  'the deliverable''s owner approves its task list');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a020'),true);
select results_eq($q$
  select outcome from public.update_task_assignment(
      'aaaaaaaa-0000-0000-0000-0000000f9801', 'Create Artwork',
      '00000000-0000-0000-0000-00000000a023', null, null, null, null, null)
$q$, $q$ values ('requested') $q$,
  '… and the same request is now recorded');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a022'),true);
select lives_ok($q$
  select public.decide_assignment_request(
      (select id from sub_task_assignment_requests
        where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000f9801' and status = 'pending'), true, null)
$q$, '… and the Studio lead''s approval is the assignment, with no gate left to refuse it (ADR-0139 d.3)');
reset role;
select is(
  (select assignee_id from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000f9801'),
  '00000000-0000-0000-0000-00000000a023', 'the task is assigned');

select * from finish();
rollback;
