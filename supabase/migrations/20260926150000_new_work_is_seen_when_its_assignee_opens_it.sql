-- I59.31 / ADR-0105 d.2 — "New on you" is seen on the server (settled by the coordinator, 25 Sep:
-- "seen server-side (the task page opened), not per device"). Track 6 remembered it in the browser's
-- storage, so a task opened on the laptop was still "new" on the phone.
--
--   sub_tasks.assignee_seen_at  When the CURRENT assignee first opened the task (or pressed Later).
--                               Null = not seen yet. Reset to null whenever `assignee_id` changes —
--                               a task handed to somebody else is new to them.
--   public.mark_task_seen(uuid) The only writer: the task's assignee, in their own tenant; sets now()
--                               once (a second call changes nothing and is not an error). Anybody
--                               else is refused (42501).
--   The column is NOT client-writable: any UPDATE that changes it outside the RPC (flag
--   `app.marking_seen`, transaction-local, raised only by it) is refused — so "seen" cannot be faked,
--   nor un-seen, by a PATCH. The same shape as ADR-0106 d.4's `app.submitting`.
--
-- SECURITY DEFINER on the app function, as every write-through RPC here (AGENTS.md §6): the assignee
-- need not hold an UPDATE policy on sub_tasks to be seen opening their own task. search_path pinned.
-- The public wrapper is SECURITY INVOKER and forwards only (20260819210000's convention).
--
-- Tests: supabase/tests/180_new_work_is_seen_when_its_assignee_opens_it.sql

begin;

-- ---------------------------------------------------------------- the column ----
alter table sub_tasks add column if not exists assignee_seen_at timestamptz;

comment on column sub_tasks.assignee_seen_at is
  'I59 (ADR-0105 d.2): when the current assignee first opened the task page (or pressed Later on '
  '"New on you"). Null = not seen. Reset on reassignment; written only by public.mark_task_seen.';

-- ---------------------------------------------------------------- the guard ----
create or replace function app.tg_sub_task_seen_guard()
returns trigger language plpgsql
set search_path = public, app, extensions as $$
begin
  if tg_op = 'INSERT' then
    -- A new task has been seen by nobody, whatever the payload says.
    new.assignee_seen_at := null;
    return new;
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    -- Handed to somebody else (or unassigned): new to whoever has it now.
    new.assignee_seen_at := null;
  elsif new.assignee_seen_at is distinct from old.assignee_seen_at
        and coalesce(current_setting('app.marking_seen', true), '') <> 'on' then
    raise exception 'whether a task has been seen is recorded by opening it'
      using errcode = '42501',
            hint = 'use mark_task_seen';
  end if;
  return new;
end $$;

comment on function app.tg_sub_task_seen_guard() is
  'I59 (ADR-0105 d.2): sub_tasks.assignee_seen_at is null on insert and on every change of assignee; '
  'any other change to it outside app.mark_task_seen (flag app.marking_seen) is refused (42501).';

drop trigger if exists sub_task_seen_guard on sub_tasks;
create trigger sub_task_seen_guard
  before insert or update on sub_tasks
  for each row execute function app.tg_sub_task_seen_guard();

-- ---------------------------------------------------------------- the RPC ----
create or replace function app.mark_task_seen(p_task uuid)
returns void
language plpgsql security definer
set search_path = public, app, extensions as $$
declare v sub_tasks;
begin
  select * into v from sub_tasks where id = p_task and tenant_id = app.current_tenant_id();
  if v.id is null then
    raise exception 'task % not found', p_task using errcode = 'P0002';
  end if;
  if v.assignee_id is distinct from auth.uid() or auth.uid() is null then
    raise exception 'only the person the task is given to is seen opening it' using errcode = '42501';
  end if;
  if v.assignee_seen_at is not null then
    return;   -- seen already: the first time is the one recorded
  end if;

  perform set_config('app.marking_seen', 'on', true);
  update sub_tasks set assignee_seen_at = now() where id = p_task;
  perform set_config('app.marking_seen', '', true);
end $$;

comment on function app.mark_task_seen(uuid) is
  'I59 (ADR-0105 d.2): the task''s assignee has opened it (or pressed Later) — stamps '
  'sub_tasks.assignee_seen_at once. Anybody else: 42501. The only path that writes the column.';

revoke execute on function app.mark_task_seen(uuid) from public, anon;
grant  execute on function app.mark_task_seen(uuid) to authenticated;

create or replace function public.mark_task_seen(p_task uuid)
returns void language sql security invoker set search_path = public, app as $$
  select app.mark_task_seen(p_task);
$$;

revoke execute on function public.mark_task_seen(uuid) from public, anon;
grant  execute on function public.mark_task_seen(uuid) to authenticated;

commit;
