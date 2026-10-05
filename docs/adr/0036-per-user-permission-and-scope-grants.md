# ADR-0036: Per-user permission & scope grants (flexible RBAC overlay)

- **Status:** accepted (Edward, 2026-08-23 — acceptance condition: **grant administration stays
  Power Admin-only for now**; delegated per-department administration remains deferred, per
  Decision §5 and the Implementation-notes follow-up)
- **Date:** 2026-08-23
- **Open Decision:** none (extends OD 9 / ADR-0008; ADR-0008 §5 requires a new ADR to change the grant model)
- **Task(s):** new sub-phase (proposed `L6` / `RBAC2`); retires the TEMP alpha toggles `TMP.1`, `TMP.1a`, `TMP.2`, `TMP.3`
- **Supersedes / amends:** amends ADR-0008 (grant model) and ADR-0009/0010 (scope model). Does **not** touch tenant isolation.

## Context

ADR-0008 gave Maestro configurable RBAC: a person is assigned exactly **one role**, and that
role decides **both** axes of access —

- **Permission ("what actions")** via `app.has_permission(resource, action)`, which checks the
  caller's single `app_role_id` claim against `role_grants` (deny-by-default, one chokepoint,
  consumed by every RLS policy and Edge Function).
- **Scope ("over whose data")** via `roles.scope` (`tenant|department|team|account|self`) consumed
  by `app.in_write_scope(dept, team, am)` (ADR-0009/0010). Writes must pass **both** axes.

This is a good foundation but it is **rigid: access is bound entirely to the role**. Real
organisations have individuals — **in every department**, not only Client Services — who carry
accountability beyond their role's bundle: a person who must approve, moderate reviews, or act
across a neighbouring team, without every holder of their role gaining the same. Today the only
ways to express that are (a) invent an ever-narrower role (role explosion), or (b) widen the whole
role (over-grant). Neither is least-privilege.

The **TEMP alpha toggles** (`TMP.1`–`TMP.3`, migrations `20260820040000`–`070000`) are the
symptom: to unblock the pilot, both axes were cranked wide open **globally** — every internal role
blanket-granted booking actions, `in_write_scope` dropped, and any user allowed to review/sign off.
That nullified intra-tenant scope isolation for everyone. They are documented as temporary with
revert paths; this ADR is the principled mechanism that lets us revert them and instead hand the
**specific accountable people** the **specific extra** they need.

Industry practice (Auth0, Kubernetes, WorkOS, Oso) is consistent: effective permissions are the
**additive union** of role grants and direct user grants, with **explicit deny taking precedence**;
but direct-to-user grants are for genuine **exceptions**, with roles remaining the default for any
shared/stable pattern. Supabase's own guidance validates the existing shape — authorization is
checked against **tables**, not JWT metadata — so per-user grants live in the same safe per-query
table lookup with **no change to the JWT**.

Decisions taken with Edward for this ADR: the overlay must cover **wider scope** (acting across
teams/departments), must support **explicit deny**, grants are **permanent** (no expiry), and the
capability is **platform-wide across all departments** — not a Client Services special case.

## Decision

Keep roles as the foundation and the default; add a thin **per-user overlay** on **both** axes,
changing only the two authorization primitives so the entire policy layer inherits it for free.

1. **Roles first (discipline unchanged).** Any permission bundle shared by more than a couple of
   people, or stable over time, is still expressed as a **role** (create/edit from the Roles
   screen — no migration). The overlay is for **individual exceptions**, in any department. This
   preserves the least-privilege / no-role-explosion balance the industry recommends.

2. **New table `user_grants` (permission axis, additive + deny).**
   `(tenant_id, user_id, resource, action, effect check ('allow','deny'), granted_by, reason,
   created_at)`, PK `(user_id, resource, action)`, `foreign key (resource, action) references
   permission_catalog`. `allow` adds an ability the role lacks; `deny` removes one the role grants.

3. **New table `user_scope_grants` (scope axis, additive targets).**
   `(tenant_id, user_id, department_id null, team_id null, granted_by, reason, created_at)` — each
   row means *"additionally treat this department/team as within this user's write scope."* This is
   **precise cross-team reach** (name the exact teams/departments a person is accountable for),
   chosen over a blunt per-user `scope_override` to a higher enum level — see Alternatives. A row
   with both null is rejected.

4. **Two primitives change; nothing else.**
   - `app.has_permission(resource, action)` becomes:
     `(role holds it OR user has an allow-grant) AND NOT (user has a deny-grant)` — **deny wins**.
   - `app.in_write_scope(dept, team, am)` becomes the existing role-scope test **OR**
     `dept ∈ user's granted departments` **OR** `team ∈ user's granted teams`.
   Because every RLS policy and Edge Function already funnels through these two functions, **no
   individual policy is rewritten** — they inherit the overlay. The frontend `permissions.tsx`
   session fetch unions role + user grants and applies deny (still no JWT change, still no
   `localStorage`).

5. **Administering the overlay is a distinct, fenced ability.** New catalog entries
   `user_grants:view` and `user_grants:manage` (separate from `users:manage` and `roles:manage`, so
   "grant a person extra power" can be delegated without handing over user lifecycle or the role
   catalog). Held by **Power Admin** initially. **Hard guardrails:**
   - **No self-grant / no self-scope:** the write policies require `user_id <> auth.uid()` — even a
     Power Admin cannot silently elevate themselves; a second admin must do it (segregation of
     duties). Enforced in RLS, re-proven in pgTAP.
   - **A grant can never exceed the catalog** (FK) and is **tenant-pinned** (cross-tenant
     impossible).
   - **External identities are fenced:** `client_portal` users cannot receive `user_grants` or
     `user_scope_grants` (guard trigger) — the portal surface stays exactly as narrow as M10's
     adversarial suite will require.
   - **No dynamic SQL, no SECURITY DEFINER** added to the read path — the primitives stay STABLE
     invoker SQL, same as `has_permission` today.

6. **Everything is audited (ADR-0008 §8).** Both tables are business tables, so the universal audit
   triggers capture every insert/update/delete; the mandatory `granted_by` + `reason` columns make
   the trail human-readable ("who gave whom what, and why"). Grant/deny/scope changes are as
   auditable as role changes.

7. **This retires the TEMP alpha toggles.** Once the overlay ships and the named accountable people
   hold the right `user_grants` / `user_scope_grants`, the revert migrations for `TMP.1/1a/2/3`
   restore the scoped booking-write policies and the `reviews:moderate` gate, and flip the four
   `TEMP alpha` pgTAP assertions back to `throws_ok('42501')` — deny-by-default + scope restored for
   everyone, with the specific exceptions carried as data.

## Alternatives considered

- **Finer-grained roles only (no schema change).** The RBAC-purist answer, and still correct for
  *shared* bundles (a recurring "Senior AM" pattern → a role). Rejected as the *sole* mechanism: it
  cannot express one-person or cross-team-accountability exceptions without role explosion — the
  rigidity being solved.
- **Coarse per-user `scope_override` (single higher enum level).** Simplest scope change (one
  nullable column, `current_scope()` coalesces it). Rejected: elevating a person to `tenant`/
  `department` grants blunt reach over *all* matching data, the opposite of least-privilege; the
  additive-target model names exactly the teams/departments and nothing more.
- **Explicit deny deferred (allow-only).** Lower cognitive cost. Rejected per Edward's decision —
  deny is required (e.g. remove one sensitive action from a single role-holder), with standard
  deny-precedence.
- **Expiring / time-boxed grants.** Considered as a clean replacement for "temporary" elevation.
  Rejected per Edward's decision — grants are permanent until revoked (no expiry sweep to build).
- **External policy engine (Oso / Permit / Cerbos / OPA) or ReBAC (SpiceDB).** Powerful FGA, but a
  paid-or-self-host dependency (ADR-0002) that moves the security boundary **out of Postgres/RLS** —
  forfeiting the "database is the boundary" guarantee M8/M10 rely on, and adding a second source of
  truth (already rejected in spirit by ADR-0015). Rejected.

## Consequences

**Easier:** individual accountability is expressible in any department without role explosion or
over-granting; the TEMP alpha toggles become revertible with real, auditable data behind the
exceptions; the change surface is tiny (two tables, two function bodies, one union in the frontend
fetch) because the one-chokepoint design was built for exactly this; grants stay out of the JWT.

**Harder:** two more adversarial surfaces to test disproportionately (self-grant, cross-tenant,
deny-precedence, scope-target reach, portal-fencing, revoked-grant latency); "why can this person do
X?" now has two answers (role **and** overlay) — mitigated by an admin view that shows effective
permissions with their source, and by the roles-first rule that keeps the overlay sparse; a per-user
deny can lock capability in surprising ways, so the effective-permissions view must make deny
visible.

**Locked in (require a further ADR to change):** deny-takes-precedence semantics; additive
scope-**targets** (not coarse override); overlay administration gated by a dedicated, non-self
`user_grants:manage`; no expiry; roles remain the default and the overlay the exception; the two
primitives remain the only authorization chokepoints (no per-policy bespoke grant logic); tenant
isolation and the no-dynamic-policy / no-DEFINER-read-path rules from ADR-0008 are untouched.

## Implementation notes (non-binding — for the build tasks once accepted)

- Migrations are **additive** (new tables + `create or replace` of the two helpers, both carrying
  the ADR-0033 `search_path` pin). The `TMP.1/1a/2/3` reverts are a **separate, later** migration
  applied only after the real accountable users are seeded with grants — ship the overlay green
  first, then re-scope.
- pgTAP additions (adversarial): role-only baseline unaffected · allow-grant adds exactly one
  action · deny-grant removes a role action (precedence) · scope-target permits exactly the named
  team/dept and no other · self-grant denied (`42501`) · cross-tenant grant denied · `client_portal`
  cannot receive grants · plus the four flipped `TEMP alpha` assertions in `002/007/010/027`.
- UI: the Roles & permissions area gains a per-user editor (effective grants shown with source —
  role vs allow vs deny — and a scope-target picker). Grant-driven and audited like the role matrix.
- Open follow-up (own decision later): **delegated administration** — letting a Department Lead
  grant within their own department — is deferred; it introduces an escalation vector (a lead
  elevating a proxy) that needs its own bounded design + tests. v1 keeps overlay administration
  centralised (Power Admin / an admin-composed role).
```
