# ADR-0118: A deliverable is approved only when every one of its tasks is — and there is no Approve button

- **Status:** accepted
- **Date:** 2026-09-27
- **Open Decision:** none
- **Task(s):** I59.60, I59.62 (supersedes ADR-0052 d.10 part 1 for sign-off; completes ADR-0058 d.6 / ADR-0077 d.2)

## Context

On production the Team page showed 89 unassigned tasks; 5 of them sat on deliverables already
**Approved**. Traced on the local copy: "K one", "O deck", "Mail job" each went to Approved 10–26 seconds
after release with 1 of 4–6 tasks done and the rest never assigned.

Two decisions combined to do it:

- **ADR-0052 d.10 (28 Aug):** an unassigned, unstarted, never-worked task is "a plan", and does not hold
  sign-off — so a lead did not have to delete every planned step nobody would pick up.
- **ADR-0077 d.2 (8 Sep):** the deliverable closes itself (`app.maybe_complete_sub_task`) the moment no
  task still counts — which, under d.10, is the first approval when every other task is unassigned.

And a deliverable could also be signed off by hand: an **Approve** button on the Deliverables page for a
deliverable in review, for whoever holds `reviews:moderate`, gated by the same d.10 predicate.

Edward, 27 Sep: *"Tasks from task lists that are approved and not assigned count as unassigned and need
to be reported. Once approved, they are real tasks. A Deliverable is approved only once all tasks are
approved… this was already established. Cancelled tasks should not be tracked as unassigned, deleted tasks
clearly should never show up. How are deliverables being approved??? There should be no approve button for
a deliverable."* Proposed: one rule in the database, no button, the early-closed deliverables back to In
progress, delivered ones left and listed — **"Yes."**

## Decision

1. **A deliverable is approved only when every one of its tasks is approved (done) or cancelled.** An
   unassigned task holds it open like any other — once its task list is approved it is real work. Both
   places that approve a deliverable apply this, with no exception for "plans": the automatic close after a
   task approval (`app.maybe_complete_sub_task`) and the guard every approval passes
   (`app.tg_deliverable_transition_guard`). ADR-0052 d.10 part 1 no longer applies to sign-off.
2. **There is no Approve button on a deliverable.** It is not offered on the Deliverables page or anywhere
   else; a deliverable becomes Approved when its last task is.
3. **Unassigned** counts tasks on approved task lists, on released projects, whose deliverable is not
   finished; cancelled tasks never count and deleted tasks do not exist (I59.59).
4. **The deliverables already closed too early are put back.** Every deliverable **Approved** with a task
   still open returns to **In progress** — by the migration, with the transition guard stood aside for that
   one statement so it does not count a revision round nobody asked for. Deliverables already **Delivered**
   are left as they are and listed for Edward to decide.
5. **Nobody moves a deliverable by hand except to deliver, block or cancel it** (Edward, 27 Sep, asked why
   the panel still had Start and Request changes — "A"). No **Start**: it starts when its first task does
   (ADR-0077 d.7). No **Request changes**: a task's own send-back takes the deliverable out of review. No
   **Submit for review**: sending an ad-hoc task still readies its container, but no person does it on the
   Deliverables page. What stays: Mark delivered, Block / Unblock, Reopen (by tasks, ADR-0103), Cancel job /
   Archive. The database is unchanged — the moves it makes itself still pass the same guard; they are gone
   only from the list of moves a person may ask the `deliverable-transition` function for.

## Consequences

*Easier:* "Approved" means what it says; the open tasks on those deliverables show as unassigned and can be
given out.

*Harder:* a planned step nobody needs has to be cancelled or deleted before its deliverable can close — the
cost ADR-0052 d.10 was written to avoid, now accepted.

*Locked in:* sign-off is the roll-up of task approvals only, and a deliverable's progress follows its tasks.

*Cost:* one migration (the two functions re-emitted, the data fix), the button removed, pgTAP.

## Addendum — 28 Sep 2026: a cancel or a delete closes it too (I65.4)

**Found:** walking K2/K4 on 28 Sep. d.1 was applied only where a task is APPROVED. When a deliverable's other
tasks were approved first and its last open ones were then cancelled or deleted, nothing ran the roll-up: the
piece stayed In progress with every task settled, and — with no Approve button (d.2) — nobody could close it.

**Edward, 28 Sep — "A":** cancelling or deleting a task runs the same check. The deliverable closes when it is
In progress, no task is open, and at least one task was approved. A deliverable whose work was all called off
is never written as Approved (the guard's own reasoning in 20260927180000, kept), and only In
progress closes — a cancel never fails because of the close it causes.

**How:** `app.tg_close_settled_deliverable()`, a `security definer` trigger function with a pinned
`search_path` (as `app.maybe_complete_sub_task` is: whoever may cancel the task closes the deliverable as the
roll-up), after `update of status` to `cancelled` and after `delete` on `sub_tasks`. The close is the
ordinary update, so `app.tg_deliverable_transition_guard` treats it as the roll-up (ADR-0077 d.1) and writes
its bookkeeping. Migration `20260928160000`; pgTAP `194` (cancel, delete, all called off, one still open,
blocked) and `189` brought to it.
