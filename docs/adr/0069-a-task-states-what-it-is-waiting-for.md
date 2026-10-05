# ADR-0069: A task states what it is waiting for

- **Status:** accepted (Edward, 3 Sep)
- **Date:** 2026-09-03
- **Open Decision:** —
- **Task(s):** `I36.3`–`I36.5`. **Amends [ADR-0030](0030-task-execution-and-time-tracking.md) §1b**
  on one point (when a dependency is satisfied) and reaffirms the rest of it; relates to ADR-0052
  (a type implies a task list), ADR-0058 (the sub-task is the unit), ADR-0045 (chasing)

## Context

Edward, 3 Sep: *"there is no dependency on task lists. so once a task is approved it does not pass
onto the next task that requires it… we need an extra column to indicate 'required input'. this
should be a drop-down based on the actual deliverables task list, keeping in mind each task can be
renamed, edited or removed."*

### Most of this was built in August and has never been used

`sub_task_dependencies` exists: B depends on A, many-to-many, **explicitly allowed across
deliverables**, with a cycle guard that rejects A→B→A, RLS'd on `project_tasks:manage`, audited.
`deliverable_pending_inputs` exists beside it: *specific* external items ("Acme logo pack", never a
vague "blocked"), registered on the deliverable and cascading to its tasks. And
`app.sub_task_has_unmet_prereqs()` already answers "is this task waiting on anything?" across both.

**Nothing in `src/` references any of it.** Outside the generated `database.ts` there is not one
reference in the entire frontend. This is the same shape as the four production workflow templates
the 2 September audit found — built, correct, and pointed at by nothing.

So the gap is a **surface**, not a schema. That is the cheapest kind of gap to be in and the easiest
to leave unnoticed for months, because nothing is broken; a capability is simply absent.

### The dropdown cannot come from the template, and this is the sharp part

`sub_tasks.workflow_step_id` is nullable and `on delete set null`, and the task's title lives on the
task. A task renamed, added, or removed after materialisation therefore has **no reliable
relationship to the template it came from**, and a task created by hand never had one.

A picker built from `workflow_steps` would offer steps that no longer exist on this deliverable and
omit tasks that do. Edward named this himself, and it is the difference between a feature that works
on a real deliverable and one that works only on an untouched one.

### What ADR-0030 §1b decided, and what changes

§1b, accepted 18 August, decided **soft** dependencies:

> **No Block — soft dependencies instead.** A sub-task can never be marked "blocked" (blocking
> becomes an excuse for idleness)… Both are **soft** — displayed, never enforced. Start/Submit are
> never disabled by an unsatisfied dependency… Starting work while a dependency is unsatisfied is
> flagged **"started ahead"** — a positive initiative marker.

Edward initially asked for hard blocking, then on being reminded of §1b (3 Sep: *"I forgot about
this… allow started ahead"*) **kept the soft rule**. That is recorded here rather than left implicit,
because the reasoning is not obvious in hindsight: a blocked flag becomes the reason work did not
happen, and `started_ahead` — the signal that somebody pressed on anyway — only exists while
pressing on is possible.

**One thing does change.** §1b makes a dependency satisfied when the prerequisite is **submitted**,
and `sub_task_has_unmet_prereqs` implements exactly that (a task sitting in `review` counts as
satisfied). Edward asked for **approved**. He is right, and the reason is the one the feature exists
for: a hand-off released by an unreviewed submission is precisely the case where the next person
builds on work that is about to be sent back.

### What is missing beyond the surface

Nothing tells the waiting person when their turn arrives. ADR-0045 built the vocabulary for chasing
stalled work but nothing emits a *"your input has landed"* event, and a dependency that is only ever
displayed requires somebody to go and look — which is the same failure as the silent stall.

## Decision

**d.1 — A task may require other tasks, across deliverables and departments.** The existing
`sub_task_dependencies` is the store; nothing about its shape changes. Cross-department is the case
that makes this worth building — a dependency confined to one deliverable's own task list would
mostly restate `sort_order`.

**d.2 — A dependency is satisfied when the prerequisite is APPROVED, not submitted.** This amends
ADR-0030 §1b and is a one-clause change to `app.sub_task_has_unmet_prereqs`: `done` satisfies,
`review` no longer does. `cancelled` also satisfies — a prerequisite that will never happen must not
hold its dependent for ever, and that is a decision, not an oversight.

**d.3 — Dependencies stay SOFT. Start is never disabled, and `started_ahead` survives** (ADR-0030
§1b, reaffirmed on Edward's instruction, 3 Sep). A task with an unmet requirement is shown as
**waiting, and for what** — prominently enough that nobody has to go looking, and never as a locked
door. Someone who proceeds anyway is flagged as having started ahead, which is a positive marker.

**d.4 — Approving a task NOTIFIES whoever is waiting on it.** Every assignee of a task whose last
unmet requirement has just been met is told their input has landed. This is the half Edward asked
for that did not exist in any form — the dependency was information nobody was pushed. Nothing is
sent while other requirements are still outstanding, because "you can start now" must be true when
it arrives.

**d.5 — The picker reads the LIVE task list**, `sub_tasks` for the deliverable, never
`workflow_steps`. A renamed task shows its current name; a removed one is absent; a hand-added one
is present. The cycle guard already refuses a circular pick, and that refusal reads as a sentence
rather than a constraint name.

**d.6 — "Required input" covers both kinds in ONE column**: tasks this task waits on, and the
deliverable's outstanding external inputs. They are one question — *what are we waiting for?* — and
two columns asking it would be one too many. `sub_task_has_unmet_prereqs` already combines them.

**d.7 — External inputs are registered on the DELIVERABLE and cascade to its tasks**, as the schema
already has it. One "waiting on Acme's logo pack" rather than the same sentence copied onto six
tasks, and one place to tick it off. `description` stays mandatory: ADR-0030 refused a vague
"blocked" and that refusal is the point of the field.

**d.8 — `awaited_from` stays free text** (Edward, 3 Sep). "The client's agency" is a real answer no
dropdown would hold, and it is the field most likely to name something the schema cannot model.
Turning it into a reference later is a migration, not a redesign.

**d.9 — Clearing an external input is an explicit act by a person**, stamped with when. `satisfied_at`
already exists, so *how long were we waiting* becomes answerable the moment anything writes it — and
that is the number this feature will eventually be judged on.

## Consequences

**Easier.** The hand-off between departments becomes visible, and the person who has been waiting
finds out without asking. Two tables that have been carrying no load since August start carrying
some. "How long did we wait on the client?" becomes a query rather than a recollection.

**Harder.** A dependency that is displayed but never enforced relies on people reading it, which is
a real limit and is chosen deliberately (d.3) rather than stumbled into. Satisfaction moving from
submit to approve makes hand-offs **later** by design — a team used to picking work up at submission
will wait longer, and that is the intended behaviour rather than a regression to explain away.

**A new notification type is a new way to be noisy** (ADR-0045's standing warning). d.4 is bounded
to the moment the LAST requirement clears, so a task with three prerequisites produces one message,
not three.

**Not done here.** Scheduling a dependent task automatically when its prerequisite completes was
considered and excluded: it collides with capacity, leave and the working week, and belongs with the
scheduler rather than with this. Deliverable-level dependencies are not added either — a
deliverable's readiness is derivable from its tasks, and two mechanisms for one idea is how they
drift.

**Locked in.** `sub_tasks` is the vocabulary for what a task waits on. Should a template ever want
to carry default dependencies, it will have to materialise them into `sub_tasks` like everything
else, rather than becoming a second source of truth (ADR-0052's pattern).
