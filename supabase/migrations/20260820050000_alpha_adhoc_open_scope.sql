-- TEMPORARY (alpha): open ad-hoc task assignment to match the wide-open schedule (TMP.1 extension).
--
-- TMP.1 (migration 20260820040000) relaxed the SCHEDULER so any internal user can view + edit any
-- booking: it blanket-granted schedule:view + bookings:create/update/delete and dropped the
-- write-scope checks from the three booking-write RLS policies. But assigning an *ad-hoc task* on a
-- person does NOT go through those booking policies — the scheduler calls the SECURITY DEFINER RPC
-- public.create_adhoc_deliverable (ADR-0035), which runs its OWN scope gate
-- (project_tasks:manage AND app.in_write_scope(assignee dept/team)). Since that RPC bypasses RLS, the
-- TMP.1 relaxation never reached it — so a Team Member (scope 'self') assigning an ad-hoc task to
-- anyone outside their own team still hit `42501 assigning this task is outside your scope`, which the
-- BookingDialog surfaces as schedule.outOfScope ("outside your write scope…"). Edward hit this in the
-- alpha where all users are meant to be able to assign schedule work freely.
--
-- This migration relaxes the RPC to match TMP.1: keep the project_tasks:manage GRANT gate, drop the
-- in_write_scope check, so any grant-holder can assign an ad-hoc task to any assignee IN THEIR TENANT.
-- Tenant isolation is preserved (and now made explicit): the assignee must belong to the caller's
-- tenant, else the RPC rejects. Everything else (reviewer check, Ad-hoc job get-or-create, the
-- deliverable + sub-task inserts) is unchanged from 20260820010000.
--
-- REVERT PATH when the alpha ends (paired with the TMP.1 revert): restore the combined guard
--   `if not (app.has_permission('project_tasks','manage') and app.in_write_scope(v_dept, v_team, null))`
-- from migration 20260820010000 (drop the grant-only gate + the explicit same-tenant check re-added
-- here — in_write_scope implies same-tenant). See docs/TASKS.md TMP.1.

create or replace function public.create_adhoc_deliverable(
  p_assignee   uuid,
  p_title      text,
  p_hours      numeric,
  p_starts_at  timestamptz,
  p_due_at     timestamptz,
  p_reviewer   uuid default null
) returns table(sub_task_id uuid, deliverable_id uuid)
language plpgsql security definer set search_path = public, app as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_dept uuid; v_team uuid;
  v_client uuid; v_job uuid; v_deliv uuid; v_sub uuid;
begin
  if coalesce(trim(p_title), '') = '' then
    raise exception 'a task title is required' using errcode = '22023';
  end if;
  if p_assignee is null then
    raise exception 'an assignee is required' using errcode = '22023';
  end if;

  -- TEMPORARY (alpha, TMP.1 extension): scope relaxed to grant-only — any project_tasks:manage holder
  -- may assign an ad-hoc task. The per-assignee in_write_scope check is dropped (revert restores it).
  if not app.has_permission('project_tasks', 'manage') then
    raise exception 'assigning this task requires project-task management permission' using errcode = '42501';
  end if;

  -- Tenant isolation stays structural: the assignee must belong to the caller's tenant. (Previously
  -- implied by in_write_scope; made explicit now that the scope check is relaxed.)
  select department_id, team_id into v_dept, v_team
  from user_profiles where id = p_assignee and tenant_id = v_tenant;
  if not found then
    raise exception 'that assignee is not in your organization' using errcode = '22023';
  end if;

  -- a named reviewer must be able to sign off (reviews:moderate is required to approve a deliverable).
  if p_reviewer is not null and not exists (
    select 1 from role_grants rg
    join user_profiles up on up.role_id = rg.role_id
    where up.id = p_reviewer and up.tenant_id = v_tenant
      and rg.resource = 'reviews' and rg.action = 'moderate'
  ) then
    raise exception 'the chosen reviewer cannot moderate reviews' using errcode = '22023';
  end if;

  -- get-or-create the tenant-level "Ad-hoc" internal client + job (fenced from external surfaces).
  select id into v_client from clients
    where tenant_id = v_tenant and is_internal and internal_kind = 'tenant' limit 1;
  if v_client is null then
    insert into clients (tenant_id, name, is_internal, internal_kind)
    values (v_tenant, 'Internal', true, 'tenant') returning id into v_client;
  end if;
  select id into v_job from jobs
    where tenant_id = v_tenant and client_id = v_client and name = 'Ad-hoc assignments' limit 1;
  if v_job is null then
    insert into jobs (tenant_id, client_id, name)
    values (v_tenant, v_client, 'Ad-hoc assignments') returning id into v_job;
  end if;

  insert into deliverables (tenant_id, job_id, name, state, reviewer_id, due_at)
  values (v_tenant, v_job, trim(p_title), 'in_progress', p_reviewer, p_due_at)
  returning id into v_deliv;

  insert into sub_tasks (tenant_id, deliverable_id, department_id, team_id, assignee_id,
                         title, sla_hours, starts_at, due_at, status, created_by)
  values (v_tenant, v_deliv, v_dept, v_team, p_assignee,
          trim(p_title), p_hours, p_starts_at, p_due_at, 'todo', auth.uid())
  returning id into v_sub;

  sub_task_id := v_sub; deliverable_id := v_deliv; return next;
end $$;

comment on function public.create_adhoc_deliverable(uuid, text, numeric, timestamptz, timestamptz, uuid) is
  'ADR-0035: create an ad-hoc reviewable deliverable + its sub-task under the tenant Ad-hoc job, with '
  'an assigner-chosen reviewer. TEMPORARY alpha (TMP.1 ext): gated project_tasks:manage only '
  '(in_write_scope dropped); assignee must be same-tenant. Revert restores the in_write_scope gate.';

-- execute grant is unchanged (authenticated only); re-assert for clarity.
revoke execute on function public.create_adhoc_deliverable(uuid, text, numeric, timestamptz, timestamptz, uuid) from public;
grant  execute on function public.create_adhoc_deliverable(uuid, text, numeric, timestamptz, timestamptz, uuid) to authenticated;
