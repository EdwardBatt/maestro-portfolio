-- ADR-0121 (Edward, 27 Sep) — I59.66. A re-opened task goes back to be assigned.
--
-- ADR-0103 d.2 kept the assignee on a re-opened task and never booked it again, so the work sat on
-- nobody's week: assigned, therefore not in anyone's "to assign" list, and with only its old booking.
-- Found on production: five "Create Brunos Static Post" tasks re-opened 27 Sep, still on Zubaida Jamil
-- Ibrahim, due 29 Sep, their only booking 15–17 Sep. Edward chose B: "reopening sends the task back
-- unassigned", and wants those five available to assign now.
--
-- 1) `app.reopen_one_task` — reproduced WHOLE from 20260925100000 (its only definition; production
--    checked identical 27 Sep). Changes, each marked ADR-0121:
--    - the task is left with NOBODY on it: assignee, start and commitment cleared (the commitment is
--      stamped again by whoever assigns it next, from the new due date);
--    - its bookings are released (deleted), as the scheduler releases an unassigned task's — the next
--      assignment books it fresh;
--    - the reviewers are told, and the previous maker is not: the task is no longer theirs, and
--      whoever is given it next is told by the ordinary assignment notification.
-- 2) The tasks already re-opened and left assigned with nothing booked since — the five above — are
--    put in the same state, so they show under "to assign" on the Schedule.

begin;

-- ============================================================================
-- 1) re-opening leaves the task to be assigned
-- ============================================================================
create or replace function app.reopen_one_task(p_sub_task uuid, p_reason text, p_due_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v sub_tasks;
  v_actor uuid := auth.uid();
  r record;
begin
  select * into v from sub_tasks where id = p_sub_task and tenant_id = app.current_tenant_id() for update;
  if not found then
    raise exception 'task % not found', p_sub_task using errcode = 'P0002';
  end if;
  if v.status = 'cancelled' then
    raise exception '"%" was called off, not finished — it cannot be re-opened', v.title using errcode = '22023';
  end if;
  if v.status <> 'done' then
    raise exception '"%" is not finished — only an approved task is re-opened', v.title using errcode = '22023';
  end if;

  -- ADR-0121: the old plan goes with the old assignment; the next assignment books it afresh.
  delete from bookings where sub_task_id = p_sub_task;

  perform set_config('app.task_reopen', 'on', true);
  update sub_tasks
     set status              = 'todo',
         approved_at         = null,
         approved_by         = null,
         due_at              = p_due_at,
         -- ADR-0121: back to be assigned — nobody on it, no start, no commitment until someone is.
         assignee_id         = null,
         starts_at           = null,
         committed_starts_at = null,
         committed_due_at    = null,
         committed_hours     = null,
         revision_number     = coalesce(revision_number, 0) + 1
   where id = p_sub_task;
  perform set_config('app.task_reopen', 'off', true);
  -- The reviewers' answers are cleared by app.tg_subtask_clear_approvals (status left done).

  insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload)
  values (v.tenant_id, v_actor, 'task_reopened', 'sub_tasks', v.id,
          jsonb_build_object('reason', p_reason, 'due_at', p_due_at,
                             'was_approved_at', v.approved_at, 'was_approved_by', v.approved_by,
                             'was_due_at', v.due_at, 'was_assignee', v.assignee_id,
                             'deliverable_id', v.deliverable_id));

  -- ADR-0121: the reviewers are told — never the person who re-opened it. The previous maker is not:
  -- the task is no longer theirs, and whoever is given it is told by the assignment itself.
  for r in
    select rv.user_id from sub_task_reviewers rv where rv.sub_task_id = v.id
  loop
    if r.user_id is distinct from v_actor then
      insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
      values (v.tenant_id, r.user_id, 'task_reopened', v.title, 'sub_task', v.id, v_actor,
              jsonb_build_object('reason', p_reason, 'due_at', p_due_at, 'for_reviewer', true));
    end if;
  end loop;
end $$;

-- ============================================================================
-- 2) the tasks already re-opened and left on nobody's week
-- ============================================================================
do $fix$
declare
  v_ids uuid[];
begin
  select array_agg(st.id) into v_ids
    from sub_tasks st
    join lateral (
      select max(a.created_at) as reopened_at
        from audit_events a
       where a.entity = 'sub_tasks' and a.entity_id = st.id and a.action = 'task_reopened'
    ) ro on ro.reopened_at is not null
   where st.status = 'todo'
     and st.assignee_id is not null
     -- nothing booked for it since it was re-opened, and nobody has started on it again
     and not exists (select 1 from bookings b where b.sub_task_id = st.id and upper(b.timespan) > ro.reopened_at)
     and not exists (select 1 from task_time_entries te where te.sub_task_id = st.id and te.created_at > ro.reopened_at);

  if v_ids is not null then
    delete from bookings where sub_task_id = any (v_ids);
    perform set_config('app.task_reopen', 'on', true);
    update sub_tasks
       set assignee_id = null, starts_at = null,
           committed_starts_at = null, committed_due_at = null, committed_hours = null
     where id = any (v_ids);
    perform set_config('app.task_reopen', 'off', true);
  end if;
  raise notice 'ADR-0121: % re-opened task(s) put back to be assigned', coalesce(array_length(v_ids, 1), 0);
end $fix$;

commit;
