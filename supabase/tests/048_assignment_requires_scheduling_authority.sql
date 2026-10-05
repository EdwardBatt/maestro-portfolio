-- ADR-0040 (I12.5): assigning work requires the authority to schedule it.
--
-- The bug this closes: assignment was gated on project_tasks:manage + department/team scope, while
-- SCHEDULING it was gated on bookings:create + the resource's scope — two independent permissions
-- with a commit between them. Passing the first and failing the second left a real, owed, invisible
-- task, and every retry committed another one (six of them on 23 Aug).
--
-- The assertion that matters is the first: an assigner who cannot book the assignee's calendar is
-- refused, and NO task survives. The rest fence the exemptions, each of which would otherwise block
-- something legitimate.
--
-- Subjects: a001 power_admin (holds everything) and a purpose-built 'assigner48' role — tenant
-- scope + project_tasks:manage and nothing else. a003 could not have been the subject: with scope
-- 'self' it fails the sub_tasks RLS policy outright, and RLS refuses with 42501 exactly as this
-- trigger does, so every assertion would have passed without the trigger existing at all.
-- Resource d001 'Sarah' is linked to a003 here so there is a calendar to be authorised for.

begin;
select plan(8);
\ir helpers/seed.sql

-- give the seed's human resource an owner, so assignments to that person need booking authority
update resources set user_id = '00000000-0000-0000-0000-00000000a003'
 where id = 'aaaaaaaa-0000-0000-0000-00000000d001';

-- THE SUBJECT. a003 (team_member, scope 'self') cannot clear the sub_tasks RLS policy at all, so a
-- refusal proves nothing — 42501 from RLS looks identical to 42501 from the new trigger. This role
-- clears RLS (project_tasks:manage + tenant scope) and lacks ONLY bookings:create, so a refusal can
-- come from one place: the thing under test. It is the account_manager shape from L6.9.
insert into roles (id, tenant_id, key, name, description, is_system, default_route, scope) values
  ('aaaaaaaa-0000-0000-0000-00000000481f','aaaaaaaa-0000-0000-0000-000000000001','assigner48',
   'Assigner 48','assigns work, cannot book', false, '/my-work', 'tenant');
insert into role_grants (tenant_id, role_id, resource, action) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000481f','project_tasks','manage');
insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-0000000048b1','assigner48@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id) values
  ('aaaaaaaa-0000-0000-0000-0000000048b1','aaaaaaaa-0000-0000-0000-000000000001','Assigner 48',
   'aaaaaaaa-0000-0000-0000-00000000481f');
insert into test_claims
  select up.id, json_build_object('sub', up.id, 'app_metadata',
    json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id = 'aaaaaaaa-0000-0000-0000-0000000048b1';

insert into deliverables (id, tenant_id, job_id, name, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000048e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001','Auth48','00000000-0000-0000-0000-00000000a001');

-- ---------------------------------------------------- superuser/seed context is exempt ----
-- auth.uid() is null here; a migration must not be blocked by a permission it has no business
-- holding. Without this exemption every fixture and seeder in the repo would fail.
select lives_ok(
  $$insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, sla_hours)
    values ('aaaaaaaa-0000-0000-0000-0000000048a0','aaaaaaaa-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-0000000048e1','00000000-0000-0000-0000-00000000a003','seeded', 8)$$,
  'a seed/migration context (no auth.uid()) may assign — RLS already treats it that way');

set local role authenticated;

-- ------------------------------------------- no bookings:create → refused, nothing written ----
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = 'aaaaaaaa-0000-0000-0000-0000000048b1'), true);
select is(app.has_permission('project_tasks', 'manage'), true,
  'the assigner may assign work (project_tasks:manage, tenant scope — it clears RLS) …');
select is(app.has_permission('bookings', 'create'), false,
  '… but cannot book anyone (no bookings:create) — so a refusal can only come from the new check');

select throws_ok(
  $$insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, sla_hours)
    values ('aaaaaaaa-0000-0000-0000-0000000048a1','aaaaaaaa-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-0000000048e1','00000000-0000-0000-0000-00000000a003','half', 8)$$,
  '42501', null,
  'assignment is refused up front by someone who could not schedule it');

select is(
  (select count(*)::int from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000048a1'), 0,
  'and NO task survives — this is the half-success that produced six duplicates on 23 Aug');

-- ------------------------------------------------------ unassigning is never blocked ----
select lives_ok(
  $$update sub_tasks set assignee_id = null where id = 'aaaaaaaa-0000-0000-0000-0000000048a0'$$,
  'clearing an assignee needs no booking authority — you are not occupying anyone''s time');

-- ------------------------------------- an assignee with no bookable calendar is exempt ----
-- Nothing would be materialised, so there is nothing to authorise. Without this, people who hold no
-- resource could not be given work at all.
-- EVERY resource linked to a003, which is what "no active bookable resource" actually means. This
-- used to name `d001` alone, and passed for a reason it did not intend: a003 had no linked resource
-- at all until ADR-0061 gave the fixture one, so the exemption applied whatever this line did. Now
-- a003 has two — the one this suite links on line 23 and the one the seed provides — and naming a
-- single id would leave the other active.
--
-- Done as the OWNER, not through RLS: whether an admin may edit a resource is another suite's
-- subject, and a silent 0-row update here would make the assertion below pass or fail for a reason
-- that has nothing to do with what it is testing.
reset role;
update resources set is_active = false where user_id = '00000000-0000-0000-0000-00000000a003';
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = 'aaaaaaaa-0000-0000-0000-0000000048b1'), true);
select lives_ok(
  $$insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, sla_hours)
    values ('aaaaaaaa-0000-0000-0000-0000000048a2','aaaaaaaa-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-0000000048e1','00000000-0000-0000-0000-00000000a003','no-calendar', 8)$$,
  'assigning to someone with no active bookable resource is still allowed');

-- ------------------------------------------------- full authority succeeds ----
reset role;
update resources set is_active = true where user_id = '00000000-0000-0000-0000-00000000a003';
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select lives_ok(
  $$insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, sla_hours)
    values ('aaaaaaaa-0000-0000-0000-0000000048a3','aaaaaaaa-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-0000000048e1','00000000-0000-0000-0000-00000000a003','authorised', 8)$$,
  'someone holding bookings:create over that resource assigns normally');

select * from finish();
rollback;
