-- ADR-0029 (I7.3), amended by ADR-0056 d.4/d.5 (I21): reusable SLA profiles + attach points +
-- effective-SLA resolver.
--
-- Proves: the resolver precedence (leaf sla_hours override → leaf profile → project profile →
-- tenant default); the sla_profiles:manage grant reaches Power Admin and no other role; RLS lets a
-- manager write and denies a member; and one default profile per TENANT.
--
-- WHAT CHANGED, AND WHY THE COUNT DROPPED. This suite used to assert six tiers, two of them work
-- type: "the work type's explicitly-assigned profile is used before its default" and "the work
-- type's default profile is used before the tenant default". `work_types` is retired, so those two
-- tiers are gone and the assertions go with them rather than being reworded onto something else.
--
-- The two tiers ADR-0053 d.2 puts in their place — deliverable type, then department — are I20.2
-- and I20.3, ⚠️-GATED on ADR-0032. **When that gate lifts, the assertions belong HERE**, between
-- the project profile and the tenant default, and the chain returns to six tiers. This comment is
-- the note that says so, because a shrunken precedence test is otherwise indistinguishable from
-- one somebody quietly deleted a case from.
begin;
select plan(12);
\ir helpers/seed.sql

-- ---- fixtures on tenant A (superuser; RLS bypassed) ----
insert into sla_profiles (id, tenant_id, name, turnaround_hours, is_default) values
  ('aaaaaaaa-0000-0000-0000-0000000031b1', 'aaaaaaaa-0000-0000-0000-000000000001', 'leaf',    8,   false),
  ('aaaaaaaa-0000-0000-0000-0000000031b2', 'aaaaaaaa-0000-0000-0000-000000000001', 'project', 24,  false),
  ('aaaaaaaa-0000-0000-0000-0000000031b5', 'aaaaaaaa-0000-0000-0000-000000000001', 'tenant',  100, true);

insert into jobs (id, tenant_id, client_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000031f1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001', 'SLA project');
insert into deliverables (id, tenant_id, job_id, name, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000031e1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000031f1', 'SLA deliverable', '00000000-0000-0000-0000-00000000a001');
insert into sub_tasks (id, tenant_id, deliverable_id, title) values
  ('aaaaaaaa-0000-0000-0000-0000000031a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000031e1', 'ST');

-- ---- resolver precedence (each step disables the higher tier and re-resolves) ----
-- 1. manual leaf override beats even the leaf profile
update sub_tasks set sla_hours = 3, sla_profile_id = 'aaaaaaaa-0000-0000-0000-0000000031b1'
  where id = 'aaaaaaaa-0000-0000-0000-0000000031a1';
select is((select app.effective_sla('aaaaaaaa-0000-0000-0000-0000000031a1')), 3::numeric,
  'sla_hours (manual leaf override) wins over everything');

-- 2. leaf profile (drop sla_hours; set a project profile below it)
update sub_tasks set sla_hours = null where id = 'aaaaaaaa-0000-0000-0000-0000000031a1';
update jobs set sla_profile_id = 'aaaaaaaa-0000-0000-0000-0000000031b2' where id = 'aaaaaaaa-0000-0000-0000-0000000031f1';
select is((select app.effective_sla('aaaaaaaa-0000-0000-0000-0000000031a1')), 8::numeric,
  'the leaf sub-task profile is used before the project profile');

-- 3. project (job) profile (clear the leaf profile; the tenant default sits below)
update sub_tasks set sla_profile_id = null where id = 'aaaaaaaa-0000-0000-0000-0000000031a1';
select is((select app.effective_sla('aaaaaaaa-0000-0000-0000-0000000031a1')), 24::numeric,
  'the project (job) profile is used before the tenant default');

-- 4. tenant default (clear the job profile). The deliverable-type and department tiers belong
--    between 3 and 4 when I20.2/I20.3 ship.
update jobs set sla_profile_id = null where id = 'aaaaaaaa-0000-0000-0000-0000000031f1';
select is((select app.effective_sla('aaaaaaaa-0000-0000-0000-0000000031a1')), 100::numeric,
  'the tenant-level default profile is the last resort');

-- The fall-through rule, which no longer has a work-type tier to demonstrate it: a profile whose
-- turnaround_hours is NULL does not stop the search, it passes it down.
update sub_tasks set sla_profile_id = 'aaaaaaaa-0000-0000-0000-0000000031b1'
  where id = 'aaaaaaaa-0000-0000-0000-0000000031a1';
update sla_profiles set turnaround_hours = null where id = 'aaaaaaaa-0000-0000-0000-0000000031b1';
select is((select app.effective_sla('aaaaaaaa-0000-0000-0000-0000000031a1')), 100::numeric,
  'a tier whose profile has a NULL turnaround falls through to the next');
update sla_profiles set turnaround_hours = 8 where id = 'aaaaaaaa-0000-0000-0000-0000000031b1';
update sub_tasks set sla_profile_id = null where id = 'aaaaaaaa-0000-0000-0000-0000000031a1';

-- ---- authority wiring (structural) ----
select is((select count(*)::int from permission_catalog where resource='sla_profiles' and action='manage'), 1,
  'sla_profiles:manage exists in the permission catalog');
select is((select count(*)::int from role_grants rg join roles r on r.id = rg.role_id
    where r.tenant_id='aaaaaaaa-0000-0000-0000-000000000001' and r.key='department_lead'
      and rg.resource='sla_profiles' and rg.action='manage'), 0,
  'Department Lead does NOT hold sla_profiles:manage (Power Admin only)');
select is((select count(*)::int from role_grants rg join roles r on r.id = rg.role_id
    where r.tenant_id='aaaaaaaa-0000-0000-0000-000000000001' and r.key='team_lead'
      and rg.resource='sla_profiles' and rg.action='manage'), 0,
  'Team Leader does NOT hold sla_profiles:manage (Power Admin only)');
select is((select count(*)::int from role_grants rg join roles r on r.id = rg.role_id
    where r.tenant_id='aaaaaaaa-0000-0000-0000-000000000001' and r.key='team_member'
      and rg.resource='sla_profiles' and rg.action='manage'), 0,
  'a Team Member does NOT hold sla_profiles:manage');

-- ---- RLS: manager writes, member denied; ONE DEFAULT PER TENANT ----
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);

-- I21 (ADR-0056 d.5): `uq_sla_profile_wt_default` was `(tenant_id, work_type_id) where is_default`.
-- With no axis to be default FOR, the invariant narrows to one default per tenant — and the fixture
-- above already holds it ('tenant'), so a second one must be refused. Losing this index quietly is
-- how `effective_sla` would start picking a default by creation date and the surface's
-- duplicate-default message would become unreachable.
select throws_ok($$ insert into sla_profiles (tenant_id, name, is_default, turnaround_hours)
  values ('aaaaaaaa-0000-0000-0000-000000000001','second-default',true,16) $$,
  '23505', null, 'a second default profile for the tenant is rejected');

-- A non-default profile is fine, which is what proves the index is partial and not a blanket rule.
select lives_ok($$ insert into sla_profiles (tenant_id, name, is_default, turnaround_hours)
  values ('aaaaaaaa-0000-0000-0000-000000000001','rush',false,4) $$,
  'a holder of sla_profiles:manage can create a non-default profile');

-- a Team Member (a003) cannot write profiles.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select throws_ok($$ insert into sla_profiles (tenant_id, name, turnaround_hours)
  values ('aaaaaaaa-0000-0000-0000-000000000001','sneaky',5) $$,
  '42501', null, 'a Team Member cannot create SLA profiles');

select * from finish();
rollback;
