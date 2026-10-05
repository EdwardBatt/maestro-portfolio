-- I45 (ADR-0087) — booking outside your reach is a request, and the resource's lead answers it.
--
-- Edward, 11 Sep: *"all users can book cross dept resources subject to the dept leads, or team
-- leads approval."* Today an out-of-reach assignment is refused three times over — by the grid's
-- mirror, by ADR-0040's trigger, and by the bookings insert policy — and there is no route inside
-- the product for a Creative lead to give a Production person a Production task except asking
-- outside Maestro. ADR-0040's last paragraph named the missing concept: *a request or a proposal
-- that a scheduler accepts*. This builds it.
--
-- THE SHAPE, in one sentence: `update_task_assignment` tests the caller's reach over the assignee's
-- calendar — the same test ADR-0040's trigger makes — and where it fails, records a request and
-- assigns nothing; whoever could have made the booking directly answers it, and approving IS the
-- assignment, made by the approver through the same function (d.2, d.5, d.7).
--
-- What this does NOT touch (d.15): `app.in_write_scope`, `app.resource_in_write_scope`, the three
-- `bookings_scheduler_*` policies, ADR-0040's trigger (test 048 passes unmodified — it remains the
-- guard on every write path that is not this RPC), the `tentative` state, `requires_approval`, the
-- PM bypass, plain reservations, and `create_adhoc_deliverable`.
--
-- Functions are reproduced WHOLE, the house pattern: a bare `create or replace` resets `proconfig`
-- and drops the ADR-0033 `search_path` pin. `update_task_assignment` is reproduced from
-- `20260830150000` (the last definition — checked with
-- `grep -ln "function public.update_task_assignment" supabase/migrations/*.sql`).

begin;

-- ============================================================================
-- 1) the notification types (d.6, d.7, d.8, d.9)
-- ============================================================================
-- Reproduced from `20260903130100`, the current definition — NOT from memory. The constraint is
-- drop-and-recreate, so anything omitted here is silently un-emittable afterwards. Four new values:
--   assignment_requested   → the leads whose reach covers the calendar (d.6)
--   assignment_approved    → the requester, when the lead says yes (d.7)
--   assignment_refused     → the requester, when the lead says no (d.8)
--   assignment_superseded  → the requester, when somebody else assigned the task meanwhile (d.9 —
--                            the ONE moot case the ADR says the requester must hear about)
-- Copy for all four is added in the same change set: `notify-email` (EN and AR) and the inbox
-- strings under `notifications.type.*`. `src/test/notification-copy.test.ts` fails otherwise.
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in (
    'assigned', 'review_requested', 'changes_requested', 'signed_off', 'blocked', 'due_soon',
    'dependency_ready', 'cancelled', 'resource_clash', 'resource_required',
    'campaign_approved', 'deliverable_reassigned', 'rescheduled', 'chat_added',
    'task_reinstated', 'brief_awaiting_approval', 'feedback_collected',
    'assignment_requested', 'assignment_approved', 'assignment_refused',
    'assignment_superseded'
  ));

comment on constraint notifications_type_check on notifications is
  'ADR-0028 + I31.7 + ADR-0068 d.6 + ADR-0070 d.6 + ADR-0087 d.6-d.9. Every value here needs COPY '
  'in notify-email or it is silently in-app only, AND copy under `notifications.type.*` in EN and '
  'AR or the inbox renders the raw key at the reader. Both have already been missed more than once.';

-- ============================================================================
-- 2) the record: a row, not a state on the task (d.4)
-- ============================================================================
-- `resource_id` is the CALENDAR the request is about — the assignee's active human resource at the
-- time of asking. It is what `resource_in_write_scope` is evaluated over when the request is
-- answered, what the grid draws the *requested* chip on, and what the moot-closing trigger watches.
-- Stored rather than re-derived so the record says which calendar was asked for even if the person
-- is later re-linked.
--
-- Composite FKs to sub_tasks and resources: a plain `references resources(id)` is not a tenant
-- fence (traps.md), and this row is written by a definer function.
create table sub_task_assignment_requests (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  sub_task_id   uuid not null,
  resource_id   uuid not null,
  assignee_id   uuid not null references user_profiles(id),
  requested_by  uuid not null references user_profiles(id),
  requested_at  timestamptz not null default now(),
  -- The assignment payload: what `update_task_assignment` would have written, held until the lead
  -- answers. NULLs mean what they mean to that function — "leave it alone".
  title         text not null,
  starts_at     timestamptz,
  due_at        timestamptz,
  hours         numeric,
  reviewers     jsonb,
  review_mode   text check (review_mode in ('digital', 'manual')),
  status        text not null default 'pending'
                  check (status in ('pending', 'approved', 'refused', 'withdrawn', 'superseded')),
  -- Who closed it and when. `decided_by` is null for a `superseded` close, which nobody made.
  decided_by    uuid references user_profiles(id),
  decided_at    timestamptz,
  reason        text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint fk_sub_task_assignment_requests_sub_task
    foreign key (tenant_id, sub_task_id) references sub_tasks (tenant_id, id) on delete cascade,
  constraint fk_sub_task_assignment_requests_resource
    foreign key (tenant_id, resource_id) references resources (tenant_id, id),
  -- A closed request always says when; a pending one never does.
  constraint chk_sub_task_assignment_requests_closed_when
    check ((status = 'pending') = (decided_at is null))
);

create index idx_sub_task_assignment_requests_tenant_id on sub_task_assignment_requests (tenant_id);
create index idx_sub_task_assignment_requests_sub_task_id on sub_task_assignment_requests (sub_task_id);
create index idx_sub_task_assignment_requests_resource_id on sub_task_assignment_requests (resource_id);
-- d.4: at most one pending request per task. Enforced here so two requesters cannot race.
create unique index uq_sub_task_assignment_requests_one_pending
  on sub_task_assignment_requests (sub_task_id) where status = 'pending';

comment on table sub_task_assignment_requests is
  'ADR-0087 d.4: a request to assign a task to somebody whose calendar the requester cannot '
  'schedule. Holds the assignment payload until whoever could have booked directly answers it '
  '(d.5). Nothing on the task changes while it is pending; a pending request holds no capacity '
  '(d.10). Written only by the RPCs in 20260911110000; readable tenant-wide like every other row.';
comment on column sub_task_assignment_requests.resource_id is
  'The calendar asked for: the assignee''s active human resource when the request was made. The '
  'decide test (`app.resource_in_write_scope`) runs over this, and the grid draws the requested chip on it.';
comment on column sub_task_assignment_requests.status is
  'pending | approved | refused | withdrawn | superseded. `superseded` is the system closing a request '
  'that no longer applies (ADR-0087 d.9): the task assigned another way, cancelled or done, or the '
  'person no longer bookable.';

-- RLS in the SAME migration. Reads are tenant-wide, as everywhere: the requester, the leads and the
-- grid all need the row, and it carries nothing a tenant member may not already see. No write
-- policy at all — every write goes through a SECURITY DEFINER RPC below, which is what keeps
-- "who may ask" and "who may answer" in one place each.
alter table sub_task_assignment_requests enable row level security;
alter table sub_task_assignment_requests force row level security;

create policy sub_task_assignment_requests_tenant_select on sub_task_assignment_requests
  for select to authenticated
  using (tenant_id = app.current_tenant_id());

-- AUDIT in the SAME migration (AGENTS.md §6; test 092 names a tenant table without it).
create trigger audit_row_change
  after insert or update or delete on sub_task_assignment_requests
  for each row execute function app.audit_row_change();
create trigger set_updated_at before update on sub_task_assignment_requests
  for each row execute function app.set_updated_at();

-- ============================================================================
-- 3) who will be TOLD: the leads whose role reach covers the calendar (d.6)
-- ============================================================================
-- Computed the way `public.department_brief_approvers` is: `app.user_has_permission` for the grant
-- half, and the scope test MIRRORED in the query for the reach half — never a role name. The two
-- branches below are `app.in_write_scope`'s `department` and `team` branches (20260906110000),
-- read against each candidate's own placement instead of the caller's:
--
--   department  the resource's department is theirs, or the resource's team sits in it;
--   team        the resource's team is theirs, or — for a resource naming NO team — their team
--               sits in the resource's department (ADR-0070 d.3's "question asked with no team").
--
-- Deliberately ABSENT, and test 097 asserts each absence:
--   * `tenant` and `all_accounts` holders — they can approve anything and would receive every
--     request in the agency; that is what keeps them a fallback and not a queue (ADR-0070 d.6);
--   * per-user SCOPE-grant holders — a scope grant says what somebody may write, not whose request
--     they answer for (I40.15). They may still decide.
--
-- So the listed set is exactly the deciding set (d.5) minus those two groups. SECURITY DEFINER:
-- it reads role scope and per-user grants across people, which `user_has_permission` already does
-- under the same justification (ADR-0037); search_path pinned (ADR-0033).
create or replace function public.assignment_request_approvers(p_resource uuid)
returns table (user_id uuid, display_name text)
language sql stable security definer
set search_path = public, app, extensions as $$
  select up.id, up.display_name
    from public.resources res
    join public.user_profiles up on up.tenant_id = res.tenant_id and up.is_active
    join public.roles r on r.id = up.role_id
   where res.id = p_resource
     and res.tenant_id = app.current_tenant_id()
     and app.user_has_permission(up.id, 'bookings', 'create')
     and (
       (r.scope = 'department' and up.department_id is not null and (
           up.department_id = res.department_id
           or (res.team_id is not null and exists (
                 select 1 from public.teams t
                 where t.id = res.team_id and t.department_id = up.department_id))))
       or
       (r.scope = 'team' and up.team_id is not null and (
           (res.team_id is not null and res.team_id = up.team_id)
           or (res.team_id is null and res.department_id is not null and exists (
                 select 1 from public.teams t
                 where t.id = up.team_id and t.department_id = res.department_id))))
     )
   order by up.display_name
$$;

comment on function public.assignment_request_approvers(uuid) is
  'ADR-0087 d.6: the leads who are TOLD about a request to book this resource — department-scoped '
  'holders of bookings:create over its department, team-scoped holders over its team (or its '
  'department, for a resource naming no team). The scope test is mirrored from app.in_write_scope, '
  'never a role name. Tenant-wide and all-accounts holders, and per-user scope-grant holders, are '
  'not named: they may still decide (d.5). Test 097 asserts named = deciding minus those groups.';

revoke execute on function public.assignment_request_approvers(uuid) from public;
revoke execute on function public.assignment_request_approvers(uuid) from anon;
grant  execute on function public.assignment_request_approvers(uuid) to authenticated;

-- ============================================================================
-- 4) the one assignment path decides (d.2, d.3, d.7, d.12, d.13)
-- ============================================================================
-- Reproduced WHOLE from 20260830150000. The return type gains `outcome` ('assigned' | 'requested')
-- and `request_id`, which a signature-preserving `create or replace` cannot do, so the old one is
-- dropped first; grants are restated below.
--
-- Three edits, and no others:
--   a) the task gate at the top is bypassed for an APPROVAL — `app.assignment_request` names a
--      request that is `approved`, for THIS task, decided by THIS caller. That is d.7's one clause
--      combining two people's authority: the request holds the task half (tested when it was made,
--      below), the approval supplies the calendar half (tested in decide_assignment_request), and
--      the row records both. The approver is not re-tested against the task's own scope.
--   b) before anything is written, on a CHANGE of assignee, the caller's reach over the assignee's
--      calendar is tested — the same three steps as ADR-0040's trigger: no bookable resource means
--      nothing to authorise; no bookings:create is refused outright (d.3 — a Team Member cannot
--      request, exactly as they cannot book); out of reach becomes a request and returns.
--   c) d.13: an unplaced resource is refused, not queued — nobody scoped could ever answer.
drop function if exists public.update_task_assignment(uuid, text, uuid, jsonb, timestamptz, timestamptz, numeric, text);

create function public.update_task_assignment(
  p_sub_task    uuid,
  p_title       text,
  p_assignee    uuid,
  p_reviewers   jsonb default null,
  p_starts_at   timestamptz default null,
  p_due_at      timestamptz default null,
  p_hours       numeric default null,
  p_review_mode text default null
) returns table(sub_task_id uuid, deliverable_id uuid, reschedule_needed boolean, outcome text, request_id uuid)
language plpgsql security definer set search_path = public, app, extensions as $$
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
  -- Against `v`, the task as it stands NOW: testing the incoming department would make this a way
  -- out of a scope you do not hold (ADR-0060 d.9).
  elsif not (app.has_permission('project_tasks', 'manage')
          and app.in_write_scope(v.department_id, v.team_id, app.deliverable_account_manager(v.deliverable_id))) then
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

      if not app.resource_in_write_scope(v_resource) then
        -- d.13: reachable only by tenant-wide and all-accounts roles, who are not notified (d.6).
        -- A request here would wait for nobody, so it is refused at request time and the fix is
        -- to place the resource. The hint lets the client show `schedule.refusal.unplaced`.
        if v_res_dept is null and v_res_team is null then
          raise exception
            '% is not placed in a department or team, so there is nobody to ask — only a company-wide role can book them',
            (select display_name from public.user_profiles where id = p_assignee)
            using errcode = '42501', hint = 'unplaced_resource';
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
end $$;

comment on function public.update_task_assignment(uuid, text, uuid, jsonb, timestamptz, timestamptz, numeric, text) is
  'ADR-0038/0040, amended by ADR-0043, ADR-0059 d.4, ADR-0060 d.9, ADR-0061 d.5 and ADR-0087 d.2: '
  'assign a task, stamp its department and team from the person, refuse to hand work to somebody '
  'who is not bookable — and where the caller cannot schedule the assignee''s calendar, record a '
  'request instead and assign nothing (outcome = requested). The caller never chooses which. On an '
  'approval (decide_assignment_request) the task gate is the approved request itself (d.7).';

revoke execute on function public.update_task_assignment(uuid, text, uuid, jsonb, timestamptz, timestamptz, numeric, text) from public;
revoke execute on function public.update_task_assignment(uuid, text, uuid, jsonb, timestamptz, timestamptz, numeric, text) from anon;
grant  execute on function public.update_task_assignment(uuid, text, uuid, jsonb, timestamptz, timestamptz, numeric, text) to authenticated;

-- ============================================================================
-- 5) answering: whoever could have made the booking directly (d.5, d.7, d.8)
-- ============================================================================
-- `app.has_permission('bookings','create')` and `app.resource_in_write_scope(<the calendar>)`,
-- for the CALLER, through the primitives and nowhere else. That is the department lead by
-- department reach, the team lead or deputy by team reach, either of them, the tenant-wide and
-- all-accounts failsafe, and a per-user scope grant over that department or team. No role is named.
-- `bookings:approve` is deliberately NOT required — it belongs to the `requires_approval`
-- reservation flow, and a second meaning on it would give this rule two homes.
--
-- Approval IS the assignment, made by the approver: the request's payload goes through
-- `update_task_assignment` as them, under `app.assignment_request`, so ADR-0040's trigger passes
-- for them, the task's department follows the assignee (ADR-0060 d.9) and the person is told
-- `assigned` with the approver as actor. The client then runs `subtask-schedule` as the approver
-- and the bookings materialise `confirmed`, as any direct assignment does — which is why this
-- returns `reschedule_needed`.
--
-- SECURITY DEFINER because the requester is not the approver and neither can write the other's
-- notification; search_path pinned (ADR-0033).
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
  if not (app.has_permission('bookings', 'create') and app.resource_in_write_scope(q.resource_id)) then
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
  'ADR-0087 d.5/d.7/d.8: approve or refuse a booking request. The caller must hold bookings:create '
  'and reach the requested calendar (app.resource_in_write_scope) — whoever could have booked '
  'directly; never the requester. Approving applies the request through update_task_assignment AS '
  'THE APPROVER, then the client schedules via subtask-schedule as them. Refusing changes nothing '
  'but the record. The requester is told either way.';

revoke execute on function public.decide_assignment_request(uuid, boolean, text) from public;
revoke execute on function public.decide_assignment_request(uuid, boolean, text) from anon;
grant  execute on function public.decide_assignment_request(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------- withdrawing (d.9) ----
create or replace function public.withdraw_assignment_request(p_request uuid)
returns void
language plpgsql security definer set search_path = public, app, extensions as $$
declare q sub_task_assignment_requests%rowtype;
begin
  select * into q from sub_task_assignment_requests
   where id = p_request and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'assignment request % not found', p_request using errcode = 'P0002';
  end if;
  if q.requested_by is distinct from auth.uid() then
    raise exception 'only the person who asked can withdraw a request' using errcode = '42501';
  end if;
  if q.status <> 'pending' then
    return;                                   -- idempotent: withdrawing a closed request is not an error
  end if;
  update sub_task_assignment_requests
     set status = 'withdrawn', decided_by = auth.uid(), decided_at = now()
   where id = p_request;
end $$;

comment on function public.withdraw_assignment_request(uuid) is
  'ADR-0087 d.9: the requester takes their request back. Nobody is told — the leads simply stop '
  'seeing it. Idempotent on a request that is already closed.';

revoke execute on function public.withdraw_assignment_request(uuid) from public;
revoke execute on function public.withdraw_assignment_request(uuid) from anon;
grant  execute on function public.withdraw_assignment_request(uuid) to authenticated;

-- ============================================================================
-- 6) closed automatically when it no longer applies (d.9)
-- ============================================================================
-- Three ways a pending request becomes moot: the task is assigned by another route, the task is
-- cancelled or done, or the proposed person stops being bookable (ADR-0061 d.5). Closed as
-- `superseded`. The requester is told ONLY in the assigned-by-someone-else case — the other two
-- are already visible to them. `decided_by` stays null: nobody decided this.
--
-- The approval path does not reach here as a supersede: decide_assignment_request marks the row
-- `approved` BEFORE the assignee changes, so there is nothing pending to close.
create or replace function app.tg_close_moot_assignment_requests() returns trigger
language plpgsql security definer set search_path = public, app, extensions as $$
declare
  v_reassigned boolean := new.assignee_id is not null and new.assignee_id is distinct from old.assignee_id;
  v_settled    boolean := new.status in ('cancelled', 'done') and new.status is distinct from old.status;
  q sub_task_assignment_requests%rowtype;
begin
  if not (v_reassigned or v_settled) then return new; end if;

  for q in
    update sub_task_assignment_requests
       set status = 'superseded', decided_at = now()
     where sub_task_assignment_requests.sub_task_id = new.id and status = 'pending'
    returning *
  loop
    if v_reassigned and q.requested_by is distinct from auth.uid() then
      insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
      values (q.tenant_id, q.requested_by, 'assignment_superseded', new.title, 'sub_task', new.id, auth.uid());
    end if;
  end loop;
  return new;
end $$;

comment on function app.tg_close_moot_assignment_requests() is
  'ADR-0087 d.9: a pending request is closed as superseded when its task is assigned another way, '
  'cancelled or done. The requester is told only when somebody else assigned it.';

create trigger close_moot_assignment_requests
  after update of assignee_id, status on sub_tasks
  for each row execute function app.tg_close_moot_assignment_requests();

-- ... and when the person stops being bookable: the resource switched off, or unlinked from the
-- login. Nobody is told; the schedule already shows the change.
create or replace function app.tg_close_assignment_requests_on_resource() returns trigger
language plpgsql security definer set search_path = public, app, extensions as $$
begin
  if (old.is_active and not new.is_active) or (new.user_id is distinct from old.user_id) then
    update sub_task_assignment_requests
       set status = 'superseded', decided_at = now()
     where resource_id = new.id and status = 'pending';
  end if;
  return new;
end $$;

comment on function app.tg_close_assignment_requests_on_resource() is
  'ADR-0087 d.9 / ADR-0061 d.5: a request to book a calendar that is switched off or re-linked no '
  'longer applies and is closed as superseded.';

create trigger close_assignment_requests_on_resource
  after update of is_active, user_id on resources
  for each row execute function app.tg_close_assignment_requests_on_resource();

commit;
