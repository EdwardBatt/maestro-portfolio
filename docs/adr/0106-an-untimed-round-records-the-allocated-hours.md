# ADR-0106: An untimed round records the task's allocated hours, and review is reached only by sending

- **Status:** accepted (Edward, 25 Sep — on `running-it`)
- **Date:** 2026-09-25
- **Open Decision:** OD 5 (the attributable clock) — in part
- **Task(s):** `I59.20`
- **Amends:** ADR-0030 (task execution and time tracking) §1 — Submit's manual-minutes branch

## Context

ADR-0030: **Start** opens a time entry, **Submit** closes it with the minutes; changes requested
opens a new round, timed from the next Start. `I52.15` (17 Sep, on production) made
`app.sub_task_submit` refuse a task that is not `in_progress`.

Edward, 25 Sep: *"the live site is allowing submission without start being pressed… there is clearly
a loophole"*, and *"your solution would allow them to complete work, hit start and immediately submit
for review. This does not help track actual hours"*, and *"the time allocated for each task is set when
the task is assigned. So there is a number to apply as the maximum."*

Two doors exist:

1. **Start, then Send a minute later** — passes every rule and records nothing real.
2. **The status column** — the `sub_tasks_manage_update` policy lets the assignee UPDATE their own
   row, `status` included, and no trigger refuses `todo → review`. The app's buttons never do it; the
   database allows it.

Options weighed: refuse unstarted sends (closes neither door fully — door 1 stays); allow with a
warning and record the allocated hours (Edward's); flag short rounds without penalty; a percentage of
the allocation (a 2-hour task would pass at 12 minutes). Edward chose a fixed-minute threshold.

## Decision

**d.1 — A round is UNTIMED when it was never started, or was sent less than N minutes after Start**,
N a tenant setting, default **15**.

**d.2 — Before an untimed round is sent the maker is warned**: *"You did not time this task. Its full
allocated time (32h) will be recorded and a KPI penalty may apply."* Sending anyway is allowed.

**d.3 — An untimed round records the task's allocated hours** (`sla_hours`, set at assignment) as its
minutes, marked `untimed` on the time entry. A timed round records the timer less blocked time
(ADR-0107 d.3). The KPI page (`I49.79`, parked) reads the mark as the penalty's input; nothing else
penalises today.

**d.4 — Review is reached only through `app.sub_task_submit`.** A guard refuses any other write that
moves a task into `review`; the submit function sets a transaction flag the guard admits. This closes
door 2 for every caller.

## Consequences

Easier: both doors close with one rule; every round's time is either real or the allocation, and
which one is on the record.

Harder: an untimed send from `todo` must open and close its time entry in one call (ADR-0030's
`mode='manual'` branch is re-used for it, now with the allocation instead of typed minutes). pgTAP
covers: never started, sent under N minutes, sent over N minutes, and a direct status write refused.

Locked in: the allocation is the ceiling of an untimed round; the threshold is a setting, not code.

## Addendum — 25 Sep (Edward)

- **A task cannot be assigned without hours allocated** — every assignment route; the database refuses it. So
  every assigned task has the maximum d.3 records. (The hour-less tasks on the local database were made by the
  automated tests, not by use.)
