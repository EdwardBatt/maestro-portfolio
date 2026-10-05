-- I22.1 (ADR-0055) — a reviewer may change workflow state and nothing else.
--
-- `app.tg_deliverable_transition_guard` has always frozen a list of columns against an actor who
-- holds `reviews:moderate` but not `project_tasks:manage`. ADR-0050 added `owner_user_id` and
-- `department_id` — who is accountable for the work — and neither was added to that list, so a
-- reviewer could reassign any deliverable in the tenant and the stamping trigger would restamp the
-- department to match.
--
-- Assertions 2 and 3 are the hole, asserted closed. Assertion 4 is the other half and matters just
-- as much: the reviewer must still be able to do the job they hold the permission for. A fix that
-- froze the workflow state as well would pass a "reviewer cannot reassign" test and break review.

begin;
select plan(6);
\ir helpers/seed.sql

reset role;

-- A reviewer-only actor. The base fixture has none: a001 is power_admin (holds everything) and
-- a003 is a team_member the seed deliberately grants project_tasks:manage. Both would satisfy
-- `has_manage` and never reach the frozen-column branch, so this suite would pass vacuously.
insert into roles (id, tenant_id, key, name, description, scope)
values ('aaaaaaaa-0000-0000-0000-00000000061f','aaaaaaaa-0000-0000-0000-000000000001',
        'reviewer_only','Reviewer Only','Holds reviews:moderate and nothing else','tenant');

insert into role_grants (tenant_id, role_id, resource, action) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000061f','reviews','moderate');

insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000061a1','reviewer-only-a@a.test');

insert into user_profiles (id, tenant_id, display_name, role_id)
values ('00000000-0000-0000-0000-0000000061a1','aaaaaaaa-0000-0000-0000-000000000001',
        'Reviewer Only A','aaaaaaaa-0000-0000-0000-00000000061f');

insert into test_claims
select up.id,
       json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
from user_profiles up where up.id = '00000000-0000-0000-0000-0000000061a1';

-- Two departments and an owned deliverable sitting in review, with no sub-tasks so the ADR-0038
-- readiness gate is not what decides any of the assertions below.
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000061d1','aaaaaaaa-0000-0000-0000-000000000001','Art & Video'),
  ('aaaaaaaa-0000-0000-0000-0000000061d2','aaaaaaaa-0000-0000-0000-000000000001','Production');
update user_profiles set department_id = 'aaaaaaaa-0000-0000-0000-0000000061d1'
 where id = '00000000-0000-0000-0000-00000000a003';

insert into deliverables (id, tenant_id, job_id, name, state, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000061e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001','Hero film','in_review',
   '00000000-0000-0000-0000-00000000a003');

select is(
  (select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000061e1'),
  'aaaaaaaa-0000-0000-0000-0000000061d1'::uuid,
  'setup: the owner stamped the department (ADR-0050)');

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-0000000061a1'), true);

-- ============================================== the hole, asserted closed ====
select throws_ok(
  $$update deliverables set owner_user_id = '00000000-0000-0000-0000-00000000a002'
     where id = 'aaaaaaaa-0000-0000-0000-0000000061e1'$$,
  '42501', null,
  'a reviewer cannot hand a deliverable to somebody else');

-- ADR-0102 d.1: the department is the owner's, so a write naming another is put back before any
-- guard sees a change — the work does not move, whoever asks.
update deliverables set department_id = 'aaaaaaaa-0000-0000-0000-0000000061d2'
 where id = 'aaaaaaaa-0000-0000-0000-0000000061e1';
select isnt(
  (select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000061e1'),
  'aaaaaaaa-0000-0000-0000-0000000061d2'::uuid,
  'nor move it to another department — the write is put back to the owner''s (ADR-0102 d.1)');

-- ================================== and the job they DO hold still works ====
-- Send-back is the reviewer's own transition (`reviews:moderate` or `project_tasks:manage`), and
-- it must survive the fix. Freezing the workflow state too would satisfy the two assertions above
-- while breaking review entirely — which is why this one is here.
select lives_ok(
  $$update deliverables set state = 'in_progress'
     where id = 'aaaaaaaa-0000-0000-0000-0000000061e1'$$,
  'a reviewer can still send the work back');

select is(
  (select owner_user_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000061e1'),
  '00000000-0000-0000-0000-00000000a003'::uuid,
  'and the owner is untouched by their doing so');

-- ================================================ manage authority is not ====
-- The freeze is scoped to actors WITHOUT project_tasks:manage. Somebody who holds it — the account
-- manager, an admin — must still be able to reassign, or ADR-0055 has nothing left to permit.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select lives_ok(
  $$update deliverables set owner_user_id = '00000000-0000-0000-0000-00000000a002'
     where id = 'aaaaaaaa-0000-0000-0000-0000000061e1'$$,
  'a project_tasks:manage holder still can — this freeze is about reviewers only');

select finish();
rollback;
