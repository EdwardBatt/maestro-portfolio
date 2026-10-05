-- ADR-0115 (I59.46, Edward 26 Sep): a department that does no production work is not offered for work.
--
-- "Finance, Support, and some others never get assigned deliverables, and neither the dept or user should
-- be displayed as a choice on /schedule or where a dept needs to be picked … CS are assigned as reviewers
-- and approvers." One switch per department (d.1), set on the Organization page (d.2). The screens hide a
-- switched-off department and its people wherever work is handed out (d.3); this file is the database's
-- half:
--
--   d.5  switching a department off is refused while it still owns live work, and the refusal names it;
--   d.6  no new work lands in a switched-off department — a deliverable (its department follows its
--        owner, ADR-0102), a task given to someone, or a booking — whatever screen or call tries.
--
-- Reviewer and approver appointments are NOT touched (d.4): CS reviews and approves.
--
-- Every existing department starts ON (d.1), so nothing changes until an admin switches one off. The
-- guards are SECURITY INVOKER: they read rows the writer can already see under RLS (tenant-wide selects).
-- Named `zz_…` so they run after every other BEFORE trigger on the table (Postgres fires them in name
-- order) — in particular after `deliverable_stamp_department`, which may have just set the department.

begin;

alter table departments
  add column if not exists is_production boolean not null default true;

comment on column departments.is_production is
  'ADR-0115 d.1: does this department take production work? Off: it and its people are not offered for '
  'work (the Schedule, the Team page, department / owner / assignee / booking pickers); reviewers and '
  'approvers keep them. Default on.';

-- ---------------------------------------------------------------- the test both guards use ----
create or replace function app.department_is_production(p_department uuid)
returns boolean
language sql
stable
set search_path = public, app, extensions
as $$
  -- No department (null) is not a refusal: work with no department is governed elsewhere.
  select coalesce((select d.is_production from departments d where d.id = p_department), true)
$$;
comment on function app.department_is_production(uuid) is
  'ADR-0115: true unless the department exists and is switched off. Null or unknown answers true.';

-- ---------------------------------------------------------------- d.5 switching off ----
create or replace function app.tg_department_production_switch()
returns trigger
language plpgsql
set search_path = public, app, extensions
as $$
declare
  v_deliverables text[];
  v_tasks        int;
  v_bookings     int;
  v_parts        text[] := '{}';
begin
  if not (old.is_production and not new.is_production) then
    return new;   -- switching ON, or not touching the switch: always allowed
  end if;

  -- Live deliverables owned in this department (not finished, not archived).
  select array_agg(d.name order by d.name) into v_deliverables
    from deliverables d
   where d.department_id = new.id
     and d.state not in ('approved', 'delivered', 'archived');

  -- Live tasks in the department, or on one of its people.
  select count(*) into v_tasks
    from sub_tasks t
   where t.status not in ('done', 'cancelled')
     and (t.department_id = new.id
          or t.assignee_id in (select p.id from user_profiles p where p.department_id = new.id));

  -- Bookings from now on for its people or its resources. A person's resource may carry no department
  -- of its own; theirs is on their profile, so the resource's is read first and the person's after.
  select count(*) into v_bookings
    from bookings b
    join resources r on r.id = b.resource_id
    left join user_profiles p on p.id = r.user_id
   where coalesce(r.department_id, p.department_id) = new.id
     and b.state not in ('cancelled', 'expired')
     and b.ends_at >= now();

  if coalesce(array_length(v_deliverables, 1), 0) > 0 then
    v_parts := v_parts || format('%s deliverable%s (%s%s)',
      array_length(v_deliverables, 1),
      case when array_length(v_deliverables, 1) = 1 then '' else 's' end,
      array_to_string(v_deliverables[1:3], ', '),
      case when array_length(v_deliverables, 1) > 3 then ', …' else '' end);
  end if;
  if v_tasks > 0 then
    v_parts := v_parts || format('%s open task%s', v_tasks, case when v_tasks = 1 then '' else 's' end);
  end if;
  if v_bookings > 0 then
    v_parts := v_parts || format('%s booking%s from today on', v_bookings, case when v_bookings = 1 then '' else 's' end);
  end if;

  if array_length(v_parts, 1) > 0 then
    -- The sentence for a log; DETAIL is the list alone, which the Organization page words around.
    raise exception '% still has % — move them before it stops taking production work',
      new.name, array_to_string(v_parts, ', ')
      using errcode = '23514', hint = 'department_has_live_work', detail = array_to_string(v_parts, ', ');
  end if;
  return new;
end $$;
comment on function app.tg_department_production_switch() is
  'ADR-0115 d.5: a department cannot be switched off while it owns live work (deliverables not finished, '
  'open tasks, bookings from now on); the refusal names what remains. Switching on is always allowed.';

drop trigger if exists zz_department_production_switch on departments;
create trigger zz_department_production_switch
  before update of is_production on departments
  for each row execute function app.tg_department_production_switch();

-- ---------------------------------------------------------------- d.6 no new work there ----
create or replace function app.refuse_non_production(p_department uuid, p_what text)
returns void
language plpgsql
stable
set search_path = public, app, extensions
as $$
declare
  v_name text;
begin
  if app.department_is_production(p_department) then
    return;
  end if;
  select d.name into v_name from departments d where d.id = p_department;
  raise exception '% does not take production work, so %', coalesce(v_name, 'That department'), p_what
    using errcode = '23514', hint = 'department_not_production';
end $$;

-- A deliverable: on insert, and whenever its department moves (it follows its owner, ADR-0102).
create or replace function app.tg_deliverable_department_is_production()
returns trigger
language plpgsql
set search_path = public, app, extensions
as $$
begin
  if tg_op = 'INSERT' or new.department_id is distinct from old.department_id then
    perform app.refuse_non_production(new.department_id, 'a deliverable cannot go there');
  end if;
  return new;
end $$;

drop trigger if exists zz_deliverable_department_is_production on deliverables;
create trigger zz_deliverable_department_is_production
  before insert or update of department_id, owner_user_id on deliverables
  for each row execute function app.tg_deliverable_department_is_production();

-- A task: when it is given to someone (their department), or its own department moves.
create or replace function app.tg_sub_task_department_is_production()
returns trigger
language plpgsql
set search_path = public, app, extensions
as $$
declare
  v_person_dept uuid;
begin
  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    select p.department_id into v_person_dept from user_profiles p where p.id = new.assignee_id;
    perform app.refuse_non_production(v_person_dept, 'a task cannot be given to someone in it');
  end if;
  if tg_op = 'INSERT' or new.department_id is distinct from old.department_id then
    perform app.refuse_non_production(new.department_id, 'a task cannot go there');
  end if;
  return new;
end $$;

drop trigger if exists zz_sub_task_department_is_production on sub_tasks;
create trigger zz_sub_task_department_is_production
  before insert or update of assignee_id, department_id on sub_tasks
  for each row execute function app.tg_sub_task_department_is_production();

-- A booking: on its resource's department, when made or moved to another resource.
create or replace function app.tg_booking_department_is_production()
returns trigger
language plpgsql
set search_path = public, app, extensions
as $$
declare
  v_dept uuid;
begin
  if tg_op = 'INSERT' or new.resource_id is distinct from old.resource_id then
    -- The resource's department, or its person's when the resource carries none.
    select coalesce(r.department_id, p.department_id) into v_dept
      from resources r left join user_profiles p on p.id = r.user_id
     where r.id = new.resource_id;
    perform app.refuse_non_production(v_dept, 'nobody in it can be booked');
  end if;
  return new;
end $$;

drop trigger if exists zz_booking_department_is_production on bookings;
create trigger zz_booking_department_is_production
  before insert or update of resource_id on bookings
  for each row execute function app.tg_booking_department_is_production();

commit;
