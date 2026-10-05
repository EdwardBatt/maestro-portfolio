-- ADR-0029 (I7.1): internal projects, role rename, per-project PM.
--
-- Internal projects are light `job`s owned by an "internal client" (the tenant, a department, or a
-- team) — `clients.client_id` stays NOT NULL everywhere, so deliverables/sub-tasks/SLA/AM are
-- unchanged. SETUP authority is the org-wide **Traffic Manager** (the Scheduler role's official
-- title) and Power Admin: both already hold tenant-wide `projects:manage`, so the existing jobs
-- write policy already lets them create an internal job — NO new grant, NO jobs-policy change.
-- Each internal project appoints a **Project Manager** (the job's `owner_user_id`); the PM gets
-- manage authority over THAT project's sub-tasks regardless of department, so a multi-department
-- project is coordinated by one appointed person without org-wide admin rights.

-- ---- 1. clients: internal ownership (nothing becomes nullable) ----
alter table clients add column is_internal            boolean not null default false;
alter table clients add column internal_kind          text check (internal_kind in ('tenant','department','team'));
alter table clients add column internal_department_id uuid references departments(id);
alter table clients add column internal_team_id       uuid references teams(id);

alter table clients add constraint chk_clients_internal_shape check (
  (not is_internal and internal_kind is null and internal_department_id is null and internal_team_id is null)
  or (is_internal and internal_kind = 'tenant'     and internal_department_id is null and internal_team_id is null)
  or (is_internal and internal_kind = 'department' and internal_department_id is not null and internal_team_id is null)
  or (is_internal and internal_kind = 'team'       and internal_team_id is not null and internal_department_id is null)
);
create unique index uq_clients_internal_tenant     on clients (tenant_id)                        where is_internal and internal_kind = 'tenant';
create unique index uq_clients_internal_department on clients (tenant_id, internal_department_id) where internal_kind = 'department';
create unique index uq_clients_internal_team       on clients (tenant_id, internal_team_id)       where internal_kind = 'team';
comment on column clients.is_internal is
  'ADR-0029: true = an internal client (the tenant/department/team owns internal projects). Fenced out of external-client surfaces.';

create or replace function app.is_internal_client(p_client uuid)
returns boolean language sql stable as $$
  select coalesce((select is_internal from public.clients where id = p_client), false)
$$;

-- ---- 2. rename the Scheduler role to its official title, Traffic Manager (key stays 'scheduler') ----
-- Reproduces the authoritative seeder (20260816110000) with the display name changed, so future
-- tenants get "Traffic Manager". No grant changes: leads do NOT get internal-project authority;
-- setup is the tenant-wide Traffic Manager / Power Admin via their existing projects:manage.
create or replace function app.seed_tenant_roles(p_tenant uuid) returns void
language plpgsql as $$
declare
  v_power uuid; v_sched uuid; v_am uuid; v_lead uuid; v_teamlead uuid; v_member uuid; v_portal uuid;
  v_ceo uuid; v_coo uuid; v_cfo uuid; v_deputy uuid;
begin
  perform set_config('app.system_op', 'on', true);

  insert into roles (tenant_id, key, name, description, is_system, default_route, scope) values
    (p_tenant, 'power_admin',      'Power Admin',         'Full access — holds every grant, automatically including future ones', true,  '/admin',    'tenant'),
    (p_tenant, 'client_portal',    'Client Portal',       'External client access — fixed portal-only grants',                    true,  '/portal',   'self'),
    (p_tenant, 'scheduler',        'Traffic Manager',     'Traffic management — plans and coordinates bookings and projects across the whole organization', false, '/schedule', 'tenant'),
    (p_tenant, 'account_manager',  'Account Manager',     'Owns assigned campaigns; client liaison; assigns/coordinates within their accounts', false, '/schedule', 'account'),
    (p_tenant, 'department_lead',  'Department Lead',     'Sees the org; approves and manages within their department',           false, '/team',     'department'),
    (p_tenant, 'team_lead',        'Team Leader',         'Sees the org; approves and manages within their team',                 false, '/team',     'team'),
    (p_tenant, 'deputy_team_lead', 'Deputy Team Leader',  'Stands in for the Team Leader — same authority, scoped to the team (ADR-0017)', false, '/team', 'team'),
    (p_tenant, 'team_member',      'Team Member',         'Sees own calendar and tasks; works own deliverables',                  false, '/my-work',  'self'),
    (p_tenant, 'ceo',              'CEO',                 'Executive oversight — reads across the whole organization (no administration)', false, '/admin', 'tenant'),
    (p_tenant, 'coo',              'COO',                 'Operations oversight — org-wide read plus booking approval',           false, '/admin',    'tenant'),
    (p_tenant, 'cfo',              'CFO',                 'Finance oversight — cost/rate and organization read, booking export',  false, '/admin',    'tenant')
  on conflict (tenant_id, key) do nothing;

  select id into v_power    from roles where tenant_id = p_tenant and key = 'power_admin';
  select id into v_sched    from roles where tenant_id = p_tenant and key = 'scheduler';
  select id into v_am       from roles where tenant_id = p_tenant and key = 'account_manager';
  select id into v_lead     from roles where tenant_id = p_tenant and key = 'department_lead';
  select id into v_teamlead from roles where tenant_id = p_tenant and key = 'team_lead';
  select id into v_deputy   from roles where tenant_id = p_tenant and key = 'deputy_team_lead';
  select id into v_member   from roles where tenant_id = p_tenant and key = 'team_member';
  select id into v_portal   from roles where tenant_id = p_tenant and key = 'client_portal';
  select id into v_ceo      from roles where tenant_id = p_tenant and key = 'ceo';
  select id into v_coo      from roles where tenant_id = p_tenant and key = 'coo';
  select id into v_cfo      from roles where tenant_id = p_tenant and key = 'cfo';

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_power, resource, action from permission_catalog on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_sched, r, a from (values
    ('schedule','view'),('my_calendar','view'),('my_tasks','view'),
    ('project_calendar','view'),('month_overview','view'),('bookings_table','view'),
    ('bookings','create'),('bookings','update'),('bookings','delete'),('bookings','export'),
    ('blackouts','manage'),('projects','manage'),('project_tasks','manage'),('media','manage'),
    ('clients','view')
  ) as g(r,a) on conflict do nothing;

  -- Account Manager (scope=account): owns campaigns, oversight views + project exception
  -- feed, and (ADR-0021) registers/maintains clients.
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_am, r, a from (values
    ('schedule','view'),('project_calendar','view'),('month_overview','view'),
    ('bookings_table','view'),('team','view'),('exceptions','view'),
    ('projects','manage'),('project_tasks','manage'),
    ('clients','view'),('clients','manage')
  ) as g(r,a) on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_lead, resource, action from role_grants where role_id = v_sched on conflict do nothing;
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_lead, r, a from (values
    ('bookings','approve'),('audit','view'),('reviews','moderate'),('team','view'),('exceptions','view')
  ) as g(r,a) on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_teamlead, r, a from (values
    ('team','view'),('schedule','view'),('my_calendar','view'),('my_tasks','view'),
    ('project_calendar','view'),('month_overview','view'),('bookings_table','view'),
    ('bookings','create'),('bookings','update'),('bookings','approve'),
    ('project_tasks','manage'),('exceptions','view')
  ) as g(r,a) on conflict do nothing;

  -- Deputy Team Leader = exact clone of Team Leader (ADR-0017).
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_deputy, resource, action from role_grants where role_id = v_teamlead on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_member, r, a from (values
    ('my_calendar','view'),('my_tasks','view'),('project_tasks','manage'),('media','manage')
  ) as g(r,a) on conflict do nothing;

  -- CEO — full read across the org + health; NO administration, NO *:manage.
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_ceo, r, a from (values
    ('admin.users','view'),('admin.resources','view'),('admin.organization','view'),('admin.roles','view'),
    ('schedule','view'),('project_calendar','view'),('month_overview','view'),('bookings_table','view'),
    ('team','view'),('audit','view'),('rates','view'),('health','view')
  ) as g(r,a) on conflict do nothing;

  -- COO — operations oversight: org-wide read + health + booking approval.
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_coo, r, a from (values
    ('admin.users','view'),('admin.resources','view'),('admin.organization','view'),
    ('schedule','view'),('project_calendar','view'),('month_overview','view'),('bookings_table','view'),
    ('team','view'),('audit','view'),('bookings','approve'),('health','view')
  ) as g(r,a) on conflict do nothing;

  -- CFO — finance posture: cost/rate + organization read, export, health.
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_cfo, r, a from (values
    ('admin.organization','view'),('admin.resources','view'),
    ('schedule','view'),('month_overview','view'),('bookings_table','view'),
    ('rates','view'),('bookings','export'),('health','view')
  ) as g(r,a) on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  values (p_tenant, v_portal, 'portal', 'view') on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, id, 'directory', 'view'
  from roles where tenant_id = p_tenant and key <> 'client_portal'
  on conflict do nothing;

  perform set_config('app.system_op', 'off', true);
end $$;

select app.seed_tenant_roles(id) from tenants;

-- backfill the display name on existing tenants' Scheduler rows (seed's on-conflict won't update)
do $$ begin
  perform set_config('app.system_op', 'on', true);
  update roles set name = 'Traffic Manager',
    description = 'Traffic management — plans and coordinates bookings and projects across the whole organization'
    where key = 'scheduler';
  perform set_config('app.system_op', 'off', true);
end $$;

-- ---- 3. per-project PM: the internal project (job) owner may manage its sub-tasks org-wide ----
-- The PM is `jobs.owner_user_id`. This helper is general (any job owner); for internal projects it
-- is the appointed PM, letting them coordinate the project's sub-tasks ACROSS departments without
-- org-wide admin rights (their authority is bounded to their own project).
create or replace function app.caller_is_project_pm(p_deliverable uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.deliverables d join public.jobs j on j.id = d.job_id
    where d.id = p_deliverable and j.owner_user_id = auth.uid()
  )
$$;
comment on function app.caller_is_project_pm(uuid) is
  'ADR-0029: is the caller the appointed PM (owner_user_id) of the job this deliverable belongs to? Grants project-scoped sub-task authority across departments.';

-- extend the sub_tasks manage policies with a PM branch (project-scoped, no in_write_scope limit)
drop policy sub_tasks_manage_insert on sub_tasks;
create policy sub_tasks_manage_insert on sub_tasks
  for insert to authenticated
  with check (
    tenant_id = app.current_tenant_id()
    and (
      (app.has_permission('project_tasks', 'manage')
        and app.in_write_scope(department_id, team_id, app.deliverable_account_manager(deliverable_id)))
      or app.caller_is_project_pm(deliverable_id)
    )
  );

drop policy sub_tasks_manage_update on sub_tasks;
create policy sub_tasks_manage_update on sub_tasks
  for update to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and (
      (app.has_permission('project_tasks', 'manage')
        and app.in_write_scope(department_id, team_id, app.deliverable_account_manager(deliverable_id)))
      or assignee_id = auth.uid()
      or app.caller_is_project_pm(deliverable_id)
    )
  )
  with check (
    tenant_id = app.current_tenant_id()
    and (
      (app.has_permission('project_tasks', 'manage')
        and app.in_write_scope(department_id, team_id, app.deliverable_account_manager(deliverable_id)))
      or assignee_id = auth.uid()
      or app.caller_is_project_pm(deliverable_id)
    )
  );

drop policy sub_tasks_manage_delete on sub_tasks;
create policy sub_tasks_manage_delete on sub_tasks
  for delete to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and (
      (app.has_permission('project_tasks', 'manage')
        and app.in_write_scope(department_id, team_id, app.deliverable_account_manager(deliverable_id)))
      or app.caller_is_project_pm(deliverable_id)
    )
  );
