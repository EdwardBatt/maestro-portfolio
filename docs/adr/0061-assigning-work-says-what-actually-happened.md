# ADR-0061: Assigning work says what actually happened

- **Status:** accepted
- **Date:** 2026-08-30
- **Open Decision:** — (found by Edward, 30 Aug, investigating five duplicate ad-hoc tasks)
- **Task(s):** **I29** (new). Amends ADR-0024 (the auto-spread), ADR-0029 (booking-based assignment), ADR-0011 (an internal user is a bookable resource).
- **Depends on:** ADR-0006 (warn, never block), ADR-0035 (ad-hoc work is reviewable), ADR-0039/0042 (a task owns its dates), ADR-0060 (booking a campaign task is assigning it).

## Context

One ad-hoc task, **Al Waha KV**, existed five times on `/deliverables` and appeared on
`/schedule` on two days. Edward asked why. The answer took four queries and turned up **five
separate defects**, all of one family: *the system was confident and quiet about work it had not
actually scheduled.*

### The evidence

| Created | Task status | Bookings |
|---|---|---|
| 11:28:06 | todo | **0** |
| 11:28:10 | todo | **0** |
| 11:30:36 | todo | **0** |
| 11:42:01 | cancelled | 0 |
| 11:42:02 | todo | 1 |

All five identical: same person, same day (**Sunday 30 August 2026**), same eight hours, same
resource, same office. And the audit log gives the reason:

```
11:37:42  offices  update  working_days → [1,2,3,4,7]
```

Dubai's working week did not include Sunday until 11:37. Three attempts before that booked nothing;
the attempt after it booked immediately. **Nothing about the task ever changed. The office did.**

### 1. The scheduler's answer is thrown away

`subtask-schedule` returns **HTTP 200** with `{ scheduled: 0, released: true, reason:
'no_working_days_in_range' }`. Every caller does this:

```ts
try { await invokeFn('subtask-schedule', { subTaskId }) }
catch (e) { scheduleWarning = (e as FnError).message }
```

A 200 does not throw. The body — which says plainly that nothing was scheduled and why — is
discarded, and the dialog reports success. **The function is honest and nobody reads it.**

There are **five** such returns, not one: `overridden`, `not_schedulable`,
`assignee_no_active_resource`, `assignee_no_office`, `no_working_days_in_range`. All five produce a
task with no booking and a success message.

### 2. "Proceed anyway" is a promise the assignment path cannot keep

The dialog warns that a day is non-working and offers **proceed anyway**. That bypasses the
client-side gate — and then `spreadHours` filters to the office's working days, finds none, and
places nothing. There is no override on that path. Not a stricter one; none.

**This is narrower than it first looked, and the narrowness is the point.** `subtask-schedule` never
consults leave or blackouts at all — the words do not appear in it — and capacity is a warning.
Booking a **leave-blocked** person works, which is exactly what Edward reported doing. The office
working week is the *single* condition where assignment silently refuses. So this is not a competing
philosophy, it is one filter nobody revisited.

Edward, 30 Aug: *"the entire concept of this system design is 'nothing blocks' … anyone, not just
the scheduler, who has the permissions can book a resource on a non-working day."*

### 3. Nothing stops a second submit while the first is in flight

`BusyButton` disables itself when `busy` is true, and on this dialog `busy` is wired to
`create.isPending` — the **plain booking** mutation. Ad-hoc work on a person uses
`createAdhoc`; ADR-0060's Project mode uses `upsertSubTask`/`updateTask`. None of them reaches the
button.

So during the two round trips of an assignment the button neither spins nor disables. Two of the
five duplicates are **4.2 seconds** and **1.4 seconds** apart — nobody fills a form twice in four
seconds. This is the failure `BusyButton`'s own docstring says it exists to prevent, and the same
one recorded in that dialog's comments from 23 Aug. The guard added then covers only the
*scheduling-failed retry*, not the in-flight window.

### 4. Moving somebody's work does not tell them

Drag a task's booking from Wednesday to Friday: the booking moves, the task's dates recompute to
the envelope of the assignee's bookings, `schedule_overridden` flips. **No notification.** Twice
over:

* `booking_notify_resource` fires `on update of resource_id` — changing the day does not touch it;
* and its first line exits for any booking carrying a `sub_task_id`, deliberately, because *"sub-task
  bookings ride the sub-task notification"* — which fires on `assignee_id`, which did not change.

**And there is no notification type for it.** The permitted list is `assigned`, `review_requested`,
`changes_requested`, `signed_off`, `blocked`, `due_soon`, `dependency_ready`, `cancelled`. So this
is not a missed trigger; the concept does not exist. Move somebody's work to another **day** and
they are not told; move it to another **person** and they are.

### 5. A person can be given work they can never be scheduled for

Assignment and scheduling look at different tables. Every person-picker reads `useAssignableUsers`,
which selects `user_profiles` with **no filter at all** — not the resource, not even the user's own
active flag. Scheduling then looks for that person's active `resources` row, finds none, and returns
`assignee_no_active_resource` — silently, per defect 1.

Edward, 30 Aug: *"IF I SAY THEY DO NOT APPEAR AS A CHOICE ON /SCHEDULE THIS MEANS THEY CANNOT BE
SELECTED OR ASSIGNED TO A TASK … AS A RESOURCE OR AS A USER."*

The switch already exists — `resources.is_active`, with an armed two-click toggle on Admin →
Resources — and `/schedule` already honours it. It is labelled **Active**, which does not say what
it controls, and **nothing else honours it**.

### 6. A resource with no user behind it, and a switch that cannot reach it

Edward deactivated a user, hard-reloaded, and they were still on `/schedule`. The data says why:

```
resources: name 'Adnan Tawfiq', kind human, user_id NULL, is_active true
```

**The resource is not linked to the login.** Deactivating a user does three things — bans the auth
account, marks the profile inactive, and switches off `resources where user_id = <them>`. That last
update matched **zero rows**, silently, so the resource stayed active and on the grid.

There are two faults here, not one:

* **An unlinked human resource belongs to nobody.** It can be booked, and there is no user behind
  it — so no assignee, no notification, no My Work. Work placed on it is work nobody was given. The
  system already knows these exist: the admin API has an "unlinked resources" list querying exactly
  `user_id is null`. Nothing tells anybody about them.
* **A cascade that matches nothing says nothing.** The person who deactivated the user was told it
  worked, and by every measure they could see it had.

This is the same defect as the other five wearing different clothes: an operation reported success
while doing part of what it said.

### What they have in common

Each is a place where the system knows something the person needed to hear and does not say it: the
booking that was not made, the day that could not be used, the click that was counted twice, the
work that moved, the person who could never be scheduled, the switch that reached nothing. **This
ADR is one decision — say it — in six places.**

## Options weighed

**A. Fix each surface.** Rejected. The client-side ones would be five separate patches to the same
mistake, and the sixth caller would repeat it.

**B. Make `subtask-schedule` return a non-2xx when it places nothing.** Rejected, and this is the
tempting one. `scheduled: 0` is often **correct** — an unassigned task, or a hand-overridden
schedule, should place nothing and is not an error. Turning a legitimate outcome into an exception
means every caller has to catch and then re-classify it, which is the same reading problem moved
somewhere worse.

**C. Read the body; treat the reasons by name.** ✅ Chosen. The function already distinguishes the
five cases. The caller decides which are ordinary and which need saying.

**D. Persist a "book on non-working days" flag on the task.** Rejected as machinery for nothing. The
same outcome falls out of a smaller rule (d.2): spread across working days when there ARE any, and
across calendar days when there are none. No flag, no plumbing, no second thing to keep in step —
and no risk of a later re-spread silently undoing an override that was not persisted.

## Decision

1. **The scheduler's answer is read.** Every caller of `subtask-schedule` inspects the response
   body, not merely whether the call threw. `scheduled: 0` is **never** reported as success. The
   five reasons are handled by name:

   | Reason | Meaning | Surface |
   |---|---|---|
   | `overridden` | somebody arranged this by hand | silent — deliberate |
   | `not_schedulable` | no assignee, hours or dates, or already settled | silent — ordinary for unassigned work |
   | `no_working_days_in_range` | (removed by d.2) | — |
   | `assignee_no_active_resource` | that person has no bookable calendar | **said, by name** |
   | `assignee_no_office` | their resource has no working week | **said, by name** |

   The last two become unreachable through the UI under d.5, and are surfaced anyway: unreachable is
   not the same as impossible, and a task that will never appear on a calendar must not be created
   quietly.

2. **Nothing blocks — including the working week.** `spreadHours` keeps its behaviour whenever the
   span contains working days: a Monday-to-Sunday task still places Monday to Friday, and no weekend
   is booked by accident. **When the span contains NO working day, it spreads across the calendar
   days instead of placing nothing.** A person who deliberately picks a Sunday gets the Sunday.
   `no_working_days_in_range` stops existing.

   This is the smallest rule that honours ADR-0006, and it needs no override to travel from the
   dialog to the scheduler — which is what makes it safe. The client-side warning is unchanged: the
   day is still flagged, "proceed anyway" is still a deliberate act, and now it does what it says.

3. **The submit button reflects the work actually in flight.** `busy` covers every mutation the
   branch can start — `createAdhoc`, `upsertSubTask`, `updateTask` and `create` — so the button
   spins and is disabled for all of them. Two of the five duplicates were four seconds and 1.4
   seconds apart; this is what closes that window.

4. **Moving work tells the person.** A new notification type, `rescheduled`, sent to a task's
   assignee when its bookings move to different days, with the actor excluded — nobody is notified
   of their own drag. Reassignment to a different person keeps its existing `assigned` notification
   and is unchanged; this fills the gap beside it, and does not double up, because the two paths are
   distinguished by whether `assignee_id` moved.

5. **Bookable, and it means one thing everywhere.** `resources.is_active` is relabelled **Bookable /
   Not bookable** on Admin → Resources. The column is NOT renamed: it is read by the schedule, the
   scheduler and the admin API, and a migration to change a name only developers see is cost without
   benefit. What changes is that the flag is finally honoured everywhere a person can be chosen:

   * **One query.** `useAssignableUsers` returns only people with an active human resource. It is
     the single source for every person-picker in the app — the Deliverables assignee list, the
     Brief Wizard owner picker and the booking dialog — so one change fixes all three. `/schedule`
     already filters this way.
   * **One guard.** `public.save_sub_task` and `public.update_task_assignment` refuse to assign work
     to somebody with no active resource, so a stale page cannot walk around the filter.
   * **Nothing existing breaks.** The guard applies to **new** assignments only. Anybody already
     holding work keeps it, their bookings stay, and their task can still be retitled, re-dated and
     completed. Turning someone off stops them being *chosen*; it does not tear up what they are
     already doing.

   **Deactivating hides a person's existing bookings without cancelling them**, because the grid
   filters the resource row out entirely. That is true today and this ADR does not change it — it is
   recorded because "not bookable" sounds harmless and that part is not.

6. **An ad-hoc deliverable follows its task when it is cancelled.** Cancelling the task left the
   deliverable at `in_progress`, so an abandoned attempt sat in the Live list looking exactly like
   real work — which is most of why five rows read as clutter rather than as a bug. Ad-hoc
   deliverable state already follows task approval (`20260825120000`); this applies the same rule to
   the other end. **Campaign deliverables are untouched**: they hold many tasks, and one being
   cancelled says nothing about the rest.

7. **A cascade that reaches nothing says so.** Deactivating a user reports how many resources it
   switched off. Zero, on a person who has one on screen, is the fact that was missing — and it is
   reported rather than refused, because a user with no resource is perfectly legitimate (an account
   manager who books nobody's time is not a bookable resource).

8. **Unlinked human resources are surfaced, not silently bookable.** Admin → Resources marks a human
   resource with no `user_id` as **unlinked**, and says what that means: it can be booked, but no
   notification, no My Work, and no user-level switch reaches it. The list already exists in the
   admin API; nothing rendered it. **Not auto-linked by name** — guessing that "Adnan Tawfiq" the
   resource is "Adnan Tawfiq" the login is the kind of inference that pairs the wrong two people
   the first time two names collide.

9. **Duplicates are not deduplicated.** No unique constraint on ad-hoc titles, no "you already
   created this" check. Two tasks with the same name for the same person on the same day is a
   legitimate thing to want, and the fix for accidental duplicates is d.3 — stop counting the second
   click — not a rule that refuses the deliberate case. **The five existing rows are left alone**;
   tidying live data is Edward's call, not a migration's.

10. **A deactivated person cannot be APPOINTED a reviewer either.** The picker already hid them —
    `public.users_holding_permission` filters `up.is_active`. Nothing refused them: the write guard
    asks `app.user_holds_permission`, which reads role grants and per-user overlays and has never
    looked at whether the account is live. Hidden is not enforced, and a stale page could still
    write one in. The check goes in beside the existing eligibility rules, **on INSERT only**, for
    the reason those rules already record: re-checking on UPDATE let a reviewer who later lost their
    standing strand their own task, because clearing approvals is an UPDATE of those rows.

11. **An appointment made before somebody was deactivated survives, and is shown.** Deleting it
    would silently drop a reviewer from work in progress — the class of quiet change this ADR exists
    to stop. So `WaitingOn` marks a deactivated reviewer wherever outstanding reviewers are already
    named: the assignee's My Work row, the Deliverables table, the reviewer's own inbox.

    **The mandatory case is why this is not cosmetic.** `app.maybe_complete_sub_task` waits for
    EVERY mandatory reviewer, so a deactivated one means the task can never complete — an approval
    owed by an account that cannot sign in. Without the marker that reads as a colleague who is
    simply slow, and the task sits until somebody goes looking. The two marks show together, and the
    tooltip says which situation it is.

    **Not auto-reassigned.** Who should review a piece of work is a judgement, and picking a
    replacement by role or department would put a name against somebody's work without asking them.

## Consequences

**Easier.** A person who assigns work learns whether it landed. A Sunday booking books on Sunday. A
double-click is one task. Somebody whose week is rearranged hears about it. And a person who cannot
be scheduled cannot be handed work in the first place, which removes the cause of two of the five
silent reasons rather than reporting them better.

**Harder.** Every `subtask-schedule` caller now has a response to interpret rather than a promise to
ignore, and a sixth caller must remember to. `spreadHours` gains a second mode, and its tests double
— the no-working-days case is now a behaviour rather than an empty result.

**Locked in.** `resources.is_active` becomes the one answer to "can this person be given work?".
That is the intent — one flag, one meaning — but it does couple assignability to having a resource
row, so a person who should be assignable and is not bookable has no representation. No such case
exists today (ADR-0011 gives every internal user a resource) and one would need its own decision.

**Not decided here.** Whether the five existing Al Waha rows are tidied; whether a person
should be notified when their work moves by less than a day; whether `assignee_no_office` should be
prevented at the office level rather than caught at scheduling. None blocks this.

**Cost.** One migration (the two assignment RPCs re-emitted with the bookable guard, the ad-hoc
cancel rule, the new notification type and its trigger), one Edge Function change, one shared query
narrowed, the busy wiring on one dialog, a label, EN and AR strings. No new table, no dependency,
no money.

## Testing

- **pgTAP:** assignment to somebody with no active resource is refused; a human resource with a null
  `user_id` is not reachable as an assignee at all; a deactivated person cannot be APPOINTED a
  reviewer, while an appointment made before they were deactivated survives untouched; assignment to somebody with
  one succeeds; a task ALREADY assigned to a now-unbookable person can still be retitled, re-dated
  and completed; cancelling an ad-hoc deliverable's only task settles the deliverable while a
  campaign deliverable with a cancelled task is untouched; moving a booking to another day writes a
  `rescheduled` notification to the assignee and none to the actor; reassignment still writes
  exactly one `assigned` notification and not two.
- **Unit:** `spreadHours` places on working days when the span has them, on calendar days when it
  has none, and never on a non-working day that had a working alternative; a `scheduled: 0` response
  is not reported as success, and each reason maps to the right surface; the submit button is
  disabled while any of the four mutations is in flight; `useAssignableUsers` excludes people with
  no active resource; deactivating a user that touched no resource says so; an unlinked human
  resource is marked as such on Admin → Resources; `WaitingOn` marks a deactivated reviewer, marks
  a mandatory one differently, and says nothing about one who already approved (they are not
  outstanding, and their verdict stands).
- **Regression:** every existing ad-hoc and Project-mode assertion passes unmodified, including
  ADR-0060's — this changes what callers do with the answer, not what assignment writes.
