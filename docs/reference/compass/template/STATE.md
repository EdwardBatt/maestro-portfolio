---
type: state
status: current
origin: ai-derived
verified: 2026-09-08
sources: [<tracker>, git log, src/]
---

# Current state

What is actually built, as of **<date>**. <Your tracker> is authoritative and carries the detail;
this is the fast answer to "does this exist yet?".

**Do not assume something works because code for it exists.**

## Working — exercised by real users

<A paragraph, not a list of tickets. What a person can actually do today.>

## Partially built

| Area | Built | Missing |
|---|---|---|
| | | |

## Not built — code referencing these is shape only

<…>

## Confirmed problems

<Things known broken, with how they were confirmed.>

## Suspected — not re-verified

<Carried from an older audit. Say so rather than presenting it as current.>

## Waiting on <the person who decides>

Open decisions, each with what it is holding up. `/compass-close` maintains this list — clear
anything answered, add anything new.

| Waiting on | Holding up |
|---|---|
| | |

## In flight right now

**The most perishable thing in this file.** It is true on the `verified:` date above and can be wrong
the next morning — a branch merges, a migration is pushed. **Check `git log` before relying on any of
it**, and correct this section when you do.

- <what is half-done, and where the next session should start>
