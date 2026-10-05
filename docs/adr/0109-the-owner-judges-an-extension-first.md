# ADR-0109: The deliverable's owner judges an extension request first, and the account manager may give less time than asked

- **Status:** accepted (Edward, 25 Sep — on `running-it`)
- **Date:** 2026-09-25
- **Open Decision:** none
- **Task(s):** `I59.22`
- **Amends:** ADR-0088 d.2, d.3 (who asks; the account manager answers)

## Context

ADR-0088: an extension is a request against the task's **committed date**; the assignee (or anyone who
could reschedule it) asks, and the **account manager** approves or refuses — nobody in between.

The v3 Figma (NY-L-3, NY-AM-4) puts the lead between: *"Fair — forward it"* with a note, or *"Not fair —
decline here"*, which ends it; only a forwarded request reaches the AM, whose choices are **Approve**,
**Approve a shorter one**, **Decline**. Edward, 25 Sep, chose the two-step form with the **deliverable's
owner** as the middle step — the person who approved the task list and assigned the work (ADR-0100).

## Decision

**d.1 — A request goes first to the deliverable's owner**, who **forwards it with a note** or
**declines it** with a reason (ending it; the maker is told). If the owner is also the account manager,
it goes straight to them.

**d.2 — A forwarded request reaches the account manager with the owner's note**, answered as ADR-0088
d.3 says.

**d.3 — The account manager may approve a shorter extension**: a date after the current commitment and
before the one asked. The commitment moves to it; the maker and the owner are told the date given.

**d.4 — Both steps escalate** after their set hours (ADR-0108).

## Consequences

Easier: the account manager sees only requests the owner stands behind; a partial yes is one step, not
a refusal and a second request.

Harder: a request has a new intermediate state (forwarded / declined by the owner), recorded as two
more `sla_events` types on the ADR-0088 d.5 pattern; the pending view reads it.

Locked in: the owner is always consulted; the client-facing date is still moved only by the account
manager's approval.

## Addendum — 25 Sep (Edward)

- The owner's note is **required** when forwarding.
- The owner is **told of every answer** the account manager gives to a request they forwarded.
- The owner step is skipped when the owner is the one asking (the ADR-0088 d.3 "asking oneself" principle).
