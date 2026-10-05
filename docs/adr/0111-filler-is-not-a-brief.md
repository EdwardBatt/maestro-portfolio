# ADR-0111: Filler is not a brief — release and campaign approval refuse placeholder text

- **Status:** accepted (Edward, 25 Sep — on `running-it`)
- **Date:** 2026-09-25
- **Open Decision:** none
- **Task(s):** `I59.27`
- **Amends:** ADR-0085 (the account manager releases a single job in one press) · campaign approval's field checks

## Context

Releasing a single job refuses **blank** required fields; "XYZ 123", "TBD" or "…" pass, and the owner
receives a brief nobody can work from. The v3 Figma (NY-AM-6) states the release rule as *"nothing
blank, nothing fake"*. Options weighed: refuse at release (chosen); warn and chase afterwards in Needs
you; no check. Edward, 25 Sep, chose to refuse.

## Decision

**d.1 — A required brief field is refused at release and at campaign approval when it holds only
filler**: XYZ, TBD, TBC, TBA, N/A, lorem ipsum, "…", "-", "x", "test", digits only, or one repeated
character — case-insensitive, trimmed.

**d.2 — The refusal names the field and its text**: *"Restrictions still says 'XYZ 123' — write the real
restriction."*

**d.3 — The list is extendable by admin**; the built-in words cannot be removed.

## Consequences

Easier: the owner never receives a fake brief; there is nothing to chase later.

Harder: one shared checker used by both the screen and the database gate, so they cannot disagree.

Locked in: releasing is the point where a brief must be real.

## Addendum — 25 Sep (Edward)

- **Every field that has text is checked**, not only the required ones; a blank optional field stays allowed.
  Text beginning "lorem ipsum" is filler.
- **"N/A" and a number on its own are real answers, not filler** (Edward, 25 Sep): the templates' own guidance
  asks for them (Budget, Audience — Secondary, Offer "…or N/A"; Average Order Value "a number"). Digits beside
  placeholder words ("XYZ 123") are still filler. Migration `20260926140000`.
