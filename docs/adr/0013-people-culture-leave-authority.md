# ADR-0013: Org-wide leave authority via a dedicated `leave` grant; the HR/leave role is admin-composed, not seeded

- **Status:** accepted (Edward, 2026-08-13)
- **Date:** 2026-08-13
- **Relates to:** ADR-0008 (grants & roles as data), ADR-0009 (write scope)
- **Task(s):** L1.7 (leave calendar), Phase L (RBAC)

## Context

L1.7 (Module 1 scope, Edward 2026-08-12) is a **leave calendar owned by whoever handles people/HR**:
they record staff leave — planned and emergency — plus public holidays, which land as
`resource_unavailability` rows and show on the booking grid. Edward's direction (2026-08-13): the
leave manager has **org-wide** rights to record leave; and — importantly — **do not seed a specific
role**. "People & Culture Manager" is not a common title (most organizations call this HR); the name
and the role should be **created and assigned by an admin**, not baked into the system.

What already exists:

- **`resource_unavailability`** (`kind in ('leave','maintenance','holiday','other')`, a time span per
  resource) is the single table for all non-booking unavailability. Reads are tenant-wide; writes are
  gated by the **`blackouts:manage`** grant **and** `app.resource_in_write_scope(resource_id)`
  (ADR-0009/0010). `blackouts:manage` is held today only by scope-limited roles (Scheduler,
  Department/Team Lead), so none of them can record leave for a person outside their slice.
- **ADR-0008 already separates the two layers this decision needs.** *Permissions* are a fixed
  vocabulary (`permission_catalog`) that RLS policies check by name; *roles* are tenant-scoped **data
  rows** an admin creates, names, grants, assigns (`user_profiles.role_id`), and deletes from the
  Roles screen. Enforcement keys off grants, never off a role's name.
- `roles.scope` (ADR-0009) defaults to **`'tenant'`**, and the Roles screen does not yet expose scope
  editing — so **any role an admin creates today is tenant-scoped (org-wide writes) by default.**

So the gap is only that the *capability* to manage leave org-wide, as a thing distinct from managing
equipment maintenance, doesn't exist yet. It should ship as a **permission**, leaving the role that
holds it entirely up to the admin.

Two ways to grant leave authority were considered. **Reuse `blackouts:manage`:** simplest, but it
bundles leave with equipment maintenance, so any HR role would also gain maintenance-editing rights,
and the catalog couldn't show leave authority as its own line — rejected on least-privilege grounds.
**A dedicated `leave` grant** reaching only the HR-owned kinds: one new permission and one extra
policy, clean separation — chosen.

## Decision

1. **No seeded role.** The system does **not** ship a "People & Culture Manager" (or "HR") role. An
   admin creates the role from the Roles screen, names it to suit the organization, grants it the
   `leave` permissions below, and assigns it to the relevant user(s). Because new roles default to
   `scope = 'tenant'`, that role has **org-wide** leave reach out of the box — which is the stated
   requirement — without anything role-specific in code.

2. **New permissions** in `permission_catalog`:

   | Resource | Action | Meaning |
   |---|---|---|
   | `leave` | `view` | The leave-calendar surface (a nav section) |
   | `leave` | `manage` | Record/edit HR-owned unavailability (leave incl. emergency, and holidays) |

   Power Admin holds the whole catalog, so it picks these up automatically — leave is manageable on
   day one by Power Admin until the org builds its own HR role.

3. **Leave authority is scope-respecting and kind-restricted.** Add a second **permissive** write
   policy on `resource_unavailability`, reaching only the HR-owned kinds and honouring the role's
   scope exactly like every other write (ADR-0009):

   ```sql
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
   ```

   Postgres OR-combines permissive policies, so this only **widens** access — the existing scheduler
   `blackouts:manage` scoped policy is untouched. "Org-wide" is not hard-coded into leave: it falls
   out of the role's scope being `tenant` (the default). If a future admin gives an HR role a
   department scope, leave writes narrow to that department — the correct, consistent behaviour.
   Because both USING (old row) and WITH CHECK (new row) apply `kind in ('leave','holiday')`, a
   leave-only role cannot reclassify a row into `maintenance` to escape the fence. **Maintenance**
   stays an ops/scheduler concern; **holidays** (a company-calendar concern) sit with the leave role.

4. **Emergency vs planned leave** is a *category of a `leave` row*, not a new `kind`. Add a nullable
   **`resource_unavailability.category`** (`check (category is null or category in
   ('planned','emergency','sick','unpaid'))`), meaningful when `kind = 'leave'`. This is the only
   schema change; it keeps the `kind` enum and the grid/booking logic (which cares *when* a resource
   is unavailable, not *why*) unchanged, while letting the leave calendar mark and report emergency
   leave.

5. **Follow-up (not this ADR):** the Roles screen should eventually let an admin see/set a role's
   `scope`, so a departmental HR variant can be composed without a migration. Today scope defaults to
   `tenant`, which covers the org-wide requirement; this is flagged, not blocked.

## Consequences

Easier: the leave capability ships without prescribing a role name that wouldn't fit every org; the
admin composes and names the role (HR, People & Culture, whatever) and assigns it; the Roles screen
shows leave authority as its own explicit grant line; HR and equipment-maintenance concerns stop
overlapping; Power Admin can manage leave immediately.

Harder: one new permission pair and one extra write policy on `resource_unavailability` (documented
above, OR-combined, kind-fenced, scope-respecting); one new nullable column; the leave-calendar
surface must gate on `leave:view` rather than a fixed role.

Locked in: **no role is seeded or special-cased** — enforcement is grant-driven (ADR-0008 preserved);
leave authority is a **dedicated grant**, not a reuse of `blackouts:manage`; write reach follows the
role's **scope** (ADR-0009 preserved — org-wide is the tenant-scope default, not a leave-specific
rule); reads stay tenant-wide; the unavailability table stays single (kinds separate HR from ops,
`category` separates leave sub-types).
