# ADR-0068: Cancelling work is confirmed, and can be undone

- **Status:** accepted (Edward, 3 Sep)
- **Date:** 2026-09-03
- **Open Decision:** —
- **Task(s):** `I36.1`, `I36.2`; relates to ADR-0060/0061 (assigning work), ADR-0042 d.6 (the
  assigner/AM pair), ADR-0052 d.10 (the "plan" predicate)

## Context

Edward, 3 Sep: *"when a user wants to cancel a task from /schedule there is no warning and the task
is not recoverable."*

Both halves are true, and the first is worse than reported.

### One click, in two places

`EditBookingDialog` calls `sub_task_cancel` straight from the button's `onClick`. There is no
confirmation, no arming, no undo. **`DeliverablesPage` does the same thing** — the same single-click
cancel on the task list, so this is not a schedule-specific omission.

The same file already arms two *less* destructive actions behind `window.confirm` (signing off with
unassigned tasks, and one other), which is what makes the omission look like an oversight rather
than a decision.

### What cancelling actually destroys

`sub_task_cancel` does two things:

```sql
update sub_tasks set status = 'cancelled' where id = p_sub_task;
delete from bookings where sub_task_id = p_sub_task;      -- "free the calendar"
```

Deleting the bookings is right — ADR-0061's whole point is that cancelled work must stop consuming
capacity, or the schedule keeps telling everyone that person is busy. But it means a single click
discards **the assignment, the calendar placement, the load percentage and the dates**, and those
are not recoverable from the `sub_tasks` row, because they never lived there.

### There is no way back, and that is not a gap anyone chose

Nothing in `supabase/migrations/` or `src/` moves a task out of `cancelled`. `update_task_assignment`
never touches `status`, so re-assigning through the app produces a task that is assigned and booked
and still reads `cancelled` — a state no surface expects.

This is not hypothetical. On **2 September** a live task ("Harmony B2B Animation") was cancelled by
mistake, and the only route back was hand-written SQL against production, in two steps, because
neither SQL alone nor a UI re-assign alone restores a coherent state. The bookings were reconstructed
from `audit_events`, which worked only because `app.audit_row_change` stores the **full row** on a
DELETE. That is a good property to have and a terrible recovery procedure to rely on.

### Cancel is not always what happens

`remove_sub_task` deletes outright when the task is **a plan** — unassigned, still `todo`, never
worked on (ADR-0052 d.10's predicate) — and cancels otherwise. Deleting a plan nobody has touched is
correct and there is nothing to recover; the two paths need different warnings, not one.

### The forces

- **A confirmation that appears every time is a confirmation nobody reads.** The value is in it
  appearing where something is actually lost.
- **Undo is better than a warning**, and cheaper than the audit-log archaeology above. But an undo
  that silently rebuilt the bookings would be worse than none: capacity may have been given to
  somebody else in the meantime, and quietly re-taking it is exactly the class of invisible change
  ADR-0061 exists to stop.
- **Cancelling is already audited**, so the record of who did it is not at risk. What is at risk is
  the work.

## Decision

**d.1 — Cancelling a task is confirmed before it happens**, on every surface that offers it —
`/schedule`'s edit dialog and `/deliverables` alike. One control, one behaviour, because the same
action reporting itself two ways depending on which screen you are on is the defect ADR's
`NoticeDialog` was introduced to end.

**d.2 — The confirmation says what is lost, in numbers.** Not "are you sure?" but the assignee's
name, the dates, and how many bookings will be released. A warning that does not say what it costs
is a click-through.

**d.3 — Deleting a PLAN is confirmed differently, and more lightly.** `remove_sub_task` deletes a
task that is unassigned, `todo` and never worked on; nothing is lost and the wording says so. The
two outcomes are distinguished **before** the click, using the same predicate the function uses, so
the dialog cannot promise one and get the other.

**d.4 — A cancelled task can be reinstated.** A new `sub_task_reinstate` moves `cancelled → todo`
under the same authority that cancelled it (`project_tasks:manage` plus write scope), and is
refused on anything that is not `cancelled`.

**d.5 — Reinstating does NOT recreate the bookings, and says so.** The task comes back **unassigned
and unscheduled**, and the person is told to assign it again. Silently rebuilding the calendar would
re-take capacity that may since have been given to somebody else — the invisible change ADR-0061 was
written about. Assigning it back is one action through a path that already exists, checks capacity,
and notifies the assignee.

**d.6 — Reinstating notifies the person who lost the work**, where there was one. Being un-cancelled
is as much news as being cancelled, and ADR-0061's rule is that assignment says what actually
happened.

**d.7 — An approved task stays uncancellable.** `sub_task_cancel` already refuses `done`, and this
does not loosen it. Reinstate is for undoing a mistake, not for reopening finished work — that is
Request Changes, which exists.

## Amendment — 3 September 2026: ad-hoc work is the exception

**d.4 does not hold for ad-hoc work, and the surfaces now say so.**

Found while building `I36.2`. `sub_task_cancel` does more than cancel the task: for ad-hoc work it
also **archives the deliverable** (ADR-0061 d.6 — *"an ad-hoc deliverable IS its task, so cancelling
the last live one settles it"*). And `archived` is **terminal** in ADR-0024's transition graph
(`when 'archived' then array[]::deliverable_state[]`), with no escape — `app.system_op` exempts the
guard's column-freezing branch, not its legality check.

So reinstating an ad-hoc task returned the task to `todo` and left the job archived: **live work
under a container nothing can revive**, which is worse than no undo, and it succeeded silently.

Two ways out were available: amend ADR-0024 to let the system reverse its own automatic archive, or
stop promising the undo. **Edward, 3 Sep: stop promising it** — *"as we are going to disable ad-hoc
assignments this fix is going to be redundant… the warning just should be modified to indicate
ad-hoc tasks cannot be recovered."*

Therefore:

- `sub_task_reinstate` **refuses** ad-hoc work whose job was archived by its own cancellation
  (`20260903120000`). Refused in the database, not merely absent from the screen: an RPC is a front
  door, and the two surfaces now assert something that has to be true.
- Both confirmation dialogs say **"Cancelling ad-hoc work closes the job for good — it cannot be
  reinstated"** in place of the undo line, and offer no Reinstate control on ad-hoc work.
- **Campaign work is unaffected.** A campaign deliverable holds several tasks and is never settled
  by one of them (ADR-0038), so d.4 applies to it exactly as written.

This narrows d.4 rather than reversing it, and it is recorded here rather than as a new ADR because
the decision — *cancelling can be undone* — is unchanged; what changed is the discovery that one
kind of work cannot honour it. If ad-hoc assignment is retired as planned, this exception retires
with it.

## Consequences

**Easier.** The commonest destructive mistake in the product stops being irreversible, and stops
requiring an agent, an audit-log query and two hand-written statements against production. A person
who cancels the wrong row fixes it themselves in two clicks.

**Harder.** There is now a third path into `todo`, so anything that assumes a `todo` task has never
been anywhere must be checked — the transition guard is the place that matters. And a reinstated
task looks new while its audit trail says otherwise; that is correct, and it means the audit trail
is the only place the round trip is visible.

**Deliberately not done.** Reinstate does not restore bookings (d.5), does not restore reviewers'
prior approvals (they belong to a version, ADR-0043), and does not undo a *deleted* plan — that row
is gone, and the honest answer is to add the task again.

**Locked in.** Cancellation stays a state, not a deletion, for anything ever assigned or worked on.
That was already true; this ADR is what makes it useful rather than merely recorded.

## Addendum — 22 Sep, recording 17 Sep: Reinstate asks "assign to whom?" (amends d.5 and d.6)

**Edward, 17 Sep, on `I52.7`.** d.6 sent `task_reinstated` to the person who was the assignee when
the task was cancelled; d.5 brought the task back unassigned with no bookings; ADR-0040 allows no
self-assignment. So the one mail went to the one person who could do nothing about it. Edward:
*"this is idiotic… the reinstatement requires action."* Option A, decided and built the same day
(`20260917100000`, `ReinstateDialog`, pgTAP 124); the ADR was held until every message had been
read (*"do not change the ADR yet"*), which was done on 21 Sep.

**d.5a — Reinstate asks "assign to whom?" in the same step.** The assignee picker opens on both
Reinstate doors; *Reinstate and assign* brings the task back assigned and booked through the
ordinary path (`save_sub_task` + `subtask-schedule`), and the assignee gets the ordinary `assigned`
mail. No `task_reinstated` mail is sent to anyone.

**d.6a — Dismissed, the task comes back unassigned and the people who CAN assign it are told.**
The leads in reach (the ADR-0087 d.6 answerer set over the task) and the deliverable's owner receive
`task_reinstated` — *"Needs assigning: …"*, opening the Schedule on the week it is due — never the
former assignee. `sub_task_reinstate(p_sub_task, p_assigning default false)` sends nothing when the
caller is assigning in the same step.

d.5's "no bookings are recreated" and d.6's "being un-cancelled is not news the old assignee can
act on" both stand; what changed is who is asked to act.
