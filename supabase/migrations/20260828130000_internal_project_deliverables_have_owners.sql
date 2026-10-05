-- I22.5 (ADR-0055 d.10) — an internal project's deliverables have owners, like any other project's.
--
-- Edward, 28 Aug: *"if it is creating an internal project where the client selected is internal it
-- should function the same as any other project."* He is right, and the reason it did not is
-- ordinary drift rather than a decision: `public.create_internal_project` was written on 19 Aug
-- (ADR-0029, I7.1) and `deliverables.owner_user_id` arrived on 27 Aug with ADR-0050. Nothing went
-- back. So the function inserted `(tenant_id, job_id, name)` and every internal-project deliverable
-- has been ownerless — and therefore, after ADR-0053, department-less and unlabelled.
--
-- Option B of three, chosen by Edward:
--   * each deliverable row may carry its own `ownerUserId`, defaulting to the project's PM;
--   * **the PM becomes required**, because a campaign cannot be created without an owner per
--     deliverable (`BriefWizard` drops any row missing one) and an internal project should not be
--     able to either. That is the whole point of "the same as any other project".
--
-- Rejected: a per-deliverable owner picker on the internal-project form (option C). Internal
-- projects are short lists under one accountable person, and `public.reassign_deliverable`
-- (20260828120000) now exists for the deliverable that needs somebody else.
--
-- Body reproduced from `20260819230000` with the marked edits; reproducing whole is what keeps
-- `search_path` pinned (ADR-0033).

begin;

create or replace function public.create_internal_project(
  p_owner_kind  text,
  p_name        text,
  p_department  uuid  default null,
  p_team        uuid  default null,
  p_pm          uuid  default null,
  p_deliverables jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_client uuid;
  v_client_name text;
  v_job uuid;
  v_owner uuid;
  d jsonb;
begin
  if not app.has_permission('projects', 'manage') then
    raise exception 'setting up internal projects requires projects:manage' using errcode = '42501';
  end if;
  if p_owner_kind not in ('tenant', 'department', 'team') then
    raise exception 'invalid owner kind %', p_owner_kind using errcode = '22023';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'a project name is required' using errcode = '22023';
  end if;

  -- I22.5: the PM is now required. Without one, every deliverable below would be ownerless, which
  -- is the state this migration exists to end.
  if p_pm is null then
    raise exception 'an internal project needs a project manager' using errcode = '22023';
  end if;
  if not exists (select 1 from user_profiles up where up.id = p_pm and up.tenant_id = v_tenant) then
    raise exception 'that project manager is not in your organization' using errcode = '22023';
  end if;

  if p_owner_kind = 'department' and p_department is null then
    raise exception 'a department is required for a department-owned project' using errcode = '22023';
  end if;
  if p_owner_kind = 'team' and p_team is null then
    raise exception 'a team is required for a team-owned project' using errcode = '22023';
  end if;

  -- get-or-create the internal client for this owner (partial-unique per owner, ADR-0029 I7.1)
  if p_owner_kind = 'tenant' then
    select id into v_client from clients where tenant_id = v_tenant and is_internal and internal_kind = 'tenant' limit 1;
    v_client_name := 'Internal';
  elsif p_owner_kind = 'department' then
    select id into v_client from clients where tenant_id = v_tenant and internal_kind = 'department' and internal_department_id = p_department limit 1;
    select 'Internal — ' || name into v_client_name from departments where id = p_department;
  else
    select id into v_client from clients where tenant_id = v_tenant and internal_kind = 'team' and internal_team_id = p_team limit 1;
    select 'Internal — ' || name into v_client_name from teams where id = p_team;
  end if;

  if v_client is null then
    insert into clients (tenant_id, name, is_internal, internal_kind, internal_department_id, internal_team_id)
    values (
      v_tenant, coalesce(v_client_name, 'Internal'), true, p_owner_kind,
      case when p_owner_kind = 'department' then p_department end,
      case when p_owner_kind = 'team' then p_team end
    )
    returning id into v_client;
  end if;

  -- the internal project itself: a light job whose owner_user_id is the appointed PM
  insert into jobs (tenant_id, client_id, name, owner_user_id)
  values (v_tenant, v_client, trim(p_name), p_pm)
  returning id into v_job;

  -- optional deliverables
  for d in select * from jsonb_array_elements(coalesce(p_deliverables, '[]'::jsonb)) loop
    if coalesce(trim(d ->> 'name'), '') <> '' then
      -- I22.5: an owner per row, defaulting to the PM. `department_id` is NOT written — it is
      -- stamped from the owner by app.tg_deliverable_stamp_department (ADR-0050 d.2), which is
      -- the same derive-don't-ask path a campaign deliverable takes.
      v_owner := coalesce(nullif(d ->> 'ownerUserId', '')::uuid, p_pm);
      if not exists (select 1 from user_profiles up where up.id = v_owner and up.tenant_id = v_tenant) then
        raise exception 'that deliverable owner is not in your organization' using errcode = '22023';
      end if;
      insert into deliverables (tenant_id, job_id, name, owner_user_id)
      values (v_tenant, v_job, trim(d ->> 'name'), v_owner);
    end if;
  end loop;

  return v_job;
end $$;

comment on function public.create_internal_project(text, text, uuid, uuid, uuid, jsonb) is
  'ADR-0029 I7.1, amended by ADR-0055 I22.5: an internal project is a project with an internal '
  'client, so its deliverables carry owners like any other. The PM is required; each deliverable '
  'may name its own owner and defaults to the PM. department_id is derived, never passed.';

revoke execute on function public.create_internal_project(text, text, uuid, uuid, uuid, jsonb) from anon;
grant execute on function public.create_internal_project(text, text, uuid, uuid, uuid, jsonb) to authenticated;

-- ------------------------------------------------------------------------ backfill ----
-- Existing internal-project deliverables are ownerless. Give them their job's PM where the job has
-- one; leave the rest alone rather than inventing an owner. A deliverable under a PM-less project
-- keeps showing a blank department, exactly as it does today — no worse, and honest.
--
-- Scoped to jobs under an INTERNAL client only. Ad-hoc deliverables are a different path
-- (ADR-0053 d.6 gives them their assignee) and campaign deliverables already have owners.
with filled as (
  update deliverables d
     set owner_user_id = j.owner_user_id
    from jobs j
    join clients c on c.id = j.client_id
   where d.job_id = j.id
     and c.is_internal
     and d.owner_user_id is null
     and j.owner_user_id is not null
  returning 1
)
select count(*) as internal_deliverables_given_their_pm from filled;

commit;
