# ADR-0124: The approval exceptions count what waits on the viewer, or over the view's reach, and name who each waits on

- **Status:** accepted (Edward, 30 Sep) — records Edward's answers of 29 Sep, already built and on production
- **Date:** 2026-09-30
- **Open Decision:** none
- **Extends:** ADR-0122 d.4 (the top bar holds the exceptions); relates to ADR-0018 d.3, ADR-0048 d.9, ADR-0119 d.3
- **Task(s):** I66.2, I66.5, I66.6

## Context

The role dashboards (ADR-0122) and My Work each had to show three approval exceptions from Figma section
H: **Unfinished briefs**, **Briefs awaiting approval**, **Task lists not approved**. Nothing said what
each one counts, over whose work, or where a click goes.

Edward's answers, one question at a time, 29 Sep:

1. An **unfinished brief** is a draft someone started (A). Rejected: a brief missing required fields.
2. A brief **not yet approved** is a figure of its own, not folded into the first.
3. **My Work counts only what waits on me.** Rejected: My Work showing the team's figures too.
4. **The dashboards count over the view's own reach**, and each card **names who the items wait on**.
5. **"Task lists not approved" opens the task lists themselves**, one row per list (B). Rejected (A):
   the campaigns list, which shows campaigns holding lists rather than the lists.

Two defects found by Edward previewing locally (I66.5) shaped the wording: Traffic's card read 42 and its
caption named only 32 (the top two people), and the My Work card named the piece but not the action.

## Decision

1. **Three figures.** A draft counts as *unfinished* and waits on whoever started it. A brief sent and not
   approved waits on its account manager (ADR-0048 d.9). A task list not approved waits on its piece's
   owner (ADR-0100).
2. **My Work counts only what waits on me**: my own drafts, and the briefs and task lists
   `my_pending_approvals` gives me. The brief figures are offered only to holders of `projects:manage`, the
   grant the database checks before it allows the approval.
3. **A dashboard counts over its view's reach**: Team Member, me; Team Lead and Department Lead, their
   people; Client Services, their accounts; C-Level, Traffic and Power Admin, everything. The client filter
   applies. One mapping (`reachFor(view)`) serves the Dashboard and the task-list page.
4. **Each card names who its items wait on**: up to three people by name; past that, the first two and
   "N others" with what they hold. "No owner" covers an item nobody holds, and the viewer appears as "you".
   The full list shows on hover, and a full name wraps rather than being cut off.
5. **A card opens what it counted.** Drafts open `?status=draft` and briefs `?status=pending_approval` on
   the campaigns list, with `&scope=mine` for the member and account-manager views. Task lists open
   `/deliverables/task-lists`, one row per list (piece, campaign, client, who it waits on, how long it has
   waited), oldest first, behind `project_tasks:manage`. The campaigns list keeps its *Task lists to
   approve* alert.
6. **How long a list has waited is read from the database's one clock** (ADR-0119 d.3, the view
   `task_list_waiting`), not worked out again on the screen.
7. **A card says the action**, e.g. "Review and approve the task list for X", not just the piece's name.

## Consequences

*Easier:* a lead sees the same number on the card and in the list it opens, and knows whom to chase
without opening anything.

*Harder:* the card, the list and My Work must all keep to the same rule (`approvalFigures`,
`awaitsTaskListApproval`). A second copy of the rule would let the numbers drift apart. The browser test
`the-second-gate.spec.ts` checks card count = rows.

*Locked in:* My Work stays personal (ADR-0105). Oversight figures live on the Dashboard only.

*Cost:* migration `20260929130000` (view `task_list_waiting`, security_invoker), pgTAP 196; one new page.
