-- I48.42 (15 Sep) — a new task takes its deliverable's department when none is given.
--
-- WHAT WENT WRONG. A real user — the deliverable's owner — added a task to their task list on
-- production and got "new row violates row-level security policy for table sub_tasks". The add form
-- writes the ASSIGNEE's department onto the task, which is null when the task is added unassigned;
-- sub_tasks_manage_insert then asks in_write_scope(null, null, AM), and the department and team
-- branches of that function cannot say yes to a null (traps.md: "A null argument to in_write_scope
-- silently kills a whole class of approver" — the fifth instance). Materialised tasks carry the
-- deliverable's department (20260828220000), which is why editing them worked and adding one did
-- not, and why retest F never saw it: nobody adds a task by the form as the owner.
--
-- ONE function reproduced WHOLE from 20260830150000 (its latest definition — grep confirmed). The
-- only edit is inside the INSERT branch, marked I48.42: a null p_department is filled from the
-- deliverable before the row is written, so the policy sees the department the work belongs to.
-- update_task_assignment is untouched — it stamps from the person, which is the right source when
-- somebody is being named.

begin;

create or replace function public.save_sub_task(
  p_sub_task    uuid,
  p_deliverable uuid,
  p_title       text,
  p_reviewers   jsonb,
  p_description text default null,
  p_assignee    uuid default null,
  p_department  uuid default null,
  p_team        uuid default null,
  p_sla_hours   numeric default null,
  p_sla_profile uuid default null,
  p_starts_at   timestamptz default null,
  p_due_at      timestamptz default null,
  p_status      text default null,
  p_review_mode text default null
) returns uuid
language plpgsql security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_id uuid := p_sub_task;
  v_was uuid;
  v_dept uuid;
begin
  if coalesce(trim(p_title), '') = '' then
    raise exception 'a task title is required' using errcode = '22023';
  end if;
  if p_review_mode is not null and p_review_mode not in ('digital', 'manual') then
    raise exception 'review mode must be digital or manual' using errcode = '22023';
  end if;
  if p_reviewers is not null then
    if jsonb_typeof(p_reviewers) <> 'array' then
      raise exception 'the reviewer list must be a JSON array' using errcode = '22023';
    end if;
    if (select count(*) from jsonb_array_elements(p_reviewers) e) <>
       (select count(distinct e ->> 'user_id') from jsonb_array_elements(p_reviewers) e) then
      raise exception 'the same reviewer is listed twice' using errcode = '22023';
    end if;
  end if;

  -- ADR-0061 d.5, on a CHANGE of assignee only. Editing a task that is already held by somebody
  -- since made unbookable must keep working — the work exists and somebody is doing it.
  if v_id is not null then
    select assignee_id into v_was from sub_tasks where id = v_id and tenant_id = v_tenant;
  end if;
  if p_assignee is not null and p_assignee is distinct from v_was
     and not app.person_is_bookable(p_assignee) then
    raise exception 'that person is not bookable, so work cannot be assigned to them'
      using errcode = '22023';
  end if;

  if v_id is null then
    -- I48.42 (15 Sep): a NEW task with no department named takes its deliverable's. The insert
    -- policy asks in_write_scope(department_id, team_id, …) of the ROW, and a null department
    -- answers "no" for every department- or team-scoped caller — so the deliverable's own owner
    -- (ADR-0083 d.11/d.12, ADR-0090 d.7) was refused adding an unassigned task to their own list.
    -- The materialiser already stamps the deliverable's department on the tasks it creates; this
    -- is the same fact for a task added by hand. A named department (the assignee's) still wins.
    if p_department is null then
      select d.department_id into v_dept
        from deliverables d where d.id = p_deliverable and d.tenant_id = v_tenant;
    end if;
    insert into sub_tasks (tenant_id, deliverable_id, title, description, assignee_id,
                           department_id, team_id, sla_hours, sla_profile_id,
                           starts_at, due_at, status, review_mode, created_by)
    values (v_tenant, p_deliverable, trim(p_title), p_description, p_assignee,
            coalesce(p_department, v_dept), p_team, p_sla_hours, p_sla_profile,
            p_starts_at, p_due_at, coalesce(p_status, 'todo'),
            coalesce(p_review_mode, 'digital'), auth.uid())
    returning id into v_id;
  else
    -- COALESCE, every field. NULL means "leave it alone".
    update sub_tasks set
      title          = trim(p_title),
      description    = coalesce(p_description, description),
      assignee_id    = coalesce(p_assignee, assignee_id),
      department_id  = coalesce(p_department, department_id),
      team_id        = coalesce(p_team, team_id),
      sla_hours      = coalesce(p_sla_hours, sla_hours),
      sla_profile_id = coalesce(p_sla_profile, sla_profile_id),
      starts_at      = coalesce(p_starts_at, starts_at),
      due_at         = coalesce(p_due_at, due_at),
      status         = coalesce(p_status, status),
      review_mode    = coalesce(p_review_mode, review_mode)
    where id = v_id and tenant_id = v_tenant;
    if not found then
      raise exception 'sub_task % not found', v_id using errcode = 'P0002';
    end if;
  end if;

  if p_reviewers is not null then
    if jsonb_array_length(p_reviewers) = 0 and p_assignee is not null then
      raise exception 'a reviewer must be appointed for this task' using errcode = '22023';
    end if;

    delete from sub_task_reviewers r
     where r.sub_task_id = v_id
       and not exists (
         select 1 from jsonb_array_elements(p_reviewers) e
         where (e ->> 'user_id')::uuid = r.user_id);

    update sub_task_reviewers r
       set is_mandatory = coalesce((e ->> 'is_mandatory')::boolean, false)
      from jsonb_array_elements(p_reviewers) e
     where r.sub_task_id = v_id
       and r.user_id = (e ->> 'user_id')::uuid
       and r.is_mandatory is distinct from coalesce((e ->> 'is_mandatory')::boolean, false);

    insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory, created_by)
    select v_tenant, v_id, (e ->> 'user_id')::uuid,
           coalesce((e ->> 'is_mandatory')::boolean, false), auth.uid()
    from jsonb_array_elements(p_reviewers) e
    where not exists (
      select 1 from sub_task_reviewers r
      where r.sub_task_id = v_id and r.user_id = (e ->> 'user_id')::uuid);
  end if;

  return v_id;
end $$;

comment on function public.save_sub_task(uuid, uuid, text, jsonb, text, uuid, uuid, uuid, numeric, uuid, timestamptz, timestamptz, text, text) is
  'ADR-0043, extended by ADR-0059 d.4 and ADR-0061 d.5: write a task, its reviewers and its review '
  'mode in ONE transaction, and refuse to hand work to somebody who is not bookable. SECURITY '
  'INVOKER — RLS decides every write. The bookable check is on a CHANGE of assignee, so a task '
  'already held by somebody since switched off can still be edited and finished. I48.42: a new '
  'task with no department named takes its deliverable''s, so the owner can add to their own list.';

commit;
