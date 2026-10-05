# ADR-0034: A task is a task everywhere — standalone ad-hoc tasks vs static bookings

- **Status:** accepted
- **Date:** 2026-08-20
- **Relates to:** ADR-0010 (sub_tasks + scoped authority), ADR-0024 (deliverable lifecycle), ADR-0030 (task execution: start/submit + timer), ADR-0029 (booking = assignment record).
- **Task(s):** Phase I follow-up (see `docs/TASKS.md`). Built in increments; migration `20260820000000` is increment 1.

## Context

Work could be assigned two different ways with two different outcomes:

- A **sub_task** (deliverable work) — has a **lifecycle**: assign → Start → Submit → review → Done, with a timer, assignment/lifecycle notifications, and a place in the assignee's **"Assigned to me"** panel.
- A **booking** created directly on the scheduler — a **static** calendar reservation. It consumes capacity (shows in "Your Load") but has no lifecycle: no Start/Submit, no timer, no progress, and it only appears in the passive bookings table, not "Assigned to me".

The result was split-brained: an ad-hoc "job" booked on a person was counted as load but could not be actioned, and (because the ad-hoc flow didn't capture a `title`) it did not even notify. Edward's rule resolves the ambiguity: **all assigned work is a task and every task has a lifecycle — without exception; a booking (a meeting, a hold, leave) is static.**

## Decision

**Model the two intents as two distinct things, and route "assign work" through the task model.**

1. **A task need not belong to a deliverable.** `sub_tasks.deliverable_id` becomes nullable (increment 1). A **standalone task** (deliverable_id NULL) is a first-class task: it carries its own `tenant_id` / `assignee_id` / scope, notifies on assignment (`app.tg_subtask_notify_assignee` — deliverable-independent), runs the full **Start/Submit/timer** lifecycle, and materialises its booking exactly as a deliverable task does — so capacity is counted **once**, on the task.

2. **The scheduler distinguishes Task vs Meeting.** Assigning work → creates a **standalone task** (requires an assignee + a title) → enters the lifecycle, notifies, appears in "Assigned to me" with Start/Submit. Booking a **meeting / reservation** → stays a **static booking** (calendar + load, no Start/Submit); it still notifies the attendee as an FYI via the existing `booking_notify_resource` trigger once a title is captured.

3. **"Assigned to me" includes all tasks.** The assignee panel reads tasks by assignee regardless of whether they have a deliverable, so standalone ad-hoc tasks appear alongside deliverable tasks.

## Why not the alternatives

- **Give bookings their own Start/Submit lifecycle** — creates two parallel lifecycles (task and booking) that drift and double-count capacity. Rejected: there should be exactly one notion of actionable work.
- **Leave ad-hoc work as bookings and surface them read-only** — doesn't make them actionable; the recipient still can't work them. Rejected as the end state (acceptable only as an interim patch).

## Consequences

Increment 1 (this migration) is safe and additive: relaxing the NOT NULL doesn't change any existing row and doesn't affect deliverable-backed logic (the deliverable-state notification and approval gate only ever target deliverable-backed tasks). Remaining increments: the scheduler creation path for a standalone task (materialising its booking), the "Assigned to me" query change (left-join the deliverable, group standalone tasks under an "Ad-hoc" bucket), the Task-vs-Meeting choice in the booking dialog (with the meeting path capturing a title so it notifies), and tests + EN/AR copy. Booking as a pure reservation is unchanged.
