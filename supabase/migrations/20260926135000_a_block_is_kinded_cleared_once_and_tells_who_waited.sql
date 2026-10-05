-- I59.31 / E12 and the coordinator's settled block items (Edward, 25 Sep) — ADR-0107 finished.
--
--   settled  A block's KIND is required on the assignee's insert path ("I'm blocked": copy · the
--            client · a file · a decision · something else). A manager's deliverable-level input
--            (ADR-0069 d.7, requirements-api) is unchanged — its rows never had a kind.
--   settled  A CLEARED input cannot be un-cleared — by anyone signed in, managers included (raise a new
--            one instead). Migrations / the service role are left alone, as every guard here does.
--   settled  Clearing ANY input tells whoever was waiting on it: `task_unblocked` (declared in
--            20260926090000) —
--              a task-level input  → the task's assignee (entity the task);
--              a deliverable-level → the assignee of every open task on that deliverable, once each
--                                    (entity the deliverable);
--            never the person who cleared it.
--   E12      Blocked minutes count BOTH kinds: the task's own inputs AND the inputs on its whole
--            deliverable (sub_task_id null), the union — overlaps once.
--
-- Reproduced WHOLE from 20260926101000 (their only definitions, grep confirmed 26 Sep):
--   app.tg_pending_input_task_guard, the policy deliverable_pending_inputs_assignee_insert,
--   app.task_blocked_minutes (same signature — sub_task_submit and task_round_timing, its callers,
--   are unchanged).
--
-- Tests: supabase/tests/178_blocks_filler_and_blocked_time.sql

begin;

-- ------------------------------------------------ the row guard: kind, and no un-clearing ----
create or replace function app.tg_pending_input_task_guard()
returns trigger language plpgsql
set search_path = public, app as $$
declare v_manager boolean;
begin
  if new.sub_task_id is not null and not exists (
    select 1 from sub_tasks st
     where st.id = new.sub_task_id and st.deliverable_id = new.deliverable_id
  ) then
    raise exception 'that task is not on this deliverable' using errcode = '23514';
  end if;

  if auth.uid() is null then
    return new;
  end if;

  -- I59 (settled): cleared is final. A block that comes back is a new block.
  if tg_op = 'UPDATE' and old.satisfied_at is not null and new.satisfied_at is null then
    raise exception 'this block was cleared and stays cleared — raise a new one if it is back'
      using errcode = '22023', hint = 'block_cleared_is_final';
  end if;

  v_manager := app.has_permission('project_tasks', 'manage');
  if v_manager then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- I59 (settled): the maker says what KIND of thing is missing.
    if new.kind is null then
      raise exception 'say what is missing — copy, the client, a file, a decision or something else'
        using errcode = '22023', hint = 'block_kind_required';
    end if;
    new.requested_at := now();
    new.created_by   := auth.uid();
    new.satisfied_at := null;
    return new;
  end if;

  -- UPDATE by the assignee or the owner: clearing is all they may do.
  if new.deliverable_id is distinct from old.deliverable_id
     or new.sub_task_id  is distinct from old.sub_task_id
     or new.description  is distinct from old.description
     or new.awaited_from is distinct from old.awaited_from
     or new.kind         is distinct from old.kind
     or new.requested_at is distinct from old.requested_at
     or new.created_by   is distinct from old.created_by
     or new.tenant_id    is distinct from old.tenant_id then
    raise exception 'only clearing a block is open to you here — ask the deliverable''s owner to change it'
      using errcode = '42501';
  end if;
  if new.satisfied_at is not null and old.satisfied_at is null then
    new.satisfied_at := now();
  end if;
  return new;
end $$;

comment on function app.tg_pending_input_task_guard() is
  'ADR-0107 d.1/d.2 + I59 settled: a task-level input names a task of its own deliverable; a caller '
  'without project_tasks:manage (the assignee raising, the assignee or owner clearing) changes nothing '
  'but satisfied_at, must give a kind when raising, and requested_at / satisfied_at are stamped now(). '
  'A cleared input is never un-cleared by a signed-in caller.';

-- ------------------------------------------------ the assignee's insert: kind required ----
drop policy if exists deliverable_pending_inputs_assignee_insert on deliverable_pending_inputs;
create policy deliverable_pending_inputs_assignee_insert on deliverable_pending_inputs
  for insert to authenticated
  with check (
    tenant_id = app.current_tenant_id()
    and sub_task_id is not null
    and kind is not null
    and nullif(btrim(description), '') is not null
    and nullif(btrim(awaited_from), '') is not null
    and exists (
      select 1 from sub_tasks st
       where st.id = sub_task_id
         and st.deliverable_id = deliverable_pending_inputs.deliverable_id
         and st.tenant_id = app.current_tenant_id()
         and st.assignee_id = auth.uid()
    )
  );

-- ------------------------------------------------------------ E12 the blocked minutes ----
create or replace function app.task_blocked_minutes(p_sub_task uuid, p_from timestamptz, p_to timestamptz)
returns numeric language sql stable set search_path = public, app as $$
  select case
    when p_from is null or p_to is null or p_to <= p_from then 0::numeric
    else coalesce((
      select round((sum(extract(epoch from (upper(r) - lower(r)))) / 60.0)::numeric, 1)
        from unnest(
          (select range_agg(tstzrange(pin.requested_at, coalesce(pin.satisfied_at, p_to), '[)'))
             from deliverable_pending_inputs pin
             join sub_tasks st on st.id = p_sub_task
            where pin.deliverable_id = st.deliverable_id
              -- E12: the task's own inputs AND the ones on its whole deliverable
              and (pin.sub_task_id = st.id or pin.sub_task_id is null)
              and coalesce(pin.satisfied_at, p_to) > pin.requested_at)
          * tstzmultirange(tstzrange(p_from, p_to, '[)'))
        ) as r
    ), 0::numeric)
  end
$$;

comment on function app.task_blocked_minutes(uuid, timestamptz, timestamptz) is
  'ADR-0107 d.3 + I59 E12: minutes within [p_from, p_to) during which the task was held by an '
  'outstanding input — its OWN inputs and those on its whole deliverable (requested_at to '
  'satisfied_at, or to p_to while open) — the UNION, so overlapping blocks count once.';

revoke execute on function app.task_blocked_minutes(uuid, timestamptz, timestamptz) from public, anon;
grant  execute on function app.task_blocked_minutes(uuid, timestamptz, timestamptz) to authenticated;

-- ------------------------------------------------------ whoever waited is told ----
create or replace function app.tg_pending_input_notify_unblocked()
returns trigger language plpgsql security definer
set search_path = public, app, extensions as $$
declare v sub_tasks; v_name text;
begin
  if not (old.satisfied_at is null and new.satisfied_at is not null) then
    return null;
  end if;

  if new.sub_task_id is not null then
    select * into v from sub_tasks where id = new.sub_task_id;
    if v.assignee_id is not null and v.assignee_id is distinct from auth.uid()
       and v.status not in ('done', 'cancelled') then
      insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
      values (new.tenant_id, v.assignee_id, 'task_unblocked', v.title, 'sub_task', v.id, auth.uid(),
              jsonb_build_object('input_id', new.id, 'kind', new.kind, 'description', new.description,
                                 'awaited_from', new.awaited_from, 'task', v.title,
                                 'deliverable_id', new.deliverable_id));
    end if;
    return null;
  end if;

  -- A deliverable-level input held every open task on it (ADR-0069 d.7): each assignee, once.
  select d.name into v_name from deliverables d where d.id = new.deliverable_id;
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
  select new.tenant_id, a.assignee_id, 'task_unblocked', v_name, 'deliverable', new.deliverable_id, auth.uid(),
         jsonb_build_object('input_id', new.id, 'kind', new.kind, 'description', new.description,
                            'awaited_from', new.awaited_from, 'deliverable_id', new.deliverable_id,
                            'tasks', a.tasks)
    from (select t.assignee_id, jsonb_agg(t.title order by t.sort_order, t.title) as tasks
            from sub_tasks t
           where t.deliverable_id = new.deliverable_id
             and t.assignee_id is not null
             and t.status in ('todo', 'in_progress', 'blocked', 'review')
           group by t.assignee_id) a
   where a.assignee_id is distinct from auth.uid();
  return null;
end $$;

comment on function app.tg_pending_input_notify_unblocked() is
  'I59 (settled 25 Sep): clearing an input tells whoever waited on it — the task''s assignee for a '
  'task-level input, the assignee of every open task on the deliverable (once each) for a '
  'deliverable-level one — never the person who cleared it. type task_unblocked.';

drop trigger if exists pending_input_notify_unblocked on deliverable_pending_inputs;
create trigger pending_input_notify_unblocked
  after update of satisfied_at on deliverable_pending_inputs
  for each row execute function app.tg_pending_input_notify_unblocked();

commit;
