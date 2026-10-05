# ADR-0112: Work is reviewed against its rules, and the maker answers each pin

- **Status:** accepted (Edward, 25 Sep — on `running-it`)
- **Date:** 2026-09-25
- **Open Decision:** none
- **Task(s):** `I59.29`
- **Amends:** ADR-0025 (internal review, versioning and anchored feedback) — who may resolve a pin

## Context

A pin (`review_feedback`) can be marked resolved only by its author or a `reviews:moderate` holder;
pins have no replies. The client's and the campaign's rules are shown only on the task-list approval
screen. The v3 Figma's maker screens (M2, M4) list the rules as ticks and give the maker **Mark done**
and **Reply** on each pin. Edward, 25 Sep: *"Why are rules presented as ticks? They are rules that need
to be followed"* — shown, not ticked — and the reviewer should see them too.

## Decision

**d.1 — The rules a piece follows are shown**, never ticked: on the maker's task page, on My Work
(the card chip and *Before you start*), and **beside the file on the review screen**.

**d.2 — The maker may mark a pin done** ("fixed in the next version") **and reply to it**; the reviewer
sees both on the next round and may **re-open** the pin, which returns it to the maker's list. Marking
done is not required to send the next version.

## Consequences

Easier: review happens against the rules the work must meet; feedback becomes a list the maker works
through and the reviewer checks.

Harder: pin replies need a parent link on `review_feedback` and its RLS; the resolve policy widens to
the task's assignee.

Locked in: the reviewer keeps the final word on every pin.
