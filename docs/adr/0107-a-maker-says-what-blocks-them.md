# ADR-0107: A maker says what blocks them, on their own task, and the blocked time is not theirs

- **Status:** accepted (Edward, 25 Sep — on `running-it`)
- **Date:** 2026-09-25
- **Open Decision:** none
- **Task(s):** `I59.21`
- **Amends:** ADR-0069 d.7 (inputs are registered on the deliverable) · ADR-0030 §1 (the timer)

## Context

ADR-0069 made "what is this task waiting for" a **required input** — what, and who it is awaited
from — registered on the **deliverable** and cascading to every task on it, cleared by a person;
ADR-0030 refused a bare "blocked" flag, and ADR-0075 d.4 reads an outstanding input as **waiting**,
not **at risk**. Inputs can be added only on the Deliverables page.

The v3 Figma gives the maker **I'm blocked** (NY-M-2): what is missing (copy · the client · a file · a
decision · something else), who has it, what you need; it goes to the lead and the AM, and *"blocked
time is counted against the block, not against you"*.

Two things do not fit today's model. A maker is blocked on **their own** task — on a deliverable with
Lujain's design task and Abeer's copy task, "waiting on Abeer's Arabic copy" registered on the deliverable
makes Abeer's own task wait on herself. And the timer runs from Start to Send, so a blocked maker's
minutes include the hours they could not work.

## Decision

**d.1 — An input may be registered on one task.** `deliverable_pending_inputs` gains a nullable
`sub_task_id`; an input with it applies to that task only, one without it cascades as today. What,
who, and mandatory description stay (ADR-0069 d.7, d.8).

**d.2 — The assignee raises it from the task page** with the three fields; the deliverable's owner and
the account manager are told. The task reads "Waiting on Abeer · Arabic copy" on My Work, in the
owner's Needs you, and on the team timeline. The maker or the owner clears it; clearing tells whoever
was waiting (ADR-0069 d.4).

**d.3 — Blocked time comes off the round's minutes.** When a round is sent, the overlap between the
round and the task's inputs (raised → cleared) is subtracted and recorded as the round's blocked
minutes.

## Consequences

Easier: the record says who is actually stuck; ADR-0075's waiting rule and the Needs-you items follow
with no new state. Still no "blocked" status.

Harder: `sub_task_has_unmet_prereqs` and the at-risk reader must include task-level inputs; the
subtraction handles overlapping inputs once, not twice.

Locked in: a block always names what and who; the maker's time excludes it.

## Addendum — 25 Sep (Edward)

- **Blocked time counts both kinds**: the task's own inputs and inputs on its whole deliverable, overlaps once.
- A block's kind is required; clearing it tells whoever waited (`task_unblocked`); a cleared block is not
  re-opened — a new one is raised.
