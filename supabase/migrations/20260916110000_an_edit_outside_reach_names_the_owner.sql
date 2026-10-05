-- I49.66 — an outsider editing a task is told "you do not have the rights", and who has them.
--
-- `save_sub_task` is SECURITY INVOKER, so its UPDATE is filtered by `sub_tasks_manage_update`.
-- For a caller outside the task's reach that filter returns no row, and the function said
-- "sub_task … not found" (P0002) — to a person looking at the row on screen. The deliverables
-- page then showed it as a failure with a Report button (found by the coverage burn-down, 15 Sep).
--
-- The policy is the authority on WHO may edit (it has three branches — reach, the assignee, the
-- project PM — and this function does not restate them). What changes is the reading of "no row":
-- if the row is visible to the caller it was a refusal, and the refusal says so and names the
-- deliverable's owner — Edward, 16 Sep: *"you do not have rights to edit this task, if you need it
-- edited please contact <deliverable owner>"*. The name rides in DETAIL and the hint says whether
-- there is an owner, the same shape as `approve_campaign` (ADR-0083 d.15). A row that is not
-- there at all is still "not found".
--
-- Reproduced whole from `20260915130000`; only the not-found branch and one declaration changed.

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
  v_owner_name text;
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
      -- I49.66: the UPDATE is filtered by RLS, so "no row" here means one of two things. A row
      -- the caller can SEE (the tenant-wide select) but may not change is a refusal, and it
      -- names who can: the deliverable's owner rides in DETAIL, the hint says whether there is
      -- one. Only a row that is not there at all is "not found".
      select p.display_name into v_owner_name
        from sub_tasks st
        join deliverables d on d.id = st.deliverable_id
        left join user_profiles p on p.id = d.owner_user_id
       where st.id = v_id and st.tenant_id = v_tenant;
      if found then
        raise exception 'you do not have the rights to edit this task'
          using errcode = '42501',
                detail = coalesce(v_owner_name, ''),
                hint = case when v_owner_name is null then 'no_owner' else 'deliverable_owner' end;
      end if;
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
  'task with no department named takes its deliverable''s, so the owner can add to their own list. '
  'I49.66: an edit outside the caller''s reach is refused as one (42501, the owner named in DETAIL), '
  'not reported as "not found".';

commit;
