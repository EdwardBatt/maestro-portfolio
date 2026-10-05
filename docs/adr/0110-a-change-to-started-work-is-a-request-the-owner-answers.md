# ADR-0110: A change to started work is a request the owner answers

- **Status:** accepted (Edward, 25 Sep — on `running-it`)
- **Date:** 2026-09-25
- **Open Decision:** none
- **Task(s):** `I59.23`
- **Amends:** the section D Edit (`I57`, `EditPieceDialog`) — deferred there as CG-E2

## Context

Edit on a deliverable (CG-E1) saves every field straight away, even when somebody is days into the
work. The v3 Figma (CG-E2, NY-L, NY-AM-5) makes a change to **type, quantity, department or date** on
**started** work a change request to the lead: the cost is shown, the asker says whether the client
asked (spends a revision round) or we briefed it wrong (costs us, counts nothing), the lead has until
end of day, and can push back with a counter; the account manager can accept the counter, insist
(escalates) or withdraw.

Edward, 25 Sep: the owner accepts, declines with a reason, or pushes back with **words and an optional
date** (not a rewritten set of fields); *"The account manager is the authority for each project /
campaign… remove insist. This is an issue that can be dealt with outside the system."*

## Decision

**d.1 — On a deliverable with any task started**, editing its type, quantity, department or due date
does not save: it becomes a **change request** to the deliverable's owner, carrying the before and after,
the cost (work lost, new landing date), and **who asked** (the client — spends a revision round; us —
counts nothing). Name, priority and notes save as today; unstarted work saves as today.

**d.2 — The owner accepts** (the change applies), **declines** (a reason), or **pushes back** (words and
an optional date).

**d.3 — On a push-back the account manager accepts her version** (the change applies with her date; her
words on the record) **or withdraws** (nothing changes, no round spent). A declined request is a card in
the account manager's Needs you with the reason, and **Send a new request**. There is no "insist".

**d.4 — An unanswered request escalates** after its set hours (ADR-0108).

## Consequences

Easier: a costly change to running work is seen, costed and agreed before it happens; revision rounds
count client changes honestly.

Harder: a new request record with its states and audit; Edit must know "started" (any task
`in_progress` or later, or any time entry).

Locked in: the owner is asked before started work changes shape; the account manager keeps the last
word by withdrawing, never by overriding.

## Addendum — 25 Sep (Edward, answering the build's questions)

- **The owner is not part of a change request** (*"changing the owner of the deliverable has no impact on the
  tasks"*): Change owner saves straight away, the department follows it (ADR-0102). A change request covers
  type, quantity and due date only.
- **A type change is allowed**: on acceptance the new type's tasks are added unassigned for the owner to
  approve (ADR-0100), the old type's open tasks are cancelled, finished ones kept — amends ADR-0052 d.6 for
  this route only.
- **A due-date change asks for the client's evidence but never blocks**, on this route and on ADR-0088 d.7a's —
  **amends ADR-0088 d.7a** ("no attachment, no change" becomes "asked for, logged either way"). Every change
  records whether evidence came with it.
