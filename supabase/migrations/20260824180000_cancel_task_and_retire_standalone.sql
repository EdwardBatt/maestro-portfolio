-- Cancelling a task, and retiring the standalone-task concept (Edward, 24 Aug).
--
-- PART 1 — NOTHING IN THE APP CANCELS A TASK.
-- You can cancel a BOOKING, which leaves the task alive, assigned, due and off every calendar. That
-- is exactly the state the three tasks cleaned up on 24 Aug were in: their bookings had been
-- cancelled through the UI, the work was still owed, and nobody could see it. Every cancellation so
-- far has been a hand-written UPDATE.
--
-- Cancelling is SOFT: status becomes 'cancelled' and the row survives, because who cancelled what
-- and when is exactly the kind of record this system exists to keep — and the universal audit
-- trigger on sub_tasks captures it. A cancelled task leaves every working list and count, which is
-- what "removed" means from the user's side; nothing is destroyed.
--
-- It also RELEASES THE CALENDAR. Deleting the task's bookings is the whole point: cancelled work
-- must stop consuming somebody's capacity, or the schedule keeps lying about how busy they are.
--
-- PART 2 — STANDALONE TASKS ARE RETIRED.
-- ADR-0034 made sub_tasks.deliverable_id nullable so work could be assigned without a deliverable.
-- ADR-0035 then superseded that for anything reviewable: ad-hoc work assigned to a person creates a
-- deliverable precisely so it CAN be reviewed. Nothing has created a standalone task since; the
-- tenant holds zero; and media_records.deliverable_id is NOT NULL, so such a task could never hold a
-- version — it could be assigned and submitted but never actually reviewed. The nullable column has
-- since produced defensive branches in the frontend, an exemption in the submit gate and two rounds
-- of confusion in one day. Restoring NOT NULL deletes the ambiguity rather than documenting it.
--
-- search_path pinned inline per ADR-0033.

begin;

-- ============================================================================
-- 1) cancelling a task
-- ============================================================================
-- The assignee is told their work was called off — silently dropping somebody's work is the kind of
-- thing this whole day has been about.
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('assigned','review_requested','changes_requested','signed_off','blocked',
                  'due_soon','dependency_ready','cancelled'));

create or replace function public.sub_task_cancel(p_sub_task uuid)
returns void language plpgsql security definer
set search_path = public, app, extensions as $$
declare v sub_tasks;
begin
  select * into v from sub_tasks where id = p_sub_task and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002';
  end if;

  if v.status = 'cancelled' then
    return;                                   -- idempotent: cancelling twice is not an error
  end if;
  if v.status = 'done' then
    raise exception 'an approved task cannot be cancelled — it is already complete'
      using errcode = '22023';
  end if;

  -- Same authority as assigning it: whoever may give this work out may call it off.
  if not (app.has_permission('project_tasks', 'manage')
          and app.in_write_scope(v.department_id, v.team_id,
                                 app.deliverable_account_manager(v.deliverable_id))) then
    raise exception 'cancelling this task is outside your scope' using errcode = '42501';
  end if;

  update sub_tasks set status = 'cancelled' where id = p_sub_task;

  -- Free the calendar. Cancelled work must stop consuming capacity, or the schedule keeps telling
  -- everyone that person is busy.
  delete from bookings where sub_task_id = p_sub_task;

  if v.assignee_id is not null and v.assignee_id is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
    values (v.tenant_id, v.assignee_id, 'cancelled', v.title, 'sub_task', v.id, auth.uid());
  end if;
end $$;

comment on function public.sub_task_cancel(uuid) is
  'Cancel a task: status → cancelled, its bookings released so it stops consuming capacity, and the '
  'assignee told. Soft by design — the row survives for the record. Same authority as assigning it.';
revoke execute on function public.sub_task_cancel(uuid) from public;
revoke execute on function public.sub_task_cancel(uuid) from anon;
grant  execute on function public.sub_task_cancel(uuid) to authenticated;

-- ============================================================================
-- 2) every task belongs to a deliverable
-- ============================================================================
-- Fail loudly rather than deleting somebody's work to satisfy a constraint.
do $$
declare v_n int;
begin
  select count(*) into v_n from sub_tasks where deliverable_id is null;
  if v_n > 0 then
    raise exception
      'ADR-0034 retirement: % standalone task(s) still exist. Give each a deliverable or cancel it '
      'before applying this migration.', v_n
      using errcode = '23502';
  end if;
end $$;

alter table sub_tasks alter column deliverable_id set not null;

comment on column sub_tasks.deliverable_id is
  'The deliverable this task belongs to. NOT NULL again since 24 Aug: ADR-0034''s standalone task was '
  'superseded by ADR-0035 (ad-hoc work creates a deliverable so it can be reviewed), nothing has '
  'created one since, and a task without a deliverable could never hold a version — reviewable in '
  'name only.';

-- The submit gate's exemption for a task with no deliverable is now unreachable. Left in place
-- deliberately: it costs one branch, and re-deriving it if the column ever loosens again would be
-- worse than keeping a comment saying why it is there.

commit;
