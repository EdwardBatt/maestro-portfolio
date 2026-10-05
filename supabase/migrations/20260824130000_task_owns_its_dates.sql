-- ADR-0039 (I12.2): the task owns its dates — a booking that moves moves the WORK.
--
-- WHY. booking-transition's reschedule updated the `bookings` row and nothing else, so
-- sub_tasks.starts_at / due_at stayed where they were. Everything that matters reads the TASK —
-- overdue, due-today, the Tasks-for-today panel, SLA, the exception counts — while everything a
-- scheduler LOOKS AT is the booking. Drag work to next week and the grid agrees, the deadline
-- silently does not move, and the task goes overdue on its original date with nobody at fault.
--
-- THE MECHANISM. The task's span is the ENVELOPE of its bookings: starts_at = earliest booking
-- start, due_at = latest booking end, recomputed by this trigger whenever a booking is inserted,
-- moved or removed. That is what lets a multi-day task's chips move INDEPENDENTLY (Edward's
-- decision, ADR-0039 d.2) while the task still owns the answer to "when is this due": work Mon /
-- Wed / Fri and the due date is Friday, gap and all.
--
-- WHY A TRIGGER RATHER THAN THE CALLER. Postgres owns the invariant (AGENTS.md §2), so every path
-- keeps it — the drag, the edit modal, the materialiser, a future import, a hand-run repair script.
-- A caller-side version would have to be remembered at each new call site, which is precisely how
-- the divergence this ADR closes came about.
--
-- NO RECURSION. The trigger writes only to sub_tasks; nothing on sub_tasks writes back to bookings.
-- The materialiser (delete + insert, never update) fires it and recomputes the same envelope it just
-- derived from the task, so it settles immediately rather than oscillating.
--
-- COEXISTS WITH `booking_marks_subtask_override` (20260817120000), which flips
-- schedule_overridden on a hand-edited booking. That flag SURVIVES this ADR and gains a clearer
-- meaning — "this schedule was arranged by hand" — because independent chips are exactly what it
-- has to protect from the materialiser's even spread.
--
-- search_path pinned inline per ADR-0033.

begin;

create or replace function app.tg_booking_syncs_subtask_span() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_task uuid := coalesce(new.sub_task_id, old.sub_task_id);
  v_start timestamptz;
  v_end   timestamptz;
begin
  -- Plain reservations (meetings, holds, leave) have no task behind them: nothing to reconcile,
  -- and ADR-0039 d.8 leaves their behaviour untouched.
  if v_task is null then
    return coalesce(new, old);
  end if;

  -- A moved booking can change which task it belongs to; resync both sides.
  if tg_op = 'UPDATE' and old.sub_task_id is distinct from new.sub_task_id and old.sub_task_id is not null then
    perform app.sync_subtask_span(old.sub_task_id);
  end if;

  perform app.sync_subtask_span(v_task);
  return coalesce(new, old);
end $$;

-- Split out so the repair path and the tests can call it directly without forging a trigger context.
create or replace function app.sync_subtask_span(p_sub_task uuid) returns void
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_start timestamptz;
  v_end   timestamptz;
begin
  select min(b.starts_at), max(b.ends_at)
    into v_start, v_end
  from public.bookings b
  where b.sub_task_id = p_sub_task
    and b.state <> 'cancelled';          -- a cancelled booking is not when the work happens

  -- An unscheduled task is not a task with no deadline (ADR-0039 d.3): with no live bookings the
  -- task keeps the dates it was given, so releasing a schedule never silently erases a due date.
  if v_start is null then
    return;
  end if;

  update public.sub_tasks
     set starts_at = v_start,
         due_at    = v_end
   where id = p_sub_task
     and (starts_at is distinct from v_start or due_at is distinct from v_end);
end $$;

comment on function app.sync_subtask_span(uuid) is
  'ADR-0039: set a task''s span to the envelope of its live bookings (earliest start, latest end). '
  'No live bookings leaves the task''s dates alone — unscheduled is not undated.';
comment on function app.tg_booking_syncs_subtask_span() is
  'ADR-0039: keep sub_tasks.starts_at/due_at in step with the task''s bookings, so dragging a chip '
  'moves the WORK and not just the calendar entry. Runs on every booking write, so no call site can '
  'forget it.';

-- AFTER, so it sees the row as written and cannot interfere with the exclusion constraint or the
-- capacity assessment that ran before it.
create trigger booking_syncs_subtask_span
  after insert or update or delete on bookings
  for each row execute function app.tg_booking_syncs_subtask_span();

-- ---------------------------------------------------------------- backfill ----
-- Bring existing tasks into line in one pass. Tasks whose bookings were dragged before today have
-- been drifting from their own dates for as long as the drag has existed.
do $$
declare r record;
begin
  for r in select distinct sub_task_id from bookings where sub_task_id is not null loop
    perform app.sync_subtask_span(r.sub_task_id);
  end loop;
end $$;

commit;
