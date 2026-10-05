-- I20.6 (ADR-0053 d.5, d.6) — the department label follows the person, and ad-hoc work has an
-- owner.
--
-- SCOPE. ADR-0053's SLA half (d.2 tiers, d.4 columns) is ⚠️-GATED on ADR-0032, which is not
-- finalised. `I20.6`'s "seven-tier chain asserted tier by tier" and "RLS allow/deny on the new
-- axes" therefore cannot be written yet: `app.effective_sla` still has five tiers and
-- `sla_profiles` still has one axis. What CAN be asserted — and is, here — is everything the gate
-- does not touch: the restamp, the freeze on finished work, and the ad-hoc owner.
--
-- The pair that matters most is 7 and 8, and they are about the SAME column seen from two sides.
-- 7: `app.tg_deliverable_transition_guard` refuses an authenticated actor who writes
-- `deliverables.department_id` without `project_tasks:manage` or `deliverable_owner:manage`.
-- 8: the restamp writes that very column anyway, on the path production actually uses — a
-- department change reaches the database through the `update-user` Edge Function's SERVICE-ROLE
-- client, where `auth.uid()` is null and the guard stands down on its own.
--
-- The system-op fencing inside the trigger is therefore belt-and-braces TODAY and load-bearing the
-- moment department editing moves onto an authenticated path (a scoped RPC, an admin screen), at
-- which point the failure would be an authorization error about a deliverable nobody mentioned.
-- 7 is what makes that risk visible instead of theoretical.

begin;
select plan(13);
\ir helpers/seed.sql

reset role;

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000067d1','aaaaaaaa-0000-0000-0000-000000000001','Creative'),
  ('aaaaaaaa-0000-0000-0000-0000000067d2','aaaaaaaa-0000-0000-0000-000000000001','Production'),
  ('bbbbbbbb-0000-0000-0000-0000000067d1','bbbbbbbb-0000-0000-0000-000000000001','Peer Creative');

-- a003 starts in Creative and owns four deliverables, one in each state that matters.
update user_profiles set department_id = 'aaaaaaaa-0000-0000-0000-0000000067d1'
 where id = '00000000-0000-0000-0000-00000000a003';

insert into deliverables (id, tenant_id, job_id, name, state, owner_user_id, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000067e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001','Live one','in_progress',
   '00000000-0000-0000-0000-00000000a003','00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-0000000067e2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001','Draft one','draft',
   '00000000-0000-0000-0000-00000000a003','00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-0000000067e3','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001','Delivered one','delivered',
   '00000000-0000-0000-0000-00000000a003','00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-0000000067e4','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001','Archived one','archived',
   '00000000-0000-0000-0000-00000000a003','00000000-0000-0000-0000-00000000a001');

-- Somebody else's live work. a002 never moves department, which is what makes assertion 5 worth
-- making: their work must sit exactly where it was created when a003 moves.
insert into deliverables (id, tenant_id, job_id, name, state, owner_user_id, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000067e5','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001','Somebody else''s','in_progress',
   '00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-00000000a001');

-- ADR-0099 d.2 (23 Sep) ended the derivation ADR-0050 d.2 ran on every owner CHANGE: naming
-- somebody else no longer moves the work, which is the 22 Sep fault (I53.29) and is asserted shut
-- in 060. What survives is the half this suite stands on — the owner supplies the department once,
-- as a default, at creation. ADR-0053 d.5's restamp, a PERSON transferring department and their
-- live work following them, is a different rule: superseded by neither ADR, and still in force
-- through the rest of this file.
select is(
  (select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000067e1'),
  'aaaaaaaa-0000-0000-0000-0000000067d1'::uuid,
  'the fixture starts in the owner''s department — the DEFAULT at creation (ADR-0099 d.2)');

-- ------------------------------------------------- the move ----
update user_profiles set department_id = 'aaaaaaaa-0000-0000-0000-0000000067d2'
 where id = '00000000-0000-0000-0000-00000000a003';

select is(
  (select count(*)::int from deliverables
    where id in ('aaaaaaaa-0000-0000-0000-0000000067e1','aaaaaaaa-0000-0000-0000-0000000067e2')
      and department_id = 'aaaaaaaa-0000-0000-0000-0000000067d2'),
  2, 'moving a person restamps every LIVE deliverable they own');

-- The freeze. A delivered row is a record of what happened, not a label to tidy — and ADR-0053
-- d.5 states out loud that it is PERMITTED to disagree with its owner's current department, so
-- that this is never later filed as a bug.
select is(
  (select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000067e3'),
  'aaaaaaaa-0000-0000-0000-0000000067d1'::uuid,
  'a DELIVERED deliverable keeps the department it was delivered under');
select is(
  (select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000067e4'),
  'aaaaaaaa-0000-0000-0000-0000000067d1'::uuid,
  'and so does an ARCHIVED one');

-- a002 has not moved, so their work is still in the department it was created in: the seed's own,
-- which every tenant-A profile carries (helpers/seed.sql). Naming that department is the same
-- guard as the null this asserted before and a stronger one — it says the row was left exactly as
-- it was, rather than merely that nothing was written into an empty column.
select is(
  (select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000067e5'),
  'aaaaaaaa-0000-0000-0000-0000000de0ff'::uuid,
  'work owned by SOMEBODY ELSE is untouched — a person''s move is not a department sweep');

-- The restamp is a data correction, not an ownership change.
select is(
  (select owner_user_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000067e1'),
  '00000000-0000-0000-0000-00000000a003'::uuid,
  'and it does not touch the owner');

-- ------------------------------------------------- the guard, and the path around it ----
-- Both task grants are stripped from power_admin in tenant A so a001 is an actor who may edit the
-- organization and may NOT touch a deliverable's accountability columns.
--
-- `protect_system_role_grants` fences the seeded roles, so the fixture asks for system-op the way
-- every seeding migration does. Turned straight back off — assertion 7 depends on the transition
-- guard being ARMED.
select set_config('app.system_op', 'on', true);
delete from role_grants rg
 using roles r
 where rg.role_id = r.id and r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   and r.key = 'power_admin'
   and (rg.resource, rg.action) in (('project_tasks','manage'), ('deliverable_owner','manage'));
select set_config('app.system_op', 'off', true);

insert into deliverables (id, tenant_id, job_id, name, state, owner_user_id, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000067e6','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001','Booker''s live work','in_progress',
   '00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-00000000a001');
update user_profiles set department_id = 'aaaaaaaa-0000-0000-0000-0000000067d1'
 where id = '00000000-0000-0000-0000-00000000a002';

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

-- The exact message, not merely the SQLSTATE: `authenticated` also holds a table-level UPDATE
-- privilege here, so a bare 42501 could be a missing grant rather than the guard. Naming the
-- message is what proves WHICH rule refused.
-- ADR-0102 d.1: a write naming another department is put back to the owner's before the guard sees
-- a change, so the actor's write does nothing rather than being refused — the department stays.
update deliverables set department_id = 'aaaaaaaa-0000-0000-0000-0000000067d2'
 where id = 'aaaaaaaa-0000-0000-0000-0000000067e6';
select isnt(
  (select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000067e6'),
  'aaaaaaaa-0000-0000-0000-0000000067d2'::uuid,
  'an authenticated actor without either task grant cannot move a deliverable''s department (ADR-0102 d.1)');

-- The production path. `update-user` writes `user_profiles.department_id` on a SERVICE-ROLE
-- client — `authenticated` is granted UPDATE on three columns only (`display_name`, `locale`,
-- `office_id`, from 20260801090000), so this is not one path among several, it is the only one.
reset role;
set local role service_role;
select lives_ok(
  $$update user_profiles set department_id = 'aaaaaaaa-0000-0000-0000-0000000067d2'
     where id = '00000000-0000-0000-0000-00000000a002'$$,
  'and the path production uses to move a person is not blocked by that guard');

reset role;
select is(
  (select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000067e6'),
  'aaaaaaaa-0000-0000-0000-0000000067d2'::uuid,
  'the restamp reached the frozen column, which is the whole point of the trigger');

-- The guard is NOT left disarmed afterwards. The trigger SAVES and RESTORES `app.system_op`
-- rather than setting it to 'off' the way the seed functions do, because the value it interrupts
-- is not always 'off' and a transaction that ends system-op mode on somebody else's behalf leaves
-- the guard down for every statement that follows.
select ok(not app.is_system_op(),
  'and system-op is handed back, so the guard is armed for the rest of the transaction');

-- ------------------------------------------------- tenant fence ----
-- A person in tenant B moving departments cannot touch tenant A's rows. The trigger is SECURITY
-- DEFINER, so the tenant clause in its UPDATE is the only thing standing here — which is exactly
-- why it is asserted rather than assumed.
update user_profiles set department_id = 'bbbbbbbb-0000-0000-0000-0000000067d1'
 where id = '00000000-0000-0000-0000-00000000b002';
select is(
  (select count(*)::int from deliverables
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and department_id = 'bbbbbbbb-0000-0000-0000-0000000067d1'),
  0, 'a department change in another tenant reaches nothing here');

-- ------------------------------------------------- d.6: the ad-hoc owner ----
-- a002 (scheduler) holds project_tasks:manage and unrestricted scope; a001 (power admin) holds
-- reviews:moderate and is not the assignee, so the no-self-review rule is satisfied.
update user_profiles set department_id = 'aaaaaaaa-0000-0000-0000-0000000067d1'
 where id = '00000000-0000-0000-0000-00000000a003';

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);

create temp table adhoc_result as
select * from public.create_adhoc_deliverable(
  '00000000-0000-0000-0000-00000000a003', 'Fix the logo', 2,
  '2026-09-01T09:00:00Z', '2026-09-01T17:00:00Z',
  '00000000-0000-0000-0000-00000000a001');

reset role;

select is(
  (select d.owner_user_id from deliverables d
    join adhoc_result r on r.deliverable_id = d.id),
  '00000000-0000-0000-0000-00000000a003'::uuid,
  'ad-hoc work takes its ASSIGNEE as owner — one task, one person, one accountable name');

-- The point of d.6: this is what gives ad-hoc work a Discipline label and a department SLA tier
-- for the first time. create_adhoc_deliverable still passes no department of its own, so the
-- owner's is filled in as the DEFAULT at creation — the only derivation ADR-0099 d.2 leaves
-- standing, and the one section C's screens displace by asking (I56.3, I56.8).
select is(
  (select d.department_id from deliverables d
    join adhoc_result r on r.deliverable_id = d.id),
  'aaaaaaaa-0000-0000-0000-0000000067d1'::uuid,
  'so it has a department too — the assignee-owner''s, defaulted at creation');

select finish();
rollback;
