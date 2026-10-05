# ADR-0014: Scope & resource-lifecycle refinements — team-implies-department, controlled scheduling, deactivation deactivates the resource

- **Status:** accepted (Edward, 2026-08-13)
- **Date:** 2026-08-13
- **Amends:** ADR-0009 (write scope), ADR-0010 (scoped write policies), ADR-0011 (internal users are resources)
- **Task(s):** Phase L (RBAC), L1.2 (update-user), L1.6 (pgTAP), L3 (bookings table)

## Context

Setting up real roles and resources for the pilot surfaced three questions that the earlier
scope ADRs (0009/0010) didn't settle. Each was decided by Edward on 2026-08-13.

1. **Department leads and sub-teams.** ADR-0010's `app.in_write_scope` checks a resource's *own*
   `department_id` for a department-scoped role. It does not walk team → department, so a resource
   tagged only with a `team_id` (its `department_id` blank) is invisible to the department lead —
   even though that team belongs to the department. In practice that means setting **both**
   `department_id` and `team_id` on every resource, which is error-prone and was the immediate
   snag during setup.

2. **Self-booking.** Booking reach is governed purely by role scope. A team lead couldn't book a
   resource outside their team — including their own resource when it was unassigned. That specific
   case resolves once data is wired correctly, but it raised the broader question: should *any*
   user always be able to book their own linked resource regardless of role?

3. **Deactivation and the bookable resource.** ADR-0011 makes an internal user a bookable resource.
   Deactivating a user (Users panel) bans the auth account and flags the profile, but does **not**
   touch the linked resource — so a departed person stays active on the scheduling grid and remains
   bookable, and their existing bookings sit unnoticed.

## Decision

1. **A department lead reaches resources by their team's parent department, not only the resource's
   own `department_id`.** `app.in_write_scope`'s `department` branch is widened to also match when
   the resource's team belongs to the caller's department:

   ```sql
   when 'department' then
     (p_department is not null and p_department = app.current_department_id())
     or (p_team is not null and exists (
           select 1 from public.teams t
           where t.id = p_team and t.department_id = app.current_department_id()))
   ```

   So you tag a resource with its **Team** and the department coverage is inferred; setting the
   department explicitly still works and is not required. Team scope and tenant scope are unchanged.
   This amends ADR-0009's "membership-scoped" definition to make department scope hierarchy-aware.

2. **No self-booking exception — scheduling stays a controlled function.** Booking reach remains
   role-scope only; there is no "the resource is mine" bypass. Rationale: Maestro's model is
   controlled scheduling (schedulers and leads own the calendar; personal leave is the P&C leave
   calendar, ADR-0013), and once data is wired a lead already reaches their own resource via scope.
   This is a documented rejection, cheap to revisit: a future ADR could add an own-resource
   predicate to the booking policies if users ask for self-service.

3. **Deactivating a user deactivates their linked resource; existing bookings are kept but
   flagged.** `update-user` sets the linked resource's `is_active` to match the user's active state
   (deactivate → resource inactive → drops off the grid, which filters `is_active`; reactivate
   restores it). Existing bookings are **not** cancelled — cancelling could silently wipe planned
   work. Instead they stay as history and are **surfaced for attention**: the bookings table (L3,
   which lists bookings regardless of resource active state) flags rows whose resource is now
   inactive so a human can deliberately reassign or cancel future ones. Auto-cancelling future
   bookings was explicitly rejected as too destructive.

## Consequences

Easier: department leads "just work" over their whole department including sub-teams, halving the
per-resource data entry (Team only); offboarding a person takes them off the bookable grid in one
action while preserving booking history; the model stays intentionally simple (no self-booking).

Harder: `in_write_scope`'s department branch gains a `teams` lookup (small, indexed by PK — the
subquery is on `teams.id`); `update-user` gains a resource `is_active` sync (redeploy required);
the bookings table gains an inactive-resource flag.

Security: decision 1 **widens** department-lead write reach, so it must be re-proven — extend the
scope pgTAP (`010`) to assert a department lead reaches a team-only resource under their department,
and is still denied a resource whose team is in another department. Decisions 2 and 3 don't widen
any grant (3 only ever *removes* a resource from reach).

Locked in: department scope is hierarchy-aware (team → department), team/tenant/self unchanged;
booking reach is role-scope only (no self-booking); deactivation is a lifecycle action that spans
the user AND their resource (ADR-0011 kept — they move together), with existing bookings preserved
and flagged rather than cancelled.
