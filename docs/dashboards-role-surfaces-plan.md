# Role Dashboards & Surfaces — reconciled plan

*Reconciles the original conceptualization (design draft v15 §2.4 + §6; Pencil `E2EV1.pen`
frames 01–06) with the accepted ADRs (0007–0017). Both the dev plan and the Pencil frames were
**initial drafts**; where an ADR has moved things, the ADR wins. This document is the bridge from
"what each role should see" to "what we build, gated how, and what is blocked on the engine."*

Status: **ratified by ADR-0018** (Edward, 2026-08-15). The §7 decisions are resolved: dedicated
`exceptions:view` + `health:view` grants (shipped, migration `20260815120000`); leads pre-filter to
their domain; individual exceptions stay Tier 1; the Account Manager's project feed waits on the engine.
See `docs/adr/0018-dashboards-grant-driven-three-tier-surfaces.md`.

---

## 1. Sources

- **Design draft v15 §2.4** — indicative role→surface mapping (Creative, Booker/Scheduler, Team lead,
  Support, Admin).
- **Design draft v15 §6** — the three-tier dashboard model (Action surface → Exception feed → Health),
  "same data, different altitudes", exception-first, drill-down.
- **Pencil `E2EV1.pen`** — concrete frames: `01 Master Schedule`, `02 Creative — My Work`,
  `04 Team Lead — Exception Feed`, `05 Company Health`, `06 Admin — Work Types & SLAs` (plus feature
  frames: chat, brief, media review).
- **ADRs 0007–0017** — the changes that supersede/refine the drafts (next section).

---

## 2. What the ADRs changed (the reframing)

The single biggest change is **ADR-0008**: it *supersedes* the design doc's "fixed role-based views
for v1" (OD 9) and the six code-level personas. Consequences for every dashboard:

1. **Surfaces are grant-driven, not role-named.** The Pencil frame "04 **Team Lead** — Exception Feed"
   is not "the team_lead role's screen." It is *the Exception Feed surface*, shown to whoever holds the
   relevant grants, and **scope-parameterized** by the viewer's role scope. One surface serves Team
   Lead, Deputy Team Leader, Department Lead and Account Manager — each sees their own slice. Roles are
   tenant data an admin can rename/add/delete (ADR-0008/0017), so nothing can key off a role's name.

2. **The personas are not our roles.** Mapping the Pencil/design names to the seeded roles
   (ADR-0008 → 0009 → 0017):

   | Draft persona | Now | Scope (ADR-0009/0017) |
   |---|---|---|
   | Creative | **Team Member** | self |
   | Booker / Scheduler | **Scheduler** | tenant |
   | Team lead | **Team Leader** + **Deputy Team Leader** | team |
   | *(new tier)* | **Department Lead** | department (team→dept hierarchy-aware, ADR-0014) |
   | *(new)* | **Account Manager** | assignment (their campaigns) |
   | *(new, ADR-0017)* | **CEO / COO / CFO** | tenant (read-only oversight) |
   | Admin | **Power Admin** | tenant |
   | Support / sales / event | *not seeded* — admin-composed if needed | — |
   | *(new, ADR-0013)* | HR / leave role | admin-composed; org-wide by default |

3. **Two lead tiers, not one** (ADR-0009). The Pencil "Team lead" exception feed must serve both a
   **team** slice (Team Lead/Deputy) and a **department** slice (Department Lead — "everything in his
   domain", Edward's phrasing) with the department scope *hierarchy-aware* (ADR-0014: a resource tagged
   only with a team still counts under its parent department).

4. **Reads are tenant-wide; scope constrains writes** (ADR-0009). So a dashboard "scoped to my domain"
   is a **UI filter** defaulting to the viewer's department/team, not an RLS boundary. The viewer's
   `department_id`/`team_id` already ride in the JWT (ADR-0010/0014) — but the client only surfaces
   `tenant_id`/`role_id` today (see §6, the one plumbing gap).

5. **Timing** (ADR-0007). The full Tier-1/2/3 dashboards were explicitly **deferred** past team-launch;
   the pilot ships the booking calendar, and creatives/leads get "the essential slice" early. So an
   interim, capacity-only cut of these surfaces is the correct pilot posture — the full versions are
   engine-gated (§5).

6. **Cross-cutting display rules** the surfaces must honour: name **+ nickname** everywhere
   (ADR-0011); people on **leave** show unavailable and reduce available capacity (ADR-0013);
   **deactivated** resources are flagged, not deleted (ADR-0014); **no self-booking** — My Work is
   read-only over one's own bookings, not a self-scheduler (ADR-0014).

---

## 3. The three tiers, as grant-driven surfaces

Design doc §6's tiers, re-expressed against the grant model. All three read the *same* bookings / SLA
clocks / attribution — "different altitudes" (§6.5), with drill-down between them.

| Tier | Surface | Gated by (grants) | Scoped to | Seeded roles that land/see it |
|---|---|---|---|---|
| **1 — Action** | My Work | `my_tasks:view` / `my_calendar:view` | self | Team Member (lands); Scheduler & all leads also hold it |
| **2 — Exception feed** | Team / oversight | `team:view` (+ approve/assign grants for actions) | **role scope** — team / department / assignment | Team Leader, Deputy, Department Lead (land); Account Manager, COO/CEO (see) |
| **3 — Health** | Company & department health | oversight read set (`month_overview:view` + `admin.*:view`; see §7 Q2) | department → company | CEO/COO/CFO, Power Admin (land on Overview) |
| *config* | Admin — work types & SLAs | `organization:manage` / `roles:manage` | tenant | Power Admin |
| *substrate* | Master Schedule | `schedule:view` | tenant (filterable) | Scheduler, Account Manager (land) |

---

## 4. Per-role landing & surfaces (current seeded set)

Landing = `roles.default_route`. "Sees" = grant-driven nav beyond the landing.

| Role | Lands on | Intended primary surface (target) | Also reaches |
|---|---|---|---|
| **Team Member** | My Work | Tier-1 action surface (Pencil 02) | Directory |
| **Scheduler** | Schedule | Master grid (Pencil 01) | My Work, Bookings, Directory |
| **Account Manager** | Schedule | Master grid + **assignment-scoped** exception slice | Bookings, Team, Directory |
| **Team Leader / Deputy** | Team | Tier-2 exception feed, **team** scope (Pencil 04) | My Work, Schedule, Bookings, Directory |
| **Department Lead** | Team | Tier-2 exception feed, **department** scope (his whole domain) | My Work, Schedule, Bookings, Audit, Directory |
| **CEO** | Overview | Tier-3 **company health** (Pencil 05) | Schedule, Bookings, Team, all admin read-only, Audit, Directory |
| **COO** | Overview | Tier-3 health + **operational** (approvals) | + `bookings:approve` |
| **CFO** | Overview | Tier-3 health, **finance** cut (rates, cost, export) | Resources, Organization, Directory |
| **Power Admin** | Overview | Overview + full config (Pencil 06) | Everything |
| **HR / leave** (composed) | *(admin-set)* | Leave calendar | Directory |
| **Client Portal** | Portal | *(external — out of scope for this plan)* | — |

---

## 5. Buildable now vs engine-gated

The dividing line is **data**. Capacity/load comes from bookings, which exist. Everything the exception
feed and health views need beyond load — SLA clocks, deliverable/sub-task status, block states,
approval age, unassigned work, on-time %, turnaround — depends on the **sub-task + SLA + attribution
engine** (ADR-0010), whose UI/clocks are deferred (M1.16 assignment UI blocked; SLA profiles M6.4/M9
not built; ADR-0007 pushed all of this past launch).

**Have data today (buildable now, pilot-grade):**

- **Tier 1 — My Work**: ✅ shipped (read-only own bookings).
- **Tier 2 — capacity slice**: this-week booked hours, booking count, over-ceiling flag, grouped by
  team. ✅ interim shipped at `/team`; needs scope-defaulting (§6) and a department-scope variant.
- **Tier 3 — capacity/volume proxies**: org/department capacity load %, bookings volume, headcount,
  people-on-leave — a partial Overview (the stat-card Overview exists).
- **Directory** (ADR-0017) and **Leave** (ADR-0013): ✅ shipped.
- **Master Schedule**: ✅ shipped.

**Engine-gated (cannot be built truthfully until the engine emits the signal):**

| Pencil element | Needs |
|---|---|
| Exception feed cards: *At risk / Breached* items | SLA clocks on sub-tasks (due_at, sla_hours) + a breach/at-risk evaluator |
| *Approvals waiting* (age-ranked) | booking/deliverable approval queue with timestamps |
| *Blocked* / "blocked on client" | sub-task/deliverable block state (Pencil 02 flag) — no state field emitting yet |
| *Unassigned work* | deliverable→sub-task assignment (M1.16 UI blocked) |
| *Zero activity / Misaligned* cards | attribution + activity signals (§5.5) |
| Health: on-time %, avg turnaround, approval throughput | SLA outcomes history (nothing recorded yet) |

**Implication:** we can make every surface *real and non-empty for the pilot* using load/capacity +
existing data, but the exception-first accountability views (the heart of §6) light up only as the SLA
engine lands. Each surface should be built so its exception rows are *additive* — capacity today, SLA
breach/blocked/unassigned rows switched on as those signals start flowing.

---

## 6. The one plumbing gap — scope in the client

Edward's requirement ("department lead sees everything in **his domain**") needs the viewer's
department/team on the client to default the filter. They are already in the JWT `app_metadata`
(ADR-0010/0014) — the gap is only that `claimsFromSession` extracts `tenant_id`/`role_id` and stops.
**Fix:** extend `AuthClaims` + `claimsFromSession` to also read `department_id`/`team_id`/`scope`; then
Tier-2 surfaces default their filter to the viewer's slice (team lead→team, dept lead→department, with
a "show wider" affordance since reads are tenant-wide anyway). Small, and it unblocks scope-correct
dashboards. No migration.

---

## 7. Open decisions (candidate ADR)

1. **Make "dashboards are grant-driven, scope-parameterized, three-tier surfaces" an explicit ADR?**
   It supersedes the last live remnant of OD 9 and pins the reframing in §2. Recommended: yes, a short
   ADR-0018 once the shape below is agreed.
2. **How is the Health view gated?** Options: (a) reuse the oversight read set already granted to
   CEO/COO/CFO (`month_overview:view` + `admin.*:view`) — zero new grants; (b) add a dedicated
   **`health:view`** permission for a clean, admin-assignable line (mirrors the ADR-0013 `leave` and
   ADR-0017 `directory` precedent). Recommendation: (b), consistent with recent ADRs.
3. **Does the Exception feed need its own grant** (e.g. `exceptions:view`) or does `team:view` suffice?
   `team:view` already gates the Team surface; a dedicated grant only matters if we want oversight
   without the rest of the team surface. Lean: reuse `team:view` for now.
4. **Scope-defaulting UX** — do leads land pre-filtered to their slice with an opt-out to tenant-wide,
   or tenant-wide with a "my team" filter? Design doc §6.3 ("exception-first, not everything-first")
   argues for pre-filtered to the slice.
5. **Account Manager's Tier-2** is assignment-scoped (campaigns), which needs the campaign→AM data and
   the deliverable engine — later than the membership-scoped leads.

---

## 8. Suggested sequence

1. **Now (pilot):** keep the interim capacity surfaces real (done: My Work, Team load, Overview,
   Directory, Leave). Add the **scope-in-claims** fix (§6) and a **department-scope** variant of the
   Team surface so Department Leads see their whole domain's load — this directly answers Edward's
   example and is buildable today.
2. **Decision:** ratify §7 (ADR-0018) — grant-driven three-tier dashboards; health gating; scope UX.
3. **Engine build (post-pilot, ADR-0010 chain):** sub-task assignment UI + SLA clocks + block/approval
   state. As each signal lands, switch on the matching exception rows and health metrics — the surfaces
   are already in place, so this is additive, not new screens.
4. **Tier-3 health** proper (on-time %, turnaround, throughput) once SLA outcomes accumulate; add the
   drill-down (company → department → exceptions → task) described in §6.5.

---

*Cross-refs: design draft v15 §2.4, §6; ADR-0007 (deferral), ADR-0008 (grant-driven views —
supersedes OD 9), ADR-0009 (lead tiers + scope), ADR-0010 (sub-task/SLA engine; JWT dept/team),
ADR-0011 (nickname), ADR-0013 (leave/capacity), ADR-0014 (hierarchy-aware dept scope; no self-book),
ADR-0017 (C-suite→health, deputy, directory). Pencil `E2EV1.pen` frames 01/02/04/05/06.*
