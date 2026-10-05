# ADR-0140: Every task has an Edit, and an approved task list is assigned on the campaign page too

- **Status:** accepted (Edward, 3 Oct) — records Edward's answers of 3 Oct
- **Date:** 2026-10-03
- **Open Decision:** none
- **Supersedes:** ADR-0132 d.2's "Assignee (read only) … Assigning stays on the Schedule and the Team page"
- **Task(s):** I74.7–I74.12

## Context

Edward, 3 Oct: *"on each task, there needs to be an edit button so all details of a task can be edited. Authorised
users can assign tasks from campaign screen as well.... once the tasks are approved."*

Today a task's details are spread over three editors and none edits all of them: the piece panel (name, due date), the
Grid tab's embedded task table (name, notes, hours, due date, review mode, dependencies), and the Schedule's booking
dialog (person, dates, hours, reviewers). The assignee, the reviewers and the start date cannot be edited from any task
editor, and nothing unassigns. ADR-0132 d.2 kept the assignee read-only on the campaign page.

Figma section N (`1954:1276`, CP-01…CP-12) draws the piece panel with Who and Dates on every row once the list is
approved (CP-04, CP-05) and a bulk "give them to one person" (CP-10–CP-12); section L draws a task's own pop-up
(SC-26), Edit all tasks (SC-21) and a lock on a started task (SC-21, SC-27).

| Question | Chosen | Rejected |
|---|---|---|
| A started task | **B: every detail editable; moving its days or its person asks first; removing it is not offered** | everything free; only hours (Figma) |
| Cancelling a booking | **The assignee and their lead are told**, not the account manager | the account manager (SC-24) |
| Who gets Edit | **A: the piece's owner edits every task on it; a change to the person or days of a task held by another team goes to that team's lead as a request** | each task by its holder's lead only; split by field |

## Decision

1. **Every task carries an Edit** — on its row in the piece panel, on its chip's pop-up on the Schedule (SC-26) and on
   the task page — a pencil (Edit) beside the ✕ (delete). The pencil opens one editor for **every detail**: name, notes, hours, person, days, what it waits for (one or
   more tasks, or "starts any time"), reviewers and how it is reviewed. **Edit all tasks** opens the same editor for the
   whole piece (SC-21).
2. **Who edits.** The **piece's owner** edits every task on the piece; **Traffic and the Power Admin** edit every task.
   A change to the **person or the days** of a task held by **another team** is sent to that team's lead as a request
   (ADR-0139 d.2–d.5); every other field saves.
3. **A started task** keeps every field editable. Moving its days or giving it to someone else asks first —
   *"Zubaida has started this — move it anyway?"* — and removing it is not offered.
4. **The campaign page assigns.** Once a piece's task list is approved, each row of its panel has **Who** and **Dates**,
   the same pickers as the Schedule (free hours shown, "Ask another team…"), and ticking rows gives them to one person
   on one day with the hours checked (CP-10–CP-12). The same booking rules apply (ADR-0139): within your reach it books,
   outside it it asks. Before approval the rows are the suggested list (CP-01–CP-03) and carry no Who.
5. **Cancelling a booking** on the Schedule takes the person off the task and returns it to **To book**; **the assignee and
   their lead are told** — not the account manager (Edward, 3 Oct, correcting SC-24). Removing an unbooked task is a separate act with undo (SC-16); a booked task
   is removed from its own pop-up, asked inline (SC-27).

## Consequences

- **Easier:** one editor for a task, wherever it is met; the owner books from the piece without leaving the campaign.
- **Harder:** the piece panel carries the Schedule's pickers and their free-hours reads; `update_task_assignment`
  gains an unassign and a "started" confirmation; the three existing editors converge on one, and the browser specs
  that drive them are rewritten.
- **Locked in:** the owner as the editor of a piece's tasks. A started task cannot be removed — only cancelled through
  the piece's own close (ADR-0118 / I66.13), which stays.

## Addendum — 4 Oct (Edward): the account manager does not edit tasks

Edward, 4 Oct: *"AM should not edit other departments' tasks either."* A deliverable's tasks are its department's:
its owner, its leads within reach, and Traffic and the Power Admin edit, add, remove, reorder, cancel and reinstate
them (d.2). The account manager changes the **deliverable** (ADR-0141 — its type, quantity, languages, due day and the
change asks, which regenerate and rename its tasks through the server) and **asks** a lead for a person (ADR-0139 d.1);
she does not edit its tasks.

Found 4 Oct (`I74.53`): every task write asked `app.in_write_scope(department, team, app.deliverable_account_manager(…))`,
and the account branch let the deliverable's account manager through on her own clients' work — the pencil, ✕ and
hours were offered and the server saved them. Migration `20261004190000` passes null for the account manager in the
three `sub_tasks` row policies and in `remove_sub_task`, `resequence_deliverable_tasks`, `update_task_assignment`,
`sub_task_cancel` and `sub_task_reinstate`. The screens follow one rule (`mayEditTasks`): the campaign page's task rows
are read-only for her, Who and the ticks stay (they are asks), and the Schedule's pop-up shows her the task without
the editor. pgTAP 232; 010 now proves the refusal.

**An ask carries its hours and who checks the task** (Edward, 4 Oct, A). An ask needs a reviewer on the task — the lead
who answers books it, and a task is never booked without one — and the asking screens used to save it onto the task just
before asking, which is a task edit she no longer may make. So `request_task_booking` takes the reviewers and review mode
with the hours (`20261004200000`); the ask records them; and the booking — `answer_task_request` or `take_task_offer` —
writes them onto the task, as both already passed the ask's reviewers into `update_task_assignment`. The task is not
touched until a lead books it. This holds for every asker: the booking window, the campaign page's task rows and the task
editor no longer save the task first. An ask that names nobody, for a task with nobody, is still refused
(`reviewer_required`). pgTAP 232 (19).

