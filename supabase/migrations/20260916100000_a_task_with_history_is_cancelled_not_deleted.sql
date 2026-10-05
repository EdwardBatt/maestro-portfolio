-- I49.67 — a task with ANY history is cancelled by Remove, never deleted.
--
-- `remove_sub_task` (ADR-0052 d.12/d.13, `20260828230000`) deletes a task that is "a plan" —
-- unassigned, still `todo`, never worked on — and cancels anything else so the record survives.
-- That predicate missed one kind of record: the SLA log. Since `20260911120000` (ADR-0075 d.3 /
-- ADR-0088 d.5) `sla_events` points at a task — `deadline_set` when its commitment is stamped on
-- assignment, `deadline_changed` on every later move of its plan — and the commitment survives an
-- unassignment. So a task that was given to somebody, then cancelled and reinstated (unassigned,
-- todo, no time logged) reads as "a plan", takes the delete branch, and the delete is refused by
-- `fk_sla_events_sub_task_tenant` (no cascade — the log is append-only by design). The person saw
-- "That action could not be completed" with a Report button, for pressing Remove.
--
-- Found by the coverage burn-down on 15 Sep, on the deliverables page.
--
-- "Never worked on" now reads as "never RECORDED": a task the log has anything to say about is
-- history, whatever its assignee and status columns say today, and Remove cancels it. A task
-- with no log row is still deleted outright — a template's unwanted steps struck out before
-- approval stay clutter-free, which is what d.12 was for. The surface reads the same predicate
-- (`fetchCancelImpact`) so the dialog promises the outcome the function delivers.
--
-- Reproduced whole from `20260828230000`; only the predicate changed.

begin;

create or replace function public.remove_sub_task(p_sub_task uuid)
returns text
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v sub_tasks;
  v_worked boolean;
  v_logged boolean;
begin
  select * into v from sub_tasks where id = p_sub_task and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002';
  end if;

  -- Same authority as assigning it: whoever may give this work out may take it away.
  if not (app.has_permission('project_tasks', 'manage')
          and app.in_write_scope(v.department_id, v.team_id,
                                 app.deliverable_account_manager(v.deliverable_id))) then
    raise exception 'removing this task is outside your scope' using errcode = '42501';
  end if;

  select exists (select 1 from task_time_entries te where te.sub_task_id = p_sub_task)
    into v_worked;
  -- I49.67: the log is a record too. A commitment stamped, a deadline moved, an extension asked
  -- for — any of these makes the task history, and history is cancelled, never deleted (the FK
  -- would refuse the delete anyway; this makes the answer a cancellation rather than an error).
  select exists (select 1 from sla_events e where e.sub_task_id = p_sub_task)
    into v_logged;

  -- A PLAN: unassigned, still todo, never worked on, never recorded. The first three are the
  -- approval gate's predicate (ADR-0052 d.10); the fourth is what the log adds.
  if v.assignee_id is null and v.status = 'todo' and not v_worked and not v_logged then
    delete from sub_tasks where id = p_sub_task;
    return 'deleted';
  end if;

  -- Anything else keeps its record. `sub_task_cancel` frees the calendar and audits.
  perform public.sub_task_cancel(p_sub_task);
  return 'cancelled';
end $$;

comment on function public.remove_sub_task(uuid) is
  'ADR-0052 d.12/d.13: remove a task from a deliverable''s list. A task that was only ever a PLAN '
  '(unassigned, todo, never worked, nothing in the SLA log — I49.67) is deleted; anything somebody '
  'was given, started, or that the log records is CANCELLED so the record survives. Returns which '
  'happened, so the surface can say so.';

revoke execute on function public.remove_sub_task(uuid) from public, anon;
grant execute on function public.remove_sub_task(uuid) to authenticated;

commit;
