-- I74.53 (ADR-0140 addendum, Edward 4 Oct, A): an ask carries its hours and who checks the task.
--
-- The account manager no longer edits a deliverable's tasks (`20261004190000`), but she asks a lead for a person
-- (ADR-0139 d.1), and an ask needs the task's hours and who checks it — the lead who answers books it, and a task is
-- never booked without a reviewer (ADR-0043 d.4). Her screens used to save both onto the task (a task edit) just
-- before asking; that edit is now refused. So the ask carries them: `request_task_booking` takes the reviewers and the
-- review mode with the hours, the ask records them (`sub_task_assignment_requests.reviewers / review_mode / hours`,
-- already there), and the BOOKING writes them onto the task — `answer_task_request` and `take_task_offer` already pass
-- the ask's reviewers, review mode and hours into `update_task_assignment`. Until a lead books it, the task is
-- untouched.
--
-- The reviewer rule still holds at the ask: a task with no reviewer may be asked for only when the ask names one.
-- The list is checked as the booking will check it (a JSON array, not empty, nobody twice), so an ask cannot be sent
-- that its answer would fail on. Everything else in the function is as it was (20261003110000).

begin;

drop function if exists public.request_task_booking(uuid, uuid, uuid, numeric, date, timestamptz, timestamptz, text);

create function public.request_task_booking(
  p_sub_task    uuid,
  p_team        uuid,
  p_assignee    uuid        default null,
  p_hours       numeric     default null,
  p_needed_by   date        default null,
  p_starts_at   timestamptz default null,
  p_due_at      timestamptz default null,
  p_note        text        default null,
  p_reviewers   jsonb       default null,
  p_review_mode text        default null)
returns uuid
language plpgsql
security definer
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

  -- Who checks it, as the booking will check it (update_task_assignment).
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
  if p_review_mode is not null and p_review_mode not in ('digital', 'manual') then
    raise exception 'review mode must be digital or manual' using errcode = '22023';
  end if;
  -- The lead who answers books the task, and a task cannot be booked without a reviewer (ADR-0043 d.4): the task
  -- has one already, or the ask names one.
  if p_reviewers is null and not exists (select 1 from sub_task_reviewers r where r.sub_task_id = p_sub_task) then
    raise exception 'choose who checks "%" before asking another team for it', v.title
      using errcode = '22023', hint = 'reviewer_required';
  end if;

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
    raise exception 'the hours asked for must be more than zero' using errcode = '22023';
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
                                p_starts_at, p_due_at, coalesce(p_hours, v.sla_hours), p_reviewers, p_review_mode,
                                p_needed_by, p_note);
end $$;

comment on function public.request_task_booking(uuid, uuid, uuid, numeric, date, timestamptz, timestamptz, text, jsonb, text) is
  'ADR-0139 d.2: ask a team (and optionally one of its people) to do a task — hours, needed-by date, optional days, a '
  'note, and (I74.53) who checks it and how, which the booking writes onto the task. Needs project_tasks:manage (or '
  'the piece''s ownership) and bookings:create; nothing is booked until it is answered. Refused with hint '
  'reviewer_required when neither the task nor the ask names a reviewer, book_directly when the person or team is '
  'within the caller''s own reach, request_pending when the task already has an open request, unplaced_resource when '
  'nobody could answer.';

revoke all on function public.request_task_booking(uuid, uuid, uuid, numeric, date, timestamptz, timestamptz, text, jsonb, text) from public, anon;
grant execute on function public.request_task_booking(uuid, uuid, uuid, numeric, date, timestamptz, timestamptz, text, jsonb, text) to authenticated;

commit;
