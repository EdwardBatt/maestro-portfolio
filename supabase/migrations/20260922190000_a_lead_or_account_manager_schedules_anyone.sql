-- ADR-0098 (22 Sep, Edward, from production) — a lead or an account manager schedules anyone,
-- across departments. *"we are removing the permission… allow all department leads and team leads
-- to assign anybody to tasks, cross department included"*; *"an account manager/account director is
-- also allowed to schedule anyone. leave stays with lead, not told."*
--
-- Reach over a calendar was one function, `app.resource_in_write_scope`, read by six things that are
-- not all about assigning work. This migration gives SCHEDULING its own predicate (d.1) and moves
-- every scheduling reader to it (d.2): the three booking policies, ADR-0040's authority trigger,
-- `update_task_assignment`'s resource test, `decide_assignment_request` and `my_pending_approvals`.
-- Leave and office closures keep the narrow test (d.3) — booking someone's leave stays their own
-- lead's act. The task row follows the person (d.4): `sub_tasks_manage_insert / _update` admit a
-- caller who may schedule the row's assignee, which is what lets a Creative team lead create an
-- ad-hoc task for a Content writer through `save_sub_task` (security invoker). Pending requests are
-- closed as withdrawn with a reason, not deleted (d.5).
--
-- Four functions reproduced WHOLE from their latest definitions (grep confirmed each is the last
-- `create or replace` of its name): `app.tg_subtask_assignment_authority` (20260824160000),
-- `public.update_task_assignment` (20260922120000), `public.decide_assignment_request`
-- (20260911110000), `public.my_pending_approvals` (20260921130000). In each the ONLY edit is
-- `app.resource_in_write_scope(` → `app.resource_in_scheduling_scope(`.

begin;

-- ---------------------------------------------------------------- d.1: the predicate ----
-- True for every holder of a department, team or account scope over any active resource of the
-- tenant; for everyone else, exactly what `resource_in_write_scope` says (tenant-wide and
-- all-accounts roles reach everyone there already; a self-scoped person reaches nobody, ADR-0014).
-- The grant axis is not here: every caller still needs bookings:create where it is asked for.
create or replace function app.resource_in_scheduling_scope(p_resource uuid)
returns boolean language sql stable
set search_path = public, app, extensions as $$
  select case
    when app.current_scope() in ('department', 'team', 'account') then exists (
      select 1 from public.resources r
      where r.id = p_resource and r.tenant_id = app.current_tenant_id() and r.is_active)
    else app.resource_in_write_scope(p_resource)
  end
$$;

comment on function app.resource_in_scheduling_scope(uuid) is
  'ADR-0098 d.1: reach over a calendar FOR SCHEDULING. A department lead, team lead or account '
  'manager reaches every active resource; anyone else reaches what resource_in_write_scope says. '
  'Read by the booking policies, the ADR-0040 trigger, update_task_assignment, '
  'decide_assignment_request and my_pending_approvals — NOT by leave or office closures (d.3), '
  'which keep resource_in_write_scope.';

-- The same question asked of a PERSON: their active human resource, for the sub_tasks policies.
create or replace function app.user_in_scheduling_scope(p_user uuid)
returns boolean language sql stable
set search_path = public, app, extensions as $$
  select p_user is not null and exists (
    select 1 from public.resources r
    where r.user_id = p_user and r.kind = 'human' and r.is_active
      and r.tenant_id = app.current_tenant_id()
      and app.resource_in_scheduling_scope(r.id))
$$;

comment on function app.user_in_scheduling_scope(uuid) is
  'ADR-0098 d.4: may the caller schedule this person — their active human resource tested with '
  'resource_in_scheduling_scope. The sub_tasks policies read it so a lead who may put a person on '
  'a task may also write and edit that task.';

-- ---------------------------------------------------------------- d.2: the booking policies ----
-- Reproduced from 20260823110000 (insert/update from 20260819140000's shape; delete from
-- 20260812120100's); the predicate is the edit.
drop policy bookings_scheduler_insert on bookings;
create policy bookings_scheduler_insert on bookings
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id()
    and app.has_permission('bookings', 'create')
    and (app.resource_in_scheduling_scope(resource_id)
         or app.caller_is_booking_pm(deliverable_id, sub_task_id, job_id)));

drop policy bookings_scheduler_update on bookings;
create policy bookings_scheduler_update on bookings
  for update to authenticated
  using (tenant_id = app.current_tenant_id()
    and app.has_permission('bookings', 'update')
    and (app.resource_in_scheduling_scope(resource_id)
         or app.caller_is_booking_pm(deliverable_id, sub_task_id, job_id)))
  with check (tenant_id = app.current_tenant_id()
    and app.has_permission('bookings', 'update')
    and (app.resource_in_scheduling_scope(resource_id)
         or app.caller_is_booking_pm(deliverable_id, sub_task_id, job_id)));

drop policy bookings_scheduler_delete on bookings;
create policy bookings_scheduler_delete on bookings
  for delete to authenticated
  using (tenant_id = app.current_tenant_id()
    and app.has_permission('bookings', 'delete')
    and app.resource_in_scheduling_scope(resource_id));

-- ---------------------------------------------------------------- d.2: ADR-0040's trigger ----

create or replace function app.tg_subtask_assignment_authority() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare v_resource uuid;
begin
  -- Only when work is being GIVEN to someone. Unassigning needs no booking authority (ADR-0040 d.4).
  if new.assignee_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.assignee_id is not distinct from new.assignee_id then
    return new;
  end if;

  -- Seeders, migrations and service contexts. auth.uid() is null for anything not acting as a
  -- signed-in user, which is already how RLS treats those callers — a data migration must not be
  -- blocked by a permission the migration role has no business holding (ADR-0040 d.5).
  if auth.uid() is null or coalesce(current_setting('app.system_op', true), '') = 'on' then
    return new;
  end if;

  -- The assignee's bookable calendar. No active resource means there is nothing to materialise, so
  -- nothing to be authorised for — assigning work to someone without a calendar stays possible
  -- (ADR-0040 d.3).
  select r.id into v_resource
  from public.resources r
  where r.user_id = new.assignee_id and r.kind = 'human' and r.is_active
  limit 1;

  if v_resource is null then
    return new;
  end if;

  if not app.has_permission('bookings', 'create') then
    raise exception
      'you cannot assign this task: scheduling it needs the bookings:create permission, which you do not hold'
      using errcode = '42501';
  end if;

  if not app.resource_in_scheduling_scope(v_resource) then
    raise exception
      'you cannot assign this task: % is outside the part of the organisation you can schedule',
      (select display_name from public.user_profiles where id = new.assignee_id)
      using errcode = '42501';
  end if;

  return new;
end $$;

comment on function app.tg_subtask_assignment_authority() is
  'ADR-0040 d.1–d.3, ADR-0098 d.2: giving a task to a person needs bookings:create and the person '
  'within the caller''s SCHEDULING scope (a lead or an account manager reaches anyone). Skipped '
  'under app.system_op and for service-role writes.';

-- ---------------------------------------------------------------- d.2: update_task_assignment ----
-- The request branch is still here (ADR-0087 d.2 stands for a caller with the grant and none of the
-- four scopes); a department lead, team lead or account manager never reaches it now (d.5).
create or replace function public.update_task_assignment(p_sub_task uuid, p_title text, p_assignee uuid, p_reviewers jsonb DEFAULT NULL::jsonb, p_starts_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_hours numeric DEFAULT NULL::numeric, p_review_mode text DEFAULT NULL::text)
 RETURNS TABLE(sub_task_id uuid, deliverable_id uuid, reschedule_needed boolean, outcome text, request_id uuid)
language plpgsql security definer
set search_path = public, app, extensions as $function$
declare
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

  update bookings set title = trim(p_title) where bookings.sub_task_id = p_sub_task;

  sub_task_id := p_sub_task;
  deliverable_id := v.deliverable_id;
  reschedule_needed := v_reassigned or v_dates_changed;
  outcome := 'assigned';
  request_id := null;
  return next;
end $function$;

comment on function public.update_task_assignment(uuid, text, uuid, jsonb, timestamptz, timestamptz, numeric, text) is
  'ADR-0060 d.1/d.3/d.9, ADR-0061, ADR-0087, ADR-0098: assign or reassign a task, appoint its '
  'reviewers, set its plan. Assigning needs project_tasks:manage and the ASSIGNEE within the '
  'caller''s SCHEDULING scope (ADR-0098 d.1 — a lead or an account manager reaches anyone); a '
  'person outside it becomes a request. The deliverable''s owner or department never gates it '
  '(ADR-0060 addendum 22 Sep); an edit with no change of assignee still asks that the task be '
  'within reach.';

-- ---------------------------------------------------------------- d.2: decide_assignment_request ----
create or replace function public.decide_assignment_request(
  p_request uuid,
  p_approve boolean,
  p_reason  text default null
) returns table(sub_task_id uuid, deliverable_id uuid, reschedule_needed boolean, outcome text)
language plpgsql security definer set search_path = public, app, extensions as $$
declare
  q sub_task_assignment_requests%rowtype;
  v_task sub_tasks%rowtype;
  v_result record;
begin
  select * into q from sub_task_assignment_requests
   where id = p_request and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'assignment request % not found', p_request using errcode = 'P0002';
  end if;
  if q.status <> 'pending' then
    raise exception 'this request has already been answered (%)', q.status using errcode = '22023';
  end if;
  -- d.5, last sentence: if they passed the reach test they would not have needed to ask.
  if q.requested_by = auth.uid() then
    raise exception 'you cannot answer your own request' using errcode = '42501';
  end if;
  if not (app.has_permission('bookings', 'create') and app.resource_in_scheduling_scope(q.resource_id)) then
    raise exception 'answering this request is outside the part of the organisation you can schedule'
      using errcode = '42501';
  end if;

  select * into v_task from sub_tasks where id = q.sub_task_id;

  if p_approve then
    -- d.9 should have closed it already; said here in case the two triggers below ever lag.
    if not app.person_is_bookable(q.assignee_id) then
      raise exception 'that person is no longer bookable, so this request cannot be approved'
        using errcode = '22023';
    end if;

    -- Status FIRST, so the moot-closing trigger on sub_tasks finds nothing pending when the
    -- assignment below changes the assignee, and so update_task_assignment can verify the approval.
    update sub_task_assignment_requests
       set status = 'approved', decided_by = auth.uid(), decided_at = now(), reason = p_reason
     where id = p_request;

    perform set_config('app.assignment_request', p_request::text, true);
    select * into v_result
      from public.update_task_assignment(q.sub_task_id, q.title, q.assignee_id, q.reviewers,
                                         q.starts_at, q.due_at, q.hours, q.review_mode) u;
    perform set_config('app.assignment_request', '', true);

    if v_result.outcome is distinct from 'assigned' then
      -- Cannot happen: the reach test above is the one update_task_assignment makes. Refused
      -- loudly rather than left as an approved request with nothing assigned.
      raise exception 'the approval did not assign the task' using errcode = '55000';
    end if;

    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
    values (q.tenant_id, q.requested_by, 'assignment_approved', v_task.title, 'sub_task', q.sub_task_id, auth.uid());

    sub_task_id := q.sub_task_id;
    deliverable_id := v_task.deliverable_id;
    reschedule_needed := v_result.reschedule_needed;
    outcome := 'approved';
    return next;
    return;
  end if;

  -- d.8: refusal changes nothing but the record. The task stays exactly as it was.
  update sub_task_assignment_requests
     set status = 'refused', decided_by = auth.uid(), decided_at = now(), reason = p_reason
   where id = p_request;

  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
  values (q.tenant_id, q.requested_by, 'assignment_refused', v_task.title, 'sub_task', q.sub_task_id, auth.uid());

  sub_task_id := q.sub_task_id;
  deliverable_id := v_task.deliverable_id;
  reschedule_needed := false;
  outcome := 'refused';
  return next;
end $$;

comment on function public.decide_assignment_request(uuid, boolean, text) is
  'ADR-0087 d.5/d.7/d.8, ADR-0098 d.2: whoever could have booked directly — bookings:create and the '
  'calendar within their SCHEDULING scope — approves (which assigns, as the approver) or refuses. '
  'Requests now arise only for a caller with the grant and none of the four scopes.';

-- ---------------------------------------------------------------- d.2: my_pending_approvals ----
create or replace function public.my_pending_approvals()
returns table (
  kind           text,
  id             uuid,
  -- What the row is called: the campaign for a brief or a campaign approval, the deliverable for a
  -- task list, the task for a request. `campaign_name` is context and is null where it would
  -- repeat the title.
  title          text,
  campaign_id    uuid,
  campaign_name  text,
  department     text,
  since          timestamptz,
  target_id      uuid,
  deliverable_id uuid
)
language sql stable security invoker
set search_path = public, app, extensions as $$
  -- My department's brief, WRITTEN, delivered by the campaign's approval and not yet accepted.
  -- (I53.22: an emptied row — a promoted job's, 20260921120000 — is not written; it is owed below.)
  select 'department_brief', b.id, c.name, c.id, null, dp.name, c.approved_at, b.department_id, null::uuid
    from campaign_briefs b
    join campaigns c    on c.id = b.campaign_id
    join departments dp on dp.id = b.department_id
    join user_profiles me on me.id = auth.uid()
   where b.approved_at is null
     and b."values" <> '{}'::jsonb
     and c.status = 'approved'
     and me.department_id = b.department_id
     and app.has_permission('briefs', 'approve')
     and app.in_write_scope(b.department_id, null, c.account_manager_id)

  union all
  -- I53.22 (Edward, 21 Sep): my department's brief NOT YET WRITTEN on an approved campaign that
  -- gives it work — owed by the department's own people who can write it (projects:manage is
  -- what Generate asks for), in scope. The row is the campaign; the door is the department's tab.
  select 'department_brief_unwritten', c.id, c.name, c.id, null, dp.name, c.approved_at, me.department_id, null::uuid
    from campaigns c
    join user_profiles me on me.id = auth.uid()
    join departments dp on dp.id = me.department_id
   where c.status = 'approved'
     and c.kind = 'campaign'
     and exists (select 1 from deliverables d join streams s on s.id = d.stream_id
                  where s.campaign_id = c.id and d.department_id = me.department_id and d.state <> 'archived')
     and not exists (select 1 from campaign_briefs b
                      where b.campaign_id = c.id and b.department_id = me.department_id and b."values" <> '{}'::jsonb)
     and app.has_permission('projects', 'manage')
     and app.in_write_scope(me.department_id, null, c.account_manager_id)

  union all
  -- The generated task list of a single job's deliverable I own (ADR-0090).
  select 'task_list', d.id, d.name, c.id, c.name, dp.name, c.approved_at, d.id, d.id
    from deliverables d
    join streams s      on s.id = d.stream_id
    join campaigns c    on c.id = s.campaign_id
    left join departments dp on dp.id = d.department_id
   where c.kind = 'single_job'
     and c.status = 'approved'
     and d.tasks_approved_at is null
     and d.state <> 'archived'
     and d.owner_user_id = auth.uid()
     and app.may_approve_deliverable_tasks(d)

  union all
  -- A booking on somebody I lead, asked for by somebody outside their reach (ADR-0087).
  select 'booking_request', q.id, q.title, c.id, c.name, dp.name, q.created_at, q.sub_task_id, d.id
    from sub_task_assignment_requests q
    join sub_tasks st   on st.id = q.sub_task_id
    join deliverables d on d.id = st.deliverable_id
    left join streams s      on s.id = d.stream_id
    left join campaigns c    on c.id = s.campaign_id
    left join departments dp on dp.id = d.department_id
   where q.status = 'pending'
     and q.requested_by <> auth.uid()
     and auth.uid() in (select a.user_id from public.assignment_request_approvers(q.resource_id) a)
     and app.has_permission('bookings', 'create')
     and app.resource_in_scheduling_scope(q.resource_id)

  union all
  -- A deadline extension asked of ME (ADR-0088).
  select 'extension_request', x.request_id, x.task_title, x.campaign_id, x.campaign_name, dp.name, x.created_at, x.sub_task_id, x.deliverable_id
    from public.sub_task_extension_requests x
    left join departments dp on dp.id = x.department_id
   where x.event_type = 'extension_requested'
     and x.is_pending
     and x.approver_id = auth.uid()
     and x.viewer_can_decide
     and x.actor_id <> auth.uid()

  union all
  -- A campaign or job waiting for ME, its account manager (ADR-0048 d.9).
  select 'campaign', c.id, c.name, c.id, null, null, c.created_at, c.id, null::uuid
    from campaigns c
   where c.status = 'pending_approval'
     and c.account_manager_id = auth.uid()
     and app.has_permission('projects', 'manage')
     and app.in_write_scope(null, null, c.account_manager_id)

  order by 7 asc nulls last;
$$;

-- ---------------------------------------------------------------- d.4: the task row follows the person ----
-- Reproduced from 20260819100000; the added branch is marked ADR-0098.
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
    )
  );

-- ---------------------------------------------------------------- d.5: nothing waits for an answer ----
-- Every pending request was raised by somebody who can now assign directly. Closed as withdrawn,
-- with the reason on the row; the requester assigns again in one act. The audit trigger logs each.
update sub_task_assignment_requests
   set status = 'withdrawn',
       decided_at = now(),
       reason = 'superseded — leads and account managers now assign directly (ADR-0098)'
 where status = 'pending';

commit;
