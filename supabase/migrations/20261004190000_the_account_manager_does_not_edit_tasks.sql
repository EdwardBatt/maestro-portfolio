-- I74.53 (ADR-0140 addendum, Edward 4 Oct: "AM should not edit other departments' tasks either").
--
-- A deliverable's tasks are its department's: its owner, its leads within reach (team leads, deputies, the department
-- lead), and Traffic and the Power Admin edit them (ADR-0140 d.2). The account manager changes the DELIVERABLE
-- (ADR-0141) — its type, quantity, languages, due day, the change asks — and asks a lead for a person (ADR-0139); she
-- does not edit, add, remove, reorder, cancel or reinstate its tasks.
--
-- She passed because every task write asked `app.in_write_scope(department, team, app.deliverable_account_manager(…))`,
-- and the account branch of `in_write_scope` is true for the deliverable's named account manager. That argument is
-- now null in the three row policies of `sub_tasks` and in the five task actions that asked it. Nothing else in them
-- changes (each is re-created from its current definition with only that argument replaced).
--
-- Unchanged, deliberately: her deliverable changes regenerate and rename tasks through SECURITY DEFINER functions
-- (`change_deliverable_type`, `app.resize_deliverable_units`, `app.retitle_deliverable_tasks`,
-- `app.place_translation_task`, `app.apply_deliverable_change_request`, `app.materialise_deliverable_workflow`), which
-- do not read these policies; her asks for a person go through `request_task_booking`. A task's ASSIGNEE still edits
-- her own task (the update policy's assignee branch), and the deliverable's owner still edits every task on it.

begin;

-- public.remove_sub_task: the account manager is no longer passed into the reach check.
CREATE OR REPLACE FUNCTION public.remove_sub_task(p_sub_task uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
declare
  v sub_tasks;
  v_worked boolean;
  v_logged boolean;
begin
  select * into v from sub_tasks where id = p_sub_task and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002';
  end if;

  -- Same authority as assigning it: whoever may give this work out may take it away. ADR-0140 d.2: and the owner.
  if not ((app.has_permission('project_tasks', 'manage')
           and app.in_write_scope(v.department_id, v.team_id,
                                  null))
          or app.is_piece_owner(v.deliverable_id)) then
    raise exception 'You cannot remove this task: it is outside your reach.%',
            app.refusal_ask(app.refusal_names_deliverable_owner(v.deliverable_id))
      using errcode = '42501',
            detail = coalesce(app.refusal_names_deliverable_owner(v.deliverable_id), ''),
            hint = 'remove_task';
  end if;

  select exists (select 1 from task_time_entries te where te.sub_task_id = p_sub_task)
    into v_worked;

  -- ADR-0140 d.3: a started task is not removed.
  if v.status in ('in_progress', 'review') or v_worked then
    raise exception '% has started this — a started task cannot be removed',
            coalesce((select display_name from user_profiles where id = v.assignee_id), 'Someone')
      using errcode = '22023',
            detail = coalesce((select display_name from user_profiles where id = v.assignee_id), ''),
            hint = 'task_started';
  end if;

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
end $function$;

-- public.resequence_deliverable_tasks: the account manager is no longer passed into the reach check.
CREATE OR REPLACE FUNCTION public.resequence_deliverable_tasks(p_deliverable uuid, p_ordered_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
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
          and app.in_write_scope(v_dept, v_team, null)) then
    -- The words the person reads. Kept in step with `deliverables.outsideReach` in the locales:
    -- the surface shows this verbatim (I53.28), so this IS the copy, not a developer's note.
    raise exception 'You cannot reorder this list: it is outside your reach.%',
            app.refusal_ask(app.refusal_names_deliverable_owner(p_deliverable))
      using errcode = '42501',
            detail = coalesce(app.refusal_names_deliverable_owner(p_deliverable), ''''),
            hint = 'reorder_tasks';
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
end $function$;

-- public.update_task_assignment: the account manager is no longer passed into the reach check.
CREATE OR REPLACE FUNCTION public.update_task_assignment(p_sub_task uuid, p_title text, p_assignee uuid, p_reviewers jsonb DEFAULT NULL::jsonb, p_starts_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_hours numeric DEFAULT NULL::numeric, p_review_mode text DEFAULT NULL::text, p_confirm_started boolean DEFAULT false)
 RETURNS TABLE(sub_task_id uuid, deliverable_id uuid, reschedule_needed boolean, outcome text, request_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$declare
  v_tenant uuid := app.current_tenant_id();
  v sub_tasks%rowtype;
  v_reassigned boolean;
  v_dates_changed boolean;
  v_days_changed boolean;     -- ADR-0140: the days alone (not the hours)
  v_days_requested boolean := false;
  v_owner boolean;            -- ADR-0140
  v_lead uuid;
  v_dept uuid;
  v_team uuid;
  -- ADR-0087
  v_approving uuid := app.try_uuid(nullif(current_setting('app.assignment_request', true), ''));
  v_resource uuid;
  v_res_dept uuid;
  v_res_team uuid;
  v_request uuid;
  v_held_res uuid;            -- ADR-0140: the calendar of the person who holds the task now
  v_held_team uuid;
begin
  select * into v from sub_tasks where id = p_sub_task and tenant_id = v_tenant;
  if not found then raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002'; end if;
  v_owner := app.is_piece_owner(v.deliverable_id);

  if v_approving is not null then
    -- ADR-0087 d.7. The task half of ADR-0040's authority was held by the requester and tested when
    -- the request was made; the row below is the proof, and it must be the request being approved
    -- right now, by this caller, for this task. Anything else is not an approval.
    if not exists (
      select 1 from sub_task_assignment_requests q
       where q.id = v_approving and q.sub_task_id = p_sub_task and q.tenant_id = v_tenant
         and q.status = 'approved' and q.decided_by = auth.uid()
         and q.assignee_id = p_assignee) then
      raise exception 'that is not an approval of a request on this task' using errcode = '42501';
    end if;
  -- ADR-0060 addendum, 22 Sep (Edward): ASSIGNING a task on an approved campaign needs
  -- project_tasks:manage and the ASSIGNEE within the caller's reach — decided below, where the
  -- resource is tested and an out-of-reach person becomes a request (ADR-0087). Which department
  -- owns the deliverable no longer matters: the task's department follows the person who will do
  -- it (d.9's first half stands; its "tested against the task as it stands" gate is withdrawn).
  -- EDITING a task — title, dates, hours — with no change of assignee still asks that the task be
  -- within reach: that is the work's own department's business. ADR-0140 d.2: or that the caller own the piece.
  elsif not (app.has_permission('project_tasks', 'manage') or v_owner) then
    raise exception 'editing this task requires project-task management permission' using errcode = '42501';
  elsif p_assignee is not distinct from v.assignee_id
        and not v_owner
        and not app.in_write_scope(v.department_id, v.team_id, null) then
    raise exception 'editing this task requires project-task management permission' using errcode = '42501';
  end if;

  if coalesce(trim(p_title), '') = '' then
    raise exception 'a task title is required' using errcode = '22023';
  end if;
  if p_assignee is null then
    raise exception 'an assignee is required' using errcode = '22023';
  end if;
  select up.department_id, up.team_id into v_dept, v_team
    from user_profiles up where up.id = p_assignee and up.tenant_id = v_tenant;
  if not found then
    raise exception 'that assignee is not in your organization' using errcode = '22023';
  end if;
  -- ADR-0061 d.5, on a CHANGE of assignee only.
  if p_assignee is distinct from v.assignee_id and not app.person_is_bookable(p_assignee) then
    raise exception 'that person is not bookable, so work cannot be assigned to them'
      using errcode = '22023';
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
  v_days_changed := (p_starts_at is not null and p_starts_at is distinct from v.starts_at)
                 or (p_due_at    is not null and p_due_at    is distinct from v.due_at);
  v_dates_changed := v_days_changed
                  or (p_hours     is not null and p_hours     is distinct from v.sla_hours);

  -- ---------------------------------------------------------------- ADR-0140 d.3 ----
  -- A started task: its days or its person move only when the caller has said so. An answered request is that say-so.
  if v_approving is null and (v_reassigned or v_days_changed) and not coalesce(p_confirm_started, false)
     and v.assignee_id is not null and app.sub_task_is_started(p_sub_task) then
    raise exception '% has started this — move it anyway?',
            coalesce((select display_name from public.user_profiles where id = v.assignee_id), 'Someone')
      using errcode = '22023',
            detail = coalesce((select display_name from public.user_profiles where id = v.assignee_id), ''),
            hint = 'task_started';
  end if;

  -- ---------------------------------------------------------------- ADR-0087 d.2 ----
  -- Reach over the assignee's CALENDAR, tested here, before anything is written, on a change of
  -- assignee. The same three steps as app.tg_subtask_assignment_authority, which still fires on the
  -- update below and still guards every other write path. The caller never chooses which branch.
  if v_reassigned and v_approving is null then
    select r.id, r.department_id, r.team_id into v_resource, v_res_dept, v_res_team
      from resources r
     where r.user_id = p_assignee and r.kind = 'human' and r.is_active and r.tenant_id = v_tenant
     limit 1;

    if v_resource is not null then
      -- d.3: what the requester must hold is everything ADR-0040 requires except reach over the
      -- calendar. Without the booking grant this is a refusal, not a request (ADR-0014).
      if not app.has_permission('bookings', 'create') then
        raise exception
          'you cannot assign this task: scheduling it needs the bookings:create permission, which you do not hold'
          using errcode = '42501';
      end if;

      if not app.resource_in_scheduling_scope(v_resource) then
        -- d.13: a person placed nowhere has nobody to answer for them — refused, not queued. ADR-0139: the
        -- person's own placement counts as well as the calendar's.
        if coalesce(v_team, v_res_team) is null and coalesce(v_dept, v_res_dept) is null then
          raise exception
            '% is not placed in a department or team, so there is nobody to ask — only a company-wide role can book them',
            (select display_name from public.user_profiles where id = p_assignee)
            using errcode = '42501', hint = 'unplaced_resource';
        end if;

        -- ADR-0139 d.2/d.3: the request names the person's team and goes to its lead (app.raise_task_request
        -- asks the campaign and acceptance gates first, and refuses a second open request on the task).
        v_request := app.raise_task_request(
          p_sub_task, coalesce(v_team, v_res_team), p_assignee, p_title,
          p_starts_at, p_due_at, p_hours, p_reviewers, p_review_mode,
          case when p_due_at is null then null else (p_due_at at time zone 'Asia/Baghdad')::date end, null);

        -- NOTHING on the task changes (d.4). The answer says what happened.
        sub_task_id := p_sub_task;
        deliverable_id := v.deliverable_id;
        reschedule_needed := false;
        outcome := 'requested';
        request_id := v_request;
        return next;
        return;
      end if;
    end if;
  end if;

  -- ---------------------------------------------------------------- ADR-0140 d.2 ----
  -- The DAYS of a task held by somebody outside the caller's scheduling reach are that person's lead's to move: they
  -- are asked (ADR-0139), and every other field below saves now.
  if not v_reassigned and v_days_changed and v_approving is null and v.assignee_id is not null then
    select r.id, r.team_id into v_held_res, v_held_team
      from resources r
     where r.user_id = v.assignee_id and r.kind = 'human' and r.is_active and r.tenant_id = v_tenant
     limit 1;
    if v_held_res is not null and not app.resource_in_scheduling_scope(v_held_res) then
      v_request := app.raise_task_request(
        p_sub_task, coalesce((select up.team_id from user_profiles up where up.id = v.assignee_id), v_held_team),
        v.assignee_id, p_title, coalesce(p_starts_at, v.starts_at), coalesce(p_due_at, v.due_at),
        coalesce(p_hours, v.sla_hours), null, null,
        case when coalesce(p_due_at, v.due_at) is null then null
             else (coalesce(p_due_at, v.due_at) at time zone 'Asia/Baghdad')::date end, null);
      v_days_requested := true;
    end if;
  end if;

  -- 20260926162000: the bookings take the new title BEFORE the task row changes. Updating them
  -- fires `booking_syncs_subtask_span`, which sets the task's dates to its bookings' span — the
  -- OLD days. Done after the task update (as it was), that silently undid every date move for
  -- the same assignee (the team view's drag along a row; found 25 Sep, L6): the dates written
  -- here were reverted in the same statement, and `subtask-schedule` then re-booked the old days.
  update bookings set title = trim(p_title) where bookings.sub_task_id = p_sub_task;

  update sub_tasks set
    title       = trim(p_title),
    assignee_id = p_assignee,
    -- ADR-0060 d.9. COALESCE: a person with no department recorded must not WIPE one the task had.
    department_id = coalesce(v_dept, department_id),
    team_id       = coalesce(v_team, team_id),
    -- ADR-0140 d.2: days sent as a request stay as they are until the lead answers.
    starts_at   = case when v_days_requested then starts_at else coalesce(p_starts_at, starts_at) end,
    due_at      = case when v_days_requested then due_at else coalesce(p_due_at, due_at) end,
    sla_hours   = coalesce(p_hours, sla_hours),
    review_mode = coalesce(p_review_mode, review_mode),
    schedule_overridden = case when v_reassigned or v_dates_changed then false else schedule_overridden end
  where id = p_sub_task;

  -- Appointments AFTER the assignee moves: one call can reassign the task AND name the previous
  -- assignee as a reviewer, and the write guard tests each appointment against the CURRENT assignee.
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


  sub_task_id := p_sub_task;
  deliverable_id := v.deliverable_id;
  if v_days_requested then
    -- ADR-0140 d.2: the days went to the lead; the hours (if changed) are placed again on the days as they stand.
    reschedule_needed := p_hours is not null and p_hours is distinct from v.sla_hours;
    outcome := 'requested';
    request_id := v_request;
  else
    reschedule_needed := v_reassigned or v_dates_changed;
    outcome := 'assigned';
    request_id := null;
  end if;
  return next;
end $function$;

-- public.sub_task_cancel: the account manager is no longer passed into the reach check.
CREATE OR REPLACE FUNCTION public.sub_task_cancel(p_sub_task uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
declare v sub_tasks; v_stream uuid; v_live integer;
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

  -- Same authority as assigning it: whoever may give this work out may call it off. ADR-0140 d.2: and the owner.
  if not ((app.has_permission('project_tasks', 'manage')
           and app.in_write_scope(v.department_id, v.team_id,
                                  null))
          or app.is_piece_owner(v.deliverable_id)) then
    raise exception 'You cannot cancel this task: it is outside your reach.%',
            app.refusal_ask(app.refusal_names_deliverable_owner(v.deliverable_id))
      using errcode = '42501',
            detail = coalesce(app.refusal_names_deliverable_owner(v.deliverable_id), ''),
            hint = 'cancel_task';
  end if;

  update sub_tasks set status = 'cancelled' where id = p_sub_task;

  -- Free the calendar. Cancelled work must stop consuming capacity, or the schedule keeps telling
  -- everyone that person is busy.
  delete from bookings where sub_task_id = p_sub_task;

  if v.assignee_id is not null and v.assignee_id is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
    values (v.tenant_id, v.assignee_id, 'cancelled', v.title, 'sub_task', v.id, auth.uid());
  end if;

  -- ADR-0061 d.6. An AD-HOC deliverable IS its task, so cancelling the last live one settles it.
  -- `archived` rather than `cancelled`: the deliverable states are draft/in_progress/in_review/
  -- approved/delivered/archived, and archived is the one that means "off the live list, kept for
  -- the record" — which is exactly what a called-off ad-hoc job is.
  --
  -- app.is_system_op() so the transition guard treats this as the consequence of an authorised act
  -- rather than a hand-made state change, the same way the materialiser is treated.
  if v.deliverable_id is not null then
    select d.stream_id into v_stream from deliverables d where d.id = v.deliverable_id;
    if v_stream is null then
      select count(*) into v_live from sub_tasks st
       where st.deliverable_id = v.deliverable_id
         and st.status not in ('cancelled', 'done');
      if v_live = 0 then
        perform set_config('app.system_op', 'on', true);
        update deliverables set state = 'archived'
         where id = v.deliverable_id and state <> 'archived';
        perform set_config('app.system_op', 'off', true);
      end if;
    end if;
  end if;
end $function$;

-- public.sub_task_reinstate: the account manager is no longer passed into the reach check.
CREATE OR REPLACE FUNCTION public.sub_task_reinstate(p_sub_task uuid, p_assigning boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
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
                                 null)) then
    raise exception 'You cannot reinstate this task: it is outside your reach.%',
            app.refusal_ask(app.refusal_names_deliverable_owner(v.deliverable_id))
      using errcode = '42501',
            detail = coalesce(app.refusal_names_deliverable_owner(v.deliverable_id), ''),
            hint = 'reinstate_task';
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
end $function$;

-- sub_tasks row policies: the same expressions, the account manager no longer passed.
drop policy if exists sub_tasks_manage_insert on public.sub_tasks;
create policy sub_tasks_manage_insert on public.sub_tasks for insert to authenticated
  with check (((tenant_id = app.current_tenant_id()) AND ((app.has_permission('project_tasks'::text, 'manage'::text) AND app.in_write_scope(department_id, team_id, null)) OR (app.has_permission('project_tasks'::text, 'manage'::text) AND app.user_in_scheduling_scope(assignee_id)) OR app.caller_is_project_pm(deliverable_id) OR app.is_piece_owner(deliverable_id))));

drop policy if exists sub_tasks_manage_update on public.sub_tasks;
create policy sub_tasks_manage_update on public.sub_tasks for update to authenticated
  using (((tenant_id = app.current_tenant_id()) AND ((app.has_permission('project_tasks'::text, 'manage'::text) AND app.in_write_scope(department_id, team_id, null)) OR (app.has_permission('project_tasks'::text, 'manage'::text) AND app.user_in_scheduling_scope(assignee_id)) OR (assignee_id = auth.uid()) OR app.caller_is_project_pm(deliverable_id) OR app.is_piece_owner(deliverable_id))))
  with check (((tenant_id = app.current_tenant_id()) AND ((app.has_permission('project_tasks'::text, 'manage'::text) AND app.in_write_scope(department_id, team_id, null)) OR (app.has_permission('project_tasks'::text, 'manage'::text) AND app.user_in_scheduling_scope(assignee_id)) OR (assignee_id = auth.uid()) OR app.caller_is_project_pm(deliverable_id) OR app.is_piece_owner(deliverable_id))));

drop policy if exists sub_tasks_manage_delete on public.sub_tasks;
create policy sub_tasks_manage_delete on public.sub_tasks for delete to authenticated
  using (((tenant_id = app.current_tenant_id()) AND ((app.has_permission('project_tasks'::text, 'manage'::text) AND app.in_write_scope(department_id, team_id, null)) OR app.caller_is_project_pm(deliverable_id))));

commit;
