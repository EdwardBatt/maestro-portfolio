-- ADR-0140 (Edward, 3 Oct) — I74.7–I74.12. Every task has an Edit; an approved task list is assigned on the campaign
-- page too.
--
--   d.2  WHO EDITS. The piece's OWNER edits every task on the piece (Traffic and the Power Admin already reach every
--        task). `app.is_piece_owner` joins the sub_tasks insert/update policies — so `save_sub_task`, which is
--        security invoker, saves the owner's edit — and `app.can_manage_sub_task`, which the sub_task_reviewers
--        policies read. sub_task_dependencies are written by any holder of project_tasks:manage already, which every
--        owner is (a deliverable's owner is a lead, `deliverable_owner_is_a_lead`), so that policy is unchanged.
--        A change to the PERSON of a task held by another team is a request (ADR-0139, unchanged). A change to its DAYS
--        is now a request too: `update_task_assignment` sends the days to the person's team lead and saves every other
--        field (outcome `requested`).
--   d.3  A STARTED task (status in_progress / review, or any time logged) keeps every field editable, but moving its
--        days or giving it to someone else is refused with hint `task_started` (detail: the person's name) unless the
--        caller passes `p_confirm_started => true` — the "Zubaida has started this — move it anyway?" step. Removing it is
--        refused (`remove_sub_task`, hint `task_started`); calling it off stays with the piece's own close (ADR-0118).
--   d.4  THE CAMPAIGN PAGE ASSIGNS through the same `update_task_assignment` (the task-list approval gate,
--        `tg_sub_task_assignment_gate`, is unchanged and still holds every assignment). The owner may place the bookings
--        of a task on her piece (`app.may_place_task_bookings`) so `subtask-schedule` books what she assigned or re-hours.
--   d.5  CANCELLING A BOOKING: `public.unassign_task` takes the person off, frees every booking of the task and puts it
--        back to To book (no assignee, its days and hours kept); the assignee and their lead (team lead, else department
--        lead) are told — not the account manager.
--
-- Reproduced WHOLE from their latest definitions (grep -liE "function +(public|app)\.<name>\b", 3 Oct):
--   public.update_task_assignment     20261003110000 (signature gains p_confirm_started: dropped and re-created)
--   public.remove_sub_task            20260923110000
--   public.sub_task_cancel            20260923110000
--   app.can_manage_sub_task           20260826100000
--   app.may_place_task_bookings       20261003110000
--   sub_tasks_manage_insert / _update 20260922190000
-- No top-level data change.

begin;

-- ===================================================================== d.2: the owner ====
create or replace function app.is_piece_owner(p_deliverable uuid)
returns boolean language sql stable security definer cost 100
set search_path = public, app, extensions as $$
  select p_deliverable is not null and auth.uid() is not null and exists (
    select 1 from public.deliverables d
     where d.id = p_deliverable and d.tenant_id = app.current_tenant_id() and d.owner_user_id = auth.uid())
$$;
comment on function app.is_piece_owner(uuid) is
  'ADR-0140 d.2: is the caller this deliverable''s owner? The owner edits every task on the piece.';
revoke execute on function app.is_piece_owner(uuid) from public, anon;
grant  execute on function app.is_piece_owner(uuid) to authenticated;

-- Reproduced from 20260922190000; the added branch is marked ADR-0140.
drop policy sub_tasks_manage_insert on sub_tasks;
create policy sub_tasks_manage_insert on sub_tasks
  for insert to authenticated
  with check (
    tenant_id = app.current_tenant_id()
    and (
      (app.has_permission('project_tasks', 'manage')
        and app.in_write_scope(department_id, team_id, app.deliverable_account_manager(deliverable_id)))
      -- ADR-0098 d.4: a caller who may schedule the row's assignee may write the row.
      or (app.has_permission('project_tasks', 'manage')
        and app.user_in_scheduling_scope(assignee_id))
      or app.caller_is_project_pm(deliverable_id)
      -- ADR-0140 d.2: the piece's owner adds and edits every task on it.
      or app.is_piece_owner(deliverable_id)
    )
  );

drop policy sub_tasks_manage_update on sub_tasks;
create policy sub_tasks_manage_update on sub_tasks
  for update to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and (
      (app.has_permission('project_tasks', 'manage')
        and app.in_write_scope(department_id, team_id, app.deliverable_account_manager(deliverable_id)))
      -- ADR-0098 d.4
      or (app.has_permission('project_tasks', 'manage')
        and app.user_in_scheduling_scope(assignee_id))
      or assignee_id = auth.uid()
      or app.caller_is_project_pm(deliverable_id)
      -- ADR-0140 d.2
      or app.is_piece_owner(deliverable_id)
    )
  )
  with check (
    tenant_id = app.current_tenant_id()
    and (
      (app.has_permission('project_tasks', 'manage')
        and app.in_write_scope(department_id, team_id, app.deliverable_account_manager(deliverable_id)))
      -- ADR-0098 d.4
      or (app.has_permission('project_tasks', 'manage')
        and app.user_in_scheduling_scope(assignee_id))
      or assignee_id = auth.uid()
      or app.caller_is_project_pm(deliverable_id)
      -- ADR-0140 d.2
      or app.is_piece_owner(deliverable_id)
    )
  );

-- Reproduced from 20260826100000 (its only definition); the owner branch is the edit. Read by the sub_task_reviewers
-- write policies (ADR-0043 d.1) and sub_task_resources.
create or replace function app.can_manage_sub_task(p_sub_task uuid)
returns boolean language sql stable
set search_path = public, app, extensions as $$
  select exists (
    select 1
    from public.sub_tasks st
    where st.id = p_sub_task
      and st.tenant_id = app.current_tenant_id()
      and (
        (app.has_permission('project_tasks', 'manage')
          and app.in_write_scope(st.department_id, st.team_id,
                                 app.deliverable_account_manager(st.deliverable_id)))
        or app.caller_is_project_pm(st.deliverable_id)
        -- ADR-0140 d.2: the piece's owner appoints a task's reviewers too.
        or app.is_piece_owner(st.deliverable_id)
      )
  )
$$;

-- Is this task started? Its status says so, or somebody has logged time on it.
create or replace function app.sub_task_is_started(p_sub_task uuid)
returns boolean language sql stable security definer
set search_path = public, app, extensions as $$
  select exists (select 1 from public.sub_tasks t
                  where t.id = p_sub_task and t.tenant_id = app.current_tenant_id()
                    and t.status in ('in_progress', 'review'))
      or exists (select 1 from public.task_time_entries te where te.sub_task_id = p_sub_task)
$$;
comment on function app.sub_task_is_started(uuid) is
  'ADR-0140 d.3: a task is started when it is in progress or in review, or when any time has been logged on it.';
revoke execute on function app.sub_task_is_started(uuid) from public, anon;
grant  execute on function app.sub_task_is_started(uuid) to authenticated;

-- ===================================================================== d.2–d.4: the one assignment path ====
-- Reproduced WHOLE from 20261003110000. Edits, each marked ADR-0140:
--   a) the piece's owner passes both edit gates;
--   b) p_confirm_started: a started task's days or person move only when the caller confirms (hint task_started);
--   c) a change of DAYS (not person) of a task whose person is outside the caller's scheduling reach is sent to that
--      person's team lead as a request; every other field saves (outcome 'requested').
drop function if exists public.update_task_assignment(uuid, text, uuid, jsonb, timestamptz, timestamptz, numeric, text);

create function public.update_task_assignment(
  p_sub_task        uuid,
  p_title           text,
  p_assignee        uuid,
  p_reviewers       jsonb       default null,
  p_starts_at       timestamptz default null,
  p_due_at          timestamptz default null,
  p_hours           numeric     default null,
  p_review_mode     text        default null,
  p_confirm_started boolean     default false)
returns table(sub_task_id uuid, deliverable_id uuid, reschedule_needed boolean, outcome text, request_id uuid)
language plpgsql
security definer
set search_path = public, app, extensions
as $$declare
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
        and not app.in_write_scope(v.department_id, v.team_id, app.deliverable_account_manager(v.deliverable_id)) then
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
end $$;

comment on function public.update_task_assignment(uuid, text, uuid, jsonb, timestamptz, timestamptz, numeric, text, boolean) is
  'ADR-0060, ADR-0061, ADR-0087, ADR-0139, ADR-0140: assign or reassign a task, appoint its reviewers, set its plan. '
  'Needs project_tasks:manage (or the piece''s ownership) and, for a change of person, the person within the caller''s '
  'scheduling reach — otherwise a request to their team lead (outcome requested). A change of DAYS of a task held by '
  'someone outside that reach is a request too; every other field saves. A started task''s days or person move only '
  'with p_confirm_started (hint task_started otherwise).';
revoke execute on function public.update_task_assignment(uuid, text, uuid, jsonb, timestamptz, timestamptz, numeric, text, boolean) from public, anon;
grant  execute on function public.update_task_assignment(uuid, text, uuid, jsonb, timestamptz, timestamptz, numeric, text, boolean) to authenticated;

-- ===================================================================== d.3: a started task is not removed ====
-- Reproduced from 20260923110000. ADR-0140: the piece's owner removes too; a STARTED task is refused (hint
-- task_started) — it is called off only by the piece's own close (ADR-0118).
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
                                  app.deliverable_account_manager(v.deliverable_id)))
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

-- Reproduced from 20260923110000. ADR-0140 d.2: the piece's owner calls a task off too (remove_sub_task's second half).
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
                                  app.deliverable_account_manager(v.deliverable_id)))
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

-- ===================================================================== d.4: the owner books what she assigns ====
-- Reproduced from 20261003110000; ADR-0140 d.4: the piece's owner may place (and clear) a task's bookings on its
-- current person's calendar — what the assignment path already decided — so the campaign page's `subtask-schedule`
-- works for a person outside her own reach. The window (app.task_booking_sanctioned) still holds the task's own days.
create or replace function app.may_place_task_bookings(p_sub_task uuid)
returns boolean language sql stable security definer cost 10000
set search_path = public, app, extensions as $$
  select p_sub_task is not null and exists (
    select 1 from public.sub_tasks t
     where t.id = p_sub_task and t.tenant_id = app.current_tenant_id() and t.assignee_id is not null
       and (exists (select 1 from public.sub_task_assignment_requests q
                     where q.sub_task_id = t.id and q.status = 'approved'
                       and q.requested_by = auth.uid() and q.assignee_id = t.assignee_id)
            -- ADR-0140 d.4
            or app.is_piece_owner(t.deliverable_id)))
$$;
comment on function app.may_place_task_bookings(uuid) is
  'ADR-0139 d.4 / ADR-0140 d.4: the caller may materialise (and clear) this task''s bookings for its current person '
  'although that person is outside their scheduling reach — they asked and the lead booked or offered it, or they own '
  'the piece.';

-- ===================================================================== d.5: cancelling a booking ====
-- Takes the person off, frees every booking of the task, and puts it back to To book: no assignee, its days and hours
-- kept, its commitment cleared (the next assignment stamps a new one). Who: the piece's owner, or whoever may schedule
-- the person (their team lead, their department lead, Traffic, the Power Admin) with bookings:delete. A started task
-- asks first (p_confirm_started, hint task_started). The assignee and their lead are told — not the account manager.
create or replace function public.unassign_task(p_sub_task uuid, p_confirm_started boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v        sub_tasks%rowtype;
  v_res    uuid;
  v_freed  integer;
  v_lead   record;
  v_told   integer := 0;
  v_team   uuid;
  v_dept   uuid;
begin
  select * into v from sub_tasks where id = p_sub_task and tenant_id = app.current_tenant_id() for update;
  if not found then
    raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002';
  end if;
  if v.status in ('done', 'cancelled') then
    raise exception '"%" is finished or called off — there is no booking to cancel', v.title using errcode = '22023';
  end if;
  if v.assignee_id is null then
    raise exception '"%" has nobody on it', v.title using errcode = '22023', hint = 'not_assigned';
  end if;

  select r.id into v_res from resources r
   where r.user_id = v.assignee_id and r.kind = 'human' and r.tenant_id = v.tenant_id
   order by r.is_active desc limit 1;
  if not (app.is_piece_owner(v.deliverable_id)
          or (app.has_permission('bookings', 'delete') and v_res is not null and app.resource_in_scheduling_scope(v_res))) then
    raise exception 'cancelling this booking is for the piece''s owner or the person''s own lead'
      using errcode = '42501', hint = 'unassign_task';
  end if;

  if not coalesce(p_confirm_started, false) and app.sub_task_is_started(p_sub_task) then
    raise exception '% has started this — take them off anyway?',
            coalesce((select display_name from user_profiles where id = v.assignee_id), 'Someone')
      using errcode = '22023',
            detail = coalesce((select display_name from user_profiles where id = v.assignee_id), ''),
            hint = 'task_started';
  end if;

  delete from bookings where bookings.sub_task_id = p_sub_task;
  get diagnostics v_freed = row_count;

  -- The commitment goes with the person (the stamp refuses a hand-made change; this is the authorised one).
  perform set_config('app.system_op', 'on', true);
  update sub_tasks
     set assignee_id = null,
         committed_starts_at = null, committed_due_at = null, committed_hours = null,
         schedule_overridden = false
   where id = p_sub_task;
  perform set_config('app.system_op', 'off', true);

  insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload)
  values (v.tenant_id, auth.uid(), 'task_unassigned', 'sub_tasks', v.id,
          jsonb_build_object('was_assignee', v.assignee_id, 'bookings_freed', v_freed,
                             'deliverable_id', v.deliverable_id));

  -- The assignee, and their lead: the team's Team Leader(s), else the department lead(s). Never the actor.
  select up.team_id, up.department_id into v_team, v_dept from user_profiles up where up.id = v.assignee_id;
  for v_lead in
    select v.assignee_id as user_id, 'assignee'::text as as_who
    union
    select x.user_id, 'lead' from (
      select up.id as user_id from user_profiles up join roles ro on ro.id = up.role_id
       where up.tenant_id = v.tenant_id and up.is_active and v_team is not null
         and up.team_id = v_team and ro.key = 'team_lead'
      union all
      select up.id from user_profiles up join roles ro on ro.id = up.role_id
       where up.tenant_id = v.tenant_id and up.is_active and ro.scope = 'department' and v_dept is not null
         and up.department_id = v_dept
         and not exists (select 1 from user_profiles t join roles tr on tr.id = t.role_id
                          where t.tenant_id = v.tenant_id and t.is_active and v_team is not null
                            and t.team_id = v_team and tr.key = 'team_lead')) x
     where x.user_id <> v.assignee_id
  loop
    if v_lead.user_id is distinct from auth.uid() then
      insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
      values (v.tenant_id, v_lead.user_id, 'task_unassigned', v.title, 'sub_task', v.id, auth.uid(),
              jsonb_build_object('person', (select display_name from user_profiles where id = v.assignee_id),
                                 'as', v_lead.as_who));
      v_told := v_told + 1;
    end if;
  end loop;

  return jsonb_build_object('sub_task_id', v.id, 'bookings_freed', v_freed, 'told', v_told);
end $$;

comment on function public.unassign_task(uuid, boolean) is
  'ADR-0140 d.5: cancel a task''s booking — the person comes off, every booking of the task is freed, the task goes '
  'back to To book with its days and hours. The piece''s owner, or the person''s own lead / Traffic (scheduling reach '
  'with bookings:delete). A started task needs p_confirm_started (hint task_started). The assignee and their lead '
  '(team lead, else department lead) are told — not the account manager.';
revoke execute on function public.unassign_task(uuid, boolean) from public, anon;
grant  execute on function public.unassign_task(uuid, boolean) to authenticated;

commit;
