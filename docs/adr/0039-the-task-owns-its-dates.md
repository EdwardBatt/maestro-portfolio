# ADR-0039: The task owns its dates — dragging a booking moves the work, not just the calendar

- **Status:** accepted
- **Date:** 2026-08-24
- **Open Decision:** — (closes the divergence recorded as `I12.2`)
- **Amended by:** ADR-0042 (Decision 5) — the span trigger reads the **assignee's** bookings only, so an asset booked for the task cannot move or stretch its dates
- **Task(s):** I12.2; relates to ADR-0024 (materialiser, `I1.3`) and migration `20260817120000`

## Context

`booking-transition`'s reschedule path updates the `bookings` row and nothing else. `sub_tasks.starts_at`
and `due_at` are untouched. The same drag also trips `schedule_overridden`, which stops the
materialiser re-syncing the task's bookings — so the two never reconcile.

Everything that matters reads the **task**: overdue, due-today, the Tasks-for-today panel, SLA
evaluation, the exception counts. Everything a scheduler *looks at* is the **booking**. So a traffic
manager drags work to next week, the grid agrees, and the deadline silently does not move. The task
stays due on its original date, goes overdue on schedule, and nobody has done anything wrong.

This is the same defect as ADR-0038's, in a different place: one fact held in two rows, with no rule
saying which is true.

It is not theoretical. On 24 Aug a booking cancelled by accident could not be rebuilt from its task
until `schedule_overridden` was cleared by hand, because a drag weeks earlier had frozen it.

### Options weighed

- **A — dragging edits only the booking (today's behaviour), made honest.** Keep the divergence but
  surface it: mark chips that sit off their task's dates. Rejected: it accepts that the schedule and
  the deadline mean different things and asks every user to hold both in their head.
- **B — dragging edits the task, and bookings are always re-materialised from it (chosen shape).**
  One source of truth for *when work is due*.
- **B1 — a multi-day task moves as a block; individual chips cannot move.** Recommended by the
  author. **Rejected by Edward:** a three-day task genuinely does get rearranged around a person's
  week, and forbidding that makes the grid useless for real scheduling.
- **B2 — chips move independently, and the task's dates follow them (chosen).** See decision 2: the
  task's span becomes the envelope of its bookings, so the task still owns the answer to "when is
  this due" without dictating which days the work happens on.

**Correction to the author's earlier framing.** It was argued that this change retires
`schedule_overridden`. Under B2 it does not — the flag is what protects a hand-arranged distribution
from being flattened by the materialiser. It survives, with a clearer meaning (decision 4).

## Decision

1. **Dragging a task-backed booking moves the task.** The write goes through
   `public.update_task_assignment`, which already resets the override and re-materialises; no new RPC.
   A drag is a change to the work, not to a calendar entry.
2. **A multi-day task's chips move independently, and the task's dates are the envelope of its
   bookings.** `starts_at` = earliest booking start, `due_at` = latest booking end, recomputed
   whenever a booking is inserted, moved or removed. A task may therefore be worked Mon/Wed/Fri with
   a due date of Friday — the gap is real and the deadline stays true. `sla_hours` is unchanged by a
   move: rearranging when work happens does not change how much there is.
3. **The envelope is maintained by a trigger on `bookings`, not by the caller.** Postgres owns the
   invariant (AGENTS.md §2), so every path — drag, edit modal, materialiser, a future import — keeps
   it. A task with no bookings keeps its dates unchanged: an unscheduled task is not a task with no
   deadline.
4. **`schedule_overridden` survives and means "this schedule was arranged by hand".** While set, the
   materialiser does not redistribute the task's bookings. It is cleared when the task is reassigned
   or its dates are edited directly, because both discard the arrangement anyway.
5. **A drag runs the same capacity assessment as a booking write** — exclusive conflict, overload,
   working-day and blackout checks. Without this, dragging becomes the route that bypasses conflict
   checking, which is precisely the route people will take.
6. **Dragging across resources is a reassignment and is confirmed before it is applied.** It changes
   who is accountable and notifies them; it also discards the hand arrangement, since the work is
   re-materialised on the new assignee's calendar. A silent reassignment on a mouse slip is not
   acceptable.
7. **Permissions are stated, not inherited by accident.** A date-only move of a task-backed booking
   requires `bookings:update` **plus** write scope over the resource — deliberately *not*
   `project_tasks:manage`, so a traffic manager can still schedule without gaining task-editing
   authority. Reassignment (decision 6) and any change to title, assignee or hours continue to
   require `project_tasks:manage`. This is a widening of `update_task_assignment`'s current gate for
   the date-only case, and is the one place this ADR grants authority rather than tightening it.
8. **A plain reservation still edits its booking.** A meeting, hold or leave entry has no task behind
   it; there is nothing to reconcile and its behaviour is unchanged.

No licensing or cost dimension.

## Consequences

**Easier.** "When is this due" has one answer, and the grid shows it. Overdue, due-today, SLA and the
exception counts finally agree with what a scheduler sees. Rebuilding a task's bookings stops being a
special operation requiring a flag to be cleared by hand.

**Harder.** The schedule becomes less forgiving: nudging a chip to tomorrow moves a deadline, with
whatever that implies for SLA and notifications. People used to rearranging the calendar freely will
feel that, and they should — it is the point. The envelope trigger runs on every booking write, so it
must be cheap and must not recurse into the materialiser. Decision 7 widens an authority gate, which
is the kind of change that deserves its pgTAP test written first.

**Locked in.** Bookings are a view of tasks, not an independent record of intent. Anything that wants
to move work moves the task. If a future surface needs to move a booking without moving the work,
that is a request to model a second concept — a provisional or draft schedule — not a reason to let
the two drift again.

**Testing.** pgTAP: envelope recomputed on insert / move / delete; unchanged when a task has no
bookings; override survives a materialiser run and is cleared by reassignment; date-only move
permitted with `bookings:update` and refused without write scope; reassignment refused without
`project_tasks:manage`. Frontend: a drag calls the task path, and a cross-resource drag confirms
first.
