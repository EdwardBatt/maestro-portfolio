-- ADR-0029 (I7.1 UI): create an internal project in one call. An internal project is a `job` owned
-- by an "internal client" (the tenant / a department / a team). This RPC get-or-creates that internal
-- client and creates the job (+ optional deliverables), so the UI never has to touch the fenced
-- internal-client rows directly. SECURITY DEFINER (it writes the internal client + job across RLS)
-- but gated on projects:manage — the same authority that sets up campaigns (Traffic Manager / Power
-- Admin). Returns the new job id.

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
      insert into deliverables (tenant_id, job_id, name) values (v_tenant, v_job, trim(d ->> 'name'));
    end if;
  end loop;

  return v_job;
end $$;

revoke execute on function public.create_internal_project(text, text, uuid, uuid, uuid, jsonb) from anon;
grant execute on function public.create_internal_project(text, text, uuid, uuid, uuid, jsonb) to authenticated;
