-- I19.9 (ADR-0052 d.12, d.13, d.14) — the task list is editable, and two edits need care.
--
-- Add, retitle and re-date already work through `public.save_sub_task`. Two do not: removing a row,
-- and reordering them.
--
-- **REMOVING.** `public.sub_task_cancel` already exists and does the right thing for work in
-- flight: it cancels, frees the calendar, and leaves the record. But a template lays down a whole
-- list at once, and an Account Manager reading it before approval will strike out steps this job
-- does not need — leaving a row of cancelled tasks in a plan nobody has started yet, which is
-- clutter pretending to be history.
--
-- So "remove" means two different things and the function decides which:
--
--   * a task that is **a plan** — unassigned, still `todo`, never worked on — is DELETED. It was
--     never anybody's work, so there is nothing to keep a record of. That is the same definition of
--     "a plan" the approval gate uses in ADR-0052 d.10, deliberately: one idea, one predicate.
--   * anything else is CANCELLED through the existing path. Work somebody was given, or started,
--     leaves a trace whatever happens to it.
--
-- d.13: the SURFACE warns before the second case, because deleting a booking out from under
-- somebody who has it in My Work is not something to do on one click. `bookings.sub_task_id` is
-- `on delete cascade`, which is what makes the warning necessary rather than merely polite.
--
-- **REORDERING.** `sort_order` is presentation, and that is the whole decision: `starts_at` and
-- `due_at` are not touched, ever. Moving step 4 to step 7 must not silently move anybody's week —
-- the same class of surprise as the booking that relocated itself onto a non-working day (`I17`).

begin;

create or replace function public.remove_sub_task(p_sub_task uuid)
returns text
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v sub_tasks;
  v_worked boolean;
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

  -- A PLAN: unassigned, still todo, never worked on. Identical to the predicate the approval gate
  -- uses (ADR-0052 d.10) — one definition, not two that can drift apart.
  if v.assignee_id is null and v.status = 'todo' and not v_worked then
    delete from sub_tasks where id = p_sub_task;
    return 'deleted';
  end if;

  -- Anything else keeps its record. `sub_task_cancel` frees the calendar and audits.
  perform public.sub_task_cancel(p_sub_task);
  return 'cancelled';
end $$;

comment on function public.remove_sub_task(uuid) is
  'ADR-0052 d.12/d.13: remove a task from a deliverable''s list. A task that was only ever a PLAN '
  '(unassigned, todo, never worked) is deleted; anything somebody was given or started is CANCELLED '
  'so the record survives. Returns which happened, so the surface can say so.';

revoke execute on function public.remove_sub_task(uuid) from public, anon;
grant execute on function public.remove_sub_task(uuid) to authenticated;

-- ------------------------------------------------------------------- reordering ----
create or replace function public.resequence_deliverable_tasks(
  p_deliverable uuid,
  p_ordered_ids uuid[]
) returns integer
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant  uuid := app.current_tenant_id();
  v_dept    uuid;
  v_team    uuid;
  v_updated integer;
begin
  if not exists (select 1 from deliverables d where d.id = p_deliverable and d.tenant_id = v_tenant) then
    raise exception 'deliverable % not found', p_deliverable using errcode = 'P0002';
  end if;

  -- Authority is judged on the deliverable, not on each task: reordering is one act on one list.
  select d.department_id, null::uuid into v_dept, v_team
    from deliverables d where d.id = p_deliverable;
  if not (app.has_permission('project_tasks', 'manage')
          and app.in_write_scope(v_dept, v_team, app.deliverable_account_manager(p_deliverable))) then
    raise exception 'reordering this list is outside your scope' using errcode = '42501';
  end if;

  -- d.14: sort_order and NOTHING else. No starts_at, no due_at. Order is presentation; a schedule
  -- is a commitment somebody has made, and rearranging a list must never quietly move it.
  update sub_tasks st
     set sort_order = ord.n
    from unnest(p_ordered_ids) with ordinality as ord(id, n)
   where st.id = ord.id
     and st.deliverable_id = p_deliverable
     and st.tenant_id = v_tenant;

  get diagnostics v_updated = row_count;
  return v_updated;
end $$;

comment on function public.resequence_deliverable_tasks(uuid, uuid[]) is
  'ADR-0052 d.14: set the presentation order of a deliverable''s tasks. Touches sort_order ONLY — '
  'never starts_at or due_at. Ids that do not belong to this deliverable are ignored rather than '
  'moved, so a stale list from another screen cannot reorder somebody else''s work.';

revoke execute on function public.resequence_deliverable_tasks(uuid, uuid[]) from public, anon;
grant execute on function public.resequence_deliverable_tasks(uuid, uuid[]) to authenticated;

commit;
