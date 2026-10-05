# ADR-0108: Every clock runs in real time, and every escalation is a tenant setting of hours and recipients

- **Status:** accepted (Edward, 25 Sep — on `running-it`)
- **Date:** 2026-09-25
- **Open Decision:** none
- **Task(s):** `I59.24`
- **Amends:** ADR-0045 (work that stalls is chased, then escalated) d.2 — the rungs, their recipients, and working hours

## Context

ADR-0045 set one sweep (`stall-sweep`) with remind / escalate rungs. Built so far: one rung —
an opened **single job** with an unassigned task after `assignment_escalation_hours` (24) is escalated
to the role keyed `scheduler` (Traffic Manager) and the owner, counted in **working hours** from the
job's approval (`app.escalate_unassigned_jobs`, local only). Review reminders (`I14.7`) are unbuilt.
Recipients are hard-coded.

The v3 Figma shows clocks everywhere ("waiting 26 hours", "escalates in 4h", "until end of day").
Edward, 25 Sep: *"Both clocks in real time… Do not skip weekends and non working days. Most actions
being escalated take minutes to complete… there is no excuse to let something drag for 48 hours over a
weekend"*; *"No need for account manager to escalate… leave it at auto escalation"*; *"we should include
admin setting for escalations and who to escalate issues to."*

Recipient options weighed: named people (breaks when people change and cannot say "this piece's
owner"); roles only (cannot say it either); roles plus people relative to the piece (chosen).

## Decision

**d.1 — Every waiting and escalation clock counts real elapsed time**, weekends and closed days
included. This replaces working hours in the single-job rung.

**d.2 — Seven escalations, each with its hours and recipients as a tenant setting:**

| Stall | Clock starts | Default | Default recipients |
|---|---|---|---|
| Nobody assigned | job approved / task list approved | 24h | Traffic Manager, the owner |
| Task list or brief not approved | waiting on the owner | 24h | Traffic Manager, the account manager |
| Change request unanswered (ADR-0110) | sent | 8h | the owner's department lead, the account manager |
| Extension, owner's step (ADR-0109) | asked | 8h | the owner's department lead |
| Extension, AM's step | forwarded | 8h | Account Director |
| Blocked (ADR-0107) | raised | 24h | the owner, the account manager |
| Review | sent | remind 24h, escalate 48h | reviewers; the account manager, the owner |

**d.3 — Recipients are any roles plus people relative to the piece**: its owner, its account manager,
the owner's department lead, the assignee's team lead. Each gets a notification, an email, and the item
in their Needs you.

**d.4 — Campaigns escalate too.** "Nobody assigned" on a campaign piece starts when its task list is
approved (ADR-0100) — the moment assigning becomes possible.

**d.5 — There is no manual escalation.** Nobody presses "Escalate now"; the sweep alone escalates, once
per cause.

**d.6 — Overload tells the leads.** A person booked over N% for the week (a setting, default **110**)
puts an item in their team lead's, deputy's and department lead's Needs you until it drops.

## Consequences

Easier: one settings table answers "who hears about what, when"; the clocks on screen and the sweep use
the same arithmetic.

Harder: the sweep grows from one rung to seven plus the overload check, each idempotent by its own
stamp (ADR-0045 d.1). Resolving "the owner's department lead" needs the department's lead-scoped
users; where none exists the row falls back to its role recipients.

Locked in: real time everywhere; recipients are data, not code; no human shortcut to escalation.

## Addendum — 25 Sep (Edward)

- Row "task list or brief" splits in two: **task list not approved** (waits on the owner → Traffic Manager, the
  account manager) and **campaign / brief not approved** (waits on the account manager → Traffic Manager, the
  Account Director). 24h each.
- **An escalation that resolves to nobody goes to the Traffic Manager**, and the admin setting shows it as
  "reaches nobody" so the gap is fixed at its source.
- A single job's "nobody assigned" clock, like a campaign's, starts when its task list is approved.
