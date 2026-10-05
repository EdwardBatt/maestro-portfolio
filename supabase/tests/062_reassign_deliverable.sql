-- I22.3 (ADR-0055) — who may change a deliverable's owner.
--
-- The assertion this suite exists for is 3: **a bare UPDATE is refused.** ADR-0055 rejected
-- enforcing this in an RPC alone, because `deliverables` carries a `for all` policy on
-- `project_tasks:manage` with no scope test and no column restriction — so `public.reassign_
-- deliverable` is a front door beside an open window. If the trigger is ever lost, assertion 3 is
-- what notices.
--
-- Assertion 6 is the other half: this NARROWS existing behaviour, and the narrowing has to be real.
-- Before ADR-0055 anybody with project_tasks:manage could reassign anything anywhere.

begin;
select plan(10);
\ir helpers/seed.sql

reset role;

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000062d1','aaaaaaaa-0000-0000-0000-000000000001','Art & Video'),
  ('aaaaaaaa-0000-0000-0000-0000000062d2','aaaaaaaa-0000-0000-0000-000000000001','Production');

-- a003 (Creative) sits in Art & Video and owns the deliverable; a002 (Booker/Traffic Manager,
-- tenant scope) sits in Production and is who the work will move to.
update user_profiles set department_id = 'aaaaaaaa-0000-0000-0000-0000000062d1'
 where id = '00000000-0000-0000-0000-00000000a003';
update user_profiles set department_id = 'aaaaaaaa-0000-0000-0000-0000000062d2'
 where id = '00000000-0000-0000-0000-00000000a002';

-- A department-scoped holder of the permission, sitting in Art & Video. `department_lead`
-- inherits deliverable_owner:manage from scheduler (noted in 20260828110000) and is scoped to its
-- own department — so it may reassign WITHIN Art & Video and not into Production.
insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000062a1','dept-lead-a@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select '00000000-0000-0000-0000-0000000062a1','aaaaaaaa-0000-0000-0000-000000000001',
       'Dept Lead A', r.id, 'aaaaaaaa-0000-0000-0000-0000000062d1'
from roles r
where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = 'department_lead';

-- Somebody in Art & Video for the in-scope move to land on.
insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000062a2','artist-a@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select '00000000-0000-0000-0000-0000000062a2','aaaaaaaa-0000-0000-0000-000000000001',
       'Artist A', r.id, 'aaaaaaaa-0000-0000-0000-0000000062d1'
from roles r
where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = 'team_member';

insert into test_claims
select up.id,
       json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
from user_profiles up
where up.id in ('00000000-0000-0000-0000-0000000062a1','00000000-0000-0000-0000-0000000062a2');

insert into deliverables (id, tenant_id, job_id, name, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000062e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001','Hero film','00000000-0000-0000-0000-00000000a003');

set local role authenticated;

-- ================================================= 1-2. the permission, in scope ====
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-0000000062a1'), true);

select lives_ok(
  $$select public.reassign_deliverable('aaaaaaaa-0000-0000-0000-0000000062e1',
                                       '00000000-0000-0000-0000-0000000062a2')$$,
  'a deliverable_owner:manage holder may reassign within their scope');

-- The department is the one the deliverable was CREATED in — defaulted from a003, its first
-- owner, and untouched since. ADR-0050 d.2's restamp is superseded by ADR-0099 d.2, so this now
-- asserts that a reassignment left it alone; the RPC never wrote it either way.
select is(
  (select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000062e1'),
  'aaaaaaaa-0000-0000-0000-0000000062d1'::uuid,
  'and the department is the deliverable''s own — the RPC does not write it and the owner no longer moves it');

-- ============================================ 3. THE ONE. a bare UPDATE is governed ====
-- Same actor, same permission, out of scope — but going round the RPC straight at the table.
select throws_ok(
  $$update deliverables set owner_user_id = '00000000-0000-0000-0000-00000000a002'
     where id = 'aaaaaaaa-0000-0000-0000-0000000062e1'$$,
  '42501', null,
  'a direct PATCH is refused by the trigger, not merely by the RPC');

-- ==================================================== 4. and so is the RPC itself ====
select throws_ok(
  $$select public.reassign_deliverable('aaaaaaaa-0000-0000-0000-0000000062e1',
                                       '00000000-0000-0000-0000-00000000a002')$$,
  '42501', null,
  'moving work into a department they have no authority over is refused');

-- ==================================================== 5. nobody at all is refused ====
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-0000000062a2'), true);
select throws_ok(
  $$select public.reassign_deliverable('aaaaaaaa-0000-0000-0000-0000000062e1',
                                       '00000000-0000-0000-0000-0000000062a1')$$,
  '42501', null,
  'a team member holding neither path cannot reassign — including the current owner');

-- ======================================= 6. the narrowing is real (regression guard) ====
-- a003 is granted project_tasks:manage by the fixture and holds `self` scope as a team_member.
-- Before ADR-0055 that alone was enough to reassign anything in the tenant.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select throws_ok(
  $$update deliverables set owner_user_id = '00000000-0000-0000-0000-00000000a002'
     where id = 'aaaaaaaa-0000-0000-0000-0000000062e1'$$,
  '42501', null,
  'project_tasks:manage ALONE no longer reassigns — this is the hole ADR-0055 closes');

-- ============================================================ 7. tenant scope wins ====
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);
select lives_ok(
  $$select public.reassign_deliverable('aaaaaaaa-0000-0000-0000-0000000062e1',
                                       '00000000-0000-0000-0000-00000000a002')$$,
  'a tenant-scoped Traffic Manager may reassign across departments');

-- ================= 8. and the work followed its owner into Production (ADR-0102 d.1) ====
-- Assertion 7 has just handed this deliverable to an owner who sits in Production. A deliverable's
-- department is its owner's (Edward, 24 Sep: "assign to people, not departments").
select is(
  (select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000062e1'),
  'aaaaaaaa-0000-0000-0000-0000000062d2'::uuid,
  'naming a Production owner carries the work into Production (ADR-0102 d.1)');

-- ================================================== 9. the owner CANNOT be cleared ====
-- This asserted the opposite until ADR-0100 d.8. `reassign_deliverable(…, null)` was how a
-- department-scoped holder un-assigned work, which is why `in_write_scope` is judged against the
-- OUTGOING owner — that part of the guard stands, it is simply no longer reachable this way. An
-- unowned deliverable is work nobody can accept: the owner is who approves its task list before
-- anyone can be assigned (ADR-0100 d.2), so the database refuses to leave one without.
select throws_ok(
  $$select public.reassign_deliverable('aaaaaaaa-0000-0000-0000-0000000062e1', null)$$,
  '23502',
  'A deliverable cannot be left without an owner: name somebody else instead.',
  'the owner cannot be cleared — work nobody answers for is work nobody can approve or start');

-- =========================================================== 10. cross-tenant ====
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000b001'), true);
select throws_ok(
  $$select public.reassign_deliverable('aaaaaaaa-0000-0000-0000-0000000062e1',
                                       '00000000-0000-0000-0000-00000000b002')$$,
  'P0002', null,
  'another tenant''s deliverable is not merely refused — it is not visible to find');

select finish();
rollback;
