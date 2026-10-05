# ADR-0075: At risk and breach are measured from the work, not from a profile

- **Status:** **accepted** (drafted 6 Sep 2026; d.3, d.4, d.5 and d.9 settled 9 Sep — the review
  numbers from measurement, the rest by Edward)
- **Date:** 2026-09-06 (accepted 2026-09-09)
- **Open Decision:** closes the part of **OD 4** (deadline authority) and **OD 5** (pausable,
  attributable clock) that blocks measurement. Nothing here is left open. OD 1, 6 and 7 are
  untouched — see *What this does not decide*.
- **Task(s):** unblocks `I20.2`, `I20.3`, `I20.6`, and is the definition `V1.5` (the exception feed)
  has been waiting on. Raises `I41.8` (the two days before go-live are a default, not a minimum) and
  `I41.9` (they are counted in calendar days, which ADR-0078 d.1 makes wrong) and `I41.10` (the three
  numbers become admin settings, which means building the screen `tenant_reminder_settings` has never
  had). Closes the ADR-0075 half of `I41.4`; the working-calendar ADR it also names stays open.
- **Narrows:** [ADR-0032](0032-agency-kpi-matrix.md) — the KPI matrix stays as the metric *library*
  for a later phase; it stops being the gate on knowing whether work is late.
- **Relates to:** [ADR-0018](0018-dashboards-grant-driven-three-tier-surfaces.md) (three tiers, one
  dataset), [ADR-0029](0029-internal-projects-adhoc-tasks-sla-profiles-kpis.md) (`sla_profiles`,
  `kpi_definitions`), [ADR-0039](0039-the-task-owns-its-dates.md) (a task's dates follow its
  bookings), [ADR-0045](0045-work-that-stalls-is-chased-and-escalated.md) (chase and escalation),
  [ADR-0052](0052-a-deliverable-type-implies-a-list-of-unassigned-tasks.md) d.1 (templates name work,
  not review), [ADR-0069](0069-a-task-states-what-it-is-waiting-for.md) d.3/d.5/d.7 (soft dependencies
  and cascading external inputs — d.4 below reads those edges and adds nothing to them),
  [ADR-0078](0078-a-day-of-work-is-a-working-day.md) d.1 (a count of days is a count of working days).

## Context

Every dashboard in ADR-0018 past capacity has been blocked on one missing sentence: **what does "late"
mean?** ADR-0032 was written to answer it and could not — it is a metric library whose foundation, OD 1
(*"the full list of human-resource accountability types, per role"*), is described in the design draft
as the single highest-leverage open item and is a management decision, not a technical one. Two weeks
of work sat behind a question nobody could answer from the repository.

**The answer turned out not to need the library.** Edward, 6 September:

> *"Each task is required to be assigned with number of hours on a specific day, that will need to
> represent the SLA for the task. The user is required to press start to indicate that they have
> started working on the task. We also have a due date for each deliverable so we can actually
> measure at risk and breach based on those items of information."*

And on the anchor:

> *"We need to track and report all changes; ultimately a task is linked to a deliverable due date.
> Moving the task does not move the due date on the deliverable."*

**Every input already exists and is already populating.** Measured against the live tenant on 6 Sep,
not assumed:

| The thing | Where it lives | Live rows |
|---|---|---|
| Hours committed to a task | `sub_tasks.sla_hours` | 179 of 325 tasks |
| The day it is committed to | `sub_tasks.starts_at` / `due_at` | 179 of 325 |
| The maker pressed Start | `task_time_entries.started_at` | 69 entries |
| Effort actually spent, per revision round | `task_time_entries.minutes`, `.round` | 69 |
| The maker submitted | `task_time_entries.submitted_at` | 50 |
| A reviewer approved | `sub_task_reviewers.approved_at` | 10 |
| Changes were requested | `review_feedback` (round-numbered) | 36 |
| The promise to the client | `deliverables.due_at` | — |
| An append-only log with `deadline_set` / `deadline_changed` | `sla_events` | 20, unused for this |

The column is literally called `sla_hours`. The mechanism was built in August and then waited for a
profile library to tell it what to do with itself.

### The defect this closes, which is not "no metric"

`deliverables.due_at` is written **only at creation** — verified across every migration; nothing
propagates a task date upward. So the client's promise is already safe.

The task's date is not. ADR-0039 gives a task its dates from its bookings, so dragging a booking
rewrites `sub_tasks.due_at`. Measured against the *current* date, **a breach cannot be observed**: it
is indistinguishable from a reschedule, and it deletes itself the moment somebody moves the work. An
on-time rate built on that is not merely imprecise, it is flattering by construction — and it is the
number a C-level dashboard would lead with.

## Options weighed

**Wait for ADR-0032 / OD 1.** Rejected. It is a management decision with no deadline, and the cost of
waiting is that nothing measures anything. The library remains valuable for *rewards* and per-role
scorecards; it is not needed to know that a task is four days late.

**Let the task's date float with its bookings, and measure against it.** Rejected — the section
above. This is today's behaviour and it is why the pilot has no usable delivery metric.

**Freeze the task's date and refuse reschedules past it.** Rejected. It blocks people from planning
honestly, and the site does not block (6 Sep). Somebody who cannot move a booking moves the work into
a spreadsheet instead, and the system stops knowing anything.

**Keep the plan free and record the promise beside it.** Chosen. Work moves as reality requires;
what was promised stays visible next to it.

## Decision

**d.1 — Two clocks, and they are never the same conversation.**

| | Question | Fails when |
|---|---|---|
| **Task breach** | did this task finish by the date it was committed to? | `now > committed_due_at` and not done |
| **Deliverable late** | did the client get it when promised? | `now > deliverables.due_at` and not delivered |

A task may breach while the deliverable still lands: that is slack being spent, a planning signal and
not a delivery failure. A deliverable may go late with no task ever breaching: that is almost always
review time nobody scheduled (d.5). **Reporting these as one number is how a delivery metric becomes
untrustworthy**, so no surface may add them together.

**d.2 — The deliverable due date is the promise and a task never moves it.** Already true in the
schema; stated here so it stays true. It changes only when a person changes it deliberately, and that
change is logged like any other (d.3).

**d.3 — A task's committed SPAN is stamped when it is assigned, and every subsequent move is
recorded.** `sub_tasks` gains `committed_starts_at`, `committed_due_at` and `committed_hours`,
written together at assignment.

**The span, not the finish date alone** (Edward, 9 Sep). A finish date cannot distinguish *"started
three days late and rushed it"* from *"started on time and worked steadily"*, so nothing can be said
until the deadline has already passed — which discards the earliest warning the system is capable of
giving. **A task not started by its committed start date warns** (Edward: *"if the task is not
started by Monday it shows a warning"*), and that warning is only possible because the start date was
kept. It is the same signal d.4 calls not-started, given a date to fire on rather than a guess.

Rescheduling still moves `starts_at` / `due_at` freely — nothing is blocked, nothing demands a reason — and writes
a `deadline_changed` row to `sla_events` with the old value, the new value, the actor and the time.
`sla_events` was built for this in July (`deadline_set`, `deadline_changed`, `attributed_to`,
`actor_user_id`) and has never been used for it.

**The pattern is the point, not the incident.** One task moved twice is a Tuesday. A deliverable
whose tasks have collectively slipped eight days while its due date has not moved is a deliverable
about to fail, visible weeks before it does — and only visible because the moves were recorded.

**d.4 — At risk is a forward calculation over data that already exists.** A task is at risk when
either holds:

```
hours_remaining     = sla_hours − minutes logged this round
capacity_remaining  = the assignee's booked hours between now and committed_due_at

  hours_remaining > capacity_remaining
  or (not started and working time left < sla_hours)
```

Not-started is the strongest early signal in the system and it costs nothing: the Start press is
explicit, and a task nobody has started with a day left is at risk whatever else is true.

**A task short of time ONLY because a declared prerequisite is outstanding is WAITING, not at
risk.** Edward, 9 Sep: *"Sara's task is only identified as at risk if Omar's task was required as an
input into her task."* At risk names somebody who is behind. A maker whose input has not arrived is
not behind, and telling a lead otherwise spends the credibility of the whole feed on people who did
nothing wrong — which is the fastest way to make an exception feed something nobody opens.

**The test is the EDGE, never deliverable membership.** A `sub_task_dependencies` row (this task
depends on that one), or a `deliverable_pending_inputs` row cascading down (ADR-0069 d.7). Two tasks
in the same deliverable with no edge between them are unrelated for this purpose. A task with no
unmet prerequisite that runs out of time is at risk plainly, with its owner named.

**This reclassifies nothing today, and that is intended.** One dependency edge exists across the
live tenant, because the work in the pilot is ad-hoc tasks, which are individual by nature and have
no siblings to wait on. The rule switches on as campaigns go through the wizard and their department
leads declare inputs — where ADR-0069 d.5 already puts that control, on the department's own tab,
after the campaign is approved.

**Waiting is not a status and gates nothing.** `blocked` was removed as a sub-task status on 19 Aug
because it rewards idleness; Start is never disabled, and somebody who presses on is flagged
`started_ahead`, which is a positive marker. Waiting is what the feed CALLS the row, not a state the
task enters.

**The prerequisite carries the risk.** Omar's task is at risk; Sara's row reads *waiting on Omar's
task*. One accountable owner per exception, and the chain is legible from the row that matters —
the same principle as d.6, applied sideways instead of upwards.

**d.5 — Review time is measured, and a deliverable's deadline is its APPROVAL.** Workflow templates
name work and not review (ADR-0052 d.1, Edward: *"everything from Internal Review to Final is not a
task, it is a step in each task itself"*), so review consumes time that no booking covers. It is
nonetheless **fully timestamped already**: `submitted_at` → `approved_at`, or `submitted_at` → the
first `review_feedback` of the next round.

So a deliverable's elapsed time splits into four attributable segments — **waiting to start · being
worked · waiting on review · in revision** — each with a different owner. That is OD 5's
attributable clock, arriving from the timer and the review record rather than from an engine.

**The deadline is go-live minus two working days.** Edward, 9 Sep: *"all deliverables should be
finalised and approved at least 2 days prior to this date."* **Finalised and approved** — the
deliverable's due date is an approval deadline, not a hand-in deadline, and every calculation here
reads it that way. The two days already exist as `DELIVERY_DAYS_BEFORE_GO_LIVE` (29 Aug). What does
not exist is any enforcement of the word *least* — the constant fills blank dates and nothing
compares a typed due date to its campaign's go-live (`I41.8`) — or the counting of those days as
working days rather than calendar days, which under ADR-0078 d.1 is now wrong (`I41.9`).

**The review buffer is one working day, and it was measured rather than chosen.** Creative, 48
completed reviews on the live tenant, 9 Sep: median **1.3h**, p80 **16.1h**, p90 **21.9h**, worst
**260.6h**. The median is not the number — a buffer sized to the median is too small half the time
by construction. The p80 and p90 sit at 16 and 22 hours, and that is not review *effort*: it is a
submission late in the day approved the next working morning. One overnight, expressed as one
working day.

**The 260-hour case sets nothing.** Eleven days is a review nobody did. Sizing a buffer to it would
demand every deliverable finish a fortnight early, and a buffer wide enough to hide a forgotten
review hides everything else too. It is an exception to be raised — ADR-0045's chase ladder — not a
constant to plan around.

**A deliverable is at risk when its last task's committed date leaves less than the buffer before
that deadline.** The buffer is a **per-department** number, seeded at one working day and replaced by
that department's own measured p90 once it has enough completed rounds. Creative is the only
department with data today; the rest start on its figure and correct themselves as they accumulate.

**The review buffer varies by department; the two go-live offsets do not** (Edward, 9 Sep). The
buffer is the only one of the three that can actually be MEASURED per department — 48 Creative
reviews are the evidence — and it is already the one that varies, because a department's review
latency is a property of how it works. The delivery and commence offsets stay agency-wide, not
because they are uniform (a film and a social post plainly differ) but because nothing in the system
can yet tell them apart: `deliverable_types.lead_time_hours` and `workflow_steps.default_hours` are
empty. Splitting them per work type before those columns carry numbers would be three settings
guessing what one populated column will answer properly.

**Every number in this ADR is an admin setting, not a constant.** Edward, 9 Sep: *"please ensure
the 2 days prior and 4 days prior are included as admin adjustable settings."* That covers all three
— the delivery offset before go-live (2), the commence offset before delivery (4), and the review
buffer (1 working day) — and it is the right call for a reason beyond convenience: each was derived
from a pilot of one department, and a number nobody can change is a number that gets worked around
in a spreadsheet the first week it is wrong.

They live on `tenant_reminder_settings` (ADR-0066), which already exists for exactly this shape of
value, behind `organization:manage`. **Its screen does not exist** — the table has one column,
`brief_approval_hours`, and nothing in `src/` reads or writes it, so the "Admin → Reminders" its own
comment names has never been built. Making these adjustable therefore means building that screen,
not adding a field to it (`I41.10`).

**The defaults stay as measured** — 2, 4, and one working day — so a tenant that never opens the
screen behaves exactly as this ADR describes. A setting whose default had to be chosen by an
administrator before anything worked would just be the OD 1 deadlock again, one table lower.

**What the measurement cannot see, stated because it will move.** It counts reviews that FINISHED —
`approved_at is not null`. A task submitted and still sitting unreviewed is excluded by
construction, so every figure above is the optimistic half of the truth and the p90 will rise as
slow reviews close. That is an argument for recomputing the number, not for distrusting it.

**d.6 — Ranked by consequence, and the task explains the deliverable.** An exception feed ranks by
what the client feels: a deliverable at risk outranks a task breach inside a deliverable that will
still land. The task is shown as the *reason*, not as a second row — *"Hero film is at risk — the
animation task breached by 2 days"*, never two rows a lead has to join up.

**d.7 — What is measured is measured for everyone, and nothing is measured by role name.** These are
properties of work, resolved by scope exactly as ADR-0018 requires. No metric here keys off who
somebody is.

**d.8 — Anti-gaming is the record, not a restriction.** No approval is required to move a deadline
and no reason field is imposed — both turn a planning tool into a delay, and ADR-0045 reached the same
conclusion about the chase ladder. What makes a moved deadline honest is that it is *visible*: moves
are counted per task, per person and per department, and a rising count is itself an exception.

**d.9 — A date inside the two days WARNS, states the damage, and is allowed.** Edward, 9 Sep:
*"the philosophy of the system is non-blocking. The user attempting to enter such a date should be
warned that there is x amount of work to be completed with details and that they need to resolve
this with the client. The severity of the impact should be clear… tight or impossible. Allow to
proceed after warning and record override."*

**Refusing is the worse failure and it is not hypothetical.** An account manager blocked from
entering the real go-live enters a false one, and every number in this ADR is then computed from a
date the client never gave. A wall does not prevent the bad plan; it removes the system's knowledge
of it.

**The warning does the work a wall cannot, by being specific.** Not *"this is too tight"* but the
arithmetic: how many hours of work remain across the deliverable's tasks, how many working days are
left before go-live minus the delivery offset, and therefore which of two things is true —

- **Tight** — the work fits, with nothing spare. Proceed knowingly.
- **Impossible** — the work does not fit in the time remaining at all. This is a conversation with
  the client, and the warning says so in those words rather than leaving the reader to infer it.

**Only a date AFTER go-live is refused**, because that is not a tight deadline but a typing mistake:
it asks the client to receive the work after they have used it, and there is no reading of it that a
warning would improve.

**The override is recorded, and that is the point** (d.8's principle, applied to dates rather than
deadlines). An unrecorded warning is a click. `sla_events` takes the row — who overrode, when, the
date they chose, and which severity they were shown — so a pattern of impossible dates accepted is
itself visible, per person and per client, rather than being absorbed silently into a delivery
figure that later looks inexplicable.

## What this does not decide

- **OD 1** — the accountability-type list per role. Untouched. ADR-0032 keeps it.
- **OD 6/7** — scoring, weighting and the rewards interface. Untouched, and deliberately downstream:
  measuring delivery is not the same as scoring a person, and conflating them is how a delivery metric
  becomes something people manage rather than something they use.
- **Utilization, cost and billable rates.** They need `V1.1`–`V1.3` and are absent from every
  definition above on purpose.
- **Client satisfaction.** Not derivable from anything the system holds.

## Consequences

**Easier.** The exception feed and every dashboard above it can be built now, from data already
present, without the SLA engine and without OD 1. `app.effective_sla` stays uncalled — no tier chain
is needed to answer "is this late".

**Harder.** One migration (the span, the settings, and the event writes), an admin screen that does
not exist (`I41.10`), a warning that has to do real arithmetic before it can be shown (d.9), and a
discipline: every path that moves a
task's dates must log it, and there is more than one — the scheduler, the drag handler,
`subtask-schedule`. A missed one is a silent hole in exactly the record that makes the metric
trustworthy, so the pgTAP for this asserts the log, not the columns.

**Locked in.** The promise and the plan are separate values, both visible. Anything later that reads
one date and calls it "the deadline" is a defect.

**Migrations.** One: `sub_tasks.committed_starts_at` + `committed_due_at` + `committed_hours`, the
whole span stamped at assignment (d.3); three settings columns on `tenant_reminder_settings`, the
review buffer keyed per department and the two go-live offsets tenant-wide (d.5);
`deadline_changed` written on every subsequent move; a `security invoker` view per clock segment so
the surfaces read one shape. Its pgTAP asserts that a rescheduled task keeps its committed date, that
the move is logged with its actor, and that a deliverable's due date is unchanged by any of it.

## Addendum — 20 Sep, a task's deadline is close of business on its last booked day

**Edward, 20 Sep, on `I52.14`.** d.3 stamps `committed_due_at` at assignment from `due_at`, and
`app.sync_subtask_span` (ADR-0039) sets `due_at` to the END of the last booking. But a booking is
entered as **a day and a number of hours**; the 09:00 start and the end hour are the system's own
placement on the capacity grid (`src/lib/bookings/day-span.ts`, `DAY_START_HOUR`) — nobody chose
them. So a four-hour task "committed to 13:00" is committed to a time no one set, and My Work printed
it as a promise. Edward: *"time is not specified — only date and hours"*; *"close of business is
18:00 Iraq time"*.

**d.3a — A task's commitment is a DAY at close of business.** `committed_due_at` is stamped as the
day of the task's last booking at **18:00 Asia/Baghdad**, whatever hour the placed booking ends; an
approved extension (ADR-0088 d.6) moves it to the requested day at 18:00 likewise. The booking's
clock times remain an internal placement for the grid and are never shown or stamped as a
commitment. The deliverable's due date is a separate promise (d.2 stands).

**d.3b — The display shows a day.** *Committed: 17 Sept 2026* — the `formatIraqDate` shape every
deadline uses, never `formatIraqDateTime`. The line still appears only when the planned day and the
committed day differ (ADR-0088 d.1).

**d.3c — Existing rows are corrected in a separate, reviewed step, never in the same migration.**
Production carries stamps at booking-end hours. A follow-up migration moves each `committed_due_at`
to 18:00 **of the same day** — the day never changes, so no breach flips — and is proposed with its
row count for Edward to approve before `db push`. Until then the display rule (d.3b) already shows
the right day. Tracked as `I52.14` (the stamp and the display) and `I53.6` (the due date, ADR-0093
addendum).

