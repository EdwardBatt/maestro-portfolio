# ADR-0098: A lead or an account manager schedules anyone, across departments

- **Status:** accepted (Edward, 22 Sep); d.1, d.5, d.6, d.7 superseded by ADR-0139 (3 Oct)
- **Date:** 2026-09-22
- **Open Decision:** none — Edward, 22 Sep, from production
- **Task(s):** I55.1
- **Supersedes, in part:** [ADR-0087](0087-booking-outside-your-reach-is-a-request-the-lead-answers.md)
  d.1–d.3 and d.12 (the request path is no longer reached by a lead); its record, decide, withdraw and
  notification decisions (d.4–d.11, d.13–d.15) stand for the rows that already exist.
- **Depends on:** [ADR-0037](0037-one-authorization-primitive-one-call-path.md) (the two axes:
  grant and reach), [ADR-0040](0040-assigning-work-requires-authority-to-schedule-it.md) (assigning
  needs booking authority), [ADR-0060](0060-booking-a-campaign-task-is-assigning-it.md) and its
  22 Sep addendum (the deliverable's owner no longer gates assignment).

## Context

Edward, 22 Sep, on production: *"all dept leads and team leads can assign tasks to anyone
irrespective of who owns the deliverable"* — and, on being shown that the build sends a person
outside the lead's reach down ADR-0087's request path: *"we are removing the permission… allow all
department leads and team leads to assign anybody to tasks, cross department included"* — then,
on the draft: *"an account manager/account director is also allowed to schedule anyone. leave stays
with lead, not told."* The account director already reaches everyone (ADR-0074); the account
manager holds the booking grants since I12.6 but reaches no calendar (the `account` branch of
`in_write_scope` is permanently false for a resource) — so today an AM with `bookings:create` can
book nobody.

### What the reach test gates today

Booking authority has two axes (ADR-0037): the grant `bookings:create`, and reach over the
calendar, `app.resource_in_write_scope(resource)` → `app.in_write_scope(department, team, null)`.
A department lead reaches her department, a team lead her team (and a team-less colleague in her
department), Traffic, the Power Admin and the Account Director everyone, an account manager nobody.
That one function is read in six places, and they are not all about assigning work:

| Reader | What it decides |
|---|---|
| `bookings_scheduler_insert / _update / _delete` (20260823110000) | who may write a booking row on a calendar |
| `app.tg_subtask_assignment_authority` (ADR-0040, 20260824160000) | whether a task may be given to this person at all |
| `update_task_assignment` (ADR-0060; latest 20260922120000) | campaign tasks: assign directly, or record a request (ADR-0087) |
| `decide_assignment_request`, `my_pending_approvals`, the owed-work views (20260911110000, 20260920160000, 20260921130000) | who answers a request, and who sees it waiting |
| `resource_unavailability_leave_write`, `office_closures_leave_write` (20260813090000, 20260913150000) | who may book leave for a person, or close an office's day |
| `src/features/schedule/lib/write-scope.ts` (`resourceInWriteScope`) | the UI mirror: which people the dialogs offer, and when the dialog says *"this will be sent for approval"* |

And the task row itself: `sub_tasks_manage_insert / _update` test `app.in_write_scope` over the
**task's** department and team, which follow the assignee (ADR-0060 d.9). An ad-hoc task a Creative
team lead creates for a Content writer is a Content task the moment it is written, so today the
policy refuses it before any booking is attempted. `update_task_assignment` is `security definer`
and does not meet this policy; `save_sub_task` (the ad-hoc path) is `security invoker` and does.

### What ADR-0087 was for

The request step existed so a lead would not find her people booked out from under her by another
department. Edward's instruction withdraws that protection for leads: reach over a calendar, for
department and team leads, becomes the whole agency. What ADR-0087 keeps is everything about a
request row once one exists.

### Options weighed

- **(a) Widen `app.in_write_scope` itself** so `department` and `team` scopes answer true to
  every question. Rejected: that function also decides who approves a department brief (ADR-0070),
  who edits a task's plan, who reassigns a deliverable — none of which Edward asked to change.
- **(b) Widen `app.resource_in_write_scope`** — reach over a *calendar*, for `department` and
  `team` scopes, is every calendar. One function, every reader follows. But leave and office
  closures read the same function, so a team lead could book leave for anyone in the agency —
  not asked for, and not what "assign tasks" means.
- **(c) A new predicate for scheduling only** — `app.resource_in_scheduling_scope(resource)`:
  true for a `department`, `team` or `account` scope, else `resource_in_write_scope`. The booking policies,
  the ADR-0040 trigger, `update_task_assignment`, the request readers and the UI mirror move to it;
  leave and closures keep the narrow test. **Chosen**: it is the change Edward described and
  nothing beyond it, and the leave rule stays as decided in ADR-0013.

## Decision

1. **A new predicate `app.resource_in_scheduling_scope(p_resource)`**: true when the caller's role
   scope is `department`, `team` or `account` and the resource is an active resource of the tenant;
   otherwise `app.resource_in_write_scope(p_resource)` (tenant-wide and all-accounts roles — Traffic,
   the Power Admin, the Account Director — already reach everyone; a self-scoped person still reaches
   nobody, ADR-0014). The grant axis is untouched: `bookings:create` is still required everywhere it
   is required today — which is what keeps a team member out, and what lets the account manager in
   (I12.6 gave the role the grant; this gives it the reach).

2. **Every scheduling reader moves to it**: `bookings_scheduler_insert / _update / _delete`,
   `app.tg_subtask_assignment_authority`, `update_task_assignment`'s resource test,
   `decide_assignment_request`, `my_pending_approvals` and the two owed-work views. Each function is
   re-emitted whole from its latest definition; the only edit is the predicate.

3. **Leave and office closures do not move.** `resource_unavailability_leave_write` and
   `office_closures_leave_write` keep `resource_in_write_scope`: booking someone's leave is their own
   lead's act, as before.

4. **The task row follows the person.** `sub_tasks_manage_insert` and `sub_tasks_manage_update`
   gain one more way to say yes: the caller holds `project_tasks:manage` **and** the row's assignee
   is a person within the caller's scheduling scope. A lead who may put a person on a task may
   write and edit that task; an unassigned task in another department stays that department's
   (ADR-0060 addendum: *"a task's plan is its own department's business until somebody takes it
   on"*). `save_sub_task` is left `security invoker`, so this policy is what admits the ad-hoc case.

5. **The request path is no longer reached by a lead.** With d.1, `update_task_assignment` assigns
   directly for every department and team lead; the `requested` outcome can now arise only for a
   caller with the booking grant and none of the four scopes — in practice nobody in the seeded
   roles; a custom role with a per-user scope grant (ADR-0036) booking outside the grant. ADR-0087's table, RPCs and dialog stay for that
   case and for the rows that already exist. **Pending requests on production are answered, not
   deleted**: the migration closes every `pending` row as `withdrawn` with the reason *"superseded
   — leads now assign directly (ADR-0098)"*, so nothing waits for an answer that will never come.

6. **The UI mirror says the same.** `resourceInWriteScope` gains the scheduling form
   (`resourceInSchedulingScope`): for a `department`, `team` or `account` scope every human
   resource is offered, and the *"this will be sent to X for approval"* sentence is never shown to a lead. The
   server remains authoritative; the mirror only stops declining.

7. **Notification**: none new. The assignee is told as today (`assigned`). The person's own lead
   is not told — Edward, 22 Sep: *"not told."*

8. **Proof (ADR-0095)**: pgTAP 147 — a Creative department lead assigns a Production maker to a
   campaign task directly (outcome `assigned`, the task follows to Production/Studio, no request
   row); creates an ad-hoc task for them through `save_sub_task` and books, moves, edits and frees
   the booking; is refused their leave and records her own department's; the account manager
   assigns them directly and is refused leave; a team member is refused. 098 is rewritten with a
   CUSTOM-role requester (a department lead's grants, scope `self`, a scope grant over Creative —
   the one shape that still reaches the request path), and records that an unrelated lead and the
   account manager now decide unnamed and that the AM's own booking is direct; 141's "a Motion-team
   person is a request" becomes an assignment; 010, 027 and 074's cross-reach refusals become the
   allowed act. Browser (retest I3): the Creative team lead books a Content writer directly — ad-hoc
   offered, no "sent for approval" sentence, the chip on the grid, the writer told `assigned`, the
   writer's leads told nothing — and the account manager books directly too. No seeded lead holds
   `leave:manage`, so the leave boundary is proven in pgTAP, not the browser; the request dialog,
   reachable by no seeded role, goes into `e2e/coverage-baseline.json` with this ADR as the reason.

9. **Words**: the guides (06 assigning, 11 leave and closures), `docs/reference/notification-email-copy.md`
   where it says *"sent for approval"*, and the working memory note *"everyone books within scope"*
   change in the same change set. The rule in one sentence: **anyone who holds the booking grant —
   a lead, an account manager, the account director, Traffic, the admin — schedules anyone; leave
   stays with the person's own lead.**

## Consequences

**Easier.** A lead pulls any person onto any task in one act; no request, no wait, no dead end. The
scheduling rule is one sentence. The deliverable's owner (ADR-0060 addendum) and now the person's
department both stop mattering to who may assign.

**Harder.** A lead can be surprised: her designer is booked by another department's lead and she
learns it from the grid, not from a request. Capacity conflicts across departments are now caught by
the capacity warning alone (ADR-0006, warn-and-allow), not by a person. Two reach functions exist
where there was one, and every future policy over a calendar must pick the right one — the
predicate's comment says which and pgTAP proves the leave case stays narrow.

**Locked in.** ADR-0087's request machinery is kept, not removed; it becomes the path for a
scope-grant holder only. Removing it later is its own ADR. `app.in_write_scope` is unchanged, so
brief approval, deliverable reassignment and task-plan edits keep their department boundaries.

**Not touched.** Leave, office closures, who approves a brief, who approves a campaign, the
`bookings:create` grant, ADR-0014's self-scoped rule. `write-scope.ts`'s note that an account
manager reaches no calendar stays true for `resourceInWriteScope` (leave); it is the scheduling
form that now says yes.
