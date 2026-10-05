-- ADR-0009/0010: invoker-side scope helpers (pattern borrowed from esports-site's
-- per-team access functions; NOT its dynamic-RLS generator) + scoped WRITE policies.
-- Reads stay tenant-wide everywhere. Writes gain a scope gate for the scoped roles;
-- Scheduler/Power Admin (scope=tenant) are unaffected.
--
-- SCOPE OF THIS MIGRATION: sub_tasks (new), and the resource-linked scheduling writes
-- (bookings, blackouts, booking_series). The campaigns/streams/jobs/deliverables write
-- policies keep their grant-only form for now; scoping them to the Account Manager's
-- assigned campaigns is a documented follow-up (no scoped role is assigned in prod yet,
-- so nothing is mis-enforced in the interim).

-- ------------------------------------------------------------- helpers ----
create or replace function app.current_department_id() returns uuid
language sql stable as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'department_id', '')::uuid
$$;

create or replace function app.current_team_id() returns uuid
language sql stable as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'team_id', '')::uuid
$$;

-- The caller's role write-reach (source of truth: roles.scope). Reads roles under its
-- own tenant-select policy — no recursion with the data tables these policies guard.
create or replace function app.current_scope() returns text
language sql stable as $$
  select coalesce((select scope from public.roles where id = app.current_role_id()), 'self')
$$;

-- Is a row with this (department, team, responsible-AM) within the caller's WRITE scope?
create or replace function app.in_write_scope(p_department uuid, p_team uuid, p_account_manager uuid)
returns boolean language sql stable as $$
  select case app.current_scope()
    when 'tenant'     then true
    when 'department' then p_department is not null and p_department = app.current_department_id()
    when 'team'       then p_team is not null and p_team = app.current_team_id()
    when 'account'    then p_account_manager is not null and p_account_manager = auth.uid()
    else false                       -- 'self' handled by explicit owner predicates
  end
$$;

-- Scope a resource-linked write (bookings/blackouts/series) by the resource's dept/team.
create or replace function app.resource_in_write_scope(p_resource uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.resources r
    where r.id = p_resource
      and app.in_write_scope(r.department_id, r.team_id, null)
  )
$$;

-- Responsible Account Manager for a deliverable (campaign override, else client default).
create or replace function app.deliverable_account_manager(p_deliverable uuid)
returns uuid language sql stable as $$
  select coalesce(c.account_manager_id, cl.account_manager_id)
  from public.deliverables d
  left join public.streams s   on s.id = d.stream_id
  left join public.jobs j      on j.id = d.job_id
  left join public.campaigns c on c.id = coalesce(s.campaign_id, j.campaign_id)
  left join public.clients cl  on cl.id = coalesce(c.client_id, j.client_id)
  where d.id = p_deliverable
$$;

-- ----------------------------------------------------------- sub_tasks ----
-- Assign/manage (member + SLA + dates): the four management roles WITHIN their scope.
-- Team Member has no manage path here, but may progress a sub_task assigned to them.
create policy sub_tasks_manage_insert on sub_tasks
  for insert to authenticated
  with check (
    tenant_id = app.current_tenant_id()
    and app.has_permission('project_tasks', 'manage')
    and app.in_write_scope(department_id, team_id, app.deliverable_account_manager(deliverable_id))
  );

create policy sub_tasks_manage_update on sub_tasks
  for update to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and (
      (app.has_permission('project_tasks', 'manage')
         and app.in_write_scope(department_id, team_id, app.deliverable_account_manager(deliverable_id)))
      or assignee_id = auth.uid()
    )
  )
  with check (
    tenant_id = app.current_tenant_id()
    and (
      (app.has_permission('project_tasks', 'manage')
         and app.in_write_scope(department_id, team_id, app.deliverable_account_manager(deliverable_id)))
      or assignee_id = auth.uid()
    )
  );

create policy sub_tasks_manage_delete on sub_tasks
  for delete to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and app.has_permission('project_tasks', 'manage')
    and app.in_write_scope(department_id, team_id, app.deliverable_account_manager(deliverable_id))
  );

-- ---------------------------------------- bookings + blackouts (scoped) ----
drop policy bookings_scheduler_insert on bookings;
create policy bookings_scheduler_insert on bookings
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id()
    and app.has_permission('bookings', 'create')
    and app.resource_in_write_scope(resource_id));

drop policy bookings_scheduler_update on bookings;
create policy bookings_scheduler_update on bookings
  for update to authenticated
  using (tenant_id = app.current_tenant_id()
    and app.has_permission('bookings', 'update')
    and app.resource_in_write_scope(resource_id))
  with check (tenant_id = app.current_tenant_id()
    and app.has_permission('bookings', 'update')
    and app.resource_in_write_scope(resource_id));

drop policy bookings_scheduler_delete on bookings;
create policy bookings_scheduler_delete on bookings
  for delete to authenticated
  using (tenant_id = app.current_tenant_id()
    and app.has_permission('bookings', 'delete')
    and app.resource_in_write_scope(resource_id));

drop policy resource_unavailability_scheduler_write on resource_unavailability;
create policy resource_unavailability_scheduler_write on resource_unavailability
  for all to authenticated
  using (tenant_id = app.current_tenant_id()
    and app.has_permission('blackouts', 'manage')
    and app.resource_in_write_scope(resource_id))
  with check (tenant_id = app.current_tenant_id()
    and app.has_permission('blackouts', 'manage')
    and app.resource_in_write_scope(resource_id));

drop policy booking_series_scheduler_write on booking_series;
create policy booking_series_scheduler_write on booking_series
  for all to authenticated
  using (tenant_id = app.current_tenant_id()
    and app.has_permission('bookings', 'create')
    and app.resource_in_write_scope(resource_id))
  with check (tenant_id = app.current_tenant_id()
    and app.has_permission('bookings', 'create')
    and app.resource_in_write_scope(resource_id));
