---
name: maestro-adr
description: Write a Maestro Architecture Decision Record. Use whenever resolving an Open Decision, changing the stack or schema shape, adding a dependency with license implications, or changing project rules. ADR comes before implementation.
---

# Writing a Maestro ADR

ADRs are the living decision system (ADR-0001): design doc v15 is frozen, and every decision
since lands here. **The ADR comes first, acceptance comes from Edward, implementation follows**
— never the reverse order.

## When an ADR is required

- Resolving any of the 29 Open Decisions (design doc §11 / the OD Gate table in `docs/TASKS.md`)
- Stack additions or changes; any dependency that is MPL, dual-licensed, paid, or unusual
- Schema-shape decisions: new entities, changed relationships, new state machines
- Changes to `AGENTS.md` rules or this process itself
- Any `security definer` function; any deviation from deny-by-default RLS

## Process

1. Copy `docs/adr/0000-adr-template.md` to `docs/adr/NNNN-kebab-title.md` (next number in
   the index).
2. Fill in: **Context** (the forces — quote the design doc section and OD number; include
   evidence, options weighed, and costs, the way ADR-0002 records the FullCalendar trail),
   **Decision** (plain, numbered, testable statements), **Consequences** (easier / harder /
   locked-in — honest about the costs).
3. Status `proposed`. Present to Edward; do not implement while proposed.
4. On acceptance: set `accepted`, add the row to `docs/adr/README.md`'s index, update the
   OD Gate table row in `docs/TASKS.md` (mark **Resolved — ADR-NNNN**), and un-gate or edit
   the affected ⚠️ tasks.
5. Accepted ADRs are immutable. Changing course = new ADR with
   "supersedes ADR-NNNN" / old one marked "superseded by ADR-MMMM".

## Quality bar

An ADR that says "we chose X" without recording what X was weighed against, what it costs,
and what it forecloses is not done. One decision per ADR. Reference every affected task ID.
If the decision has a licensing or money dimension, state it explicitly — silent cost
assumptions are how the FullCalendar problem happened.
