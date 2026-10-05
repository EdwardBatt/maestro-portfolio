# ADR-0078: A day of work is a working day

- **Status:** **accepted**
- **Date:** 2026-09-09
- **Open Decision:** none.
- **Task(s):** `I41.7` (this ADR), `I41.2` / `I41.3` (already built against the rule), `I41.5`.
  **Amends `I29.2`** and refines **ADR-0061 d.2**; supersedes neither.

## Context

**This ADR is late, and that is the first thing it records.**

`AGENTS.md` §8 requires an ADR *before* a rule change. On 7 Sep Edward reversed a shipped decision in
conversation and `I41.2`/`I41.3` were built the same afternoon; two further pieces of work
(`I41.5`, and the container-model work of ADR-0077) have since been built on top of it. Writing the
ADR two days later cannot undo that, but leaving the rule unwritten would mean the next person finds
`I29.2` — an accepted, ticked decision — saying the opposite of what the code does, with nothing
explaining which is current. That is the actual cost of skipping the step, and it is the reason this
is being written before anything further is built on the rule.

**What `I29.2` decided, and why it was reasonable.** *"`spreadHours` keeps its behaviour whenever
the span holds working days — a Monday-to-Sunday task still spreads Monday to Friday — and spreads
across the calendar days when it holds NONE."* Read as "never book somebody on a day their office
does not work, unless that is deliberately all you asked for", it is a sensible rule and it shipped.

**What it produced in real use.** Edward, 6 Sep, from the live pilot: a person assigned on a
**Thursday for 2 days at 8 hours** had **all 16 hours placed on the Thursday**. The span Thursday→
Friday contained one working day, so the whole allocation compressed into it.

Nobody had done anything wrong. The assigner asked for two days of somebody's time; the system
honoured the *span* and silently discarded the *amount*.

**The diagnosis was initially wrong, and that matters to the rule.** `spreadHours` was blamed —
including in the memory notes written that evening. It was innocent: handed a span containing one
working day it did the only honest thing available. The cause was that **"2 days" was counted in
calendar days in three separate places** — the dialog's day count, the series expansion, and the due
date read off the typed end date — and none of the three consulted the office's working week. The
rule below is therefore about what a *count of days means*, not about how hours are divided.

**Edward's decision, 7 Sep:**

> *"it would be better to skip Friday and apply Sunday… the assigner can then drag it back to Friday
> if required, thereby shifting the due date backwards, instead of forwards."*

And, when the consequence was put to him directly — that this makes the end date move on its own:

> *"my call is second day slides to sunday… as i stated, the assigner can drag to Friday, get the
> warning and proceed."*

**That second half was not true when he said it.** Dragging a chip consulted nothing but write
scope: no working week, no capacity, no blackout. The escape hatch the rule depends on did not
exist, and `I41.5` was raised and built to create it. d.4 below makes it part of the rule rather
than a coincidence.

## Decision

1. **A count of days is a count of WORKING days.** "Thursday, 2 days" means two days of that
   person's working time. A day their office does not work never consumes one of them: the second
   day lands on the next working day, and the end of the span moves forward to meet it.

2. **The FIRST day is never moved.** A deliberately-chosen Friday is booked on the Friday. This is
   ADR-0061 d.2's judgement — *nothing blocks; somebody picked that date and the surface warned
   them* — kept intact. Only the repeats step over. Without this, d.1 would silently overrule a
   direct instruction, which is the failure `I29.2` was right to avoid.

3. **An explicit PLACEMENT is never re-derived.** Dragging a chip, or typing a date on an existing
   task, sets that task's dates; nothing may recompute them afterwards. d.1 governs turning a
   *count* into dates. A dialog opened on existing work re-derived where its days "would" land, and
   would have written that back on save — Edward: *"if the task is dragged to Friday, the correct
   end date is Friday."* A count is an instruction; a placement is an answer.

4. **The forward slide is only acceptable because the drag can undo it**, and the drag must SAY what
   it is doing. Dropping onto a non-working day, a blackout, or a day that would go over capacity
   warns first and proceeds on confirmation (`I41.5`). This is a condition of d.1, not an
   independent nicety: the rule moves somebody's deadline without being asked, and the only thing
   that makes that tolerable is a one-gesture correction that tells the truth.

5. **Weekly series do not step.** A weekly Friday booking stays on every Friday. Stepping it would
   break the same-weekday contract that is the entire point of a weekly series, and the office's
   days off are not news to whoever set it up.

6. **`spreadHours` is unchanged**, and this ADR records that it was never the defect. Given a span,
   it divides the total across the working days inside it. That behaviour is correct and stays; d.1
   works by making the SPAN right before it is reached.

7. **`I29.2` is amended, not superseded.** Its wider decision — *nothing blocks, including the
   working week* — stands, and d.2 above is a direct application of it. What changes is the single
   sentence about a Monday-to-Sunday task, which described the behaviour of a system where the day
   count was calendar-shaped. Its tracker entry carries a pointer here.

## Consequences

**Easier.** "Two days of Sara's time" means two days of Sara's time, on every path that produces
dates. The three places that counted calendar days now cannot disagree, because only one of them
counts at all. And the capacity preview stops checking the wrong day — it assessed a Friday, always
empty because nobody works it, for work that was going to land on a Sunday, so an already-full Sunday
passed silently.

**Harder.** A deadline now moves without being asked, and that is a real cost, mitigated but not
removed by d.4. Somebody who picks Thursday→Friday and expects Friday will get Sunday, and the only
thing standing between them and surprise is a line of text and a warning on the drag back. If that
proves confusing in the pilot, the answer is better wording, not a return to compressing the hours —
16 hours on one Thursday is the outcome nobody could defend.

**Locked in.** Dates are derived from a count exactly once, at the moment of assignment. Anything
that wants to change them afterwards moves the work, and the work carries its dates (ADR-0039). A
future feature that recomputes a span from a count on saved work would silently re-slide every
deadline it touched; d.3 exists to forbid it.

**Not decided here.** The working calendar itself. `workingDaysInRange` knows a weekly pattern and
nothing else: **there is no holidays table anywhere in the schema, and `resource_unavailability` is
never consulted by the spreader.** Every office works the same week every week of the year, Eid
included, and d.1 makes that gap sharper because it now decides where work lands rather than only
how it is divided. That is `I41.4`, and it wants its own ADR.
