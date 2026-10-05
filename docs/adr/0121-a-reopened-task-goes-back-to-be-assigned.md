# ADR-0121: A re-opened task goes back to be assigned

- **Status:** accepted; d.1–d.2 superseded by ADR-0142 (3 Oct)
- **Date:** 2026-09-27
- **Open Decision:** none
- **Supersedes:** ADR-0103 d.2 in part ("the same assignee")
- **Task(s):** I59.66

## Context

ADR-0103 d.2 (25 Sep) re-opened a task to To do "with the same assignee and reviewers". It never booked the
work again. On production, 27 Sep, Edward re-opened five "Create Brunos Static Post" tasks: they stayed on
Zubaida Jamil Ibrahim, due 29 Sep, with only their old bookings (15–17 Sep). Being assigned, they were in
nobody's "to assign" list; having nothing booked, they were on nobody's week. Edward: *"I have reopened 5
tasks, but they are not appearing for assignment on schedule."*

Options put to him: (A) re-opening books the work again for the same person; (B) re-opening sends the task
back unassigned, to be given out on the Schedule; (C) no change, book it by hand. Recommended A.
**Edward chose B**, and wanted the five available to assign straight away.

## Decision

1. **A re-opened task has nobody on it.** Re-opening clears the assignee, the start and the commitment. The
   new due date stays. The next assignment stamps the commitment again (ADR-0075).
2. **Its bookings are released.** They go with the old assignment, as the scheduler releases an unassigned
   task's. The next assignment books it fresh.
3. **The reviewers stay, and are told** with the reason. The previous maker is not told: the task is no
   longer theirs, and whoever is given it next is told by the assignment itself.
4. **The tasks already re-opened** and left assigned with nothing booked since are put in the same state by
   the migration, so they show under "to assign" (the five Brunos posts on production).

## Consequences

*Easier:* a re-opened task shows up where work is given out, and a lead chooses who does it again.

*Harder:* the person who made it is not given it back automatically; if they should redo it, a lead
assigns it to them.

*Locked in:* re-opening never leaves work assigned but unbooked.

*Cost:* one migration (`app.reopen_one_task` re-emitted, a data fix), pgTAP 157 updated, the re-open
window's wording (English and Arabic).
