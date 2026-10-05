# ADR-0045: Work that stalls is chased, then escalated

- **Status:** accepted (Edward, 27 Aug — defaults set to 24/48 and made editable in the UI)
- **Date:** 2026-08-26
- **Open Decision:** — (specified by Edward, 26 Aug)
- **Task(s):** I14.7 (new); closes the `due_soon` deferral from `I5.1`; relates to ADR-0043
  (mandatory reviewers), ADR-0026/0028 (inbox + email), ADR-0023 (`archive-sweep`, the pattern used
  here)

## Context

Every stall in this system is currently silent. Nothing reminds anybody of anything.

- **Review.** A submitted task sits in `review` until a reviewer acts. ADR-0043 makes this sharper by
  allowing several **mandatory** reviewers: the work is blocked by whoever has not looked, and
  removing them is the only lever.
- **Deadlines.** `due_soon` is a valid notification type that **nothing ever emits**. It was deferred
  at `I5.1` — *"deferred with its scheduled sweep (no `pg_cron` yet)"* — and never returned to.

Edward, 26 Aug: *"reminders need to be sent and escalated when necessary."*

### The blocker was not real

`I5.1` recorded "no `pg_cron` yet", and I repeated that as "this project has no scheduler". **That is
wrong, and checking the code says so.** `supabase/functions/archive-sweep/` is a scheduled sweep
running in production today: *"Invoked on a schedule (Supabase scheduled function / external cron),
NOT by end users. There is no user JWT; the caller proves itself with a shared `CRON_SECRET`
header."* It uses the service-role client for cross-tenant system work, authorises on the shared
secret before touching anything, and is **idempotent by construction** — its due-set query cannot
return an already-processed row, so a retried or overlapping run cannot double-act.

So the pattern is settled by precedent. What was missing was the work, not the decision.

### The forces

**Reminders become noise faster than any other notification.** A nudge that arrives too often, or
about something the recipient cannot act on, trains people to ignore the inbox — and that inbox also
carries `changes_requested` and `signed_off`, which they must not ignore. Whatever is built has to be
quiet by default.

**Escalation is a judgement about people, not a technical fan-out.** Telling somebody's manager that
they are late is a real act. It should happen when work is genuinely stuck, to a person who can
actually unstick it, and it must be visible to the person being escalated — not behind their back.

**There is already a rule for who hears about stuck work.** ADR-0042 d.6 sends a resource clash to
**the assigner and the account manager**: the person who arranged the work and the person who owns
the client relationship. A second, different ladder would be a contradiction to maintain.

## Decision

1. **One sweep, one function.** A new `supabase/functions/stall-sweep/` on exactly the
   `archive-sweep` pattern: cron-invoked, `CRON_SECRET` header, service-role, no user JWT,
   **idempotent by construction**. It handles review reminders, escalation and `due_soon` in one
   pass, because they share a due-set query shape and three cron entries would be three things to
   forget.

2. **Two rungs, per tenant, set by the tenant.**
   - **Remind** at `review_reminder_hours` (default **24**) — the outstanding reviewers, and only
     them.
   - **Escalate** at `review_escalation_hours` (default **48**) — the **assigner and the account
     manager**, the ADR-0042 d.6 recipients, **plus the reviewer again**. Nobody is escalated behind
     their back.

   Hours are **working hours on the reviewer's office calendar** (ADR-0005), not wall-clock. A task
   submitted at 4pm Thursday in Baghdad has not been sitting for a day by Friday morning; treating it
   as though it had is how a reminder system loses its credibility in week one.

   **24 and 48 are a starting point, not the decision.** The decision is d.3: the numbers belong to
   the tenant, not to us.

3. **The thresholds are edited in the UI, not in a migration.** A new `tenant_reminder_settings` —
   one row per tenant, typed columns with defaults, on exactly the `tenant_storage_settings` shape
   that already exists (`tenant_id` primary key, one-to-one FK to `tenants`). Held as **columns, not
   in `tenants.settings jsonb`**: these are numbers something reads on a schedule, and a typed column
   with a CHECK is the difference between a bad value being refused and a sweep silently doing
   nothing at 3am.

   Edited on a new **Admin → Reminders** screen behind `organization:manage`, with three fields —
   remind after, escalate after, due-soon warning — each in **working hours**, said so on screen,
   with the office-calendar caveat stated rather than left to be discovered. Escalation must be
   greater than remind, refused on save if not. A tenant that has never opened the screen has no row
   and gets the defaults; saving upserts one.

   **This is the project's first tenant-settings screen.** `tenant_storage_settings` has existed
   since ADR-0023 with no UI at all and is configured by migration today. That is the honest cost of
   this decision and the reason it is a numbered decision rather than a note: the screen is real work,
   and building it here sets the pattern the storage settings should eventually follow.

4. **Each rung fires once per round.** `sub_task_reviewers` carries `reminded_at` and
   `escalated_at`. A round is a submission: request-changes clears both, exactly as ADR-0043 d.6
   clears approvals, because the next round is a new ask. This is what makes the sweep idempotent —
   the due-set is "outstanding, past threshold, not yet stamped for this rung".

5. **A reviewer who has approved is never chased.** The unit is the *reviewer's outstanding
   approval*, not the task. With three mandatory reviewers and two done, exactly one person is
   reminded.

6. **`due_soon` is emitted by the same sweep**, closing the `I5.1` deferral: a task whose `due_at` is
   inside `due_soon_hours` (default **24** working hours) and which is not `done`/`cancelled`
   notifies its assignee, once. It rides the existing type and locale key.

7. **Reminders are in-app only. Escalations also email.** ADR-0028 made email a deliberately
   high-signal slow lane and excluded `due_soon` from it; a daily nudge does not belong there. An
   escalation does — it is the point at which somebody outside the work needs to know.

8. **Nothing is auto-resolved.** The sweep never reassigns a reviewer, never drops a mandatory flag,
   never moves a date. It reports. This is ADR-0042 d.6 again — *"conflict raised, discussed and
   resolved"* — and for the same reason: the system cannot see the conversation that explains why
   something is late.

9. **Two new notification types**, `review_overdue` and `review_escalated`, rather than reusing
   `due_soon`. The inbox renders copy from `type` (ADR-0026), and three different situations sharing
   one string is how a notification stops being read. Both link to the task.

## Consequences

**Easier.** A stalled review surfaces without anybody noticing it by chance. `due_soon` finally
works, having been dead since it was defined. The sweep is one place to add the next scheduled
concern, rather than each one re-deciding how it runs.

**Harder.** A cron entry is now load-bearing for something users feel — if the scheduler stops,
reminders stop silently. It needs a heartbeat check in the runbook, which `archive-sweep` also lacks
today. Working-hour arithmetic across three office calendars is more than it sounds, though the
capacity engine already does exactly this and is unit-tested.

**A new way to annoy people.** Two rungs at 24 and 48 working hours is a starting point, and it will
be wrong for somebody. That is exactly why d.3 puts the numbers on a screen rather than in a
migration: being wrong is expected, and the fix must not require a developer. The honest test is
whether anybody changes them in the first month — and whether anybody turns them off in the
second.

**Locked in.** Escalation goes to the assigner and the account manager — the same pair as a resource
clash. The person being escalated is always told at the same moment. Nothing is auto-resolved. A
reminder is per outstanding reviewer, not per task.

**Cost.** No dependency, no service, no licence. One Edge Function, one new settings table, one new
admin screen, two columns on `sub_task_reviewers`, two notification types, and a cron entry Edward
wires at deploy time — the same operation `archive-sweep` already needed. The screen is the biggest
single piece and is new ground: nothing tenant-configurable has had a UI before.

**Testing.** pgTAP: the due-set query returns only outstanding, past-threshold, unstamped rows;
running the sweep twice notifies once; request-changes clears both stamps so the next round chases
again; an approved reviewer is not chased; a `done` task is not chased. Unit: the working-hours
threshold against the three office calendars, including a Thursday-evening submission in Baghdad and
a DST boundary. Edge Function: a wrong or missing `CRON_SECRET` is refused before anything is read.
Settings: a tenant with no row gets the defaults; an escalation threshold below the reminder
threshold is refused on save; a saved change is what the next sweep reads. RLS: a user without
`organization:manage` can neither read another tenant's row nor write their own.
