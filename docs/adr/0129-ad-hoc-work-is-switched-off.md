# ADR-0129: Ad-hoc work is switched off on the Schedule

- **Status:** accepted (Edward, 30 Sep) — records Edward's instruction of 29 Sep, already built and on production
- **Date:** 2026-09-30
- **Open Decision:** none
- **Completes:** ADR-0082 d.8 (ad-hoc creation from `/schedule` retired), which `I48.5` had deferred on 13 Sep; ADR-0082 d.9 (existing ad-hoc work untouched) stands
- **Task(s):** I66.10

## Context

ADR-0082 d.8 retired ad-hoc creation from the Schedule on 10 Sep: new work comes through one door, and a
single job behaves as a project. On 13 Sep Edward asked for the old path back until the new one had
proven itself (`I48.5`). Switching it off was to be his call, after testing, a merge and a week on
production.

On 29 Sep he made that call: *"Adhoc tasks is still available, we need to remove this option."*

By then the path was also doing damage. An ad-hoc task made a deliverable owned by its **assignee**, which
the lead-owner rule skips. Production held 67 ad-hoc deliverables owned by team members, the newest from
28 Sep.

## Decision

1. **The booking dialog no longer offers "Project task / Ad-hoc task" on a person.** It offers a task from
   a project only.
2. **A room or equipment booking keeps its free-text note**, now labelled *Note* (it was *Ad-hoc task
   description*).
3. **Existing ad-hoc deliverables are untouched** (ADR-0082 d.9). They stay on the Deliverables page's
   Ad-hoc tab. No migration rewrites them or their owners.
4. **`create_adhoc_deliverable` stays in the database**, reachable from nothing on screen. Removing it is
   a later clean-up, not part of this decision.

## Consequences

*Easier:* new work has one shape, and no new deliverable is owned by a team member.

*Harder:* a quick one-off job now needs a single job through the door (`Ctrl/Cmd + P`), not a booking.

*Locked in:* nothing irreversible. The function remains, and the choice could come back through a new ADR.

*Cost:* no migration. The browser specs were brought over (schedule-page, team-view L7, i-scheduling I3/I6,
section M's setup) and pass on a reset local database.
