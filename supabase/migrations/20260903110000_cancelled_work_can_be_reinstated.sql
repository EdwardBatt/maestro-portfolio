-- I36.2 (ADR-0068 d.4–d.7) — a cancelled task can be reinstated.
--
-- WHY. `sub_task_cancel` sets `status = 'cancelled'` and deletes the task's bookings. Deleting them
-- is right (ADR-0061: cancelled work must stop consuming capacity, or the schedule keeps telling
-- everyone that person is busy) — but nothing anywhere moved a task back out of `cancelled`, and
-- `update_task_assignment` never touches `status`. So re-assigning through the app produced a task
-- that was assigned, booked, and still read `cancelled`: a state no surface expects.
--
-- On 2 September a live task was cancelled by mistake and the only route back was hand-written SQL
-- against production, in two steps, because neither SQL alone nor a UI re-assign alone restores a
-- coherent state. The bookings were reconstructed from `audit_events` — which worked only because
-- `app.audit_row_change` stores the FULL row on a DELETE. A good property, and a terrible recovery
-- procedure to depend on.
--
-- WHAT THIS DELIBERATELY DOES NOT DO: recreate the bookings (d.5). The task comes back UNASSIGNED
-- and UNSCHEDULED. Silently rebuilding the calendar would re-take capacity that may since have been
-- given to somebody else — precisely the invisible change ADR-0061 was written about — and it would
-- do so without the capacity check, the working-week check or the notification that
-- `update_task_assignment` + `subtask-schedule` perform. Assigning it back is one action down a path
-- that already does all three.
--
-- The assignee is cleared for the same reason: leaving a name on an unscheduled task claims somebody
-- is doing work that is on nobody's calendar, which is the exact shape of how work went missing.
--
-- `done` STAYS UNCANCELLABLE and therefore unreinstatable. Reinstate undoes a mistake; reopening
-- finished work is Request Changes, which exists (ADR-0030 §1).

begin;

-- ---- the notification type, before anything inserts one ----
-- Reproduced whole from `20260831120200`, plus `task_reinstated`. That constraint's own comment is
-- the warning to heed: "Every value here needs COPY in notify-email or it is silently in-app only —
-- the failure mode this list has already produced six times (I30.2)." Copy is added in the same
-- change set, in `notify-email` and in the inbox's EN/AR strings.
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('assigned','review_requested','changes_requested','signed_off','blocked',
                  'due_soon','dependency_ready','cancelled','resource_clash','resource_required',
                  'campaign_approved','deliverable_reassigned','rescheduled','chat_added',
                  'task_reinstated'));

comment on constraint notifications_type_check on notifications is
  'ADR-0028 + I31.7 + ADR-0068 d.6. Every value here needs COPY in notify-email or it is silently '
  'in-app only — the failure mode this list has already produced six times (I30.2).';

create or replace function public.sub_task_reinstate(p_sub_task uuid)
returns void
language plpgsql
security definer
set search_path = public, app, extensions as $$
declare
  v sub_tasks;
begin
  select * into v from sub_tasks where id = p_sub_task and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002';
  end if;

  -- Only from `cancelled`. Anything else is either already live or finished, and "reinstating" it
  -- would be a silent status rewrite rather than an undo.
  if v.status <> 'cancelled' then
    raise exception 'only a cancelled task can be reinstated' using errcode = '22023';
  end if;

  -- The same authority that cancelled it: whoever may call work off may call it back on. Mirrors
  -- `sub_task_cancel` exactly rather than inventing a second rule that can drift from it.
  if not (app.has_permission('project_tasks', 'manage')
          and app.in_write_scope(v.department_id, v.team_id,
                                 app.deliverable_account_manager(v.deliverable_id))) then
    raise exception 'reinstating this task is outside your scope' using errcode = '42501';
  end if;

  update sub_tasks
     set status      = 'todo',
         assignee_id = null
   where id = p_sub_task;

  -- Tell whoever lost the work that it is back (d.6). Being un-cancelled is as much news as being
  -- cancelled, and ADR-0061's rule is that assignment says what actually happened. Skipped when the
  -- task was never assigned — there is nobody who lost anything — and when the person reinstating
  -- IS the former assignee, who does not need telling what they just did.
  if v.assignee_id is not null and v.assignee_id is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
    values (v.tenant_id, v.assignee_id, 'task_reinstated', v.title, 'sub_task', v.id, auth.uid());
  end if;
end $$;

comment on function public.sub_task_reinstate(uuid) is
  'ADR-0068 d.4: cancelled -> todo, under the same authority that cancelled it. Does NOT recreate '
  'the bookings and does NOT restore the assignee (d.5): the calendar may have been given away, and '
  'a named assignee on an unscheduled task claims somebody is doing work that is on nobody''s '
  'calendar. Notifies whoever lost the work.';

revoke execute on function public.sub_task_reinstate(uuid) from anon;
grant  execute on function public.sub_task_reinstate(uuid) to authenticated;

commit;
