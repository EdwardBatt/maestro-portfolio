-- I36.2 (ADR-0068 d.4), narrowed the day it was written — ad-hoc cancellation is final, and the
-- database says so rather than leaving it to the surface.
--
-- WHAT WAS FOUND. `sub_task_cancel` does more than cancel the task: for AD-HOC work it also
-- archives the deliverable (ADR-0061 d.6 — "an ad-hoc deliverable IS its task, so cancelling the
-- last live one settles it"). And `archived` is TERMINAL in the transition graph (ADR-0024:
-- `when 'archived' then array[]::deliverable_state[]`), with no escape — `app.system_op` exempts
-- the column-freezing branch of the guard, not the legality check.
--
-- So `sub_task_reinstate` as first written returned the TASK to `todo` and left the deliverable
-- archived: live work under a container nothing can revive. Worse than no undo, and it succeeded
-- silently.
--
-- THE DECISION (Edward, 3 Sep). Not to amend ADR-0024's state machine to make `archived`
-- reversible — ad-hoc assignment is being retired, so the mechanism is not worth changing. Instead
-- **the promise changes**: both surfaces now warn that ad-hoc cancellation cannot be undone, and
-- this function refuses it outright.
--
-- WHY REFUSE IN THE DATABASE RATHER THAN JUST HIDE THE BUTTON. An RPC is a front door (ADR-0055's
-- phrasing, and ADR-0068's own reasoning about stamped columns). A UI that declines to offer an
-- action is a decision about a screen; a function that refuses it is a decision about the system.
-- The two surfaces say "cannot be reinstated" — this is what makes that sentence true.
--
-- CAMPAIGN WORK IS UNAFFECTED. A campaign deliverable holds several tasks and is never settled by
-- one of them (ADR-0038), so cancelling a task there archives nothing and reinstating it is the
-- ordinary undo ADR-0068 d.4 describes.
--
-- Reproduced WHOLE from `20260903110000`, the house pattern for `create or replace`: a bare replace
-- resets `proconfig` and silently drops the ADR-0033 `search_path` pin. The only edit is the guard.

begin;

create or replace function public.sub_task_reinstate(p_sub_task uuid)
returns void
language plpgsql
security definer
set search_path = public, app, extensions as $$
declare
  v sub_tasks;
  v_stream uuid;
  v_state  deliverable_state;
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

  -- The guard this migration exists for. Ad-hoc work whose job was archived by its own
  -- cancellation cannot come back, because the job cannot — so refuse rather than produce a live
  -- task under a dead container.
  if v.deliverable_id is not null then
    select d.stream_id, d.state into v_stream, v_state
      from deliverables d where d.id = v.deliverable_id;
    if v_stream is null and v_state = 'archived' then
      raise exception
        'ad-hoc work cannot be reinstated: cancelling it closed the job, and an archived job is final'
        using errcode = '22023';
    end if;
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
  'the bookings and does NOT restore the assignee (d.5). REFUSES ad-hoc work whose job was archived '
  'by its own cancellation (ADR-0061 d.6 + ADR-0024''s terminal archived state) — that undo does '
  'not exist, and both surfaces say so rather than offering it.';

commit;
