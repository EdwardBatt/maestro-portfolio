# ADR-0126: Everyone lands on My Work; anyone without My Work lands on the Dashboard

- **Status:** accepted (Edward, 30 Sep) — records Edward's answer of 29 Sep, already built and on production
- **Date:** 2026-09-30
- **Open Decision:** none
- **Amends:** ADR-0008 (`roles.default_route` per role, kept) and ADR-0017's seeded routes; follows ADR-0122 d.6
- **Task(s):** I66.7 (closes the parked `I48.16`)

## Context

Where a person lands after signing in was set per role (`roles.default_route`, ADR-0008):

| Role | Landed on |
|---|---|
| Account Director | Campaigns |
| Account Manager | Schedule |
| Leads | Team |
| C-level and admins | `/admin` (ADR-0017) |

The landing question was parked on 13 Sep until the dashboards existed (`I48.16`). Once ADR-0122 gave every
signed-in person a Dashboard, it was due. Edward, 29 Sep: *"All users land on my-work, users that have no
my-work land on dashboard."*

Two ways to build it:

- **(A) One fixed rule in the code.** The per-role setting would be ignored.
- **(B) Keep the per-role setting and set every role to the new rule.** An admin can still change one
  role's landing on the Roles page.

Edward chose **B**.

## Decision

1. **Every role in every tenant lands on `/my-work` where it holds My Work** (`my_tasks:view` or
   `my_calendar:view`), **and on `/dashboard` otherwise.** Today that means the CEO, COO and CFO. The
   client portal keeps `/portal`.
2. **The setting stays per role.** New tenants get the same routes (`app.seed_tenant_roles`,
   `app.seed_account_director`).
3. **A landing the person cannot open falls through to the Dashboard** (`app/landing.ts`), so a personal
   grant removed later never leaves someone on a page they cannot see. The UI never blocks.
4. **The Roles page offers** My Work, Dashboard, Campaigns, Schedule, Team and Portal. `/admin` is no
   longer offered: it opens the Dashboard.

## Consequences

*Easier:* everyone starts on their own work (ADR-0105), and a new role lands somewhere sensible without
anyone choosing.

*Harder:* a role an admin points elsewhere stays pointed there. The rule is a default, not a guarantee.

*Locked in:* nothing. The setting can still be changed per role.

*Cost:* migration `20260929150000`; pgTAP 198; browser L5 (each role lands on its route).
