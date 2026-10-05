# ADR-0042: Sub-task resources — the assets a task needs, held on the task

- **Status:** accepted (Edward, 2026-08-26)
- **Date:** 2026-08-25
- **Open Decision:** — (specified by Edward, 25 Aug, during the pre-UAT review)
- **Amended by:** ADR-0094 (d.3) — a task's required room or kit is booked only if free; a clash is no longer booked over but becomes a request the scheduler chooses the kind of (amends d.4 and d.6)
- **Amends:** ADR-0039 (Decision 5 narrows the span rule: a task's dates come from the assignee's bookings only)
- **Task(s):** I13.1 (new); relates to ADR-0006 (bookings), ADR-0029 (assignment = the booking),
  ADR-0035 (ad-hoc work), ADR-0039 (the task owns its dates), ADR-0040 (assignment authority)

## Context

The system allocates and tracks **resources** — `kind` is `human | equipment | room` — and a booking
is always a booking *of a resource*. That half works and has since 28 July.

What is missing is the other direction. **A task needs assets**: task A requires a camera. Edward,
25 Aug: *"resources cannot be assigned a task… but subtle difference they can be assigned **to** a
task."*

### What the code does today

The requirement is expressible **by accident** and then destroyed:

- A `bookings` row carries both `resource_id` and `sub_task_id`, and nothing constrains that resource
  to be human. So booking the camera and pointing it at task A is the only way to say it today.
- **There is no model for it.** No table, no column — searched every migration. The fact exists only
  as a side effect of a calendar entry existing; delete the entry and the requirement is gone.
- **`subtask-schedule` deletes it.** `delete from bookings where sub_task_id = <task>` releases
  *every* booking on the task, whatever resource it sits on, then re-creates only on the assignee's
  own resource (`supabase/functions/subtask-schedule/index.ts:81`, `:119`). So the camera booking is
  silently wiped on any reassignment, date change or hours change — exactly the operations the
  scheduling flow performs.
- **It corrupts the task's dates.** `app.sync_subtask_span` takes `min(starts_at), max(ends_at)`
  across *all* the task's bookings (`20260824130000:37-40`), so a camera booked outside the
  assignee's days drags the task's span with it.

### The constraint that shapes the answer

`excl_bookings_confirmed_exclusive_overlap` (`20260728110500:56-58`) is a hard Postgres exclusion:
**confirmed + exclusive ⇒ no overlap on a resource.** `is_exclusive` is derived by trigger from the
resource's `capacity_model`. Humans are always `load_based` by CHECK constraint, so a person's
bookings never trip it — capacity is accumulated load with a warn threshold and a ceiling. Equipment
and rooms may be `exclusive`.

`subtask-schedule` materialises bookings as **`confirmed`** (`index.ts:123`). So without a decision
here, the first double-booked camera would be **refused by the database** — and Edward has specified
the opposite: *"conflicts should be raised to traffic manager or account manager."*

### Where it is edited, and where it is not

The client's brief captures **deliverables only** — name, discipline, quantity, load (brief wizard
step 3). Which assets we use to produce them is internal. Requirements are therefore edited on
`/deliverables` (gated `project_tasks:manage`; the Client Portal role holds only `portal:view` and
cannot reach it), never in the brief.

### The destination

Edward: *"ultimately I want to get to the point that all of the tasks and resources required are held
in predefined templates and they insert time allocation only."* `work_types` already carries
`default_load_pct`, `lead_time_hours`, `sla_profile_id` and `revision_limit` — the natural anchor. A
template is not built here, but the shape below must be one a template can populate without being
reworked.

### Options weighed

- **A — keep using bookings as the record, and teach the scheduler not to delete other resources'
  rows.** Cheapest. Rejected: the requirement still lives only in a calendar entry, so it cannot be
  templated, cannot be stated before the task is scheduled, and is lost the moment someone cancels
  the booking. It also leaves the span corruption untouched.
- **B — a requirement list on the deliverable rather than the task.** Rejected: the camera is needed
  *for the shoot*, not for the deliverable as a whole; a five-task deliverable would have to
  apportion one list across tasks, which is the same problem moved.
- **C — model the requirement on the task (chosen).** The requirement becomes a property of the work,
  independent of any calendar entry. Templates populate it, the scheduler materialises from it, and
  releasing bookings stops destroying it.

## Decision

1. **New table `sub_task_resources`** — the resources a task needs. `tenant_id`, `sub_task_id` (FK,
   cascade), `resource_id` (FK), `days` (integer, ≥1), optional `starts_on` (date), `notes`, plus the
   standard audit/`updated_at` triggers. Unique on `(sub_task_id, resource_id)`. RLS enabled **and**
   forced in the same migration, writes gated `project_tasks:manage` + the task's write scope —
   the same authority that edits the task itself.

   **Every resource has its own id, so Camera A and Camera B are different rows** (Edward, 25 Aug).
   There is no type-and-quantity concept: a task needing two cameras names two cameras. A task may
   list as many resources as it needs.

   **A resource may be a person** (Edward, 25 Aug) — "task A also needs Sara for two days" is a
   legitimate requirement and gets the same conflict detection as any asset (d.6). This does not
   divide accountability: `sub_tasks.assignee_id` is a single column, so the task has exactly one
   owner and a required person is additional resource on it, not a second assignee.

2. **A task with no requirements is the normal case.** No row means no asset needed, and such a task
   behaves exactly as it does today. Nothing about this decision changes an existing task.

3. **An asset is booked for its own HOURS, not the task's span.** `hours` is the total the asset is
   needed for; `starts_on` pins it to a specific date, and when null the scheduler places it on the
   task's first day. Hours fill consecutive working days up to a standard day each: 3h is one short
   booking, 16h is two full days, 20h is 8 + 8 + 4.

   *Amended by Edward, 26 Aug 2026: originally `days`.* Days were wrong twice over. Practically, a
   camera wanted for three hours blocked the whole day and the grid reported the studio as
   unavailable when it was free from lunchtime — the schedule lying about availability. And it
   contradicted ADR-0006, already accepted: *"hours are the booking vocabulary; load % is derived,
   never asked."* Every other unit of effort here is hours — `sub_tasks.sla_hours` is a total spread
   across working days — and this was the only place that broke the vocabulary.

4. **The scheduler materialises both sets together.** `subtask-schedule` releases and rebuilds the
   assignee's bookings **and** one run per required resource in the same pass. It may keep deleting
   by `sub_task_id`, because the requirement now survives in its own table — that is the point of
   modelling it.

5. **The task's span comes from the assignee's bookings only.** `app.sync_subtask_span` is narrowed
   to bookings on the assignee's resource, so an asset booked outside those days can no longer move
   or stretch the task's dates.

6. **A clash raises; it does not block, and it never moves a date by itself.** Every required
   resource is booked; what "clash" means depends on the resource's capacity model, and both shapes
   raise the same way:

   | Resource | Clash is | What happens |
   | --- | --- | --- |
   | **Exclusive** (a camera, an edit suite) | the exclusion constraint refuses an overlapping confirmed booking (`23P01`) | the booking is written `tentative` instead, and an **exception** is raised |
   | **Load-based** (every person, by CHECK constraint) | the day's accumulated load crosses the resource's warn/ceiling thresholds | the booking is written `confirmed` — it does not fail — and an **exception** is raised |

   A person can never trip the exclusion constraint (`chk_resources_human_load` forces every human to
   `load_based`), so "same conflict detection" for a required person means the capacity check the
   booking engine already performs, not the constraint. Exceptions from either shape go to the
   Traffic Manager and Account Manager. **Assignment itself always succeeds**: a contested camera or
   an overloaded colleague must never silently prevent work being assigned, and must never be
   silently dropped either.

   Edward, 25 Aug, on why the system must not resolve this for itself: *"we can make the conscious
   decision to move the task manually — which is the right thing to do. Conflict raised, discussed
   and resolved."* Rescheduling committed work is a decision with consequences outside this system —
   a client expectation, another team's dependency — and the scheduler has none of that context. So
   it reports the clash accurately and leaves the judgement to the people who do. This is the same
   principle as ADR-0040's refusal-over-half-success and ADR-0039 d.3's "an unscheduled task is not a
   task with no deadline": the system declines to invent an answer rather than quietly producing a
   wrong one.

7. **Requirements are edited at task level, on `/deliverables` AND on the `/schedule` booking
   modal.** Never in the brief wizard — what the client asks for and what it takes to make it are
   different questions, and the client sees neither the assets nor their cost.

   *Amended by Edward, 26 Aug 2026: originally `/deliverables` only.* The schedule modal is where
   work is actually assigned, and it is where somebody has the camera in mind — planning the task
   and stating what it needs are the same moment of thought. `/deliverables` remains the
   task-management surface and keeps the fuller editor; the modal offers the same list inline.
   **One writer, two surfaces:** both go through the same hook against `sub_task_resources`, so
   the two can never diverge in what they permit or record.

8. **The shape must be template-populatable.** `(task, resource, hours)` is deliberately the same
   triple a future work-type template would carry, so populating a deliverable from a template writes
   these rows directly and production sets time only. The template itself is **not** built here.

## Consequences

**Easier.** "Task A needs a camera" becomes a fact the system holds, survives rescheduling, and can
be stated before anything is scheduled. Reassigning a task moves its assets with it. An exclusive
asset double-booked across two tasks becomes visible instead of being silently overwritten. The
template that Edward wants becomes a population step over an existing shape rather than a redesign.

**Harder.** `subtask-schedule` grows from "materialise the assignee's days" to "materialise the
assignee's days plus each requirement's days, and report what it could not place" — it is the most
load-bearing function in the scheduling path and this is a real increase in its surface. Decision 6
introduces a booking that exists in a contested state, which means the exceptions surface has to
carry it or it is worse than useless. Decision 5 narrows an invariant that shipped yesterday
(ADR-0039), so the envelope trigger and its pgTAP suite both change.

**Locked in.** A deadline moves only because a person moved it. No trigger, scheduler or asset
booking may rewrite a task's dates as a side effect — the clash is surfaced and a human decides.
The assets a task needs are a property of the **task**, not of a calendar entry and
not of the deliverable. A booking remains a booking *of a resource*; it does not double as the record
of why the resource was wanted. Anything wanting per-deliverable asset planning is asking for a
different concept, not a reason to move this one.

**Cost.** No dependency, no service, no licence. One table, one scheduler change, one trigger
narrowing, one screen section.

**Testing.** pgTAP: RLS allow + deny on the new table (including cross-tenant and out-of-scope);
`days ≥ 1`; cascade on task delete; the span trigger ignoring non-assignee bookings; both clash shapes —
an exclusive resource producing a `tentative` booking plus an exception, and an over-ceiling person
producing a `confirmed` booking plus an exception — each rather than a failed assignment; a task with no
requirements scheduling exactly as before. Unit: the day-placement maths (`days` + optional
`starts_on` against the task's span). The Edge Function's partial-placement report needs a test that
asserts it reports what it could not place rather than failing silently.
