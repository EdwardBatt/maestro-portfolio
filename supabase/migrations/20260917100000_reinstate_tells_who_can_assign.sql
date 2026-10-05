-- I52.7 (Edward, 17 Sep) — a reinstated task is announced to the people who can assign it.
--
-- ADR-0068 d.6 told "whoever lost the work" that it was back. Edward, reading the mail as sent:
-- "this is idiotic… the reinstatement requires action… it cannot be assigned by a team member."
-- Reinstate clears the assignee and rebuilds no bookings (d.5), so it CREATES an action — somebody
-- with booking authority has to assign the task again — and the only person told was the one
-- person who cannot do it. The former assignee is no longer told; nothing is theirs to do.
--
-- Two ways to reinstate now, chosen by the caller (option A, decided 17 Sep):
--
--   * `p_assigning = true`  — the screen is assigning it in the same step (the picker opened with
--                             Reinstate). Nobody is told here: the assignment that follows writes
--                             `assignee_id`, and `app.tg_subtask_notify_assignee` sends the ordinary
--                             `assigned` notification. A `task_reinstated` mail on top would be the
--                             same event worded twice (I12.9).
--   * `p_assigning = false` — it comes back unassigned. The leads whose reach covers the task —
--                             the same set ADR-0087 d.6 names for a booking request, evaluated over
--                             the task's department and team rather than a resource — and the
--                             deliverable's owner are told it needs assigning. Never the caller.
--
-- The signature gains a defaulted parameter, which `create or replace` cannot do, so the old one is
-- dropped and the grants restated. The body is otherwise reproduced whole from `20260903120000`
-- (search_path pinned, ADR-0033). The ADR-0068 addendum is held until Edward has been through every
-- message (TASKS.md I52); this migration is the mechanism, not the record.

begin;

drop function if exists public.sub_task_reinstate(uuid);

create function public.sub_task_reinstate(p_sub_task uuid, p_assigning boolean default false)
returns void
language plpgsql
security definer
set search_path = public, app, extensions as $$
declare
  v sub_tasks;
  v_stream uuid;
  v_state  deliverable_state;
  v_owner  uuid;
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

  -- Ad-hoc work whose job was archived by its own cancellation cannot come back, because the job
  -- cannot — so refuse rather than produce a live task under a dead container.
  if v.deliverable_id is not null then
    select d.stream_id, d.state, d.owner_user_id into v_stream, v_state, v_owner
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

  -- The caller is assigning it now: the assignment says so (ADR-0061), nothing else needs to.
  if p_assigning then
    return;
  end if;

  -- It comes back unassigned: tell the people who can put it on a calendar. Department-scoped
  -- holders of bookings:create over the task's department, team-scoped holders over its team (or
  -- over the department's teams when the task names none), and the deliverable's owner. The scope
  -- test mirrors public.assignment_request_approvers over the task instead of a resource. Never the
  -- caller, and never the former assignee — there is nothing for them to do.
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
  select distinct v.tenant_id, r.user_id, 'task_reinstated', v.title, 'sub_task', v.id, auth.uid()
    from (
      select up.id as user_id
        from public.user_profiles up
        join public.roles r on r.id = up.role_id
       where up.tenant_id = v.tenant_id and up.is_active
         and app.user_has_permission(up.id, 'bookings', 'create')
         and (
           (r.scope = 'department' and up.department_id is not null and (
               up.department_id = v.department_id
               or (v.team_id is not null and exists (
                     select 1 from public.teams t
                     where t.id = v.team_id and t.department_id = up.department_id))))
           or
           (r.scope = 'team' and up.team_id is not null and (
               (v.team_id is not null and v.team_id = up.team_id)
               or (v.team_id is null and v.department_id is not null and exists (
                     select 1 from public.teams t
                     where t.id = up.team_id and t.department_id = v.department_id))))
         )
      union
      select v_owner where v_owner is not null
    ) r
   where r.user_id is distinct from auth.uid();
end $$;

comment on function public.sub_task_reinstate(uuid, boolean) is
  'ADR-0068 d.4: cancelled -> todo, under the same authority that cancelled it. Does NOT recreate '
  'the bookings and does NOT restore the assignee (d.5). REFUSES ad-hoc work whose job was archived '
  'by its own cancellation (ADR-0061 d.6 + ADR-0024''s terminal archived state). I52.7: with '
  'p_assigning the caller assigns it in the same step and nobody is told here (the assignment '
  'is); without, the leads in reach and the deliverable''s owner are told it needs assigning. The '
  'former assignee is never told — the mail used to go to the one person who could not act.';

revoke execute on function public.sub_task_reinstate(uuid, boolean) from public;
revoke execute on function public.sub_task_reinstate(uuid, boolean) from anon;
grant  execute on function public.sub_task_reinstate(uuid, boolean) to authenticated;

commit;
