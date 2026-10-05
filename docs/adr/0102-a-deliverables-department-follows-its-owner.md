# ADR-0102: A deliverable's department follows its owner

- **Status:** accepted (Edward, 24 Sep: "yes")
- **Date:** 2026-09-24
- **Supersedes:** ADR-0099 d.2, d.3 and d.4 in part (the deliverable's department). ADR-0099's workstreams stand.
- **Task(s):** I57.11 (Edit a deliverable, CG-E1), I57.18

## Context

**What Edward asked, 24 Sep:** *"We need to assign to people, not departments… The dept should be
based on the assigned owner."*

**What the system does today.** Since ADR-0099 (23 Sep) a deliverable's department is set in two
places only:

1. when the deliverable is created — its first owner's department (a starting point);
2. when it is put into a workstream — the workstream's department.

Changing the deliverable's **owner** moves nothing: a Creative deliverable handed to a Content lead
stays Creative. The Edit dialog (CG-E1) shows the department read-only for that reason.

**Why ADR-0099 made it so.** On 22 Sep a Creative team leader was refused the assignment of her own
team member: the deliverable's owner sat in another department, so the deliverable was that
department's, and its tasks were outside her reach. The department had moved because one person's
name changed, and the fix was to stop the owner moving it.

**What has changed since.** The reach that refused her no longer exists. ADR-0098 (22 Sep, accepted):
anyone who may book books anyone, in any department — a lead's reach is no longer bounded by the
deliverable's department — and a TASK's department already follows its assignee (ADR-0098 d.9). So
the harm that made ADR-0099 stop the owner-derivation is gone, and what is left is Edward's rule:
work is given to people, and the department is where that person sits.

**Measured on the local database (24 Sep):** 751 deliverables with an owner; of the 699 not yet
approved, delivered or closed, **7** sit in a department other than their owner's — **6** of them
because a workstream put them there. No owner has no department. Production must be counted by the
migration before it runs (d.5).

### Options weighed

**A. Keep ADR-0099 as it is** — the department is chosen at creation or by a workstream; an owner
change moves nothing. Rejected by Edward: it assigns to departments, not people.

**B. A separate Department choice in Edit**, as the CG-E1 frame draws it. Rejected: it keeps two
answers to one question (the owner says one department, the field another), which is exactly what
Edward's rule removes.

**C. The deliverable's department follows its owner, always** — at creation, and whenever the owner
changes. Chosen.

## Decision

**d.1 — A deliverable's department is its owner's department.** Set when the deliverable is created
and set again every time its owner changes. It is never chosen separately. This restores ADR-0050
d.2's derivation for deliverables and supersedes ADR-0099 d.2.

**d.2 — A workstream no longer sets a deliverable's department.** Putting a deliverable into a
workstream, or moving it between workstreams, changes the grouping only. A workstream keeps its own
department — it labels the group and starts its owner picker on that department's people (ADR-0099
d.5) — and a group may hold deliverables of more than one department. Supersedes ADR-0099 d.3; d.4
("taking it out changes nothing but the grouping") now holds for putting it in too.

**d.3 — An owner with no department leaves the deliverable's department as it was.** The department
is never emptied by an owner change. (None exist locally today; the migration counts production.)

**d.4 — Tasks follow as they do today.** An ASSIGNED task's department follows its assignee (ADR-0098
d.9). The deliverable's UNASSIGNED tasks follow the deliverable when its department moves — the rule
since I53.29 (21 Sep), unchanged. (Corrected on acceptance: the proposal said no task moves, which was
not what the system does.)

**d.5 — Existing work is brought into line once.** The migration re-stamps every deliverable not yet
approved, delivered or closed whose department differs from its owner's, lists them (count and ids in
its output), and records each move in the audit log. Approved, delivered and closed deliverables keep
the department they finished in — history is not rewritten.

**d.6 — The Edit dialog says so.** The Department line is read-only and reads *"Follows the owner — a
new owner moves it to their department."*; choosing a new owner shows the department it will move to
before saving.

## Consequences

**Easier.** One answer to "whose department is this?": the owner's. Assigning to a person is the
whole act — Edward's model.

**Harder / to watch.**
- The 22 Sep incident's cause returns in form (an owner change moves the department) but not in effect,
  because reach no longer depends on the department (ADR-0098). If reach is ever narrowed to the
  department again, this ADR must be revisited first.
- A workstream can now hold deliverables of several departments; screens that group by workstream
  (the Grid, the Season map) show the group, and each row's owner says where it sits.
- `app.tg_deliverable_stamp_department` changes, and the pgTAP suites around ADR-0099 d.3 (the move
  that changes the department) are rewritten to assert the opposite.

**Locked in.** A deliverable has no department of its own apart from its owner's.

## Implementation (after acceptance) — `I57.18`

- Migration: the trigger stamps from the owner on insert and on every owner change; a workstream move
  no longer touches the department; the one-off re-stamp of d.5 with its count; pgTAP for each rule
  (owner change moves it, workstream move does not, owner with no department leaves it, finished work
  untouched).
- Edit dialog: the department hint and the preview of the new department (d.6).
- Browser: `edit-piece.spec.ts` asserts the department follows the new owner; `workstreams.spec.ts`
  asserts a move no longer changes it.
