-- ADR-0013: org-wide leave authority as a dedicated `leave` grant (not a seeded
-- role). Adds the permission pair, backfills Power Admin (which holds the whole
-- catalog), adds a scope-respecting + kind-fenced write policy on
-- resource_unavailability, and a `category` column so emergency/planned/sick/
-- unpaid leave is a reportable sub-type of a `leave` row (not a new kind).
-- Idempotent. No role is seeded; an admin composes and names the HR/leave role
-- on the Roles screen and assigns `leave:manage` (+ `leave:view`) to it.

-- 1. Permission vocabulary (global catalog; enum-like, not tenant-scoped).
--    The `grant_new_catalog_to_power_admin` trigger (ADR-0008) fires on this
--    insert and grants both new permissions to every existing tenant's Power
--    Admin automatically — "Power Admin never falls behind". Future tenants
--    inherit them because seed_tenant_roles reads the catalog live. So no
--    explicit Power-Admin backfill is needed here; the HR/leave role itself is
--    admin-composed and granted `leave:manage`/`leave:view` from the Roles screen.
insert into permission_catalog (resource, action, description) values
  ('leave', 'view',   'People & Culture leave-calendar surface'),
  ('leave', 'manage', 'Record/edit leave (incl. emergency) and holidays')
on conflict (resource, action) do nothing;

-- 2. Leave sub-type. Meaningful when kind = 'leave'; null otherwise. Kept off the
--    `kind` enum so grid/booking logic (which cares WHEN, not WHY) is unchanged.
alter table resource_unavailability
  add column if not exists category text;
alter table resource_unavailability
  drop constraint if exists chk_unavailability_category;
alter table resource_unavailability
  add constraint chk_unavailability_category
  check (category is null or category in ('planned', 'emergency', 'sick', 'unpaid'));

-- 3. Leave write policy: HR-owned kinds only, honouring the role's write scope
--    (ADR-0009). OR-combines with the existing blackouts:manage scheduler policy,
--    so schedulers are unaffected. Org-wide reach is the tenant-scope default, not
--    hard-coded here. kind-fence on both USING (old row) and WITH CHECK (new row)
--    stops a leave-only role reclassifying a row into maintenance to escape it.
drop policy if exists resource_unavailability_leave_write on resource_unavailability;
create policy resource_unavailability_leave_write on resource_unavailability
  for all to authenticated
  using (tenant_id = app.current_tenant_id()
         and app.has_permission('leave', 'manage')
         and kind in ('leave', 'holiday')
         and app.resource_in_write_scope(resource_id))
  with check (tenant_id = app.current_tenant_id()
              and app.has_permission('leave', 'manage')
              and kind in ('leave', 'holiday')
              and app.resource_in_write_scope(resource_id));
