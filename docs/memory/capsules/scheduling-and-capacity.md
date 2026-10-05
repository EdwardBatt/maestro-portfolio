---
type: capsule
abstract: The schedule grid, bookings, capacity, and what happens when two things want the same resource — the densest domain in the project.
status: current
origin: ai-derived
verified: 2026-10-04
sources: [docs/adr/0006-*, 0039-*, 0040-*, 0042-*, 0098-*, 0139-*, 0140-*, src/features/schedule/, src/lib/capacity/, supabase/migrations/20260728110500_create_bookings_and_blackouts.sql, supabase/migrations/20260922190000_a_lead_or_account_manager_schedules_anyone.sql]
---

# Capsule — Scheduling and capacity

## The model

A **booking** is always a booking *of a resource* — a person, a piece of equipment, or a room. A
resource has one of three capacity models, and they behave completely differently:

Three capacity models, and they behave differently: `load_based` (**every human**, forced by
`chk_resources_human_load` — day load crossing `warn_at_pct` then `load_ceiling_pct`, in application
logic); `exclusive` (equipment, rooms — any overlap of two *confirmed* bookings, held by the
`excl_bookings_confirmed_exclusive_overlap` exclusion constraint); `pooled` (more than `pool_size` at
once, application logic). People never clash outright; they get overloaded. That asymmetry is why
"conflict detection" always has two shapes. See [traps.md](../traps.md).

## The grid

ADR-0006: rows are resources, columns are days, one cell per resource-day. Seven days always
rendered; each row shades its **own** office's non-working days (ADR-0005) — offices differ. Weekend
columns collapse unless they carry a booking. Chips size by load (`lib/chip-width.ts`) and colour by
kind (`lib/chip-kind.ts`, decided on `campaignId == null`); drag moves a chip between cells.

## Tasks, dates and assignment

- **A task owns its dates** (ADR-0039): a trigger keeps `sub_tasks.starts_at`/`due_at` in step with
  its bookings, so dragging a chip moves the *work*. **Narrowed by ADR-0042 d.5** to the **assignee's**
  bookings (via `resources.user_id`): a resource required *by* the task never moves its dates, and an
  unassigned task keeps the dates it was given.
- **Assigning requires the authority to schedule** (ADR-0040): `project_tasks:manage` alone is not
  enough — you must be able to book the assignee's calendar, checked *before* the task is written.
- **Reach is your own team; outside it is an ASK** (**ADR-0139**, 3 Oct — supersedes ADR-0098's "anyone books
  anyone", which was on production 22 Sep–merge of I74). `app.resource_in_scheduling_scope`: team lead → her team,
  department lead → his department, Traffic / Power Admin → anyone, account manager / director → nobody (they ask).
  An ask names a team (person optional), is answered by the Team Leader (Deputy only when the leader is on leave
  that day; no leader → department lead), and escalates after 4 working hours to Traffic + the department lead —
  `request_task_booking` / `answer_task_request` (20261003110000), UI `src/lib/task-asks/`, `AnswerAskDialog`,
  `ScheduleAsksSide`. A lead blocks leave / internal time for her people from Block time (20261003170000). Leave
  and closures otherwise keep `resource_in_write_scope`. pgTAP 218, 223; mirror `lib/write-scope.ts`.
- **The Schedule (Figma L) books a whole deliverable** — To book → click a person's day → `BookTasksDialog` with
  every task pre-filled with that person and day (I74.32); hours are entered by the person booking (a task never
  books with none). A task's chip opens `TaskPopup` + the one `TaskEditor` (ADR-0140): a started task asks before a
  move, Cancel booking → back to To book (person + their lead told). Who books nobody opens on Everyone (I74.30).
- **Assignment is the booking** (ADR-0029): `bookings` carry `sub_task_id` and `title`.
- **A day count is WORKING days** (`I41.2`, ADR-0078): `expandDaily` steps over a day off, the FIRST
  day never moves (ADR-0061 d.2), weekly series do not step; due date = the last day PLACED on.
- **The working calendar is the weekly pattern PLUS the office's closures** (ADR-0079).
  `isWorkingDay` (`lib/capacity/working-week.ts`) is the ONE test every reader uses; closures are
  `office_closures` (behind `leave:manage`) via `lib/capacity/closures.ts` — write that embed
  LITERALLY (the scanner test). Declaring one moves nothing; `office_closure_stranded_bookings` lists
  what sits on a closed day.
- **Go-live offsets are working days and SETTINGS** (I41.8–10, `lib/campaigns/go-live-dates.ts`).
- **The grid's cell warning and its drop warning are one calculation** — `lib/drop-check.ts` (where
  `overloadFor` lives). A drop onto a day off, a blackout or an over-capacity day asks first and
  never refuses; cross-resource drags take the same path.

## Where to look

- `src/features/schedule/` — `SchedulePage.tsx`, `components/DayGrid.tsx`, `api/schedule-api.ts`,
  `hooks/use-write-scope.ts`, `lib/`.
- `src/lib/capacity/` — the unit-tested engine: `working-week.ts`, `day-hours.ts`.
- `supabase/functions/subtask-schedule/` — a task into bookings; release deletes ALL of that task's.
- `supabase/migrations/20260728110500_create_bookings_and_blackouts.sql` — the exclusion constraint.

## Rooms, equipment, known gaps

A plain reservation is `BookingDialog.tsx`'s non-task branch; ADR-0094 (accepted, `I50`, ON HOLD) replaces how
kit is booked. Never run: the RTL visual pass and the full-pool performance check (M5.6).

## Related

[work-lifecycle](work-lifecycle.md) · [authorization](authorization.md) for who may book what.
