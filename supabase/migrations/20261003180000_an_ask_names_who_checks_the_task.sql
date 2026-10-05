-- I74 (ADR-0139) — an ask to another team names who checks the task first.
--
-- Found by the I74 browser tests: request_task_booking accepted an ask on a task with no reviewer; the
-- answering lead's Book then failed ("a reviewer must be appointed for this task") with no way to add
-- one. The asker now chooses the reviewers first (the existing picker — the first mandatory, the rest
-- optional; Edward, 3 Oct), and the server refuses an ask without them (hint reviewer_required).
-- Re-emitted whole from 20261003110000; the only other change is the hours message's wording.
begin;

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
  -- I74 (found by the browser tests): the lead who answers books the task, and a task cannot be booked
  -- without a reviewer (ADR-0043 d.4) — so the asker chooses who checks it before asking, as the
  -- Schedule's booking window does. Without this the answer window could only fail.
  if not exists (select 1 from sub_task_reviewers r where r.sub_task_id = p_sub_task) then
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
                                p_starts_at, p_due_at, coalesce(p_hours, v.sla_hours), null, null,
                                p_needed_by, p_note);
end $$;

commit;
