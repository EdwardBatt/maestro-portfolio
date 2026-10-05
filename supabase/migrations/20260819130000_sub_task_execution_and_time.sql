-- ADR-0030 (I8.1): sub-task execution — Start/Submit lifecycle + single-session time tracking.
--
-- The sub-task is the timed, actionable unit. The assignee Starts a task (opens a timed session)
-- and Submits it (stops the clock). Submit with no running timer requires manual hours, flagged as
-- not-timer-tracked (a small process-adherence marker; no automated consequence — ADR-0029/0030
-- guardrail). Actions run as SECURITY DEFINER functions (assignee-only, atomic status + time write).
-- Additive: the deliverable approval gate + Request Changes land in I8.2; dependencies / dropping
-- `blocked` from the status enum land in I8.3.

alter table sub_tasks add column revision_number int not null default 0;   -- per-task rework rounds
comment on column sub_tasks.revision_number is 'ADR-0030: per-task rework round count (bumped by Request Changes, I8.2).';

create table task_time_entries (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  sub_task_id   uuid not null references sub_tasks(id) on delete cascade,
  user_id       uuid not null references user_profiles(id),   -- who did the work (the assignee)
  round         int  not null default 0,                       -- = sub_tasks.revision_number at start
  started_at    timestamptz,                                   -- null for a manual back-fill entry
  submitted_at  timestamptz,
  minutes       numeric(7,1),                                  -- timer: submitted−started; manual: entered
  mode          text not null check (mode in ('timer','manual')),
  started_ahead boolean not null default false,                -- started while a dep/input was unmet (I8.3)
  created_at    timestamptz not null default now()
);
create index idx_task_time_entries_sub_task on task_time_entries (sub_task_id, round);
-- at most one OPEN (running) entry per sub-task per round
create unique index uq_task_time_open_entry on task_time_entries (sub_task_id, round) where submitted_at is null;

alter table task_time_entries enable row level security;
alter table task_time_entries force row level security;
-- reads are tenant-wide (work tracking is visible, like sub_tasks); writes go through the action
-- functions only (no client insert/update).
create policy task_time_entries_tenant_select on task_time_entries
  for select to authenticated using (tenant_id = app.current_tenant_id());
create trigger audit_row_change after insert or update or delete on task_time_entries
  for each row execute function app.audit_row_change();

-- ---- Start Task: the assignee opens a timed session (todo → in_progress) ----
create or replace function app.sub_task_start(p_id uuid)
returns void language plpgsql security definer set search_path = public, app as $$
declare v sub_tasks;
begin
  select * into v from sub_tasks where id = p_id;
  if v.id is null then raise exception 'sub_task % not found', p_id using errcode = 'P0002'; end if;
  if v.assignee_id is distinct from auth.uid() then
    raise exception 'only the assignee may start this task' using errcode = '42501';
  end if;
  if v.status <> 'todo' then
    raise exception 'task can only be started from todo (is %)', v.status using errcode = '22023';
  end if;
  update sub_tasks set status = 'in_progress' where id = p_id;
  insert into task_time_entries (tenant_id, sub_task_id, user_id, round, started_at, mode)
  values (v.tenant_id, p_id, auth.uid(), v.revision_number, now(), 'timer');
end $$;
comment on function app.sub_task_start(uuid) is
  'ADR-0030: assignee starts their sub-task — status todo→in_progress, opens a timed entry for the current round.';

-- ---- Submit for Review: close the timer, or enter manual hours if none is running ----
create or replace function app.sub_task_submit(p_id uuid, p_manual_minutes numeric default null)
returns void language plpgsql security definer set search_path = public, app as $$
declare v sub_tasks; v_open task_time_entries;
begin
  select * into v from sub_tasks where id = p_id;
  if v.id is null then raise exception 'sub_task % not found', p_id using errcode = 'P0002'; end if;
  if v.assignee_id is distinct from auth.uid() then
    raise exception 'only the assignee may submit this task' using errcode = '42501';
  end if;
  -- submit is allowed from in_progress (timer running) OR straight from todo (submit-without-start →
  -- manual hours). Any other status (review/done/cancelled) is illegal.
  if v.status not in ('todo', 'in_progress') then
    raise exception 'task cannot be submitted from % (only todo or in_progress)', v.status using errcode = '22023';
  end if;

  select * into v_open from task_time_entries
    where sub_task_id = p_id and round = v.revision_number and submitted_at is null;

  if v_open.id is not null then
    -- timer path: close the running session
    update task_time_entries
      set submitted_at = now(), minutes = round(extract(epoch from (now() - started_at)) / 60.0, 1)
      where id = v_open.id;
  else
    -- manual path: hours required, flagged as not-timer-tracked
    if p_manual_minutes is null or p_manual_minutes <= 0 then
      raise exception 'submitting without a running timer requires manual minutes (> 0)' using errcode = '22023';
    end if;
    insert into task_time_entries (tenant_id, sub_task_id, user_id, round, submitted_at, minutes, mode)
    values (v.tenant_id, p_id, auth.uid(), v.revision_number, now(), p_manual_minutes, 'manual');
  end if;

  update sub_tasks set status = 'review' where id = p_id;
end $$;
comment on function app.sub_task_submit(uuid, numeric) is
  'ADR-0030: assignee submits their sub-task — status in_progress→review; closes the timer, or (no running timer) records manual minutes flagged mode=manual.';

grant execute on function app.sub_task_start(uuid) to authenticated;
grant execute on function app.sub_task_submit(uuid, numeric) to authenticated;
