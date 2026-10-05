-- The same assignee's date move through `update_task_assignment` stuck on the old days.
--
-- Found 25 Sep by the browser suite (coverage/team-view L6, "Move it anyway"): the RPC wrote the new
-- starts_at/due_at, then — in the same call — renamed the task's bookings, which fires
-- `app.tg_booking_syncs_subtask_span` and sets the task's dates back to its bookings' span (still the
-- old days, because `subtask-schedule` has not run yet). The audit log shows both updates at the same
-- instant. `subtask-schedule` then read the reverted dates and booked the old days again. A move to
-- ANOTHER person was unaffected (the sync reads only the new assignee's bookings, of which there are
-- none yet) — which is why the Schedule's cross-person drag worked and this went unseen.
--
-- Reproduced whole from the live definition (last written by 20260922190000), with one change: the
-- bookings rename moves above the task update. Same signature, same security, same search_path; the
-- grants and comment on the function are kept by `create or replace`.

begin;

create or replace function public.update_task_assignment(p_sub_task uuid, p_title text, p_assignee uuid, p_reviewers jsonb DEFAULT NULL::jsonb, p_starts_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_hours numeric DEFAULT NULL::numeric, p_review_mode text DEFAULT NULL::text)
returns table(sub_task_id uuid, deliverable_id uuid, reschedule_needed boolean, outcome text, request_id uuid)
language plpgsql
security definer
set search_path = public, app, extensions
as $$declare
  v_tenant uuid := app.current_tenant_id();
  v sub_tasks%rowtype;
  v_reassigned boolean;
  v_dates_changed boolean;
  v_lead uuid;
  v_dept uuid;
  v_team uuid;
  -- ADR-0087
  v_approving uuid := app.try_uuid(nullif(current_setting('app.assignment_request', true), ''));
  v_resource uuid;
  v_res_dept uuid;
  v_res_team uuid;
  v_request uuid;
  v_refusal text;   -- review, 11 Sep
begin
  select * into v from sub_tasks where id = p_sub_task and tenant_id = v_tenant;
  if not found then raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002'; end if;

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
  -- within reach: that is the work's own department's business.
  elsif not app.has_permission('project_tasks', 'manage') then
    raise exception 'editing this task requires project-task management permission' using errcode = '42501';
  elsif p_assignee is not distinct from v.assignee_id
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
  v_dates_changed := (p_starts_at is not null and p_starts_at is distinct from v.starts_at)
                  or (p_due_at    is not null and p_due_at    is distinct from v.due_at)
                  or (p_hours     is not null and p_hours     is distinct from v.sla_hours);

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
        -- d.13: reachable only by tenant-wide and all-accounts roles, who are not notified (d.6).
        -- A request here would wait for nobody, so it is refused at request time and the fix is
        -- to place the resource. The hint lets the client show `schedule.refusal.unplaced`.
        if v_res_dept is null and v_res_team is null then
          raise exception
            '% is not placed in a department or team, so there is nobody to ask — only a company-wide role can book them',
            (select display_name from public.user_profiles where id = p_assignee)
            using errcode = '42501', hint = 'unplaced_resource';
        end if;

        -- Review finding, 11 Sep (ADR-0087 d.11 — "the approver has no dead end"): a request is
        -- raised only for work the approval could assign. These are the SAME two gates
        -- app.tg_sub_task_assignment_gate will hold the approval to (ADR-0048 d.8, ADR-0070 d.4,
        -- ADR-0090 d.3), asked now, in the same words, so no lead is told about work whose
        -- answer would be refused — and the requester learns it from the refusal, not the lead.
        if not app.campaign_is_approved(app.sub_task_campaign(p_sub_task)) then
          raise exception
            'this campaign is waiting for the account manager to approve it, so its work cannot be assigned yet'
            using errcode = '42501';
        end if;
        v_refusal := app.sub_task_work_acceptance_refusal(p_sub_task);
        if v_refusal is not null then
          raise exception '%', v_refusal using errcode = '42501';
        end if;

        -- d.4: at most one pending request per task. Said in words before the unique index says it
        -- in a constraint name.
        if exists (select 1 from sub_task_assignment_requests q
                    where q.sub_task_id = p_sub_task and q.status = 'pending') then
          raise exception 'this task already has a booking request waiting for an answer'
            using errcode = '22023', hint = 'request_pending';
        end if;

        insert into sub_task_assignment_requests
          (tenant_id, sub_task_id, resource_id, assignee_id, requested_by,
           title, starts_at, due_at, hours, reviewers, review_mode)
        values
          (v_tenant, p_sub_task, v_resource, p_assignee, auth.uid(),
           trim(p_title), p_starts_at, p_due_at, p_hours, p_reviewers, p_review_mode)
        returning id into v_request;

        -- d.6: the leads whose reach covers the calendar. Never the requester, who knows.
        insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
        select v_tenant, a.user_id, 'assignment_requested', v.title, 'sub_task', v.id, auth.uid()
          from public.assignment_request_approvers(v_resource) a
         where a.user_id is distinct from auth.uid();

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
    starts_at   = coalesce(p_starts_at, starts_at),
    due_at      = coalesce(p_due_at, due_at),
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
  reschedule_needed := v_reassigned or v_dates_changed;
  outcome := 'assigned';
  request_id := null;
  return next;
end $$;

commit;
