# ADR-0008: Configurable RBAC — roles, grants, and org structure as data

- **Status:** accepted (Edward, 2026-08-02 — with two amendments: the full-access system
  role is named **Power Admin**, and auditability is universal, see Decision 8)
- **Date:** 2026-08-02
- **Open Decision:** supersedes OD 9's "fixed role-based views for v1" resolution
- **Task(s):** Phase L1 (restructured on acceptance); touches every RLS policy, both auth
  Edge Functions, guards/nav, and the L2 view switcher
- **Reference reviewed:** `esports-site` RBAC (roles table + permissions matrix + admin
  rules screens), at Edward's direction

## Context

The v15 design doc fixed six code-level roles (creative, booker, team_lead, support,
admin, client_portal) as §2.3 personas. Edward's correction: these are not Meridian's
organisation — there is no "booker" job. The real structure (org chart) is people with
**job titles** belonging to **departments** (Client Services, Creative, Performance,
Production, Influencers, Accounting, P&C, IT). The schema has a `departments` table but
only resources link to it; `user_profiles` carries no department or job title. And the
enum model means every role change is a migration + code deploy — a proper RBAC lets an
administrator create rules and assign them.

The reference implementation (esports-site) proves the shape works in production on the
same stack: a `roles` table (rows, not enum) with `profiles.role_id`, a permissions
matrix editable from an admin screen, fail-closed checks on client and server. Two of its
mechanisms are deliberately **not** carried over, with reasons in the Decision.

## Decision

1. **Separate the three concepts.** Platform **role** = a named bundle of permissions,
   assigned per user. **Job title** = display/HR fact on the profile. **Department** =
   org membership on the profile (FK to the existing `departments` table). A person's
   access never derives implicitly from title or department.

2. **Roles are tenant-scoped rows.** New `roles` table: `id`, `tenant_id`, `key` (stable
   slug, immutable), `name` (display, editable), `description`, `is_system`,
   `default_route`, `status`. Seeded per tenant: **Power Admin** (`power_admin`) and
   **Client Portal** as `is_system` (cannot be deleted). Power Admin holds **every grant
   in the catalog, automatically including grants added by future migrations** — full
   access by complete grant coverage, never by bypassing checks. Editable starters:
   **Scheduler**, **Department Lead**, **Team Member**. Admins create more from the UI —
   no migration, no deploy. Cutover mapping: existing `admin` users (Edward) →
   **Power Admin**, losing nothing.

3. **`user_profiles` gains `role_id` (FK roles, not null), `department_id` (FK
   departments, nullable), `job_title` (text, nullable).** The `role` enum column is
   dropped after cutover (pre-launch, minimal data: bootstrap + seed users are
   re-pointed in the same migration). The JWT claim changes from `app_role` (name) to
   `app_role_id` (uuid): still `app_metadata`, still written ONLY by the provisioning
   functions, claim + profile updated atomically or not at all (ADR pattern from L1.2).

4. **Permissions are explicit deny-by-default grants.** `role_grants` table:
   `tenant_id`, `role_id`, `resource` (text key from a code-seeded catalog), `action`
   (`view|create|update|delete|approve|export|manage`), unique per triple. No hierarchy
   levels: Meridian's roles are lateral, and levels grant by implication — every ability must
   be an explicit, auditable rule. No bypass role: Administrator is powerful because it
   holds all grants, not because checks skip it. Grant changes write `audit_events`.

5. **Enforcement stays layered, policies stay hand-written.** A helper
   `app.has_permission(resource, action)` (STABLE SQL: does the caller's `app_role_id`
   hold this grant in this tenant?) replaces `app.is_admin()` inside RLS policies and
   Edge Function authorization. The esports-site **auto-sync trigger that regenerates
   RLS policies from permission rows is explicitly rejected**: Maestro policies remain
   hand-written, reviewed, pgTAP-tested SQL that *consult* grant data — rule changes are
   instant data changes, but no screen can rewrite the tenant-isolation layer, and no
   SECURITY DEFINER DDL generator exists to attack. Client-side caching of a permissions
   snapshot (the esports store) is adopted in React Query form, **without** localStorage
   (claims-adjacent data stays out of storage; a fetch per session is cheap).

6. **Views become grant-driven.** `view.*` grants (e.g. `schedule:view`,
   `admin.users:view`, `my_calendar:view`) drive nav items, route guards, and the L2
   view switcher; `roles.default_route` replaces the hardcoded `ROLE_HOME`. The §2.3
   leakage rule is unchanged: absence, not hiding — plus RLS beneath it as always.

7. **Client Portal remains a fenced system role**: its grants are fixed (`is_system`),
   and the M10 portal adversarial suite still gates that surface before it ships.

8. **Everything is logged and auditable — system-wide (Edward's acceptance condition).**
   Auditability stops being per-feature courtesy and becomes a platform rule: every
   mutation on every business table lands in the append-only `audit_events` log with
   actor, tenant, entity, action, and changed fields — regardless of the write path.
   Edge-Function writes already log explicitly; direct client writes (PostgREST under
   RLS) are captured by table-level audit triggers added in the RBAC migration, so
   nothing can be created, changed, or deleted silently. Role assignments, grant
   changes, and sign-in-relevant events (invites, deactivations, password resets) are
   part of the same trail. `audit_events` keeps its append-only enforcement (INSERT-only
   + REVOKE, pgTAP-proven) — the log itself cannot be edited or pruned from the app. A
   Power Admin-only audit view surfaces the trail in the UI (tracked in Phase L).

## Consequences

Easier: roles match the real organisation; new roles/rule changes are admin actions, not
deploys; profiles carry department + title for views, filters, and later
department-scoped calendars; the grants matrix is the single auditable answer to "who
can do what".

Harder: every existing RLS policy is touched and the full pgTAP suite re-proven
(adversarial cases: forged grants, cross-tenant role reads, revoked-grant latency);
`update-user`/`invite-user` re-target `role_id`; existing auth users need one-time claim
re-provisioning (pre-launch, so trivial now — the cost of doing this *after* launch is
exactly why it happens in L1). Adds roughly a milestone of work to L1.

Locked in: deny-by-default grants; no dynamic policy generation ever without a new ADR;
role/grant mutations are audited; `app_role_id` claim written only by service-role
functions.
