-- ADR-0024 (Phase I / I1.3): sub-task → schedule override plumbing.
--
-- A sub-task with an assignee + hours + dates materialises as a daily series of bookings on the
-- assignee's resource (the subtask-schedule Edge Function, next increment, using the capacity
-- engine + the even-spread lib). The rule Edward chose: auto-spread UNTIL a human hand-adjusts a
-- day, then the schedule is theirs and the platform stops re-spreading that sub-task.
--
-- Suppression is STRUCTURAL, not a flag: the materialiser regenerates a sub-task's schedule by
-- DELETE + INSERT (idempotent), never UPDATE. The override trigger is AFTER UPDATE only, so it
-- never sees the materialiser — only a human edit (the scheduler drag/resize via
-- booking-transition, or a direct change) updates a linked booking, and that flips the flag.
-- (A transaction-local GUC was considered and rejected: the materialiser makes separate
-- PostgREST calls, so a local GUC would not carry across them.)
--
-- Task: I1.3.

alter table sub_tasks
  add column schedule_overridden boolean not null default false;
comment on column sub_tasks.schedule_overridden is
  'ADR-0024: true once a human hand-adjusted this sub-task''s materialised bookings; the auto-spreader then leaves it alone.';

-- SECURITY DEFINER (search_path pinned): the person editing a booking may not hold sub_tasks
-- write access, but the override bookkeeping must still record. Scoped to the one linked
-- sub-task; no cross-tenant reach (a booking and its sub_task share a tenant by construction).
create or replace function app.tg_booking_marks_subtask_override() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  if new.sub_task_id is not null
     and (new.starts_at   is distinct from old.starts_at
          or new.ends_at   is distinct from old.ends_at
          or new.load_pct  is distinct from old.load_pct
          or new.resource_id is distinct from old.resource_id
          or new.state     is distinct from old.state) then
    update sub_tasks set schedule_overridden = true
     where id = new.sub_task_id and schedule_overridden = false;
  end if;
  return new;
end $$;

comment on function app.tg_booking_marks_subtask_override() is
  'ADR-0024: flip sub_tasks.schedule_overridden when a materialised (sub_task-linked) booking is hand-edited. The materialiser never UPDATEs (delete+insert), so only human edits reach this.';

create trigger booking_marks_subtask_override after update on bookings
  for each row execute function app.tg_booking_marks_subtask_override();
