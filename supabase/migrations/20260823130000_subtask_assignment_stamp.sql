-- Accountability: first-class assignment tracking on sub_tasks — WHO assigned the task and WHEN,
-- promoted from implicit (created_at/created_by + the audit log) to real, server-controlled columns
-- so the accountability engine and work surfaces can read assignment provenance directly.
--
-- The columns are NOT client-writable: a trigger stamps auth.uid()+now() on assign/reassign, clears
-- them on unassign, and freezes them on any other update — a client cannot forge who/when.

begin;

alter table sub_tasks add column assigned_at timestamptz;
alter table sub_tasks add column assigned_by uuid references user_profiles(id);
comment on column sub_tasks.assigned_at is
  'When the current assignee was assigned (server-stamped on assign/reassign; null when unassigned).';
comment on column sub_tasks.assigned_by is
  'Who assigned the current assignee (auth.uid() at assign time; null for system paths / unassigned).';
-- Provenance is read by assigner ("everything X assigned") by the accountability surfaces.
create index idx_sub_tasks_assigned_by on sub_tasks (assigned_by);

-- Backfill existing assigned tasks as assigned-at-creation, with the touch + audit triggers OFF so
-- this one-time migration neither bumps updated_at nor spams the audit log. The stamping trigger
-- below does not exist yet, so it cannot clobber the backfill.
alter table sub_tasks disable trigger set_updated_at;
alter table sub_tasks disable trigger audit_row_change;
update sub_tasks set assigned_at = created_at, assigned_by = created_by where assignee_id is not null;
alter table sub_tasks enable trigger audit_row_change;
alter table sub_tasks enable trigger set_updated_at;

create or replace function app.tg_stamp_subtask_assignment() returns trigger
language plpgsql set search_path = public, app, extensions as $$
begin
  if tg_op = 'INSERT' then
    if new.assignee_id is not null then
      new.assigned_at := now();
      new.assigned_by := auth.uid();
    else
      new.assigned_at := null;
      new.assigned_by := null;
    end if;
  elsif new.assignee_id is distinct from old.assignee_id then
    -- assigned or reassigned (or unassigned): restamp / clear
    if new.assignee_id is not null then
      new.assigned_at := now();
      new.assigned_by := auth.uid();
    else
      new.assigned_at := null;
      new.assigned_by := null;
    end if;
  else
    -- assignee unchanged: freeze the stamp (ignore any client-supplied value)
    new.assigned_at := old.assigned_at;
    new.assigned_by := old.assigned_by;
  end if;
  return new;
end $$;
comment on function app.tg_stamp_subtask_assignment() is
  'Server-controls sub_tasks.assigned_at/assigned_by: stamps auth.uid()+now() on assign/reassign, '
  'clears on unassign, freezes otherwise. Not client-writable (accountability provenance).';

create trigger stamp_assignment before insert or update on sub_tasks
  for each row execute function app.tg_stamp_subtask_assignment();

commit;
