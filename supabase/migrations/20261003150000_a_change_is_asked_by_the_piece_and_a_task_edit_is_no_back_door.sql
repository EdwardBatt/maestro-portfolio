-- Follow-up to ADR-0140 / ADR-0141 (3 Oct, the coordinator's two corrections from the accepted ADRs; no new decision).
--
--   1) ADR-0141 d.2/d.5: the change form is asked by the piece's OWNER and the LEADS who reach its department (and the
--      tenant-wide roles) — not by every holder of project_tasks:manage (team members hold it) and not by the person on
--      a task: a maker asks her own lead for more time (ask_more_time). Refusal hint `ask_your_lead`.
--   2) ADR-0139 d.1 / ADR-0140 d.2: `save_sub_task` (security invoker; the owner's policy branch lets it update any
--      task on her piece) is not a back door: changing the days or the person of a task whose assignee is outside the
--      caller's scheduling reach is refused with hint `use_update_task_assignment` — that path turns it into a request.
--      Name, notes, hours and review still save.
--
-- Reproduced WHOLE from their live definitions (pg_get_functiondef, local stack at 20261003140000):
--   public.ask_deliverable_change   20261003130000
--   public.save_sub_task            20260916110000
-- No data change.

begin;

-- public.ask_deliverable_change — the gate is the edit.
CREATE OR REPLACE FUNCTION public.ask_deliverable_change(p_deliverable uuid, p_kinds text[], p_reason text, p_due_day date DEFAULT NULL::date, p_hours numeric DEFAULT NULL::numeric, p_from_sub_task uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
declare
  d      deliverables%rowtype;
  v_ask  uuid;
  v_am   uuid;
begin
  select * into d from deliverables where id = p_deliverable and tenant_id = app.current_tenant_id();
  if not found then raise exception 'deliverable % not found', p_deliverable using errcode = 'P0002'; end if;
  if d.state = 'archived' then
    raise exception 'this deliverable is closed; there is nothing left to change' using errcode = '22023';
  end if;
  if app.may_change_deliverable(p_deliverable) then
    raise exception 'you change this deliverable yourself — there is nobody to ask' using errcode = '22023', hint = 'change_directly';
  end if;
  -- ADR-0141 d.2/d.5: the piece's owner and the leads who reach its department (department or team scope over it), and
  -- the tenant-wide roles. A maker asks her own lead for more time instead (ask_more_time).
  if not (d.owner_user_id = auth.uid()
          or app.leads_department(coalesce(d.department_id,
                                           (select up.department_id from user_profiles up where up.id = d.owner_user_id)))
          or app.current_scope() = 'tenant') then
    raise exception 'asking for a change to this deliverable is for its owner and the leads of its department — ask your lead for more time instead'
      using errcode = '42501', hint = 'ask_your_lead';
  end if;
  if p_kinds is null or cardinality(p_kinds) = 0
     or not (p_kinds <@ array['hours', 'due_date', 'format', 'language', 'quantity', 'brief', 'other']::text[]) then
    raise exception 'say what isn''t right — hours, due date, format, language, quantity, brief or something else'
      using errcode = '22023', hint = 'kinds_required';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'say why — the reason goes to the account manager' using errcode = '22023', hint = 'reason_required';
  end if;
  if p_hours is not null and p_hours <= 0 then
    raise exception 'the hours asked for are more than nothing' using errcode = '22023';
  end if;
  if p_from_sub_task is not null and not exists (select 1 from sub_tasks t where t.id = p_from_sub_task and t.deliverable_id = d.id) then
    raise exception 'that task is not one of this deliverable''s' using errcode = '22023';
  end if;
  if exists (select 1 from deliverable_change_asks a where a.deliverable_id = d.id and a.status = 'pending') then
    raise exception 'a change to this deliverable is already waiting on the account manager'
      using errcode = '22023', hint = 'change_pending';
  end if;

  insert into deliverable_change_asks (tenant_id, deliverable_id, asked_by, kinds, requested_due_day, requested_hours,
                                       reason, from_sub_task_id)
  values (d.tenant_id, d.id, auth.uid(), p_kinds, p_due_day, p_hours, trim(p_reason), p_from_sub_task)
  returning id into v_ask;

  v_am := app.deliverable_account_manager(d.id);
  if v_am is not null and v_am is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (d.tenant_id, v_am, 'deliverable_change_asked', d.name, 'deliverable', d.id, auth.uid(),
            jsonb_build_object('ask_id', v_ask, 'kinds', to_jsonb(p_kinds), 'due_day', p_due_day, 'hours', p_hours,
                               'reason', trim(p_reason), 'from_sub_task', p_from_sub_task));
  end if;
  return v_ask;
end $function$;

-- public.save_sub_task — the reach check is the edit.
CREATE OR REPLACE FUNCTION public.save_sub_task(p_sub_task uuid, p_deliverable uuid, p_title text, p_reviewers jsonb, p_description text DEFAULT NULL::text, p_assignee uuid DEFAULT NULL::uuid, p_department uuid DEFAULT NULL::uuid, p_team uuid DEFAULT NULL::uuid, p_sla_hours numeric DEFAULT NULL::numeric, p_sla_profile uuid DEFAULT NULL::uuid, p_starts_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_status text DEFAULT NULL::text, p_review_mode text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
declare
  v_tenant uuid := app.current_tenant_id();
  v_id uuid := p_sub_task;
  v_was uuid;
  v_dept uuid;
  v_owner_name text;
  v_cur sub_tasks%rowtype;   -- ADR-0140 d.2
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
  -- ADR-0139 d.1 / ADR-0140 d.2 (3 Oct): the days or the person of a task held by somebody outside the caller's
  -- scheduling reach are that person's lead's to move — through update_task_assignment, which asks. This editor is not a
  -- way round it; its name, notes, hours and review still save here.
  if v_id is not null and auth.uid() is not null and not app.is_system_op() then
    select * into v_cur from sub_tasks where id = v_id and tenant_id = v_tenant;
    if found and v_cur.assignee_id is not null
       and ((p_assignee is not null and p_assignee is distinct from v_cur.assignee_id)
            or (p_starts_at is not null and p_starts_at is distinct from v_cur.starts_at)
            or (p_due_at is not null and p_due_at is distinct from v_cur.due_at))
       and exists (select 1 from resources r
                    where r.user_id = v_cur.assignee_id and r.kind = 'human' and r.is_active and r.tenant_id = v_tenant
                      and not app.resource_in_scheduling_scope(r.id)) then
      raise exception '% is outside your team — moving their days or giving the task to someone else is asked of their lead',
              coalesce((select display_name from user_profiles where id = v_cur.assignee_id), 'The person')
        using errcode = '42501',
              detail = coalesce((select display_name from user_profiles where id = v_cur.assignee_id), ''),
              hint = 'use_update_task_assignment';
    end if;
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
end $function$;

commit;
