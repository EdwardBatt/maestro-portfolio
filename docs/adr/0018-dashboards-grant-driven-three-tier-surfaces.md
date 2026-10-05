# ADR-0018: Dashboards are grant-driven, scope-parameterized, three-tier surfaces

- **Status:** accepted (Edward, 2026-08-15 — decisions D1–D5 resolved this session)
- **Date:** 2026-08-15
- **Supersedes:** the last live remnant of **OD 9** ("fixed role-based views for v1", design draft v15 §2.4) — completing what ADR-0008 began
- **Relates to:** ADR-0007 (dashboards deferred past launch), ADR-0008 (grant-driven views; roles as data), ADR-0009 (lead tiers + write scope), ADR-0010 (sub-task/SLA engine; JWT carries dept/team), ADR-0011 (nickname), ADR-0013 (leave/`directory` grant precedent), ADR-0014 (hierarchy-aware department scope; no self-booking), ADR-0017 (C-suite → health; deputy; directory)
- **Task(s):** M6, M7 (dashboards), and the interim pilot surfaces
- **Reference:** `docs/dashboards-role-surfaces-plan.md` (the reconciliation this ADR ratifies); Pencil `E2EV1.pen` frames 01/02/04/05/06

## Context

Both the dev plan and the Pencil frames were **initial drafts**. They name dashboards by persona —
"Creative — My Work", "Team Lead — Exception Feed", "Company Health", "Admin — Work Types & SLAs" —
which predates **ADR-0008**, where roles became tenant **data** and every surface became **grant-driven**
(absence, not hiding). Nothing may key off a role's *name*. Meanwhile ADR-0009 split the single "team
lead" persona into **two membership tiers** (Department Lead, Team Lead) plus an **assignment-scoped**
Account Manager, and ADR-0017 added CEO/COO/CFO (the Company-Health audience) and the Deputy Team Leader.

Design draft v15 §6 already frames the right model — **three tiers of the same data at different
altitudes** (individual **action surface** → oversight **exception feed** → **health** view), with
drill-down between them. This ADR keeps that model and re-expresses it against the grant system, and
records the five decisions taken this session.

A hard constraint (ADR-0007 / ADR-0010): the exception feed and health metrics depend on the
**sub-task + SLA + attribution engine**, which is deferred and not yet emitting signals. Only
**capacity/load** (from bookings) has data today. So the surfaces ship now in an interim, capacity-only
form and light up **additively** as the engine lands — no new screens later, just new rows/metrics.

## Decision

1. **Dashboards are grant-driven, scope-parameterized, three-tier surfaces** — not per-role screens.
   One surface serves many roles; what a holder sees is their **scope** slice. This supersedes OD 9's
   "fixed role-based views."

2. **The three tiers and their gates:**

   | Tier | Surface | Grant | Scope |
   |---|---|---|---|
   | 1 — Action | **My Work** | `my_tasks:view` / `my_calendar:view` (every internal role) | self |
   | 2 — Oversight | **Exception feed** | **`exceptions:view`** (new) | role scope — team / department / **account (campaigns)** |
   | 3 — Health | **Company & department health** | **`health:view`** (new) | department → company |

3. **An individual's own exceptions are Tier 1, never Tier 2** (D3 clarification). A person's own
   at-risk / blocked / waiting-on-me items live on **My Work**, gated by `my_tasks:view` — which every
   internal role already holds. `exceptions:view` is strictly the **oversight** feed: exceptions on work
   *other people* are doing that the viewer is accountable for.

4. **New permission `exceptions:view`** (D3). The oversight exception feed, held by **Department Lead,
   Team Lead, Deputy Team Leader, and Account Manager**, and **scope-parameterized**: team lead → their
   team; department lead → their department (hierarchy-aware, ADR-0014); **account manager → their
   assigned campaigns/projects**. A dedicated grant (not reuse of `team:view`) because the audience spans
   membership-scoped leads *and* an assignment-scoped, project-oriented AM — `team:view` reads wrong for
   the AM case. Power Admin auto-holds it (catalog trigger).

5. **New permission `health:view`** (D2). The Tier-3 company/department health view, seeded to
   **CEO, COO, CFO** (Power Admin auto via trigger). A dedicated, admin-assignable grant — consistent
   with the `leave` (ADR-0013) and `directory` (ADR-0017) precedent — so "see the health dashboards" can
   be granted (e.g. to a board member) without handing over admin screens.

6. **Leads land pre-filtered to their domain, with an opt-out** (D4). The exception feed opens on the
   viewer's own slice (design draft §6.3, "exception-first, not everything-first"), with a "show wider"
   affordance since reads are tenant-wide anyway (ADR-0009). The viewer's `department_id` / `team_id` /
   `scope` already ride in the JWT (ADR-0010/0014); the client must surface them (today `claimsFromSession`
   reads only tenant + role) — a no-migration client change that unblocks scope-correct defaulting.

7. **Account Manager's feed is deferred to the engine phase** (D5). Its assignment scope needs the
   campaign→AM and deliverable/sub-task data; the membership-scoped leads (team/department), whose load
   data exists, come first. The grant is seeded now; the AM's project-scoped rows populate with the engine.

8. **Engine-gating is explicit and additive.** Interim surfaces show capacity/load from bookings now
   (My Work ✅, Team load ✅, Overview ✅). The exception rows (SLA breach, at-risk, blocked, unassigned,
   approval-age) and true health metrics (on-time %, turnaround, throughput) switch on as ADR-0010's
   engine emits them — into the *same* surfaces, not new ones.

9. **Every default dashboard carries a company/industry news feed slot** (task M7.4). Interim: a
   placeholder ("coming soon"). The content-source choice (manual posts vs external/RSS pull) is **OD 31**,
   tracked separately; only the *slot on every landing* is fixed here.

## Consequences

Easier: one exception-feed surface and one health surface serve every relevant role by scope, so there
are no per-role screens to build or keep in sync; `health:view` and `exceptions:view` are clean,
auditable, admin-assignable lines; the interim capacity surfaces are already the right shells.

Harder / follow-ups: two new catalog permissions + a re-seed (one migration); the client claims must
surface `department_id`/`team_id`/`scope`; the exception feed and health metrics remain **blocked on the
ADR-0010 engine** for everything past capacity — this ADR fixes the *shape and gates*, not the engine.

Locked in: dashboards are grant-driven and scope-parameterized (ADR-0008 preserved and extended);
three tiers of one dataset with drill-down (design draft §6 preserved); individual exceptions are Tier 1;
oversight exceptions are `exceptions:view`; health is `health:view`; leads default to their own slice;
no role is special-cased in code — all of this is grants + scope over hand-written, audited policies.
