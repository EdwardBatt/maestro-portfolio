# ADR-0125: A piece with no live task has no task list to approve — its owner is asked to define the tasks, or to add one or close it

- **Status:** accepted (Edward, 30 Sep) — records Edward's answers of 29 Sep, already built and on production
- **Date:** 2026-09-30
- **Open Decision:** none
- **Amends:** ADR-0100 (the task-list gate), ADR-0119 (the card and its escalation); complements the ADR-0118 addendum of 28 Sep (I65.4)
- **Task(s):** I66.3, I66.4, I66.11

## Context

The task-list gate (ADR-0100, ADR-0119) asks a piece's owner to approve its task list. Two kinds of piece
had nothing to approve and still counted, or were left stuck:

- **No tasks at all.** A piece with no deliverable type has no workflow, so no task is generated. ADR-0051
  d.7 allows this: the lead breaks the work down by hand. The same happens with a type whose workflow has
  no steps, or when every task was deleted. The Creative lead's My Work counted 54 lists and the dashboard
  31. The 23 extra were pieces with no tasks. Edward: *"how can you include them in the count when there
  is nothing to count?"* … the owner *"should still see their notification … if no tasks have been
  created, then you need to define the tasks."* Their 24-hour escalation also said the list *"has waited
  for approval"*, which was false.
- **Every task cancelled.** The ADR-0118 addendum closes a piece when its last open task goes, but only
  when one task was approved. Work that was all called off stayed In progress with nothing to do. Three
  such pieces were on production (Sunset orange: Packaging, City Stamp design, Sunset orange Logo).
  Edward: *"it gets stuck in limbo"*.
  - Chose **B, ask the owner to add a task or close it.**
  - Rejected **A, close it automatically**: that would end a piece on a cancellation that may have been
    meant as a replacement.

## Decision

1. **A piece with no live task is not a task list to approve.** `my_pending_approvals` gives it as
   `task_list_undefined`, to the same people as the task-list card (ADR-0119 d.2) and on the same clock.
   Every "Task lists not approved" figure counts only real lists.
2. **Its owner is asked to define the tasks.** The Needs you card reads *"No tasks have been created for
   X — define the tasks"* with **Define tasks**. The bell and the email (EN + AR) say the same. Approving a
   campaign, adding a piece, and changing an owner all record `no_tasks` in the owner's notice.
3. **Its escalation says what is wrong.** It keeps the same rung and the same clock (ADR-0119 d.3), but
   the detail is marked `no_tasks`: *"X has had no tasks defined for 24h — find out from its owner what is
   holding it, or define the tasks."*
4. **A piece whose every task was cancelled asks its owner to add a task or close it.** This applies where
   no approved task closed it under the ADR-0118 addendum. The owner gets a `tasks_all_cancelled` card
   (*"Every task on X was cancelled — add a task, or close the deliverable"*), dated from the last
   cancellation. The task-list card leaves these out.
5. **That card escalates** on the task-list rung's hours, to its recipients, counted from the last
   cancellation (`all_cancelled`). The unapproved-list rung leaves it out, so it is never escalated
   twice.
6. **Nothing is closed for the owner.** Closing stays the owner's act: from the deliverable window
   (I66.13) or Edit piece. It cancels what is open, frees the bookings, and is final.

## Consequences

*Easier:* every figure counts something a person can act on, and no piece sits In progress with no work
and no one asked.

*Harder:* the approvals feed now carries three kinds for one gate (`task_list`, `task_list_undefined`,
`tasks_all_cancelled`), and every reader must tell them apart. The bell, the email, Needs you and the
escalation sweep each carry the wording.

*Locked in:* the system never closes a piece because its tasks were all cancelled. It asks.

*Cost:* migrations `20260929120000`, `20260929140000` and `20260929160000`; pgTAP 195, 197 and 199;
`notify-email` changed (deployed).
