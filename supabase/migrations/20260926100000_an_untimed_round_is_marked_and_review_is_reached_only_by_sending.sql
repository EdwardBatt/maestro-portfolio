-- I59.20 (ADR-0106, accepted 25 Sep) — the schema half of "an untimed round records the allocated
-- hours, and review is reached only by sending". The function half (app.sub_task_submit) is
-- `20260926102000`, after ADR-0107's columns exist, because one submit writes both.
--
--   1. `tenant_reminder_settings.untimed_threshold_minutes` (d.1) — N, default 15. The same shape as
--      `assignment_escalation_hours` (20260922170000): a typed column with a CHECK on the tenant's one
--      settings row, so the existing `tenant_reminder_settings_tenant_select` (everyone in the tenant
--      reads it — the task screen needs N to word its warning) and
--      `tenant_reminder_settings_admin_write` (organization:manage) policies cover it. No new policy.
--
--   2. `task_time_entries.untimed` (d.3) — the mark the KPI page (I49.79, parked) reads. A BOOLEAN
--      beside `mode`, not a third `mode` value: `mode` already answers a different question (was a
--      timer running — 'timer' — or was the entry written in one go — 'manual'), and an untimed round
--      can be either (sent a minute after Start = 'timer'; never started = 'manual', ADR-0106
--      Consequences). Folding them would lose one of the two facts and break every reader that
--      filters `mode = 'timer'`. Default false, so every existing row stays what it was.
--
--   3. The status door (d.4). `sub_tasks_manage_update` lets the assignee UPDATE their own row,
--      `status` included; nothing refused `todo → review`. A BEFORE UPDATE trigger now refuses any
--      change INTO `review` unless the transaction-local flag `app.submitting` is 'on' — and only
--      `app.sub_task_submit` raises it (`set_config(..., true)`, cleared again straight after its one
--      update). Same device as `app.task_list_approval` (the tasks-approved fence).
--
--      Every function that moves a task to review was checked (grep `status = 'review'` over
--      supabase/migrations and supabase/functions, 25 Sep): only `app.sub_task_submit` does. The
--      generic editors (`public.save_sub_task`'s `status = coalesce(p_status, status)`) could be
--      handed 'review'; the app never passes a status to them (src/, 25 Sep), and they are refused
--      now, which is the point. Leaving review (approve → done, send back → todo, cancel, reopen) is
--      untouched: the guard only watches the way IN.
--
--      INSERT is not guarded: a task is created as `todo` by every product path; a direct insert
--      needs `project_tasks:manage` in scope. Raised with Edward rather than assumed.

begin;

-- ------------------------------------------------------------------ 1. the threshold (d.1) ----
alter table tenant_reminder_settings
  add column if not exists untimed_threshold_minutes integer not null default 15
  constraint chk_reminder_untimed_threshold_minutes check (untimed_threshold_minutes > 0);

comment on column tenant_reminder_settings.untimed_threshold_minutes is
  'ADR-0106 d.1 (25 Sep): a round sent less than this many minutes after Start — or never started — '
  'is UNTIMED: the maker is warned, and if sent anyway the task''s allocated hours are recorded, '
  'marked task_time_entries.untimed. Default 15. A tenant with no settings row reads 15.';

-- ------------------------------------------------------------------ 2. the mark (d.3) ----
alter table task_time_entries
  add column if not exists untimed boolean not null default false;

comment on column task_time_entries.untimed is
  'ADR-0106 d.3: this round was sent untimed (never started, or sent under the tenant''s '
  'untimed_threshold_minutes after Start), so `minutes` is the task''s ALLOCATION (sla_hours x 60, '
  'else committed_hours x 60), not the timer. The KPI penalty''s input (I49.79). Independent of '
  '`mode`: an untimed round is ''manual'' when never started and ''timer'' when started too late.';

-- ------------------------------------------------------------------ 3. the door (d.4) ----
create or replace function app.tg_sub_task_review_only_by_sending()
returns trigger language plpgsql
set search_path = public, app as $$
begin
  if new.status = 'review' and old.status is distinct from 'review'
     and coalesce(current_setting('app.submitting', true), '') <> 'on' then
    raise exception 'a task reaches review only by being sent for review'
      using errcode = '42501',
            hint = 'use sub_task_submit';
  end if;
  return new;
end $$;

comment on function app.tg_sub_task_review_only_by_sending() is
  'ADR-0106 d.4: refuses any UPDATE that moves a sub-task INTO review unless app.sub_task_submit '
  'raised the transaction-local app.submitting flag. Closes the direct-PATCH door for every caller.';

drop trigger if exists sub_task_review_only_by_sending on sub_tasks;
create trigger sub_task_review_only_by_sending
  before update of status on sub_tasks
  for each row execute function app.tg_sub_task_review_only_by_sending();

commit;
