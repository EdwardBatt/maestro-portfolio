# ADR-0135: A job or campaign name that differs from another only by capitals or spaces is taken

- **Status:** accepted (Edward, 1 Oct) — records Edward's answers of 1 Oct
- **Date:** 2026-10-01
- **Open Decision:** none
- **Amends:** the exact-match rule `uq_campaigns_tenant_name` (`20260728110400`); sits beside ADR-0086's similarity
  prompt, which is unchanged
- **Task(s):** I72

## Context

The live Library holds two project folders for one job: *"Borderless card"* and *"Borderless Card"* (Figma LB-01 and
LB-NOTES item 06, tested 28 Sep). Every job and campaign gets its own folder, named after it (ADR-0022, `20260922140000`).

Maestro already refuses a second campaign or job with **exactly** the same name anywhere in the company
(`uq_campaigns_tenant_name unique (tenant_id, name)`). A capital letter or a trailing space gets past it. ADR-0086's
similarity check asks — never refuses — when a job is approved and looks like an open one.

Edward, 1 Oct: *"the system should not allow duplicate job names or campaign names to start with"*. Then:

| Question | Chosen | Rejected |
|---|---|---|
| What counts as the same name | **A**: ignore capitals and extra spaces | B, also near-misses ("card" / "cards") — would refuse "Ramadan post 1" beside "Ramadan post 2" |
| The look-alikes already live | **A**: listed by a check Edward runs; the duplicates are closed first, then the rule goes on | B, rename the newer "(2)" automatically |

## Decision

1. **A name is taken when it matches another job or campaign in the company ignoring capitals, and ignoring leading,
   trailing and repeated spaces.** The second is refused with the existing *"A campaign with this name already exists"*
   message, in the wizard and the single-job flow alike.
2. Enforced in the database: a unique index on the normalised name per tenant replaces the exact-match constraint.
3. **The live look-alikes are cleared first.** A read-only SQL check lists every pair on production; Edward or the
   account managers close the duplicates (their files move to the job that stays, ADR-0134 d.21). The migration that
   adds the index is pushed only after the check returns nothing, and it refuses to apply while a pair remains.
4. ADR-0086's similarity prompt is unchanged: near-misses are still asked about, never refused.

## Consequences

**Easier:** one job, one folder; nobody creates a second job "to be safe" by changing a capital.

**Harder:** the push waits on clearing the live pairs — a manual step for Edward. Names stay company-wide unique, so two
clients cannot both have a "Ramadan 2027" campaign, as today.

**Locked in:** capitals and spacing never distinguish two jobs or campaigns.
