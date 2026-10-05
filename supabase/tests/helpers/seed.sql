-- Shared fixtures, included from each test file via \ir (pg_prove runs every
-- file in its own transaction, so seeding repeats per file and rolls back).
-- Runs as superuser; tests then SWITCH to the authenticated role with JWT
-- claims injected — RLS is never exercised from the superuser path.

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a001', 'admin-a@a.test'),
  ('00000000-0000-0000-0000-00000000a002', 'booker-a@a.test'),
  ('00000000-0000-0000-0000-00000000a003', 'creative-a@a.test'),
  ('00000000-0000-0000-0000-00000000b001', 'admin-b@b.test'),
  ('00000000-0000-0000-0000-00000000b002', 'booker-b@b.test');

insert into tenants (id, name, slug) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Tenant A (Meridian)', 'tenant-a'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Tenant B (Peer)', 'tenant-b');

-- ADR-0008: roles are rows, seeded per tenant exactly as production does it.
select app.seed_tenant_roles(id) from tenants;

-- Team Member no longer holds project_tasks:manage in the product (20260825110000): nothing it does
-- needs it, and it only opened menus whose writes RLS refused. Several suites below nonetheless put
-- the permission on a003 ON PURPOSE — they exist to prove that the permission ALONE is not enough
-- and that scope (or the ADR-0036 overlay) is what decides. Granting it here keeps those tests
-- proving that, instead of passing because the grant quietly disappeared.
insert into role_grants (tenant_id, role_id, resource, action)
select r.tenant_id, r.id, 'project_tasks', 'manage'
from roles r where r.key = 'team_member'
on conflict do nothing;

-- The fixture department. Every real user belongs to one; the fixture's did not, and that stopped
-- mattering only because a deliverable's department used to be DERIVED from its owner. ADR-0099 d.2
-- makes it the deliverable's own, defaulted from the owner once at creation — so an owner with no
-- department now produces work with no department, which the guard refuses. Creative A gets one.
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000de0ff', 'aaaaaaaa-0000-0000-0000-000000000001', 'Fixture dept')
on conflict (id) do nothing;

-- Profiles reference roles by (tenant, key); display roles map:
--   Admin → power_admin, Booker → scheduler, Creative → team_member.
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, v.tenant::uuid, v.name,
       (select r.id from roles r where r.tenant_id = v.tenant::uuid and r.key = v.role_key),
       v.dept::uuid
from (values
  -- Only Creative A carries a department: it is the one used as a deliverable's OWNER, and the
  -- tenant- and account-scoped roles are deliberately left without, because several suites assert
  -- on what a person with no department can and cannot reach.
  ('00000000-0000-0000-0000-00000000a001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Admin A',    'power_admin', 'aaaaaaaa-0000-0000-0000-0000000de0ff'),
  ('00000000-0000-0000-0000-00000000a002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Booker A',   'scheduler',   'aaaaaaaa-0000-0000-0000-0000000de0ff'),
  ('00000000-0000-0000-0000-00000000a003', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative A', 'team_member', 'aaaaaaaa-0000-0000-0000-0000000de0ff'),
  ('00000000-0000-0000-0000-00000000b001', 'bbbbbbbb-0000-0000-0000-000000000001', 'Admin B',    'power_admin', null),
  ('00000000-0000-0000-0000-00000000b002', 'bbbbbbbb-0000-0000-0000-000000000001', 'Booker B',   'scheduler',   null)
) as v(id, tenant, name, role_key, dept);

-- Claims lookup for tests: literal JWTs are gone (role ids are generated), so
-- each test selects its claim string from here. Temp table, superuser-built,
-- readable after SET ROLE authenticated.
create temp table test_claims as
select up.id,
       json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text as jwt
from user_profiles up;
grant select on test_claims to public;

insert into clients (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000c001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Kite Card'),
  ('bbbbbbbb-0000-0000-0000-00000000c001', 'bbbbbbbb-0000-0000-0000-000000000001', 'B Client');

insert into resources (id, tenant_id, kind, name, capacity_model, load_ceiling_pct, warn_at_pct) values
  ('aaaaaaaa-0000-0000-0000-00000000d001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'human', 'Sarah', 'load_based', 120.0, 100.0),
  ('bbbbbbbb-0000-0000-0000-00000000d001', 'bbbbbbbb-0000-0000-0000-000000000001',
   'human', 'Botan', 'load_based', 120.0, 100.0);
-- ADR-0011: an internal user IS a bookable resource — the invite flow creates one and links it by
-- `user_id`. The fixture's own people had none, which was invisible until ADR-0061 d.5 made
-- "can this person be given work?" depend on it. Linked here so the fixture models a real agency
-- rather than one where nobody can be assigned anything.
insert into resources (id, tenant_id, kind, name, capacity_model, load_ceiling_pct, warn_at_pct, user_id) values
  ('aaaaaaaa-0000-0000-0000-00000000d0a1', 'aaaaaaaa-0000-0000-0000-000000000001',
   'human', 'A001 Admin', 'load_based', 120.0, 100.0, '00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-00000000d0a2', 'aaaaaaaa-0000-0000-0000-000000000001',
   'human', 'A002 Scheduler', 'load_based', 120.0, 100.0, '00000000-0000-0000-0000-00000000a002'),
  ('aaaaaaaa-0000-0000-0000-00000000d0a3', 'aaaaaaaa-0000-0000-0000-000000000001',
   'human', 'A003 Maker', 'load_based', 120.0, 100.0, '00000000-0000-0000-0000-00000000a003'),
  ('bbbbbbbb-0000-0000-0000-00000000d0b1', 'bbbbbbbb-0000-0000-0000-000000000001',
   'human', 'B001 Admin', 'load_based', 120.0, 100.0, '00000000-0000-0000-0000-00000000b001'),
  ('bbbbbbbb-0000-0000-0000-00000000d0b2', 'bbbbbbbb-0000-0000-0000-000000000001',
   'human', 'B002 Booker', 'load_based', 120.0, 100.0, '00000000-0000-0000-0000-00000000b002');

insert into resources (id, tenant_id, kind, name, capacity_model) values
  ('aaaaaaaa-0000-0000-0000-00000000d002', 'aaaaaaaa-0000-0000-0000-000000000001',
   'equipment', 'RED Camera', 'exclusive');
insert into resources (id, tenant_id, kind, name, capacity_model, pool_size) values
  ('aaaaaaaa-0000-0000-0000-00000000d003', 'aaaaaaaa-0000-0000-0000-000000000001',
   'equipment', '50mm Lens Pool', 'pooled', 4);

-- ADR-0048 d.8: campaigns default to pending_approval, and nothing on a pending campaign may
-- be assigned or booked. This fixture models an agency ALREADY RUNNING - every other suite
-- assigns and books against it - so its campaign is approved, exactly as the migration marked
-- every campaign that existed when it was applied.
insert into campaigns (id, tenant_id, client_id, name, status) values
  ('aaaaaaaa-0000-0000-0000-00000000e001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Ramadan 2027', 'approved');

insert into jobs (id, tenant_id, client_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Logo tweak (ad-hoc, both links null)');

-- ADR-0038: a deliverable names a reviewer, and its tasks inherit it (subtask_seed_reviewer), so
-- fixtures need not repeat it on every sub-task insert. a001 is never an assignee in any test, so
-- the no-self-review constraint cannot trip.
insert into deliverables (id, tenant_id, job_id, name, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-00000000f101', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001', 'Revised logo', '00000000-0000-0000-0000-00000000a001');

-- ---------------------------------------------------------------- the work is accepted ----
-- ADR-0072 d.6 (enforced 20 Sep, `20260920150000`): a campaign deliverable's tasks can be assigned
-- only once its department has GENERATED and APPROVED its brief — and every deliverable the product
-- creates has an owner, so a department. Fixtures older than that rule insert deliverables with no
-- owner and no brief and then assign. This helper puts such a campaign into the state the product
-- would have put it in: a department for any deliverable that has none, and an approved brief for
-- every department with work on the campaign. A suite that tests the gate itself (082, 083, 103,
-- 133) never calls it.
create or replace function test_accept_campaign_work(p_campaign uuid) returns void
language plpgsql as $$
begin
  insert into departments (id, tenant_id, name) values
    ('aaaaaaaa-0000-0000-0000-0000000de0ff', 'aaaaaaaa-0000-0000-0000-000000000001', 'Fixture dept')
  on conflict (id) do nothing;
  update deliverables d set department_id = 'aaaaaaaa-0000-0000-0000-0000000de0ff'
    from streams s
   where s.id = d.stream_id and s.campaign_id = p_campaign and d.department_id is null;
  -- ADR-0100 d.2 (23 Sep): the second gate is now the OWNER approving the task list, not the
  -- department approving its brief. A fixture that says "this campaign's work has been accepted"
  -- has to say it the way the product now means it. The brief approval below stays: it is harmless,
  -- and the suites that still test the old gate (082, 090) read it directly.
  -- The stamp is fenced (`deliverable_task_list_approval_fence`): it may only be written by
  -- `approve_deliverable_tasks`, which raises this flag first. A fixture standing in for that RPC
  -- has to raise it too, or the fence refuses — "the stamp is not editable", which is the fence
  -- doing exactly its job.
  perform set_config('app.task_list_approval', 'on', true);
  update deliverables d set tasks_approved_at = now(), tasks_approved_by = d.owner_user_id
    from streams s
   where s.id = d.stream_id and s.campaign_id = p_campaign and d.tasks_approved_at is null;
  perform set_config('app.task_list_approval', '', true);

  insert into campaign_briefs (tenant_id, campaign_id, department_id, brief_type, values, approved_at, approved_by)
  select distinct d.tenant_id, p_campaign, d.department_id, 'creative', '{}'::jsonb, now(),
         '00000000-0000-0000-0000-00000000a001'::uuid
    from deliverables d
    join streams s on s.id = d.stream_id
   where s.campaign_id = p_campaign and d.department_id is not null
  on conflict (campaign_id, department_id) do update
    set approved_at = excluded.approved_at, approved_by = excluded.approved_by;
end $$;
