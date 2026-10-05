# ADR-0017: Seed C-suite oversight roles (CEO/COO/CFO) and a Deputy Team Leader; add a company `directory` grant

- **Status:** accepted (Edward, 2026-08-15)
- **Date:** 2026-08-15
- **Relates to:** ADR-0008 (grants & roles as data), ADR-0009 (write scope), ADR-0011 (users are resources; nickname), ADR-0013 (seed-universal / compose-niche), ADR-0014 (team-implies-department scope)
- **Task(s):** L1.19 (seed C-suite + Deputy Team Leader), L1.20 (company directory)

## Context

Two org-shape gaps surfaced while wiring real staff for the pilot, plus one small new surface.

**1. No executive oversight roles.** The seeded set tops out at Department Lead / Scheduler / Power
Admin. A real org has a C-suite (CEO, COO, CFO) that needs to *see across the whole organization* —
the master grid, month density, the read-only admin panels, cost/rate visibility — but should **not**
be handed Power Admin (which holds every grant, including `users:manage`, `roles:manage`,
`organization:manage`). Oversight is a read posture; administration is not. Edward's direction
(2026-08-15): *"seed all C-Suite as normal roles… if they are not appointed we do not need to use
them."* So they ship as ordinary, deletable, tunable role rows — present for the orgs that use them,
removable in one click for the orgs that don't.

**2. A three-level org structure on a two-level model.** The org is Department → Team → **Sub-team**
(3 levels), but the data model is Department → Team → people (2). The lightweight fix Edward chose is
a **Deputy Team Leader** role "where it exists," carrying **the same permissions as the Team Leader**.
Two reaches were considered (AskUserQuestion):

- **Option 1 — whole-team reach (chosen).** Deputy = an exact clone of Team Leader: `scope = 'team'`,
  identical grants. Zero new code, zero schema. The deputy can act across the *whole* team, not just a
  named sub-team. Edward asked whether this is reversible later; it is — see Consequences.
- **Option 2 — true sub-team scoping.** A real third org level (`sub_teams` table, a new
  `roles.scope = 'sub_team'`, a scope-helper branch). Correct long-term, but a contained migration in
  its own right and not needed for the pilot.

Option 1 ships now; Option 2 stays an additive follow-up if sub-team-precise authority is ever needed.

**3. A company directory.** Edward: *"add a company Directory that lists all registered employees by
department (full name, nickname, email)."* This is a read-only internal surface. Per ADR-0008 it must
be **grant-driven**, not role-name-driven, and it should be visible to internal staff but **not** to
external `client_portal` accounts. The data it needs already reads tenant-wide under existing policies:
`user_profiles` (`display_name`, `email`, `department_id`) via `user_profiles_tenant_select`, and the
linked resource's `nickname` (ADR-0011) via `resources_tenant_select`. No new table or read policy —
only a new **`directory:view`** permission to gate the nav item and route.

This is the same seed-vs-compose line ADR-0013 drew, applied to the other side of it. ADR-0013 refused
to seed "People & Culture Manager" because HR titles vary org-to-org — a **niche** role, admin-composed.
CEO/COO/CFO and a deputy-to-the-team-lead are the opposite: **near-universal** titles that essentially
every org recognises. Seeding universal titles and composing niche ones is one consistent principle.

## Decision

1. **Seed CEO, COO, CFO as ordinary oversight roles.** Non-system (`is_system = false`, so an admin can
   rename, re-grant, or **delete** any unused one), `scope = 'tenant'` (org-wide *read*),
   `default_route = '/admin'` (the Overview dashboard, which already gates on any `admin.*:view` grant —
   nav-config `ADMIN_VIEW`). Grants are **read/oversight only — no `*:manage`, no `users`/`roles`/
   `organization` administration**:

   | Role | Grants (all view/oversight) |
   |---|---|
   | **CEO** | `admin.users:view`, `admin.resources:view`, `admin.organization:view`, `admin.roles:view`, `schedule:view`, `project_calendar:view`, `month_overview:view`, `bookings_table:view`, `team:view`, `audit:view`, `rates:view`, `directory:view` |
   | **COO** | the CEO oversight set **minus** `admin.roles:view`/`rates:view`, **plus** `bookings:approve` (operational sign-off across the org) |
   | **CFO** | `admin.organization:view`, `admin.resources:view`, `schedule:view`, `month_overview:view`, `bookings_table:view`, `rates:view`, `bookings:export`, `directory:view` (finance/cost posture) |

   These are *starter* defaults; every grant is tunable on the Roles screen (ADR-0008). CEO/COO/CFO are
   the seeded core; other C-titles (CMO/CTO/CCO) are one admin action away (clone a C-suite role, rename)
   and are deliberately **not** seeded — they are not universal enough to bake in.

2. **Seed Deputy Team Leader as a clone of Team Leader (Option 1).** Non-system, `scope = 'team'`,
   `default_route = '/team'`, grants copied **verbatim** from the tenant's `team_lead` role — so parity
   is guaranteed by construction (`insert … select … from role_grants where role_id = team_lead`), not
   by a hand-maintained duplicate list that could drift. An admin assigns it to the deputy of any team
   that has one; teams without a deputy simply never assign it.

3. **Add a `directory:view` permission** to `permission_catalog` and grant it to **every seeded role
   except `client_portal`** (all internal roles, present and future-seeded). Power Admin picks it up via
   the existing `grant_new_catalog_to_power_admin` trigger. The Company Directory surface (L1.20) gates
   its nav item and route on `directory:view`.

4. **One idempotent migration** `create or replace`s `app.seed_tenant_roles` with the three C-suite
   roles, the deputy clone, and the blanket internal `directory:view` grant, then re-runs it for all
   existing tenants (`on conflict do nothing` throughout, so re-running is safe and existing grants are
   never disturbed).

## Consequences

Easier: orgs get sensible executive and deputy roles out of the box; oversight (CEO/COO/CFO) is
read-only by construction, so seeding them can never accidentally hand out administrative power;
Deputy Team Leader parity with Team Leader can never drift because it is a live copy of the same grants;
the directory is a single new grant over data that already reads tenant-wide.

Harder / watch: four more rows in every tenant's Roles screen (deletable if unused); the deputy has
*whole-team* reach, not sub-team-precise reach — acceptable for the pilot, flagged below.

Locked in — and **reversibility of Option 1** (Edward's question): the deputy is a plain role row with
`scope = 'team'`. Moving to true sub-team scoping later is **purely additive and non-breaking**: add a
`sub_teams` table, extend `roles.scope` to allow `'sub_team'`, add one branch to `app.in_write_scope`,
and flip existing deputies' scope from `'team'` to `'sub_team'`. No data migration of bookings, no
policy rewrite, no change to any other role. Until then, nothing is lost — a whole-team deputy is a
strict superset of a sub-team deputy's reach. Enforcement stays grant-driven (ADR-0008): none of these
roles is special-cased anywhere in code; they are grant rows like every other role, and an admin can
rename, re-grant, or delete any of them.
