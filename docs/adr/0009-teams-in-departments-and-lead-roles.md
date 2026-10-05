# ADR-0009: Teams as an org sub-layer; Department Lead, Team Lead, and Account Manager roles

- **Status:** accepted (Edward, 2026-08-12)
- **Date:** 2026-08-12
- **Amends:** ADR-0008 (Decision 2 seeded-role list; Decision 4 "roles are lateral")
- **Reference reviewed:** Meridian Group Org Chart (the agency org chart (client-supplied, not included)),
  `TrafficFlowV2.drawio`, brief-lifecycle + workflow swimlanes (`docs/reference/diagrams/`)
- **Task(s):** Phase L (RBAC), new org-structure milestone

## Context

ADR-0008 modelled the org as **departments + job titles**, with `user_profiles.department_id`
but no finer structure, and seeded **Scheduler, Department Lead, Team Member** as the editable
starter roles. Three sources show that is too coarse:

- **The org chart** — departments literally contain named **Teams**, each with its own lead:
  Creative → *Art & Video Team* (Art Director) and *Copy, Social & Content Team* (Head of Digital);
  Production → *Copywriting / Pre-Production / On-Set / Post-Production*, each with a lead. So the
  real structure is **Department → Team → people**, two lead tiers, not one.
- **The wireframes/swimlanes** use inconsistent terms ("Discipline lead", a single "Team lead"
  oversight tier, "Management") — a simplification of the org chart's two tiers.
- **Account Manager** appears across the brief lifecycle and TASKS (M9.3: "the account manager is
  the only role that edits milestone/go-live dates") as a first-class role that owns a campaign and
  liaises with the client — but ADR-0008 never seeded it.

Edward's resolution (this session): Department → Team → people; **Department Lead** owns a
department (all its teams), **Team Lead** owns one team, **Account Manager** owns the campaigns
assigned to them. Leads and members see the whole tenant (reads stay tenant-wide) but **write only
within their slice**. This adds a *scope* dimension ADR-0008 didn't have. ADR-0008 Decision 4
rejected privilege **levels** ("levels grant by implication"); a spatial write-scope is different —
grants stay explicit and lateral, scope only says *which rows* a grant reaches — so this amends,
not contradicts, that decision.

## Decision

1. **Teams are an org sub-layer under Departments.** New `teams` table: `id`, `tenant_id`,
   `department_id` (FK, not null), `name`, unique `(department_id, name)`; tenant-select RLS,
   `organization:manage` writes (mirrors departments); universal audit + `updated_at` triggers.
   `user_profiles.team_id` (FK teams, nullable, one team per person). A person's team, when set,
   belongs to their department; `department_id` (ADR-0008) stays for people/leads with no team
   (support functions, department heads).

2. **Seeded editable starters become:** Scheduler, **Account Manager**, **Department Lead**,
   **Team Lead**, Team Member (Power Admin + Client Portal remain the `is_system` roles). This
   amends ADR-0008 Decision 2. Any further roles are still admin-created from the Roles screen —
   no migration — per ADR-0008.

3. **Each role carries a write `scope`** (reads are always tenant-wide):

   | Role | Write scope |
   |---|---|
   | Power Admin | tenant |
   | Scheduler | tenant |
   | Account Manager | **assignment** — campaigns/accounts assigned to them |
   | Department Lead | **department** — their department and every team beneath it |
   | Team Lead | **team** — their team |
   | Team Member | self |
   | Client Portal | self (external, fenced) |

4. **Two flavours of scope.** Department Lead and Team Lead are **membership-scoped** (their
   `department_id` / `team_id`). Account Manager is **assignment-scoped** (the campaigns assigned to
   them). AM assignment defaults per **account**; the Client Services Department Lead may assign an
   AM **per campaign** as an override. The enforcement mechanism for both is ADR-0010.

## Consequences

Easier: the model matches Meridian's actual org; the two lead tiers and the Account Manager exist as
real roles; team-scoped surfaces and filters have a real `team_id` to hang on.

Harder: `roles` gains a `scope`; `teams` + `team_id` are new; the Team Lead and Account Manager
roles must be seeded (amending ADR-0008's starter list) rather than admin-created — justified
because they are standard Meridian roles, not tenant-specific extensions.

Locked in: Department → Team → people; scope constrains **writes only**, reads stay tenant-wide;
scope is spatial, not a privilege level (ADR-0008 Decision 4 preserved in spirit); no role derives
access implicitly from department/title (ADR-0008 Decision 1 preserved — scope is an explicit
property of the role, membership/assignment an explicit fact on the row).
