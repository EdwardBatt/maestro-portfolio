# ADR-0077: A container closes when its contents are done

- **Status:** **accepted**
- **Date:** 2026-09-08
- **Open Decision:** none. This makes a decision already taken actually happen — see Context.
- **Task(s):** `I40.23` (the fix), `I40.24` (cancelled-only deliverables, deliberately not decided
  here), `I40.22` (which surfaced it). Amends **ADR-0058 d.6** by removing what made it unreachable.

## Context

**ADR-0058 d.6 is already decided, already built, and has never once fired.**

Edward, 28 Aug: *"if all sub-tasks are approved, then the deliverable by default is approved."*
`app.maybe_complete_sub_task` does exactly that. `20260828235500` removed the last condition fencing
it to ad-hoc work.

It cannot run. The approval is gated on the deliverable being `in_review`, and the container's state
machine (`20260817110100`, still current) permits only `in_progress → in_review → approved`.
**Nothing in the system ever writes `in_review` on a deliverable** — every reference in every
migration is a *read* (`if v_deliv_state = 'in_review' then`), verified 8 Sep. The only way in is a
person pressing a button.

So the automatic sign-off waits on a state nothing sets.

**Measured on the live tenant, 8 Sep.** Eleven ad-hoc deliverables, one task each, every task `done`
and approved — several the previous afternoon — every deliverable still `in_progress`. Not one could
have closed itself. And on the Ad-hoc tab the row actions are filtered to `archived` only, so there
was no button to do it by hand either: **the work was unreachable from both directions.**

**Why the gate exists, and why it is wrong.** The container's state machine was written 17 Aug.
**ADR-0058 then made the SUB-TASK the unit of review** — *"a deliverable is a container, the sub-task
is the unit of review"* — and the container's states were never revisited. Its `in_review` is a
leftover from the model that preceded it.

Edward, 8 Sep, twice, and he was right both times:

> *"the deliverable is a container for the tasks, it is not a physical asset or specific task… the
> sub-tasks of the deliverable are what get reviewed and approved… so why do you keep saying move
> the deliverable to in review?"*

> *"we have a review and approve path… we can access it from /deliverables as well… why is there a
> third path for the same process?"*

There is no reason. Reviewing and approving happens on the task — submit from My Work, approve from
Awaiting Review or the review panel. The container's review-and-approve buttons on the campaign tab
duplicate that vocabulary while reviewing nothing.

**A first draft of this ADR proposed adding `in_progress → approved` and KEEPING the old route**, on
"do not break live work". That was wrong, and Edward rejected it: the route being preserved is not
used by anything, is not reachable at all for ad-hoc work, and is the very duplication he was asking
about. Keeping it would have carried the defect forward with a second door beside it.

**What is actually at risk, measured rather than assumed:**

| | count | what happens |
|---|---|---|
| deliverables in `in_review` | **9** | moved (d.4) — small enough to clear properly |
| deliverables stranded `in_progress`, all tasks approved | **11** | approved (d.5) |
| deliverables with only a cancelled task | **34** | untouched (d.6) |
| **TASKS** in `review` on ad-hoc alone | **16** | **untouched — this is the live review process** |

The last row is the one that matters for safety, and it is why the container and the task must not
be confused: a task in `review` is work correctly awaiting a reviewer. **Nothing here touches task
review.** The container's state and its tasks' statuses are independent, confirmed by measurement:
9 containers in one state, 16 tasks in another, no relationship between them.

## Decision

1. **One review-and-approve path, and it is the task.** Submit, review, approve happen on the
   sub-task. A deliverable is never reviewed and never approved as an act performed on it.

2. **A deliverable goes from `in_progress` to `approved`** when every task on it is settled — `done`
   or `cancelled` — which is the condition `app.maybe_complete_sub_task` already enforces. That
   function accepts `in_progress`, which is the whole of the behaviour change.

3. **`in_review` STAYS reachable, for now.** Removing the edge was attempted and reverted: fifteen
   pgTAP suites drive that state as setup, and unpicking them is a separate piece of work, not a
   rider on this one (`I40.25`). What changes is that nothing NEEDS it — a container reaches
   `approved` without it. It becomes a path nobody has to take rather than one nobody can.
   Retiring it, and removing the campaign tab's review/approve buttons with it, is `I40.25`.

3a. **The rollup path requires something to roll up.** `in_progress → approved` skips the sign-off
   permission only when at least one task on the deliverable is `done` with an `approved_at`.
   Without that test, a deliverable whose every task was CANCELLED could be closed by anyone who
   could reach it — `cancelled` counts as settled for the readiness gate — which is precisely the
   lie d.6 refuses to write into the data. Found by the pgTAP suite, not by reasoning.

4. **The nine deliverables in `in_review` are moved out**, in the same migration: to `approved` where
   every task is settled, and back to `in_progress` where any task is still live. Nothing is left
   sitting in a state that has just become unreachable.

5. **The eleven stranded deliverables are approved.** Ad-hoc, one task each, task `done` and
   approved, container `in_progress`: the state the system decided for them and could not write.
   Reversible — `approved → in_progress` is legal and is how a revision is already reopened.

6. **Cancelled-only deliverables are NOT touched.** Thirty-four have their single task cancelled and
   nothing approved. That is abandoned work, not finished work, and recording it as `approved` would
   put a lie in the log. What such a deliverable should READ as is `I40.24`.

7. **Task review is untouched.** The sixteen tasks in `review` are the live process working. No
   migration, guard or surface in this change reads or writes `sub_tasks.status`.

## Consequences

**Easier.** The rule decided on 28 August finally happens, and there is one way to approve work
rather than two words for it in two places. Finished deliverables stop sitting in the live list
looking like something somebody still owes. And the container's vocabulary stops contradicting
ADR-0058 on the screen where it is read most.

**Harder.** The container keeps a review state that nothing needs, and the campaign tab keeps
buttons for it — so the duplication Edward asked about is reduced, not yet gone. `I40.25` carries
the rest. Two routes to `approved` now exist and a reader of the guard has to know why; d.3 and d.3a
are that explanation.

**Locked in.** Approval flows upward — task to container, never the reverse, never as an act on a
container. If a container ever genuinely needs its own sign-off — a client approving a package, say —
that is a NEW state with a new name and its own ADR, not a revival of this one.

**Not decided here.** What a deliverable whose only task was cancelled should read as (`I40.24`).
Whether `approved → delivered` earns its place: `delivered` holds **zero** rows and has never been
used, which is worth knowing before anyone builds on it.

## Addendum — 14 Sep, starting any task starts its container

**Tracker:** I48.35. **Accepted** (Edward, 14 Sep: *"start on any task triggers to in progress —
it does not have to be the first one"*).

**What was found.** Writing guide 10, a deliverable with all four tasks `done` and approved still
read *Draft · 4 of 4 tasks done*. d.2 closes a container from `in_progress` (or the drained
`in_review`), and nothing moves a deliverable out of `draft` except a person pressing **Start** —
a press that needs `project_tasks:manage`, so the maker whose task just began cannot make it. The
retest specs press Start before approving, which is why K2 never saw it. Sign-off was made a
consequence with no authority of its own; the step before it was still a button somebody had to
remember.

**Decision.**

- **d.7 — Starting any task under a `draft` deliverable moves the deliverable to `in_progress`.**
  `app.sub_task_start`, after it starts the task, moves a still-`draft` container. Whichever task,
  in whatever order: the first press of Start on any of them is the moment work on the container
  began, which is what *In progress* means.
- **d.8 — That transition needs no authority of its own**, in the shape of d.3: the guard lets
  `draft → in_progress` through when a task under the container has started (`in_progress`,
  `review` or `done`). A `draft → in_progress` with no started task still needs
  `project_tasks:manage` — the **Start** button on the deliverable stays for that.
- **d.9 — The rows already stuck are moved once**, in the honest direction: a `draft` container
  with a started task becomes `in_progress`; one whose work is settled and approved becomes
  `approved` through the same rollup d.6 keeps honest (at least one approved task; nothing live).

**Consequences.** *In progress* now means what it says. Nothing about the close rule changes; d.7
only guarantees the container is in the state the close rule reads from. pgTAP 116: a maker with no
management permission starts a task under a Draft deliverable and it is In progress; the last
approval then signs it off with nobody pressing Start; a Draft deliverable with no started task
stays Draft and a maker cannot move it by hand.

## Addendum — 22 Sep, recording 17 Sep: what the two rings measure (`I52.10`)

**Edward, 17 Sep, from the production walk-through of the campaign page.** The first ring counted
CLOSED containers (all-or-nothing) and the second excluded finished work, so it shrank as work was
done. Decided and built the same day (`deliverableProgress`, `countTasks`, `taskCoverage`;
`coverage/campaign-rings.spec.ts`):

- **One ring per deliverable** — *"Social Advertisement — 0 of 5 complete"*: its tasks done of its
  tasks, filling as tasks are approved. Archived deliverables show no ring.
- **Tasks assigned** counts assigned of ALL tasks: a done task stays in the total and counts as
  assigned; only a cancelled or removed task leaves it — *"done is a status, not whether or not it
  counts."* The compact line per department reads *"n of m tasks complete."*
- A task's badge wears its status — **Not started** in orange (was "To do"), In progress, In
  review, Done, Cancelled — everywhere a task row appears (`I52.11`).
