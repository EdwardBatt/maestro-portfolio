-- ADR-0139 (Edward, 3 Oct) — I74.1–I74.6. A booking outside your own team is a request to that team's lead.
--
--   d.1  WHO BOOKS DIRECTLY. `app.resource_in_scheduling_scope` narrows: a tenant-wide role (Traffic, Power Admin) reaches
--        every calendar; a department lead the people of his department; a team lead (and a deputy) the people of her
--        team; everyone else — an account manager, the account director, a team member — nobody, and asks. Per-user
--        scope grants (ADR-0036) still widen it, as they widened `resource_in_write_scope`. Every reader ADR-0098 d.2
--        moved to the predicate follows: the three booking policies, ADR-0040's trigger, `update_task_assignment`,
--        `user_in_scheduling_scope` (the sub_tasks policies) and the request readers.
--   d.2  A REQUEST NAMES A TEAM; the person is optional. `sub_task_assignment_requests` gains `team_id`, `needed_by`,
--        `note`, an `offered` answer (`offered_starts_at`, `offered_ends_at`), `answered_by`, `answer_note` and
--        `escalated_at`; `assignee_id` / `resource_id` become nullable ("the lead decides"). Rows already on the record
--        are untouched (d.8). `public.request_task_booking` asks; `update_task_assignment`'s request branch (a person
--        picked outside your reach) asks the same way.
--   d.3  WHO ANSWERS. `app.task_request_answerers`: the team's Team Leader; the Deputy Team Leader only when every Team
--        Leader has leave covering that day; no team, no leader, or the leader away with no deputy → the department
--        lead(s). It replaces the body of `public.assignment_request_approvers`, so every caller follows.
--   d.4  THE ANSWERS. `public.answer_task_request`: book (the person and days, re-run as the answerer through
--        `update_task_assignment`, as `decide_assignment_request` did), offer another day, or say no with a reason.
--        `public.take_task_offer` books an offer as the asker took it; `withdraw_assignment_request` takes it back
--        while it waits. `decide_assignment_request` stays as the old door, over the same answer.
--   d.5  UNANSWERED after 4 working hours (a tenant setting, kind `task_request`): Traffic and the department lead are
--        told and may answer; the first to act settles it. The sweep stamps `escalated_at`.
--   Booking the answer: the asker of an approved request may place (and clear) that task's bookings on the agreed
--        person's calendar within the task's days — `app.task_booking_sanctioned` in the three booking policies — so
--        `subtask-schedule`, which runs as the caller, can book a taken offer. Nothing else widens.
--
-- The notification types and escalation kinds for ALL FOUR decisions of 3 Oct (ADR-0139–0142) are added here, once:
--   assignment_offered, assignment_offer_taken, assignment_withdrawn   (ADR-0139)
--   task_unassigned                                                    (ADR-0140)
--   deliverable_change_asked, deliverable_change_answered, deliverable_change_withdrawn, time_asked, time_answered
--                                                                      (ADR-0141)
--   escalation kinds: task_request (ADR-0139), deliverable_change (ADR-0141)
--
-- Reproduced WHOLE from their latest definitions (grep -liE "function +(public|app)\.<name>\b" confirmed each, 3 Oct):
--   app.resource_in_scheduling_scope         20260922190000 (cost from 20260923130000)
--   public.update_task_assignment            20260926162000
--   public.decide_assignment_request         20260922190000
--   public.withdraw_assignment_request       20260911110000
--   public.assignment_request_approvers      20260911110000
--   app.tg_subtask_assignment_authority      20260922190000
--   app.tg_close_moot_assignment_requests    20260911110000
--   app.tg_close_assignment_requests_on_resource 20260911110000
--   public.my_pending_approvals              20260930141000
--   app.seed_tenant_escalation_rules, app.escalation_due, app.run_escalation_sweep   20260930142000
--   notifications_type_check                 20261002120000
--   chk_tenant_escalation_rules_kind         20260930142000
-- Safe on a populated database: every constraint added is satisfied by the rows the old one admitted, the new columns
-- are nullable, and the only top-level write is the escalation-rule seed (`on conflict do nothing`).

begin;

-- ===================================================================== the lists, once for the four decisions ====
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check check (type = any (array[
  'assigned', 'review_requested', 'changes_requested', 'signed_off', 'due_soon', 'dependency_ready', 'cancelled',
  'resource_clash', 'resource_required', 'campaign_approved', 'deliverable_reassigned', 'rescheduled', 'chat_added',
  'task_reinstated', 'feedback_collected', 'assignment_requested', 'assignment_approved', 'assignment_refused',
  'assignment_superseded', 'extension_requested', 'extension_approved', 'extension_refused', 'deliverable_added',
  'deliverable_owner_removed', 'task_reassigned_away', 'feedback_requested', 'assignment_overdue', 'task_reopened',
  'deliverable_reopened', 'task_blocked', 'untimed_round', 'extension_forwarded', 'change_request_sent',
  'change_request_answered', 'change_request_resolved', 'question_asked', 'question_replied', 'nudged', 'too_much',
  'too_much_answered', 'escalated', 'review_reminder', 'over_capacity', 'task_unblocked',
  'client_activation_requested', 'deliverable_type_changed', 'deliverable_edited',
  'handover_list', 'deactivation_complete',
  'link_expiring', 'file_brought_back',
  -- ADR-0139 d.4: an answer the asker hears, an offer taken, a request taken back
  'assignment_offered', 'assignment_offer_taken', 'assignment_withdrawn',
  -- ADR-0140 d.5: a booking cancelled — the assignee and their lead
  'task_unassigned',
  -- ADR-0141 d.2–d.5: the one change form, and the maker's ask for more time
  'deliverable_change_asked', 'deliverable_change_answered', 'deliverable_change_withdrawn',
  'time_asked', 'time_answered'
]::text[]));

alter table tenant_escalation_rules drop constraint if exists chk_tenant_escalation_rules_kind;
alter table tenant_escalation_rules add constraint chk_tenant_escalation_rules_kind check (kind = any (array[
  'unassigned', 'task_list', 'campaign_brief', 'change_request', 'extension_owner', 'extension_am', 'blocked',
  'review_remind', 'review_escalate',
  'handover',             -- ADR-0133 d.5
  'task_request',         -- ADR-0139 d.5
  'deliverable_change'    -- ADR-0141 d.3
]::text[]));

-- ===================================================================== d.1: who books directly ====
create or replace function app.resource_in_scheduling_scope(p_resource uuid)
returns boolean language sql stable cost 10000
set search_path = public, app, extensions as $$
  select exists (
    select 1
      from public.resources r
      left join public.user_profiles up on up.id = r.user_id and up.tenant_id = r.tenant_id
      left join public.teams pt on pt.id = coalesce(up.team_id, r.team_id)
     where r.id = p_resource
       and r.tenant_id = app.current_tenant_id()
       and (
         case app.current_scope()
           -- Traffic and the Power Admin: every calendar.
           when 'tenant' then true
           -- A department lead: the people of his department (their own placement first, the calendar's otherwise),
           -- and anyone in a team that sits in it.
           when 'department' then app.current_department_id() is not null
             and (coalesce(up.department_id, r.department_id) = app.current_department_id()
                  or pt.department_id = app.current_department_id())
           -- A team lead or deputy: the people of her own team. Inside her department but another team is a request.
           when 'team' then app.current_team_id() is not null
             and coalesce(up.team_id, r.team_id) = app.current_team_id()
           -- account, all_accounts, self: nobody. They ask.
           else false
         end
         -- ADR-0036: a per-user scope grant still widens reach, as it did through resource_in_write_scope.
         or exists (
           select 1 from public.user_scope_grants usg
            where usg.user_id = auth.uid() and usg.tenant_id = app.current_tenant_id()
              and ((usg.department_id is not null
                    and usg.department_id in (coalesce(up.department_id, r.department_id), pt.department_id))
                or (usg.team_id is not null and usg.team_id = coalesce(up.team_id, r.team_id))))))
$$;

comment on function app.resource_in_scheduling_scope(uuid) is
  'ADR-0139 d.1: reach over a calendar FOR SCHEDULING. Tenant-wide roles (Traffic, Power Admin) reach every calendar; '
  'a department lead the people of his department; a team lead or deputy the people of her own team; account, '
  'all_accounts and self scopes reach nobody and send a request. Per-user scope grants widen it. Read by the booking '
  'policies, the ADR-0040 trigger, update_task_assignment and user_in_scheduling_scope — NOT by leave or office '
  'closures (ADR-0098 d.3), which keep resource_in_write_scope.';

-- ===================================================================== d.2: the request names a team ====
alter table sub_task_assignment_requests
  add column if not exists team_id           uuid references teams(id),
  add column if not exists needed_by         date,
  add column if not exists note              text,
  add column if not exists offered_starts_at timestamptz,
  add column if not exists offered_ends_at   timestamptz,
  add column if not exists answered_by       uuid references user_profiles(id),
  add column if not exists answered_at       timestamptz,
  add column if not exists answer_note       text,
  add column if not exists escalated_at      timestamptz;

alter table sub_task_assignment_requests alter column assignee_id drop not null;
alter table sub_task_assignment_requests alter column resource_id drop not null;

alter table sub_task_assignment_requests drop constraint if exists sub_task_assignment_requests_status_check;
alter table sub_task_assignment_requests add constraint sub_task_assignment_requests_status_check
  check (status in ('pending', 'offered', 'approved', 'refused', 'withdrawn', 'superseded'));

-- An open request (waiting on the lead, or on the asker to take an offer) has no close; every other one says when.
alter table sub_task_assignment_requests drop constraint if exists chk_sub_task_assignment_requests_closed_when;
alter table sub_task_assignment_requests add constraint chk_sub_task_assignment_requests_closed_when
  check ((status in ('pending', 'offered')) = (decided_at is null));
alter table sub_task_assignment_requests add constraint chk_sub_task_assignment_requests_offer_has_days
  check (status <> 'offered' or (offered_starts_at is not null and offered_ends_at is not null
                                 and offered_ends_at > offered_starts_at));
-- Somebody is asked: a team, a person, or both.
alter table sub_task_assignment_requests add constraint chk_sub_task_assignment_requests_asks_someone
  check (team_id is not null or assignee_id is not null);

-- At most one OPEN request per task — pending or offered.
drop index if exists uq_sub_task_assignment_requests_one_pending;
create unique index if not exists uq_sub_task_assignment_requests_one_open
  on sub_task_assignment_requests (sub_task_id) where status in ('pending', 'offered');
create index if not exists idx_sub_task_assignment_requests_team_id on sub_task_assignment_requests (team_id);

comment on column sub_task_assignment_requests.team_id is
  'ADR-0139 d.2: the team asked. Null on requests made before 3 Oct (they named a person; the person''s team answers).';
comment on column sub_task_assignment_requests.assignee_id is
  'The person asked for, or null when the team''s lead decides (ADR-0139 d.2). On an approved request, the person booked.';
comment on column sub_task_assignment_requests.status is
  'pending | offered | approved | refused | withdrawn | superseded. `offered` (ADR-0139 d.4): the lead offered other '
  'days (offered_starts_at / offered_ends_at) and the asker has not taken them yet.';

-- ===================================================================== d.3: who answers ====
-- Has this person leave covering the day (Baghdad's day, as the working-hours clock reads it)?
create or replace function app.person_on_leave(p_user uuid, p_on date)
returns boolean language sql stable security definer
set search_path = public, app, extensions as $$
  select exists (
    select 1
      from public.resource_unavailability ru
      join public.resources r on r.id = ru.resource_id
     where r.user_id = p_user and r.kind = 'human'
       and r.tenant_id = app.current_tenant_id()
       and ru.kind = 'leave'
       and ru.timespan && tstzrange(p_on::timestamp at time zone 'Asia/Baghdad',
                                    (p_on + 1)::timestamp at time zone 'Asia/Baghdad', '[)'))
$$;
comment on function app.person_on_leave(uuid, date) is
  'ADR-0139 d.3: true when the person has leave (resource_unavailability kind leave) on that Baghdad day. Definer: '
  'leave rows are read tenant-wide already; this only fences the tenant.';
revoke execute on function app.person_on_leave(uuid, date) from public, anon;
grant  execute on function app.person_on_leave(uuid, date) to authenticated, service_role;

-- The department a request waits on: its team's, else the asked person's own, else their calendar's.
create or replace function app.task_request_department(p_team uuid, p_assignee uuid)
returns uuid language sql stable security definer
set search_path = public, app, extensions as $$
  select coalesce(
    (select t.department_id from public.teams t where t.id = p_team),
    (select up.department_id from public.user_profiles up where up.id = p_assignee),
    (select r.department_id from public.resources r
      where r.user_id = p_assignee and r.kind = 'human' order by r.is_active desc limit 1))
$$;
revoke execute on function app.task_request_department(uuid, uuid) from public, anon;
grant  execute on function app.task_request_department(uuid, uuid) to authenticated, service_role;

-- The team a request waits on: the one named, else the asked person's (requests made before 3 Oct named a person only).
create or replace function app.task_request_team(p_team uuid, p_assignee uuid)
returns uuid language sql stable security definer
set search_path = public, app, extensions as $$
  select coalesce(p_team,
    (select up.team_id from public.user_profiles up where up.id = p_assignee),
    (select r.team_id from public.resources r
      where r.user_id = p_assignee and r.kind = 'human' order by r.is_active desc limit 1))
$$;
revoke execute on function app.task_request_team(uuid, uuid) from public, anon;
grant  execute on function app.task_request_team(uuid, uuid) to authenticated, service_role;

-- d.3 in order: the Team Leader(s) of the team who are not on leave that day; if the team HAS a Team Leader and every
-- one is on leave, its Deputy Team Leader(s) not on leave; otherwise — no team, no leader, or nobody to stand in — the
-- department lead(s). Roles are told apart by key (`team_lead`, `deputy_team_lead`); a department lead by scope, as
-- the escalation resolver reads it. SECURITY DEFINER: it reads people's roles and leave across the tenant, fenced to
-- the caller's tenant (or, for the service-role sweep, the team's).
create or replace function app.task_request_answerers(p_team uuid, p_department uuid, p_on date default null)
returns table (user_id uuid, reason text)
language plpgsql stable security definer
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := coalesce(app.current_tenant_id(),
                            (select t.tenant_id from public.teams t where t.id = p_team),
                            (select d.tenant_id from public.departments d where d.id = p_department));
  v_on   date := coalesce(p_on, (now() at time zone 'Asia/Baghdad')::date);
  v_dept uuid := coalesce((select t.department_id from public.teams t where t.id = p_team), p_department);
begin
  if p_team is not null then
    return query
      select up.id, 'team_lead'::text
        from public.user_profiles up join public.roles ro on ro.id = up.role_id
       where up.tenant_id = v_tenant and up.is_active and up.team_id = p_team and ro.key = 'team_lead'
         and not app.person_on_leave(up.id, v_on)
       order by up.id;
    if found then return; end if;

    if exists (select 1 from public.user_profiles up join public.roles ro on ro.id = up.role_id
                where up.tenant_id = v_tenant and up.is_active and up.team_id = p_team and ro.key = 'team_lead') then
      return query
        select up.id, 'deputy_team_lead'::text
          from public.user_profiles up join public.roles ro on ro.id = up.role_id
         where up.tenant_id = v_tenant and up.is_active and up.team_id = p_team and ro.key = 'deputy_team_lead'
           and not app.person_on_leave(up.id, v_on)
         order by up.id;
      if found then return; end if;
    end if;
  end if;

  return query
    select up.id, 'department_lead'::text
      from public.user_profiles up join public.roles ro on ro.id = up.role_id
     where up.tenant_id = v_tenant and up.is_active and ro.scope = 'department'
       and v_dept is not null and up.department_id = v_dept
     order by up.id;
end $$;

comment on function app.task_request_answerers(uuid, uuid, date) is
  'ADR-0139 d.3: who answers a request to a team — its Team Leader; the Deputy Team Leader only when every Team Leader '
  'has leave that day; no team, no leader, or nobody to stand in → the department lead(s). `reason` says which.';
revoke execute on function app.task_request_answerers(uuid, uuid, date) from public, anon;
grant  execute on function app.task_request_answerers(uuid, uuid, date) to authenticated, service_role;

-- May the caller answer this request? Its answerers; and once it has escalated (d.5), Traffic — a tenant-wide holder
-- of bookings:create — and the department lead it waits on. Never the asker. Only an open request has an answer.
create or replace function app.may_answer_task_request(p_request uuid)
returns boolean language sql stable security definer cost 10000
set search_path = public, app, extensions as $$
  select exists (
    select 1 from public.sub_task_assignment_requests q
     where q.id = p_request and q.tenant_id = app.current_tenant_id()
       and q.requested_by is distinct from auth.uid()
       and (
         auth.uid() in (select a.user_id
                          from app.task_request_answerers(app.task_request_team(q.team_id, q.assignee_id),
                                                          app.task_request_department(q.team_id, q.assignee_id)) a)
         or (q.escalated_at is not null and (
               (app.current_scope() = 'tenant' and app.has_permission('bookings', 'create'))
               or (app.current_scope() = 'department'
                   and app.current_department_id() = app.task_request_department(q.team_id, q.assignee_id))))))
$$;
comment on function app.may_answer_task_request(uuid) is
  'ADR-0139 d.3/d.5: the request''s answerers (app.task_request_answerers); after it escalates, also Traffic (tenant '
  'scope with bookings:create) and the department lead it waits on. Never the asker.';
revoke execute on function app.may_answer_task_request(uuid) from public, anon;
grant  execute on function app.may_answer_task_request(uuid) to authenticated;

-- The one exposed list (same signature as ADR-0087's): who is asked about a booking on this calendar. Re-emitted
-- whole from 20260911110000 with ADR-0139 d.3's order as its body, so every caller — refusal_names_assignee_leads, the
-- client — follows.
create or replace function public.assignment_request_approvers(p_resource uuid)
returns table (user_id uuid, display_name text)
language sql stable security definer
set search_path = public, app, extensions as $$
  select up.id, up.display_name
    from public.resources res
    cross join lateral app.task_request_answerers(app.task_request_team(null, res.user_id),
                                                  coalesce(app.task_request_department(null, res.user_id),
                                                           res.department_id)) a
    join public.user_profiles up on up.id = a.user_id
   where res.id = p_resource
     and res.tenant_id = app.current_tenant_id()
   order by up.display_name
$$;
comment on function public.assignment_request_approvers(uuid) is
  'ADR-0139 d.3 (replaces ADR-0087 d.6): who answers a booking request on this calendar — its person''s Team Leader, '
  'the Deputy when every Team Leader is on leave today, else the department lead(s).';

-- ===================================================================== d.2: raising one ====
-- The one writer of a request, for both doors (request_task_booking, and update_task_assignment's out-of-reach
-- branch). Already authorised by its caller; not granted to anyone.
create or replace function app.raise_task_request(
  p_sub_task uuid, p_team uuid, p_assignee uuid, p_title text,
  p_starts_at timestamptz, p_due_at timestamptz, p_hours numeric, p_reviewers jsonb, p_review_mode text,
  p_needed_by date, p_note text)
returns uuid
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant   uuid := app.current_tenant_id();
  v_resource uuid;
  v_request  uuid;
  v_team     uuid := app.task_request_team(p_team, p_assignee);
  v_dept     uuid := app.task_request_department(p_team, p_assignee);
  v_refusal  text;
begin
  -- The same two gates app.tg_sub_task_assignment_gate holds the answer to, asked now (ADR-0087 d.11): no lead is
  -- asked about work whose answer would be refused.
  if not app.campaign_is_approved(app.sub_task_campaign(p_sub_task)) then
    raise exception
      'this campaign is waiting for the account manager to approve it, so its work cannot be assigned yet'
      using errcode = '42501';
  end if;
  v_refusal := app.sub_task_work_acceptance_refusal(p_sub_task);
  if v_refusal is not null then
    raise exception '%', v_refusal using errcode = '42501';
  end if;
  if exists (select 1 from sub_task_assignment_requests q
              where q.sub_task_id = p_sub_task and q.status in ('pending', 'offered')) then
    raise exception 'this task already has a booking request waiting for an answer'
      using errcode = '22023', hint = 'request_pending';
  end if;
  if v_team is null and v_dept is null then
    raise exception 'there is nobody to ask — the person is in no team and no department'
      using errcode = '42501', hint = 'unplaced_resource';
  end if;

  if p_assignee is not null then
    select r.id into v_resource from resources r
     where r.user_id = p_assignee and r.kind = 'human' and r.is_active and r.tenant_id = v_tenant
     limit 1;
  end if;

  insert into sub_task_assignment_requests
    (tenant_id, sub_task_id, resource_id, assignee_id, team_id, requested_by,
     title, starts_at, due_at, hours, reviewers, review_mode, needed_by, note)
  values
    (v_tenant, p_sub_task, v_resource, p_assignee, v_team, auth.uid(),
     trim(p_title), p_starts_at, p_due_at, p_hours, p_reviewers, p_review_mode, p_needed_by,
     nullif(trim(coalesce(p_note, '')), ''))
  returning id into v_request;

  -- d.3: the answerers are told. Never the asker, who knows.
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
  select v_tenant, a.user_id, 'assignment_requested', (select t.title from sub_tasks t where t.id = p_sub_task),
         'sub_task', p_sub_task, auth.uid(),
         jsonb_build_object('request_id', v_request, 'team', (select tm.name from teams tm where tm.id = v_team),
                            'person', (select up.display_name from user_profiles up where up.id = p_assignee),
                            'hours', p_hours, 'needed_by', p_needed_by, 'note', nullif(trim(coalesce(p_note, '')), ''),
                            'as', a.reason)
    from app.task_request_answerers(v_team, v_dept) a
   where a.user_id is distinct from auth.uid();

  return v_request;
end $$;
revoke execute on function app.raise_task_request(uuid, uuid, uuid, text, timestamptz, timestamptz, numeric, jsonb, text, date, text)
  from public, anon, authenticated;

-- The asking door (SC-15, SC-28): a team, optionally one of its people, the hours, the needed-by date and a note.
-- Who may ask: whoever may give the task out — project_tasks:manage, or the piece's owner — and holds bookings:create
-- (ADR-0087 d.3: without the booking grant it is a refusal, not a request). Somebody within the caller's own reach is
-- booked directly, not asked (hint `book_directly`).
create or replace function public.request_task_booking(
  p_sub_task  uuid,
  p_team      uuid,
  p_assignee  uuid        default null,
  p_hours     numeric     default null,
  p_needed_by date        default null,
  p_starts_at timestamptz default null,
  p_due_at    timestamptz default null,
  p_note      text        default null)
returns uuid
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v        sub_tasks%rowtype;
  v_owner  uuid;
  v_team   uuid := p_team;
  v_person_team uuid;
  v_res    uuid;
begin
  select * into v from sub_tasks where id = p_sub_task and tenant_id = v_tenant;
  if not found then raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002'; end if;
  if v.status in ('done', 'cancelled') then
    raise exception '"%" is finished or called off — there is nothing to book', v.title using errcode = '22023';
  end if;
  select d.owner_user_id into v_owner from deliverables d where d.id = v.deliverable_id;

  if not (app.has_permission('project_tasks', 'manage') or v_owner = auth.uid()) then
    raise exception 'asking for this task to be booked requires project-task management permission'
      using errcode = '42501';
  end if;
  if not app.has_permission('bookings', 'create') then
    raise exception
      'you cannot ask for this task to be booked: it needs the bookings:create permission, which you do not hold'
      using errcode = '42501';
  end if;
  if p_team is null and p_assignee is null then
    raise exception 'say which team is asked' using errcode = '22023';
  end if;
  if p_team is not null and not exists (select 1 from teams t where t.id = p_team and t.tenant_id = v_tenant) then
    raise exception 'that team is not in your organization' using errcode = '22023';
  end if;
  if p_hours is not null and p_hours <= 0 then
    raise exception 'the hours asked for are more than nothing' using errcode = '22023';
  end if;
  if p_starts_at is not null and p_due_at is not null and p_due_at <= p_starts_at then
    raise exception 'the days asked for end before they start' using errcode = '22023';
  end if;

  if p_assignee is not null then
    select up.team_id into v_person_team from user_profiles up
     where up.id = p_assignee and up.tenant_id = v_tenant;
    if not found then
      raise exception 'that person is not in your organization' using errcode = '22023';
    end if;
    if p_team is not null and v_person_team is distinct from p_team then
      raise exception 'that person is not in the team asked' using errcode = '22023';
    end if;
    if not app.person_is_bookable(p_assignee) then
      raise exception 'that person is not bookable, so work cannot be asked of them' using errcode = '22023';
    end if;
    select r.id into v_res from resources r
     where r.user_id = p_assignee and r.kind = 'human' and r.is_active and r.tenant_id = v_tenant limit 1;
    if v_res is not null and app.resource_in_scheduling_scope(v_res) then
      raise exception 'this person is within your own reach — book them directly'
        using errcode = '22023', hint = 'book_directly';
    end if;
  elsif auth.uid() in (select a.user_id from app.task_request_answerers(v_team, null) a)
        or (app.current_scope() = 'tenant')
        or (app.current_scope() = 'team' and app.current_team_id() = v_team)
        or (app.current_scope() = 'department'
            and app.current_department_id() = app.task_request_department(v_team, null)) then
    raise exception 'this team is within your own reach — book one of its people directly'
      using errcode = '22023', hint = 'book_directly';
  end if;

  return app.raise_task_request(p_sub_task, p_team, p_assignee, v.title,
                                p_starts_at, p_due_at, coalesce(p_hours, v.sla_hours), null, null,
                                p_needed_by, p_note);
end $$;

comment on function public.request_task_booking(uuid, uuid, uuid, numeric, date, timestamptz, timestamptz, text) is
  'ADR-0139 d.2: ask a team (and optionally one of its people) to do a task — hours, needed-by date, optional days, '
  'a note. Needs project_tasks:manage (or the piece''s ownership) and bookings:create; nothing is booked until it is '
  'answered. Refused with hint book_directly when the person or team is within the caller''s own reach, '
  'request_pending when the task already has an open request, unplaced_resource when nobody could answer.';
revoke execute on function public.request_task_booking(uuid, uuid, uuid, numeric, date, timestamptz, timestamptz, text)
  from public, anon;
grant  execute on function public.request_task_booking(uuid, uuid, uuid, numeric, date, timestamptz, timestamptz, text)
  to authenticated;

-- ===================================================================== d.2: the assignment path asks the same way ====
-- Reproduced WHOLE from 20260926162000. Edits, each marked ADR-0139: the out-of-reach branch writes through
-- app.raise_task_request (the person's team, the new answerers, `offered` counts as open); the unplaced test reads the
-- person's own placement as well as the calendar's. Nothing else.
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

-- ===================================================================== d.4: the answers ====
-- book  — the lead keeps or changes the person and the days; the booking becomes the task's assignment, made AS THE
--         ANSWERER through update_task_assignment (the approval proof is this row: approved, by this caller). The
--         client then runs `subtask-schedule` as the answerer when `reschedule_needed`.
-- offer — other days (and optionally another person); the asker takes them or asks again.
-- refuse — with a reason; nothing on the task changes.
-- First to act settles it: an answer to a request that is no longer pending is refused with hint `request_settled`.
create or replace function public.answer_task_request(
  p_request   uuid,
  p_answer    text,
  p_assignee  uuid        default null,
  p_starts_at timestamptz default null,
  p_due_at    timestamptz default null,
  p_hours     numeric     default null,
  p_note      text        default null)
returns table(sub_task_id uuid, deliverable_id uuid, reschedule_needed boolean, outcome text)
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  q        sub_task_assignment_requests%rowtype;
  v_task   sub_tasks%rowtype;
  v_person uuid;
  v_starts timestamptz;
  v_due    timestamptz;
  v_hours  numeric;
  v_res    uuid;
  v_result record;
  v_by     text;
  v_note   text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into q from sub_task_assignment_requests
   where id = p_request and tenant_id = app.current_tenant_id()
   for update;
  if not found then
    raise exception 'assignment request % not found', p_request using errcode = 'P0002';
  end if;
  if p_answer is null or p_answer not in ('book', 'offer', 'refuse') then
    raise exception 'the answer is book, offer or refuse' using errcode = '22023';
  end if;
  if q.status <> 'pending' then
    select up.display_name into v_by from user_profiles up where up.id = coalesce(q.answered_by, q.decided_by);
    raise exception 'this request has already been answered (%)%', q.status,
            case when v_by is null then '' else ' by ' || v_by end
      using errcode = '22023', hint = 'request_settled';
  end if;
  if q.requested_by = auth.uid() then
    raise exception 'you cannot answer your own request' using errcode = '42501';
  end if;
  if not app.may_answer_task_request(p_request) then
    raise exception 'this request is answered by the lead of the team asked — or, once it has waited, by Traffic or the department lead'
      using errcode = '42501', hint = 'not_the_answerer';
  end if;

  select * into v_task from sub_tasks where id = q.sub_task_id;
  v_person := coalesce(p_assignee, q.assignee_id);
  v_starts := coalesce(p_starts_at, q.starts_at, v_task.starts_at);
  v_due    := coalesce(p_due_at, q.due_at,
                       case when q.needed_by is null then null else app.close_of_day(q.needed_by) end,
                       v_task.due_at);
  v_hours  := coalesce(p_hours, q.hours, v_task.sla_hours);

  if p_answer = 'refuse' then
    if v_note is null then
      raise exception 'say why — the reason goes to the person who asked' using errcode = '22023', hint = 'reason_required';
    end if;
    update sub_task_assignment_requests
       set status = 'refused', decided_by = auth.uid(), decided_at = now(), reason = v_note,
           answered_by = auth.uid(), answered_at = now(), answer_note = v_note
     where id = p_request;
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (q.tenant_id, q.requested_by, 'assignment_refused', v_task.title, 'sub_task', q.sub_task_id, auth.uid(),
            jsonb_build_object('request_id', q.id, 'reason', v_note));
    sub_task_id := q.sub_task_id; deliverable_id := v_task.deliverable_id;
    reschedule_needed := false; outcome := 'refused';
    return next; return;
  end if;

  if v_person is not null then
    if not exists (select 1 from user_profiles up where up.id = v_person and up.tenant_id = q.tenant_id) then
      raise exception 'that person is not in your organization' using errcode = '22023';
    end if;
    if not app.person_is_bookable(v_person) then
      raise exception 'that person is not bookable, so this request cannot be booked to them' using errcode = '22023';
    end if;
    select r.id into v_res from resources r
     where r.user_id = v_person and r.kind = 'human' and r.is_active and r.tenant_id = q.tenant_id limit 1;
  end if;

  if p_answer = 'offer' then
    if p_starts_at is null or p_due_at is null or p_due_at <= p_starts_at then
      raise exception 'an offer names the days — a start and an end after it' using errcode = '22023', hint = 'days_required';
    end if;
    update sub_task_assignment_requests
       set status = 'offered', offered_starts_at = p_starts_at, offered_ends_at = p_due_at,
           assignee_id = v_person, resource_id = coalesce(v_res, resource_id),
           hours = coalesce(p_hours, hours),
           answered_by = auth.uid(), answered_at = now(), answer_note = v_note
     where id = p_request;
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (q.tenant_id, q.requested_by, 'assignment_offered', v_task.title, 'sub_task', q.sub_task_id, auth.uid(),
            jsonb_build_object('request_id', q.id, 'starts_at', p_starts_at, 'ends_at', p_due_at,
                               'person', (select up.display_name from user_profiles up where up.id = v_person),
                               'note', v_note));
    sub_task_id := q.sub_task_id; deliverable_id := v_task.deliverable_id;
    reschedule_needed := false; outcome := 'offered';
    return next; return;
  end if;

  -- book
  if v_person is null then
    raise exception 'choose who does it' using errcode = '22023', hint = 'person_required';
  end if;
  -- Days are the answer's when it gives them, else the request's, else the task's own. A task with no days at all is
  -- still assigned (as ADR-0087's approval did); `subtask-schedule` places nothing until it has them.

  -- Status FIRST (the moot-closing trigger then finds nothing open), and the row becomes the proof
  -- update_task_assignment checks: approved, by this caller, for this person.
  update sub_task_assignment_requests
     set status = 'approved', decided_by = auth.uid(), decided_at = now(), reason = v_note,
         answered_by = auth.uid(), answered_at = now(), answer_note = v_note,
         assignee_id = v_person, resource_id = coalesce(v_res, resource_id),
         starts_at = v_starts, due_at = v_due, hours = v_hours
   where id = p_request;

  perform set_config('app.assignment_request', p_request::text, true);
  select * into v_result
    from public.update_task_assignment(q.sub_task_id, coalesce(q.title, v_task.title), v_person, q.reviewers,
                                       v_starts, v_due, v_hours, q.review_mode) u;
  perform set_config('app.assignment_request', '', true);

  if v_result.outcome is distinct from 'assigned' then
    raise exception 'the answer did not assign the task' using errcode = '55000';
  end if;

  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
  values (q.tenant_id, q.requested_by, 'assignment_approved', v_task.title, 'sub_task', q.sub_task_id, auth.uid(),
          jsonb_build_object('request_id', q.id, 'starts_at', v_starts, 'ends_at', v_due, 'hours', v_hours,
                             'person', (select up.display_name from user_profiles up where up.id = v_person),
                             'note', v_note));

  sub_task_id := q.sub_task_id; deliverable_id := v_task.deliverable_id;
  -- Always placed afresh: the days are the answer's, even when they equal the task's.
  reschedule_needed := true; outcome := 'booked';
  return next;
end $$;

comment on function public.answer_task_request(uuid, text, uuid, timestamptz, timestamptz, numeric, text) is
  'ADR-0139 d.4: book (person and days; assigns AS THE ANSWERER, then the client runs subtask-schedule), offer other '
  'days, or refuse with a reason. Answerers: app.may_answer_task_request. Hints: request_settled (already answered), '
  'not_the_answerer, reason_required, days_required, person_required.';
revoke execute on function public.answer_task_request(uuid, text, uuid, timestamptz, timestamptz, numeric, text) from public, anon;
grant  execute on function public.answer_task_request(uuid, text, uuid, timestamptz, timestamptz, numeric, text) to authenticated;

-- The asker takes an offer: the request becomes approved on the offered days and the task is assigned through the same
-- path. The asker is outside the person's reach — that is why they asked — so the proof row carries the lead's offer
-- (`answered_by`), and ADR-0040's trigger admits exactly this (below). The asker's `subtask-schedule` books it under
-- app.task_booking_sanctioned.
create or replace function public.take_task_offer(p_request uuid)
returns table(sub_task_id uuid, deliverable_id uuid, reschedule_needed boolean, outcome text)
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  q        sub_task_assignment_requests%rowtype;
  v_task   sub_tasks%rowtype;
  v_result record;
begin
  select * into q from sub_task_assignment_requests
   where id = p_request and tenant_id = app.current_tenant_id()
   for update;
  if not found then
    raise exception 'assignment request % not found', p_request using errcode = 'P0002';
  end if;
  if q.requested_by is distinct from auth.uid() then
    raise exception 'only the person who asked can take the offer' using errcode = '42501';
  end if;
  if q.status <> 'offered' then
    raise exception 'there is no offer waiting on this request (%)', q.status using errcode = '22023', hint = 'request_settled';
  end if;
  if q.assignee_id is null then
    raise exception 'the offer names nobody — ask the lead again' using errcode = '22023', hint = 'person_required';
  end if;
  if not app.person_is_bookable(q.assignee_id) then
    raise exception 'that person is no longer bookable, so the offer cannot be taken' using errcode = '22023';
  end if;

  select * into v_task from sub_tasks where id = q.sub_task_id;

  update sub_task_assignment_requests
     set status = 'approved', decided_by = auth.uid(), decided_at = now(),
         starts_at = q.offered_starts_at, due_at = q.offered_ends_at
   where id = p_request;

  perform set_config('app.assignment_request', p_request::text, true);
  select * into v_result
    from public.update_task_assignment(q.sub_task_id, coalesce(q.title, v_task.title), q.assignee_id, q.reviewers,
                                       q.offered_starts_at, q.offered_ends_at, coalesce(q.hours, v_task.sla_hours),
                                       q.review_mode) u;
  perform set_config('app.assignment_request', '', true);
  if v_result.outcome is distinct from 'assigned' then
    raise exception 'taking the offer did not assign the task' using errcode = '55000';
  end if;

  if q.answered_by is not null and q.answered_by is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (q.tenant_id, q.answered_by, 'assignment_offer_taken', v_task.title, 'sub_task', q.sub_task_id, auth.uid(),
            jsonb_build_object('request_id', q.id, 'starts_at', q.offered_starts_at, 'ends_at', q.offered_ends_at));
  end if;

  sub_task_id := q.sub_task_id; deliverable_id := v_task.deliverable_id;
  reschedule_needed := true; outcome := 'booked';
  return next;
end $$;

comment on function public.take_task_offer(uuid) is
  'ADR-0139 d.4: the asker takes the lead''s offered days — the task is assigned on them (the lead''s offer is the '
  'authority), the lead is told, and the client runs subtask-schedule as the asker (app.task_booking_sanctioned).';
revoke execute on function public.take_task_offer(uuid) from public, anon;
grant  execute on function public.take_task_offer(uuid) to authenticated;

-- Reproduced from 20260911110000; ADR-0139: an offer can be withdrawn too (declining it), and whoever was asked is told.
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
  if q.status not in ('pending', 'offered') then
    return;                                   -- idempotent: withdrawing a closed request is not an error
  end if;
  update sub_task_assignment_requests
     set status = 'withdrawn', decided_by = auth.uid(), decided_at = now()
   where id = p_request;

  -- ADR-0139: the lead who offered, or everyone who could have answered.
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
  select q.tenant_id, x.user_id, 'assignment_withdrawn', (select t.title from sub_tasks t where t.id = q.sub_task_id),
         'sub_task', q.sub_task_id, auth.uid(), jsonb_build_object('request_id', q.id, 'was', q.status)
    from (select q.answered_by as user_id where q.status = 'offered' and q.answered_by is not null
          union
          select a.user_id
            from app.task_request_answerers(app.task_request_team(q.team_id, q.assignee_id),
                                            app.task_request_department(q.team_id, q.assignee_id)) a
           where q.status = 'pending') x
   where x.user_id is distinct from auth.uid();
end $$;

comment on function public.withdraw_assignment_request(uuid) is
  'ADR-0087 d.9 / ADR-0139 d.4: the asker takes their request back while it waits, or declines an offer. The lead '
  'who offered, or the request''s answerers, are told. Idempotent on a request that is already closed.';

-- The old door (ADR-0087), kept for its callers, over the new answer: approve = book on the request's own person and
-- days; refuse = refuse (a reason is now required, ADR-0139 d.4).
create or replace function public.decide_assignment_request(
  p_request uuid,
  p_approve boolean,
  p_reason  text default null
) returns table(sub_task_id uuid, deliverable_id uuid, reschedule_needed boolean, outcome text)
language plpgsql security definer set search_path = public, app, extensions as $$
declare r record;
begin
  select * into r from public.answer_task_request(p_request, case when p_approve then 'book' else 'refuse' end,
                                                  null, null, null, null, p_reason) a;
  sub_task_id := r.sub_task_id;
  deliverable_id := r.deliverable_id;
  reschedule_needed := r.reschedule_needed;
  outcome := case r.outcome when 'booked' then 'approved' else r.outcome end;
  return next;
end $$;

comment on function public.decide_assignment_request(uuid, boolean, text) is
  'ADR-0087 / ADR-0139: the old door over public.answer_task_request — approve books the request''s own person and '
  'days, refuse refuses with the reason (required). Answerers: app.may_answer_task_request.';

-- ===================================================================== ADR-0040's trigger, and the asker's offer ====
-- Reproduced from 20260922190000. ADR-0139: the one write it admits beyond the caller's reach is a taken offer — the
-- request named by `app.assignment_request` is approved, for this task and this person, decided by this caller, and
-- carries the lead's answer (answered_by, somebody else). The GUC alone proves nothing; the row does.
create or replace function app.tg_subtask_assignment_authority() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_resource uuid;
  v_request  uuid;
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

  -- ADR-0139 d.4: an offer the asker took. The lead's answer on the row is the reach.
  v_request := app.try_uuid(nullif(current_setting('app.assignment_request', true), ''));
  if v_request is not null and exists (
       select 1 from public.sub_task_assignment_requests q
        where q.id = v_request and q.sub_task_id = new.id and q.status = 'approved'
          and q.assignee_id = new.assignee_id and q.decided_by = auth.uid()
          and q.requested_by = auth.uid()
          and q.answered_by is not null and q.answered_by <> auth.uid()
          and q.offered_starts_at is not null) then
    return new;
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
  'ADR-0040 d.1–d.3, ADR-0139 d.1/d.4: giving a task to a person needs bookings:create and the person within the '
  'caller''s SCHEDULING scope (own team for a team lead, own department for a department lead, everyone for Traffic '
  'and the Power Admin) — or an offer the caller asked for and took. Skipped under app.system_op and for service-role writes.';

-- ===================================================================== moot requests ====
-- Reproduced from 20260911110000; ADR-0139: an OFFERED request is open too, and is closed the same way.
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
     where sub_task_assignment_requests.sub_task_id = new.id and status in ('pending', 'offered')
    returning *
  loop
    if v_reassigned and q.requested_by is distinct from auth.uid() then
      insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
      values (q.tenant_id, q.requested_by, 'assignment_superseded', new.title, 'sub_task', new.id, auth.uid());
    end if;
  end loop;
  return new;
end $$;

create or replace function app.tg_close_assignment_requests_on_resource() returns trigger
language plpgsql security definer set search_path = public, app, extensions as $$
begin
  if (old.is_active and not new.is_active) or (new.user_id is distinct from old.user_id) then
    update sub_task_assignment_requests
       set status = 'superseded', decided_at = now()
     where resource_id = new.id and status in ('pending', 'offered');
  end if;
  return new;
end $$;

-- ===================================================================== booking the answer ====
-- May the caller place this task's bookings although its person is outside their reach? Only as the asker of an
-- approved request whose person still holds the task (a booked answer or a taken offer). The window: the task's own
-- days, a day either side for the office-day anchoring — a booking elsewhere is a move, which is the lead's.
create or replace function app.may_place_task_bookings(p_sub_task uuid)
returns boolean language sql stable security definer cost 10000
set search_path = public, app, extensions as $$
  select p_sub_task is not null and exists (
    select 1 from public.sub_tasks t
     where t.id = p_sub_task and t.tenant_id = app.current_tenant_id() and t.assignee_id is not null
       and exists (select 1 from public.sub_task_assignment_requests q
                    where q.sub_task_id = t.id and q.status = 'approved'
                      and q.requested_by = auth.uid() and q.assignee_id = t.assignee_id))
$$;
comment on function app.may_place_task_bookings(uuid) is
  'ADR-0139 d.4: the caller may materialise (and clear) this task''s bookings for its current person although that '
  'person is outside their scheduling reach — they asked, and the lead booked or offered it.';
revoke execute on function app.may_place_task_bookings(uuid) from public, anon;
grant  execute on function app.may_place_task_bookings(uuid) to authenticated;

create or replace function app.task_booking_sanctioned(p_sub_task uuid, p_resource uuid, p_starts timestamptz, p_ends timestamptz)
returns boolean language sql stable security definer cost 10000
set search_path = public, app, extensions as $$
  select app.may_place_task_bookings(p_sub_task) and exists (
    select 1 from public.sub_tasks t
      join public.resources r on r.user_id = t.assignee_id and r.kind = 'human' and r.tenant_id = t.tenant_id
     where t.id = p_sub_task and r.id = p_resource
       and t.starts_at is not null and t.due_at is not null
       and p_starts >= t.starts_at - interval '1 day'
       and p_ends   <= t.due_at + interval '1 day')
$$;
comment on function app.task_booking_sanctioned(uuid, uuid, timestamptz, timestamptz) is
  'ADR-0139 d.4: a booking row for this task, on its current person''s calendar, within the task''s own days, by a '
  'caller app.may_place_task_bookings admits. Read by bookings_scheduler_insert / _update.';
revoke execute on function app.task_booking_sanctioned(uuid, uuid, timestamptz, timestamptz) from public, anon;
grant  execute on function app.task_booking_sanctioned(uuid, uuid, timestamptz, timestamptz) to authenticated;

-- Reproduced from 20260922190000; the added branch is marked ADR-0139.
drop policy bookings_scheduler_insert on bookings;
create policy bookings_scheduler_insert on bookings
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id()
    and app.has_permission('bookings', 'create')
    and (app.resource_in_scheduling_scope(resource_id)
         or app.caller_is_booking_pm(deliverable_id, sub_task_id, job_id)
         -- ADR-0139 d.4
         or app.task_booking_sanctioned(sub_task_id, resource_id, starts_at, ends_at)));

drop policy bookings_scheduler_update on bookings;
create policy bookings_scheduler_update on bookings
  for update to authenticated
  using (tenant_id = app.current_tenant_id()
    and app.has_permission('bookings', 'update')
    and (app.resource_in_scheduling_scope(resource_id)
         or app.caller_is_booking_pm(deliverable_id, sub_task_id, job_id)
         or app.task_booking_sanctioned(sub_task_id, resource_id, starts_at, ends_at)))
  with check (tenant_id = app.current_tenant_id()
    and app.has_permission('bookings', 'update')
    and (app.resource_in_scheduling_scope(resource_id)
         or app.caller_is_booking_pm(deliverable_id, sub_task_id, job_id)
         or app.task_booking_sanctioned(sub_task_id, resource_id, starts_at, ends_at)));

drop policy bookings_scheduler_delete on bookings;
create policy bookings_scheduler_delete on bookings
  for delete to authenticated
  using (tenant_id = app.current_tenant_id()
    and app.has_permission('bookings', 'delete')
    and (app.resource_in_scheduling_scope(resource_id)
         -- ADR-0139 d.4: `subtask-schedule` clears a task's bookings before it places them again.
         or app.may_place_task_bookings(sub_task_id)));

-- ===================================================================== Needs you ====
-- Re-emitted from 20260930141000 (the last definition); the only change is the booking_request arm, which now lists a
-- request to everyone app.may_answer_task_request admits (ADR-0139 d.3/d.5).
CREATE OR REPLACE FUNCTION public.my_pending_approvals()
 RETURNS TABLE(kind text, id uuid, title text, campaign_id uuid, campaign_name text, department text, since timestamp with time zone, target_id uuid, deliverable_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
  -- ADR-0100 d.4: "write your department's brief" and "approve your department's brief" are GONE.
  -- The document they asked for no longer exists, so neither does the ask. (Removing them also
  -- takes out the branch I54.25 found scanning every task in the tenant — a side effect, not a
  -- reason.)
  -- A task list waiting for approval (ADR-0090; every campaign since ADR-0100 d.2) — on the owner's list,
  -- and (ADR-0119 d.2) on the department lead's and every team lead's of the deliverable's department,
  -- where they may approve it. Every campaign, however old (d.1). `since` is when its clock started —
  -- the one the escalation reads (d.3), so the card and the sweep agree.
  -- I66.3 (Edward, 29 Sep): a piece with no live task has no list to approve — "there is nothing to count" —
  -- but its owner still owes something: the tasks. Same people, same clock, its own kind, so the card says
  -- "define the tasks" and the "Task lists not approved" figures leave it out.
  select case when not exists (select 1 from sub_tasks st where st.deliverable_id = d.id and st.status not in ('done', 'cancelled'))
              then 'task_list_undefined' else 'task_list' end,
         d.id, d.name, c.id, c.name, dp.name, app.task_list_waiting_since(c.kind, c.approved_at, d.task_list_reopened_at), d.id, d.id
    from deliverables d
    join streams s      on s.id = d.stream_id
    join campaigns c    on c.id = s.campaign_id
    left join departments dp on dp.id = d.department_id
    left join user_profiles own on own.id = d.owner_user_id
   where c.status = 'approved'
     and d.tasks_approved_at is null
     and d.state <> 'archived'
     and (d.owner_user_id = auth.uid()
          or app.leads_department(coalesce(d.department_id, own.department_id)))
     and app.may_approve_deliverable_tasks(d)
     -- I66.11: a piece whose every task was cancelled has its own card, below.
     and not (exists (select 1 from sub_tasks t where t.deliverable_id = d.id) and not exists (select 1 from sub_tasks t where t.deliverable_id = d.id and t.status <> 'cancelled'))

  union all
  -- I66.11 (Edward, 29 Sep, option B): every task on the piece was cancelled and none was done, so nothing will
  -- close it (ADR-0118 addendum: work all called off is never Approved). Its OWNER is asked to add a task or
  -- close the deliverable; `since` is the last cancellation.
  select 'tasks_all_cancelled', d.id, d.name, c.id, c.name, dp.name,
         (select max(t.updated_at) from sub_tasks t where t.deliverable_id = d.id), d.id, d.id
    from deliverables d
    join streams s      on s.id = d.stream_id
    join campaigns c    on c.id = s.campaign_id
    left join departments dp on dp.id = d.department_id
   where c.status = 'approved'
     and d.state not in ('archived', 'approved', 'delivered')
     and d.owner_user_id = auth.uid()
     and exists (select 1 from sub_tasks t where t.deliverable_id = d.id) and not exists (select 1 from sub_tasks t where t.deliverable_id = d.id and t.status <> 'cancelled')

  union all
  -- A booking asked of a team I answer for (ADR-0139 d.3), or — once it has waited (d.5) — of my department, or of
  -- anyone, for Traffic.
  select 'booking_request', q.id, q.title, c.id, c.name, dp.name, q.created_at, q.sub_task_id, d.id
    from sub_task_assignment_requests q
    join sub_tasks st   on st.id = q.sub_task_id
    join deliverables d on d.id = st.deliverable_id
    left join streams s      on s.id = d.stream_id
    left join campaigns c    on c.id = s.campaign_id
    left join departments dp on dp.id = d.department_id
   where q.status = 'pending'
     and q.requested_by <> auth.uid()
     and app.may_answer_task_request(q.id)

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

  union all
  -- ADR-0133 d.2 (I70.3): a leaving person's work, for ME to hand over — their department lead, or (none, or they
  -- ARE the lead) the Traffic Manager and the Power Admins. `id` and `target_id` are the person; `title` their name;
  -- `since` the day they started leaving (the escalation's clock, d.5).
  select 'handover', up.id, up.display_name, null::uuid, null::text, dp.name, up.leaving_since, up.id, null::uuid
    from user_profiles up
    left join departments dp on dp.id = up.department_id
   where up.tenant_id = app.current_tenant_id()
     and up.leaving_since is not null and up.is_active
     and app.is_handover_recipient(up.id)

  order by 7 asc nulls last;
$function$;

-- ===================================================================== d.5: unanswered after 4 working hours ====
create or replace function app.seed_tenant_escalation_rules(p_tenant uuid)
 returns void
 language plpgsql
 set search_path to 'public', 'app', 'extensions'
as $function$
declare
  v_traffic uuid := (select id from roles where tenant_id = p_tenant and key = 'scheduler');
  v_ad      uuid := (select id from roles where tenant_id = p_tenant and key = 'account_director');
  v_admin   uuid := (select id from roles where tenant_id = p_tenant and key = 'power_admin');
  v_hours   integer := coalesce(
    (select s.assignment_escalation_hours from tenant_reminder_settings s where s.tenant_id = p_tenant), 24);
begin
  insert into tenant_escalation_rules (tenant_id, kind, hours, role_ids, relative)
  values
    (p_tenant, 'unassigned',      v_hours, array_remove(array[v_traffic], null), array['owner']),
    (p_tenant, 'task_list',       24,      array_remove(array[v_traffic], null), array['account_manager']),
    -- I59 E8: the campaign / brief waiting on the account manager.
    (p_tenant, 'campaign_brief',  24,      array_remove(array[v_traffic, v_ad], null), '{}'),
    (p_tenant, 'change_request',  8,       '{}',                                  array['owner_department_lead', 'account_manager']),
    (p_tenant, 'extension_owner', 8,       '{}',                                  array['owner_department_lead']),
    (p_tenant, 'extension_am',    8,       array_remove(array[v_ad], null),      '{}'),
    (p_tenant, 'blocked',         24,      '{}',                                  array['owner', 'account_manager']),
    (p_tenant, 'review_remind',   24,      '{}',                                  array['reviewers']),
    (p_tenant, 'review_escalate', 48,      '{}',                                  array['account_manager', 'owner']),
    -- ADR-0133 d.5: a hand-over not finished — the Traffic Manager and the Power Admins.
    (p_tenant, 'handover',        24,      array_remove(array[v_traffic, v_admin], null), '{}'),
    -- ADR-0139 d.5: a request to another team, unanswered — Traffic (and, always, the department lead it waits on).
    (p_tenant, 'task_request',    4,       array_remove(array[v_traffic], null), '{}'),
    -- ADR-0141 d.3: a change asked of the account manager, unanswered — the account director.
    (p_tenant, 'deliverable_change', 4,    array_remove(array[v_ad], null),      '{}')
  on conflict (tenant_id, kind) do nothing;
end $function$;

-- Every existing tenant gets the new row (the others already exist and are left as the tenant set them).
select app.seed_tenant_escalation_rules(id) from tenants;

CREATE OR REPLACE FUNCTION app.escalation_due(p_now timestamp with time zone DEFAULT now())
 RETURNS SETOF app.escalation_due_row
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
  -- ---- unassigned (ADR-0108 d.2 row 1, d.4; I59 settled: every piece from its task list's approval) ----
  select d.tenant_id, 'unassigned', d.id, '', 'deliverable', d.id, d.name, d.id, null::uuid, c.id,
         d.tasks_approved_at, app.elapsed_hours(d.tasks_approved_at, p_now), r.hours,
         jsonb_build_object('unassigned', u.n, 'campaign_kind', c.kind,
                            'owner', (select display_name from user_profiles where id = d.owner_user_id))
    from deliverables d
    join streams st on st.id = d.stream_id
    join campaigns c on c.id = st.campaign_id
    join tenant_escalation_rules r on r.tenant_id = d.tenant_id and r.kind = 'unassigned'
    cross join lateral (select count(*)::int as n from sub_tasks t
                         where t.deliverable_id = d.id and t.assignee_id is null
                           and t.status in ('todo', 'in_progress', 'blocked', 'review')) u
   where c.status = 'approved'
     and c.kind in ('single_job', 'campaign')
     and d.tasks_approved_at is not null
     and d.state not in ('archived', 'delivered')
     and u.n > 0
     and app.elapsed_hours(d.tasks_approved_at, p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = d.tenant_id and l.kind = 'unassigned'
                        and l.subject_id = d.id and l.occurrence = '')

  union all
  -- ---- task_list: the piece's task list, waiting on its owner (ADR-0090 / ADR-0100) ----
  select d.tenant_id, 'task_list', d.id, coalesce(d.task_list_reopened_at::text, ''), 'deliverable', d.id, d.name, d.id, null::uuid, c.id,
         app.task_list_waiting_since(c.kind, c.approved_at, d.task_list_reopened_at),
         app.elapsed_hours(app.task_list_waiting_since(c.kind, c.approved_at, d.task_list_reopened_at), p_now), r.hours,
         jsonb_build_object('waiting_on', 'task_list', 'campaign_kind', c.kind,
                            'owner', (select display_name from user_profiles where id = d.owner_user_id),
                            -- I66.4: a piece with no live task has no list to approve — its tasks were never
                            -- defined, and the escalation says that instead of "waited for approval".
                            'no_tasks', not exists (select 1 from sub_tasks t where t.deliverable_id = d.id
                                                                             and t.status not in ('done', 'cancelled')))
    from deliverables d
    join streams st on st.id = d.stream_id
    join campaigns c on c.id = st.campaign_id
    join tenant_escalation_rules r on r.tenant_id = d.tenant_id and r.kind = 'task_list'
   where c.status = 'approved'
     and c.approved_at is not null
     and d.tasks_approved_at is null
     and d.state <> 'archived'
     -- ADR-0119 d.1/d.3: every campaign; one approved before the cut-over is timed from this release.
     and app.elapsed_hours(app.task_list_waiting_since(c.kind, c.approved_at, d.task_list_reopened_at), p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = d.tenant_id and l.kind = 'task_list'
                        and l.subject_id = d.id and l.occurrence = coalesce(d.task_list_reopened_at::text, ''))
     -- I66.11: every task cancelled has its own rung, below.
     and not (exists (select 1 from sub_tasks t where t.deliverable_id = d.id) and not exists (select 1 from sub_tasks t where t.deliverable_id = d.id and t.status <> 'cancelled'))

  union all
  -- ---- task_list, every task cancelled (I66.11): the owner has not added a task or closed the piece. The same
  -- rung's hours and recipients, counted from the last cancellation; `occurrence` is that moment, so a piece
  -- cancelled again later escalates again. ----
  select d.tenant_id, 'task_list', d.id, 'all_cancelled:' || x.last_cancel::text, 'deliverable', d.id, d.name, d.id, null::uuid, c.id,
         x.last_cancel, app.elapsed_hours(x.last_cancel, p_now), r.hours,
         jsonb_build_object('waiting_on', 'task_list', 'campaign_kind', c.kind, 'all_cancelled', true,
                            'owner', (select display_name from user_profiles where id = d.owner_user_id))
    from deliverables d
    join streams st on st.id = d.stream_id
    join campaigns c on c.id = st.campaign_id
    join tenant_escalation_rules r on r.tenant_id = d.tenant_id and r.kind = 'task_list'
    cross join lateral (select max(t.updated_at) as last_cancel from sub_tasks t where t.deliverable_id = d.id) x
   where c.status = 'approved'
     and d.state not in ('archived', 'approved', 'delivered')
     and exists (select 1 from sub_tasks t where t.deliverable_id = d.id) and not exists (select 1 from sub_tasks t where t.deliverable_id = d.id and t.status <> 'cancelled')
     and app.elapsed_hours(x.last_cancel, p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = d.tenant_id and l.kind = 'task_list'
                        and l.subject_id = d.id and l.occurrence = 'all_cancelled:' || x.last_cancel::text)

  union all
  -- ---- campaign_brief (I59 E8): the campaign's brief, waiting on the account manager (ADR-0048 d.9) ----
  select c.tenant_id, 'campaign_brief', c.id, c.submitted_at::text, 'campaign', c.id, c.name, null::uuid, null::uuid, c.id,
         c.submitted_at, app.elapsed_hours(c.submitted_at, p_now), r.hours,
         jsonb_build_object('waiting_on', 'campaign_brief', 'campaign_kind', c.kind)
    from campaigns c
    join tenant_escalation_rules r on r.tenant_id = c.tenant_id and r.kind = 'campaign_brief'
   where c.status = 'pending_approval'
     and c.submitted_at is not null
     and app.elapsed_hours(c.submitted_at, p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = c.tenant_id and l.kind = 'campaign_brief'
                        and l.subject_id = c.id and l.occurrence = c.submitted_at::text)

  union all
  -- ---- review_remind / review_escalate: a round sent and not answered (ADR-0043 / ADR-0089) ----
  select t.tenant_id, r.kind, t.id, t.revision_number::text, 'sub_task', t.id, t.title, t.deliverable_id, t.id,
         coalesce(st.campaign_id, j.campaign_id),
         s.since, app.elapsed_hours(s.since, p_now), r.hours,
         jsonb_build_object('round', t.revision_number + 1,
                            'outstanding', (select count(*) from sub_task_reviewers rv
                                             where rv.sub_task_id = t.id
                                               and rv.approved_at is null and rv.responded_at is null),
                            'deliverable', d.name)
    from sub_tasks t
    join deliverables d on d.id = t.deliverable_id
    left join streams st on st.id = d.stream_id
    left join jobs j on j.id = d.job_id
    join tenant_escalation_rules r on r.tenant_id = t.tenant_id and r.kind in ('review_remind', 'review_escalate')
    cross join lateral (select max(e.submitted_at) as since from task_time_entries e
                         where e.sub_task_id = t.id and e.round = t.revision_number) s
   where t.status = 'review'
     and s.since is not null
     and exists (select 1 from sub_task_reviewers rv
                  where rv.sub_task_id = t.id and rv.approved_at is null and rv.responded_at is null)
     and app.elapsed_hours(s.since, p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = t.tenant_id and l.kind = r.kind
                        and l.subject_id = t.id and l.occurrence = t.revision_number::text)

  union all
  -- ---- over_capacity (ADR-0108 d.6) ----
  select w.tenant_id, 'over_capacity', w.resource_id, w.week_start::text, 'resource', w.resource_id, w.name,
         null::uuid, null::uuid, null::uuid, (w.week_start::timestamp at time zone 'UTC'), null::numeric,
         coalesce(s.over_capacity_pct, 110),
         jsonb_build_object('booked_hours', w.booked_hours, 'nominal_hours', w.nominal_hours,
                            'util_pct', w.util_pct, 'over_capacity_pct', coalesce(s.over_capacity_pct, 110),
                            'week_start', w.week_start, 'booking_count', w.booking_count)
    from app.week_load(p_now) w
    left join tenant_reminder_settings s on s.tenant_id = w.tenant_id
   where w.util_pct > coalesce(s.over_capacity_pct, 110)
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = w.tenant_id and l.kind = 'over_capacity'
                        and l.subject_id = w.resource_id and l.occurrence = w.week_start::text)

  union all
  -- ---- change_request (ADR-0110; hook): pending on its owner, from when it was sent ----
  select q.tenant_id, 'change_request', q.id, '', 'deliverable', d.id, d.name, d.id, null::uuid, st.campaign_id,
         q.created_at, app.elapsed_hours(q.created_at, p_now), r.hours,
         jsonb_build_object('change_request_id', q.id, 'changes', q.changes, 'asked_by', q.asked_by,
                            'owner', (select display_name from user_profiles where id = d.owner_user_id))
    from deliverable_change_requests q
    join deliverables d on d.id = q.deliverable_id
    left join streams st on st.id = d.stream_id
    join tenant_escalation_rules r on r.tenant_id = q.tenant_id and r.kind = 'change_request'
   where q.status = 'pending'
     and d.state <> 'archived'
     and app.elapsed_hours(q.created_at, p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = q.tenant_id and l.kind = 'change_request'
                        and l.subject_id = q.id and l.occurrence = '')

  union all
  -- ---- extension_owner / extension_am (ADR-0109; hooks): the step the request waits at ----
  select x.tenant_id, k.kind, x.request_id, '', 'sub_task', x.sub_task_id, x.task_title, x.deliverable_id,
         x.sub_task_id, x.campaign_id,
         k.since, app.elapsed_hours(k.since, p_now), r.hours,
         jsonb_build_object('request_id', x.request_id, 'stage', x.stage, 'from', x.from_at, 'to', x.to_at,
                            'deliverable', x.deliverable_name, 'owner', x.owner_name)
    from public.sub_task_extension_requests x
    cross join lateral (
      select case when x.stage = 'owner' then 'extension_owner' else 'extension_am' end as kind,
             case when x.stage = 'owner' then x.created_at else coalesce(x.forwarded_at, x.created_at) end as since
    ) k
    join tenant_escalation_rules r on r.tenant_id = x.tenant_id and r.kind = k.kind
   where x.stage in ('owner', 'am')
     and app.elapsed_hours(k.since, p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = x.tenant_id and l.kind = k.kind
                        and l.subject_id = x.request_id and l.occurrence = '')

  union all
  -- ---- blocked (ADR-0107; hook): a maker's input on their own task, not cleared, from when raised ----
  select pin.tenant_id, 'blocked', pin.id, '', 'sub_task', t.id, t.title, t.deliverable_id, t.id,
         coalesce(st.campaign_id, j.campaign_id),
         pin.requested_at, app.elapsed_hours(pin.requested_at, p_now), r.hours,
         jsonb_build_object('input_id', pin.id, 'kind_of_input', pin.kind, 'awaited_from', pin.awaited_from,
                            'description', pin.description, 'deliverable', d.name)
    from deliverable_pending_inputs pin
    join sub_tasks t on t.id = pin.sub_task_id
    join deliverables d on d.id = t.deliverable_id
    left join streams st on st.id = d.stream_id
    left join jobs j on j.id = d.job_id
    join tenant_escalation_rules r on r.tenant_id = pin.tenant_id and r.kind = 'blocked'
   where pin.satisfied_at is null
     and t.status not in ('done', 'cancelled')
     and app.elapsed_hours(pin.requested_at, p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = pin.tenant_id and l.kind = 'blocked'
                        and l.subject_id = pin.id and l.occurrence = '')

  union all
  -- ---- handover (ADR-0133 d.5, I70.6): a leaving person's work not all handed on, from when they started leaving.
  -- `occurrence` is that moment, so a person who leaves again later escalates again. ----
  select up.tenant_id, 'handover', up.id, up.leaving_since::text, 'user_profile', up.id, up.display_name,
         null::uuid, null::uuid, null::uuid,
         up.leaving_since, app.elapsed_hours(up.leaving_since, p_now), r.hours,
         jsonb_build_object('user_id', up.id, 'name', up.display_name,
                            'items', app.handover_item_counts(up.id), 'total', app.handover_item_total(up.id))
    from user_profiles up
    join tenant_escalation_rules r on r.tenant_id = up.tenant_id and r.kind = 'handover'
   where up.leaving_since is not null
     and up.is_active
     and app.elapsed_hours(up.leaving_since, p_now) >= r.hours
     and app.handover_item_total(up.id) > 0
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = up.tenant_id and l.kind = 'handover'
                        and l.subject_id = up.id and l.occurrence = up.leaving_since::text)

  union all
  -- ---- task_request (ADR-0139 d.5): a booking asked of another team, unanswered, in WORKING hours from when it was
  -- asked. Once only per request (`occurrence` ''); the sweep stamps `escalated_at`. ----
  select q.tenant_id, 'task_request', q.id, '', 'sub_task', t.id, t.title, t.deliverable_id, t.id,
         coalesce(st.campaign_id, j.campaign_id),
         q.created_at, app.working_hours_between(q.created_at, p_now), r.hours,
         jsonb_build_object('request_id', q.id,
                            'team', (select tm.name from teams tm where tm.id = app.task_request_team(q.team_id, q.assignee_id)),
                            'person', (select up.display_name from user_profiles up where up.id = q.assignee_id),
                            'asked_by', (select up.display_name from user_profiles up where up.id = q.requested_by),
                            'needed_by', q.needed_by, 'deliverable', d.name)
    from sub_task_assignment_requests q
    join sub_tasks t on t.id = q.sub_task_id
    join deliverables d on d.id = t.deliverable_id
    left join streams st on st.id = d.stream_id
    left join jobs j on j.id = d.job_id
    join tenant_escalation_rules r on r.tenant_id = q.tenant_id and r.kind = 'task_request'
   where q.status = 'pending'
     and q.escalated_at is null
     and app.working_hours_between(q.created_at, p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = q.tenant_id and l.kind = 'task_request'
                        and l.subject_id = q.id and l.occurrence = '');
$function$;

CREATE OR REPLACE FUNCTION app.run_escalation_sweep(p_now timestamp with time zone DEFAULT now(), p_dry_run boolean DEFAULT false, p_kind text DEFAULT NULL::text, p_deliverable uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
declare
  r          app.escalation_due_row;
  v_people   jsonb;
  v_count    integer;
  v_log      uuid;
  v_type     text;
  v_sent     integer := 0;
  v_items    jsonb := '[]'::jsonb;
  v_fallback boolean;
  v_reason   text;
begin
  -- ADR-0133 d.4: a list emptied from the items' own pages (not the hand-over page) completes here too.
  if not p_dry_run then
    perform app.complete_finished_handovers();
  end if;

  for r in select * from app.escalation_due(p_now) e where (p_kind is null or e.kind = p_kind)
             and (p_deliverable is null or e.deliverable_id = p_deliverable)   -- [edit]
           order by e.kind, e.since, e.subject_id loop
    v_fallback := false;
    v_reason := null;
    if r.kind = 'over_capacity' then
      select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'reasons', x.reasons) order by x.user_id), '[]'::jsonb)
        into v_people from app.over_capacity_recipients(r.subject_id) x;
    elsif r.kind = 'handover' then
      -- ADR-0133 d.5: the rule's roles (default the Traffic Manager and the Power Admins), active and not leaving
      -- themselves, never the person leaving. The rule names no piece, so `escalation_recipients` does not apply.
      select coalesce(jsonb_agg(jsonb_build_object('user_id', up.id, 'reasons', jsonb_build_array('role')) order by up.id), '[]'::jsonb)
        into v_people
        from user_profiles up
        join tenant_escalation_rules er on er.tenant_id = r.tenant_id and er.kind = 'handover'
       where up.tenant_id = r.tenant_id and up.role_id = any (er.role_ids)
         and up.is_active and up.leaving_since is null and up.id <> r.subject_id;
      if jsonb_array_length(v_people) = 0 then
        v_fallback := true;
        v_reason := 'no one holds the hand-over rule''s roles';
        select coalesce(jsonb_agg(jsonb_build_object('user_id', up.id, 'reasons', jsonb_build_array('traffic_fallback'))
                                  order by up.id), '[]'::jsonb)
          into v_people
          from user_profiles up
          join roles ro on ro.id = up.role_id
         where up.tenant_id = r.tenant_id and ro.tenant_id = r.tenant_id
           and ro.key = 'scheduler' and up.is_active and up.leaving_since is null and up.id <> r.subject_id;
      end if;
    elsif r.kind = 'task_request' then
      -- ADR-0139 d.5: the rule's roles (default Traffic) AND the department lead the request waits on — both, always;
      -- never the asker. Falls back to the Traffic Manager like every other rung.
      select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'reasons', x.reasons) order by x.user_id), '[]'::jsonb)
        into v_people
        from (select f.user_id, array_agg(distinct f.reason order by f.reason) as reasons
                from (select up.id as user_id, 'role'::text as reason
                        from user_profiles up
                        join tenant_escalation_rules er on er.tenant_id = r.tenant_id and er.kind = 'task_request'
                       where up.tenant_id = r.tenant_id and up.role_id = any (er.role_ids) and up.is_active
                      union all
                      select up.id, 'department_lead'
                        from sub_task_assignment_requests q
                        join user_profiles up on up.tenant_id = q.tenant_id and up.is_active
                        join roles ro on ro.id = up.role_id and ro.scope = 'department'
                       where q.id = r.subject_id
                         and up.department_id = app.task_request_department(q.team_id, q.assignee_id)) f
               where f.user_id is distinct from (select q.requested_by from sub_task_assignment_requests q where q.id = r.subject_id)
               group by f.user_id) x;
      if jsonb_array_length(v_people) = 0 then
        v_fallback := true;
        v_reason := 'no one holds the task-request rule''s roles and the department has no lead';
        select coalesce(jsonb_agg(jsonb_build_object('user_id', up.id, 'reasons', jsonb_build_array('traffic_fallback'))
                                  order by up.id), '[]'::jsonb)
          into v_people
          from user_profiles up
          join roles ro on ro.id = up.role_id
         where up.tenant_id = r.tenant_id and ro.tenant_id = r.tenant_id
           and ro.key = 'scheduler' and up.is_active;
      end if;
    else
      select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'reasons', x.reasons) order by x.user_id), '[]'::jsonb)
        into v_people from app.escalation_recipients(r.kind, r.deliverable_id, r.sub_task_id, r.campaign_id) x;

      -- I59 E9: a rule that resolves to nobody goes to the Traffic Manager role.
      if jsonb_array_length(v_people) = 0 then
        v_fallback := true;
        v_reason := app.escalation_fallback_reason(r.kind, r.deliverable_id, r.sub_task_id, r.campaign_id);
        select coalesce(jsonb_agg(jsonb_build_object('user_id', up.id, 'reasons', jsonb_build_array('traffic_fallback'))
                                  order by up.id), '[]'::jsonb)
          into v_people
          from user_profiles up
          join roles ro on ro.id = up.role_id
         where up.tenant_id = r.tenant_id and ro.tenant_id = r.tenant_id
           and ro.key = 'scheduler' and up.is_active;
      end if;
    end if;
    v_count := jsonb_array_length(v_people);

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'kind', r.kind, 'entity_type', r.entity_type, 'entity_id', r.entity_id, 'label', r.label,
      'occurrence', r.occurrence, 'since', r.since, 'hours', round(r.hours, 1), 'threshold', r.threshold,
      'recipients', v_people, 'extra', r.extra,
      'fallback', v_fallback, 'fallback_reason', v_reason));

    if p_dry_run then
      continue;
    end if;

    if v_count = 0 then
      -- Nobody at all, not even the Traffic Manager: nothing sent, retried next run — but recorded.
      insert into escalation_unreached (tenant_id, kind, subject_id, occurrence, reason, first_tried_at, last_tried_at)
      values (r.tenant_id, r.kind, r.subject_id, r.occurrence, v_reason, p_now, p_now)
      on conflict (tenant_id, kind, subject_id, occurrence)
      do update set last_tried_at = excluded.last_tried_at, reason = excluded.reason;
      continue;
    end if;

    v_log := null;
    insert into escalation_log (tenant_id, kind, subject_id, occurrence, recipients, sent_at, fallback, fallback_reason)
    values (r.tenant_id, r.kind, r.subject_id, r.occurrence, v_count, p_now, v_fallback, v_reason)
    on conflict (tenant_id, kind, subject_id, occurrence) do nothing
    returning id into v_log;
    if v_log is null then
      continue;   -- another run sent this cause first
    end if;

    delete from escalation_unreached u
     where u.tenant_id = r.tenant_id and u.kind = r.kind and u.subject_id = r.subject_id
       and u.occurrence = r.occurrence;

    v_type := case r.kind when 'review_remind' then 'review_reminder'
                          when 'over_capacity' then 'over_capacity'
                          else 'escalated' end;

    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    select r.tenant_id, (p ->> 'user_id')::uuid, v_type, r.label, r.entity_type, r.entity_id, null,
           coalesce(r.extra, '{}'::jsonb) || jsonb_build_object(
             'kind', r.kind, 'occurrence', r.occurrence, 'since', r.since,
             'hours', case when r.hours is null then null else round(r.hours) end,
             'threshold', r.threshold, 'as', p -> 'reasons')
           || case when v_fallback then jsonb_build_object('fallback_reason', v_reason) else '{}'::jsonb end
      from jsonb_array_elements(v_people) p;

    -- The single-job rung's own stamp keeps its meaning ("when the unassigned escalation was sent").
    if r.kind = 'unassigned' then
      update deliverables set assignment_escalated_at = p_now
       where id = r.subject_id and assignment_escalated_at is null;
    end if;
    -- ADR-0139 d.5: from now Traffic and the department lead may answer the request too.
    if r.kind = 'task_request' then
      update sub_task_assignment_requests set escalated_at = p_now
       where id = r.subject_id and escalated_at is null;
    end if;

    v_sent := v_sent + 1;
  end loop;

  return jsonb_build_object('dry_run', p_dry_run, 'now', p_now, 'sent', v_sent,
                            'due', jsonb_array_length(v_items), 'items', v_items);
end $function$;

commit;
