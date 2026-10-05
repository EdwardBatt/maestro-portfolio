# ADR-0103: Finished work can be re-opened

- **Status:** accepted (Edward, 25 Sep — built on `running-it`) — **d.2's "same assignee" superseded by [ADR-0121](0121-a-reopened-task-goes-back-to-be-assigned.md) (27 Sep): a re-opened task goes back to be assigned**
- **Date:** 2026-09-25
- **Open Decision:** none — a new capability (Edward, 25 Sep)
- **Task(s):** `I58.1`–`I58.8`
- **Amends:** ADR-0077 (a container closes when its contents are done) · the close-out of 13 Sep
  (`20260913100000`, `reopen_campaign`)

## Context

Edward, 25 Sep: *"we need to be able to re-open campaigns that are complete, we need to be able to
re-open deliverables and associated tasks that are marked as approved and complete. In order to
re-open a campaign, deliverable or task that is complete this is allowed by Account Director,
Account Manager, Traffic Manager, Power Admin, the assigned deliverable's owner's department leads
and team leads."*

What exists today:

| Level | Today | The gap |
|---|---|---|
| Campaign | `reopen_campaign` takes a **closed** campaign back to `approved` — the card's ⋯ menu. Authority: `projects:manage` and write scope over the campaign's account manager. | Leads hold no `projects:manage` over another department's account, so a department lead cannot re-open one. |
| Deliverable | The transition guard already allows `approved → in_progress` and `delivered → in_progress` to anyone with `project_tasks:manage`. | It moves the container only. Its tasks stay done and approved, so it sits "in progress" with nothing left to do — and nothing tells anybody. |
| Task | A task leaves `done` only by nobody: Request changes works only on a task **in review**. | There is no way back for an approved task at all. |

Why a task, and not the deliverable, is the unit that re-opens: ADR-0058 made the task the unit of
review and ADR-0077 closes a deliverable when its tasks are all approved. Re-opening a deliverable
without re-opening a task would leave a container the rollup cannot explain.

The authority Edward named, as rights and reach (no role is named in code — ADR-0008). Every role
he listed holds `project_tasks:manage` today, and no team member does:

| Role | `project_tasks:manage` | Reach |
|---|---|---|
| Account Director | yes | all accounts |
| Account Manager | yes | their accounts |
| Traffic Manager (`scheduler`) | yes | tenant |
| Power Admin | yes | tenant |
| Department lead | yes | their department |
| Team lead | yes | their team |
| Deputy team lead | yes | their team — included (Edward accepted the rule as written, 25 Sep) |
| Team member | no | self |

Options weighed:

- **Which tasks re-open with a deliverable** — all of them; only the last; or the ones the person
  picks. *Picked* (Edward): a change the client asks for is usually to one step, and redoing six
  approved tasks to change one is the reason people would go around the system.
- **What a re-opened task becomes** — back to To do with the same people; straight into review;
  or unassigned. *Same people, To do* (Edward): the maker who did it knows it, the reviewer who
  approved it judges the change, and nothing has to be re-booked from nothing.
- **A closed campaign under a re-opened deliverable** — refuse until the campaign is re-opened; or
  re-open it with the work. *Re-open it with the work* (Edward): the first is a dead end with
  extra words (the UI never blocks).

## Decision

**d.1 — Who.** Re-opening needs `project_tasks:manage` **and** reach:

- over a **task or a deliverable**: write scope over the campaign's account manager (the account
  roles and the tenant-wide ones), **or** department / team scope over the department of the
  deliverable's **owner** (ADR-0102: the owner's department is the deliverable's);
- over a **campaign**: write scope over its account manager, **or** department / team scope over
  the department of **any** deliverable owner on it.

One SQL predicate, `app.may_reopen(deliverable)`, answers it; the campaign asks it of each of its
deliverables. The screen mirrors it only to decide which buttons to offer — the server refuses in
words anyone the mirror got wrong.

**d.2 — A task.** A task that is `done` (approved) re-opens to `todo`:

- the **same assignee and reviewers**; its approval is cleared (`approved_at`, the reviewers'
  answers) — the history stays on the record (`audit_events`, the review thread);
- a **reason is required** and a **new due date is required**; the new date is the task's new
  commitment (ADR-0075: late is measured from the work — the old promise is not silently kept);
- the assignee and every reviewer are told — in-app and by mail — with the reason;
- a task that was **cancelled** does not re-open (it was called off, not finished — ADR-0080).

**d.3 — A deliverable.** An `approved` or `delivered` deliverable re-opens by re-opening **the
tasks the person picks — at least one**. Those go back to To do (d.2, one reason and one due date
for the lot); the rest stay approved. The deliverable goes to `in_progress`, and it closes again
by ADR-0077's rollup when the re-opened tasks are approved. A deliverable cannot be re-opened with
no task picked: the bare `approved → in_progress` move is taken out of the guard, so a container
never sits "in progress" with nothing to do (the stranded state ADR-0077 d.5 cleaned up).

**d.4 — A campaign.** A **closed** campaign re-opens to `approved` (today's `reopen_campaign`,
with d.1's authority). Re-opening a deliverable or a task in a closed campaign **re-opens the
campaign with it**, and the page says why (*"re-opened because the Digital Banner was re-opened"*).

**d.5 — Where.** Re-open sits where the finished thing is shown: the campaign card's ⋯ menu and
the campaign page; **Re-open** in the deliverable drawer and on the deliverable page, which opens
its task list with a tick per approved task, the reason and the date; **Re-open** on an approved
task's row. One RPC per level — `reopen_task`, `reopen_deliverable(tasks[])`, `reopen_campaign`
— each security definer, each with its pgTAP suite (who may, who may not, what moves, what is
told), each audited (`task_reopened`, `deliverable_reopened`, `campaign_reopened`).

**d.6 — What re-opening never does.** It never moves a date the client was given without saying
so (a re-opened deliverable's own due date is untouched; if the new task date runs past it, the
at-risk rule of ADR-0075 shows it), and it never re-opens a legacy department brief (ADR-0100).

## Consequences

- **Easier:** a client's late change is handled inside Maestro, on the same people, with the reason
  on the record — instead of a new "v2" deliverable or an ad-hoc task that loses the history.
- **Harder:** "approved" is no longer final. Every report that counts approved work (the campaign
  card's progress, Season map, Where is everything, the KPI reads) must count what IS approved now,
  not what was once — they already read the live state, and pgTAP proves the re-open changes it.
- **Locked in:** the task is the unit that re-opens. A deliverable-level "redo everything" is a
  tick-all, not a second mechanism.
- **Cost:** three RPCs, one guard change, three pgTAP suites, two notification types (their mail
  words in both languages), the dialog, and browser tests for each control. No licence or money
  dimension.
