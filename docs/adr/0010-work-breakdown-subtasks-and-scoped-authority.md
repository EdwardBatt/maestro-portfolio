# ADR-0010: Work breakdown (deliverable → sub-tasks) and scoped write authority

- **Status:** accepted (Edward, 2026-08-12)
- **Date:** 2026-08-12
- **Depends on:** ADR-0008 (grants + universal audit), ADR-0009 (teams + role scope), ADR-0006 (day-cell scheduler)
- **Reference reviewed:** `TrafficFlowV2.drawio` (Team Lead / Account Management pages), brief-lifecycle swimlanes; **esports-site RBAC** (a prior project of the author), per Edward, for the "is there a simpler way" question
- **Task(s):** Phase L / M9 (work breakdown), touches booking/capacity + RLS

## Context

**Work breakdown.** From the client, a **deliverable is a single entity** with its own deadline and
SLA; the **Account Manager who owns the campaign owns its deliverables**. What splits work across
departments is the **sub-task**: each sub-task belongs to one deliverable, is directed at a team,
assigned to a team member, carries its own SLA hours/dates + status, and rolls up into the
deliverable's SLA. The current schema has `deliverables` but **no sub-task entity** — the object the
whole assignment/accountability model turns on does not exist yet. The wireframes make it explicit:
"Deliverables → sub-tasks (assign owner + SLA hrs)", "deliverable SLA health rolls up from its
sub-task clocks", and assigned tasks "appear on all calendar views for full visibility".

**Who may assign.** Assigning a sub-task's member + SLA hours/dates is deliberately flexible, held by
**Account Manager, Department Lead, Team Lead, and Scheduler** — but each **within their scope**
(ADR-0009): Team Lead in their team, Department Lead in their department, Account Manager in their
assigned campaigns, Scheduler tenant-wide. Reads stay tenant-wide; the audit trail (ADR-0008
Decision 8) is the accountability control on the flexibility.

**Enforcement mechanism — esports-site evaluation.** Edward asked whether esports-site's RBAC is a
simpler model to adopt. Reviewed (`domains/schema_core_rbac.sql`, `05_functions.sql`,
`08_policies.sql`). Findings:

- Its core is **messier and riskier**, not simpler: a role `level` 1–4 hierarchy (implicit grants by
  level); a `permissions.permission_item` JSONB that maps each action to **one** `permission_role`
  string (`check_permission_action` returns `action_role = user_role`) — so two roles can't cleanly
  share an ability; authz through **`SECURITY DEFINER`** functions (`is_admin`, `check_permission_action`);
  and an **`auto_sync_rls_on_permission_update`** trigger that **regenerates RLS policies from
  permission rows**. These are precisely the three things ADR-0008 Decision 5 rejected (dynamic
  policy generation, SECURITY DEFINER authz, implicit level grants). Many policies also fall back to a
  coarse binary `is_admin()`.
- The **one pattern worth borrowing**: its per-team access helpers — `check_team_admin_access(team_id,
  user_id)` / `check_team_member_access(team_id, user_id)` — small invoker-checkable functions that a
  policy calls to scope a write to a specific team. That is the clean, proven shape for the
  membership/assignment scoping ADR-0009 needs.

Conclusion: **keep ADR-0008's grant matrix as the core** (many roles × resource × action,
invoker-side, hand-written reviewed policies — already better than esports-site's per-action
single-role model), and **borrow only the helper-predicate pattern** for scope.

## Decision

1. **`sub_tasks` entity.** `id`, `tenant_id`, `deliverable_id` (FK), `department_id` + `team_id`
   (the team the work is directed at), `assignee_id` (FK user_profiles), `sla_hours`, `starts_at`/
   `due_at`, `status`. Deliverable SLA rolls up from its sub-tasks' clocks. Universal audit +
   `updated_at` triggers (new table opts in, per the app_feedback precedent).

2. **Sub-tasks integrate with the day-cell scheduler (ADR-0006).** An assigned sub-task appears on
   the assignee's and all calendar views, and its `sla_hours` consume that assignee's load/capacity —
   sub-tasks are a source of bookings, not a parallel system. (Confirmed capacity-consuming, 2026-08-12; revisitable later.)

3. **Assignment is a grant** (`project_tasks:manage`, extended to sub-tasks) held by Account Manager,
   Department Lead, Team Lead, Scheduler; Team Member holds only the ability to progress work assigned
   to them.

4. **Scope is enforced by invoker-side helper predicates**, borrowed in shape from esports-site,
   rejecting its dynamic-RLS mechanism. A small set of STABLE `app.*` functions consulted by write
   policies:
   - `app.current_scope()` → the caller's role scope (`tenant|department|team|account|self`, from `roles.scope`)
   - `app.manages_department(dept uuid)` · `app.manages_team(team uuid)` · `app.manages_account(acct uuid)`
   - or a single `app.in_write_scope(dept uuid, team uuid, account uuid)` combining them.

   A sub-task write requires the grant **and** the row in the caller's scope: tenant → always;
   department → row's `department_id` = caller's; team → row's `team_id` = caller's; account → the
   sub-task's deliverable's campaign is assigned to the caller. No `SECURITY DEFINER`, no generated
   DDL — consistent with ADR-0008 Decision 5. The caller's `department_id`/`team_id` ride in the JWT
   `app_metadata` (like `role_id`/`tenant_id`); assignment is read from campaign→AM rows.

5. **Audit is the accountability layer for the flexibility.** Because four roles may assign within
   their scope, every assignment and SLA change is captured by the universal audit trigger
   (ADR-0008 Decision 8) — actor, tenant, entity, before/after — automatically once `sub_tasks` has
   the trigger. Nothing assigned or re-assigned is silent.

6. **Explicitly rejected from esports-site** (reaffirming ADR-0008): the level hierarchy; per-action
   single-role permission mapping; SECURITY DEFINER authorization; and the auto-sync RLS generator.

## Consequences

Easier: the brief → deliverable → sub-task chain is real and matches the wireframes; the four
management roles share assignment with flexibility, bounded by scope and covered by audit; scope
lives in a handful of reviewed helper functions, not duplicated across every policy.

Harder: the capacity engine must account for sub-task hours (Decision 2); new pgTAP for the scope
helpers and sub-task RLS (adversarial: a Team Lead assigning outside their team must be denied; an AM
outside their campaigns denied; Scheduler allowed tenant-wide; reads open); the JWT gains
`department_id`/`team_id`, so `invite-user`/`update-user` write them and scope refreshes on token
refresh (same latency profile as role changes today).

Locked in: sub-task as the unit of assignment **and** capacity; scope enforced by invoker-side helper
predicates only; no dynamic RLS generation, ever, without a new ADR (ADR-0008 Decision 5 reaffirmed).
