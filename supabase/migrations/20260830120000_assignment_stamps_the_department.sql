-- I28.6 (ADR-0060 d.9) — a task counts against the department of whoever is doing it.
--
-- **The bug.** `public.update_task_assignment` writes the assignee, the dates, the hours and the
-- reviewer list, and has never touched `department_id`. The `/deliverables` add form does pass it
-- (`DeliverablesPage.tsx`: `departmentId: u?.departmentId`), so the two assignment surfaces
-- disagreed about the same fact.
--
-- A materialised task inherits the DELIVERABLE's department, which ADR-0050 stamps from the
-- deliverable's OWNER. So an OOH deliverable owned by a creative lead lays down Artwork, Production,
-- Proof and Installation all stamped Creative. Give Installation to somebody in Production and the
-- task stayed counted against Creative — in the per-department metrics, in the unassigned counts,
-- and in `app.in_write_scope` for everybody who touched it afterwards.
--
-- Edward, 30 Aug: *"tasks should be tracked against the department for the user assigned."* That is
-- also what ADR-0053 decided at the deliverable level and what I20.4 restamps when a person changes
-- department. This makes the task agree with both.
--
-- ADR-0060 turns `/schedule` into the main assignment surface, so leaving this would take a defect
-- that was reachable from one screen and make it the normal path.
--
-- **THE ORDER IS LOAD-BEARING.** `app.in_write_scope` is tested against `v` — the task as it stands
-- BEFORE this call — and `v` is read at the top, before the update. Testing the NEW department
-- instead would turn this into a way to move a task out of a department you have no authority over
-- by assigning it to somebody in one you do. The gate asks "may you edit this task?", never "may
-- you edit what it is about to become".
--
-- Reproduced WHOLE from `20260830090000_review_mode_digital_or_manual.sql` (the current definition),
-- the house pattern: a bare `create or replace` resets `proconfig` and drops the ADR-0033
-- `search_path` pin. The signature is unchanged, so nothing is dropped and no caller changes.

begin;

create or replace function public.update_task_assignment(
  p_sub_task    uuid,
  p_title       text,
  p_assignee    uuid,
  p_reviewers   jsonb default null,
  p_starts_at   timestamptz default null,
  p_due_at      timestamptz default null,
  p_hours       numeric default null,
  p_review_mode text default null
) returns table(sub_task_id uuid, deliverable_id uuid, reschedule_needed boolean)
language plpgsql security definer set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v sub_tasks%rowtype;
  v_reassigned boolean;
  v_dates_changed boolean;
  v_lead uuid;
  v_dept uuid;
  v_team uuid;
begin
  select * into v from sub_tasks where id = p_sub_task and tenant_id = v_tenant;
  if not found then raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002'; end if;

  -- Against `v`, the task as it stands NOW. See the header: testing the incoming department would
  -- make this a way out of a scope you do not hold.
  if not (app.has_permission('project_tasks', 'manage')
          and app.in_write_scope(v.department_id, v.team_id, app.deliverable_account_manager(v.deliverable_id))) then
    raise exception 'editing this task requires project-task management permission' using errcode = '42501';
  end if;

  if coalesce(trim(p_title), '') = '' then
    raise exception 'a task title is required' using errcode = '22023';
  end if;
  if p_assignee is null then
    raise exception 'an assignee is required' using errcode = '22023';
  end if;
  -- Fetched, not trusted: the placement comes from the assignee's own profile, fenced to this
  -- tenant, so a caller cannot send a department alongside a person who is not in it. This is also
  -- the membership check the old version did separately.
  select up.department_id, up.team_id into v_dept, v_team
    from user_profiles up where up.id = p_assignee and up.tenant_id = v_tenant;
  if not found then
    raise exception 'that assignee is not in your organization' using errcode = '22023';
  end if;
  if p_review_mode is not null and p_review_mode not in ('digital', 'manual') then
    raise exception 'review mode must be digital or manual' using errcode = '22023';
  end if;

  if p_reviewers is not null then
    if jsonb_typeof(p_reviewers) <> 'array' then
      raise exception 'the reviewer list must be a JSON array' using errcode = '22023';
    end if;
    if jsonb_array_length(p_reviewers) = 0 then
      raise exception 'a reviewer must be appointed for this task' using errcode = '22023';
    end if;
    if (select count(*) from jsonb_array_elements(p_reviewers) e) <>
       (select count(distinct e ->> 'user_id') from jsonb_array_elements(p_reviewers) e) then
      raise exception 'the same reviewer is listed twice' using errcode = '22023';
    end if;
  end if;

  v_reassigned := p_assignee is distinct from v.assignee_id;
  v_dates_changed := (p_starts_at is not null and p_starts_at is distinct from v.starts_at)
                  or (p_due_at    is not null and p_due_at    is distinct from v.due_at)
                  or (p_hours     is not null and p_hours     is distinct from v.sla_hours);

  update sub_tasks set
    title       = trim(p_title),
    assignee_id = p_assignee,
    -- ADR-0060 d.9. COALESCE, not a bare assignment: a person with no department recorded must not
    -- WIPE a department the task already had. An unknown placement is not a statement that the task
    -- belongs nowhere.
    department_id = coalesce(v_dept, department_id),
    team_id       = coalesce(v_team, team_id),
    starts_at   = coalesce(p_starts_at, starts_at),
    due_at      = coalesce(p_due_at, due_at),
    sla_hours   = coalesce(p_hours, sla_hours),
    review_mode = coalesce(p_review_mode, review_mode),
    -- reset the human-override flag so subtask-schedule rebuilds the booking on reassign / date change
    schedule_overridden = case when v_reassigned or v_dates_changed then false else schedule_overridden end
  where id = p_sub_task;

  -- The appointments are applied AFTER the assignee moves, and the order is load-bearing: one call
  -- can both reassign the task and name the previous assignee as a reviewer. The write guard tests
  -- each appointment against the task's CURRENT assignee, so doing this first would refuse that
  -- edit against an assignee who is on their way out.
  if p_reviewers is not null then
    delete from sub_task_reviewers r
     where r.sub_task_id = p_sub_task
       and not exists (
         select 1 from jsonb_array_elements(p_reviewers) e
         where (e ->> 'user_id')::uuid = r.user_id);

    update sub_task_reviewers r
       set is_mandatory = coalesce((e ->> 'is_mandatory')::boolean, false)
      from jsonb_array_elements(p_reviewers) e
     where r.sub_task_id = p_sub_task
       and r.user_id = (e ->> 'user_id')::uuid
       and r.is_mandatory is distinct from coalesce((e ->> 'is_mandatory')::boolean, false);

    insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory, created_by)
    select v_tenant, p_sub_task, (e ->> 'user_id')::uuid,
           coalesce((e ->> 'is_mandatory')::boolean, false), auth.uid()
    from jsonb_array_elements(p_reviewers) e
    where not exists (
      select 1 from sub_task_reviewers r
      where r.sub_task_id = p_sub_task and r.user_id = (e ->> 'user_id')::uuid);
  end if;

  -- parent deliverable: keep the deliverable-level reviewer record in step (ADR-0043 d.9). Only
  -- rename an AD-HOC deliverable (stream_id null) — never rename a project deliverable from a
  -- booking edit.
  if v.deliverable_id is not null then
    select r.user_id into v_lead from sub_task_reviewers r
     where r.sub_task_id = p_sub_task
     order by r.is_mandatory desc, r.created_at, r.user_id
     limit 1;
    update deliverables set
      reviewer_id = coalesce(v_lead, reviewer_id),
      name = case when stream_id is null then trim(p_title) else name end
    where id = v.deliverable_id;
  end if;

  -- keep the linked booking's title column in step. Qualify bookings.sub_task_id — the OUT
  -- parameter sub_task_id would otherwise shadow it.
  update bookings set title = trim(p_title) where bookings.sub_task_id = p_sub_task;

  sub_task_id := p_sub_task;
  deliverable_id := v.deliverable_id;
  reschedule_needed := v_reassigned or v_dates_changed;
  return next;
end $$;

comment on function public.update_task_assignment(uuid, text, uuid, jsonb, timestamptz, timestamptz, numeric, text) is
  'ADR-0038/0040, amended by ADR-0043, ADR-0059 d.4 and ADR-0060 d.9: assign a task — assignee, '
  'reviewers, dates, hours, review mode — and stamp its DEPARTMENT and TEAM from the person it is '
  'assigned to, so the work counts against whoever is doing it. The write-scope gate is evaluated '
  'against the task''s placement BEFORE the change, never after, so this is not a route out of a '
  'scope the caller does not hold.';

commit;
