-- Team Leader role + role WRITE-scope (ADR-0008).
--
-- Reads stay tenant-wide for every role; `scope` limits only what a role may
-- WRITE (create/edit/approve). tenant = whole org, department = own department,
-- team = own team, self = only own rows. Power Admin & Scheduler are tenant;
-- Department Lead = department; Team Leader = team; Team Member = self.
--
-- The scope PREDICATES live on write policies in the companion migration; this
-- migration only records each role's scope and introduces the Team Leader role.

alter table roles
  add column scope text not null default 'tenant'
    check (scope in ('tenant', 'department', 'team', 'self'));

comment on column roles.scope is
  'WRITE reach of this role: tenant | department | team | self. Reads are always tenant-wide; write policies consult this via app.in_write_scope().';

create or replace function app.seed_tenant_roles(p_tenant uuid) returns void
language plpgsql as $$
declare
  v_power uuid; v_sched uuid; v_lead uuid; v_teamlead uuid; v_member uuid; v_portal uuid;
begin
  perform set_config('app.system_op', 'on', true);

  insert into roles (tenant_id, key, name, description, is_system, default_route, scope) values
    (p_tenant, 'power_admin',     'Power Admin',     'Full access — holds every grant, automatically including future ones', true,  '/admin',    'tenant'),
    (p_tenant, 'client_portal',   'Client Portal',   'External client access — fixed portal-only grants',                    true,  '/portal',   'self'),
    (p_tenant, 'scheduler',       'Scheduler',       'Plans and manages bookings across the whole organization',             false, '/schedule', 'tenant'),
    (p_tenant, 'department_lead', 'Department Lead', 'Sees the org; approves and manages within their department',           false, '/team',     'department'),
    (p_tenant, 'team_lead',       'Team Leader',     'Sees the org; approves and manages within their team',                 false, '/team',     'team'),
    (p_tenant, 'team_member',     'Team Member',     'Sees own calendar and tasks; works own deliverables',                  false, '/my-work',  'self')
  on conflict (tenant_id, key) do nothing;

  select id into v_power    from roles where tenant_id = p_tenant and key = 'power_admin';
  select id into v_sched    from roles where tenant_id = p_tenant and key = 'scheduler';
  select id into v_lead     from roles where tenant_id = p_tenant and key = 'department_lead';
  select id into v_teamlead from roles where tenant_id = p_tenant and key = 'team_lead';
  select id into v_member   from roles where tenant_id = p_tenant and key = 'team_member';
  select id into v_portal   from roles where tenant_id = p_tenant and key = 'client_portal';

  -- Power Admin: the whole catalog.
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_power, resource, action from permission_catalog
  on conflict do nothing;

  -- Scheduler (tenant-wide).
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_sched, r, a from (values
    ('schedule','view'), ('my_calendar','view'), ('my_tasks','view'),
    ('project_calendar','view'), ('month_overview','view'), ('bookings_table','view'),
    ('bookings','create'), ('bookings','update'), ('bookings','delete'), ('bookings','export'),
    ('blackouts','manage'), ('projects','manage'), ('project_tasks','manage'), ('media','manage')
  ) as g(r, a)
  on conflict do nothing;

  -- Department Lead: scheduler abilities + approvals + audit + review moderation,
  -- but scoped to their department by write policies (grants are the same set).
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_lead, resource, action from role_grants
  where role_id = v_sched
  on conflict do nothing;
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_lead, r, a from (values
    ('bookings','approve'), ('audit','view'), ('reviews','moderate'), ('team','view')
  ) as g(r, a)
  on conflict do nothing;

  -- Team Leader: team surface + scheduling + approvals, scoped to their team.
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_teamlead, r, a from (values
    ('team','view'), ('schedule','view'), ('my_calendar','view'), ('my_tasks','view'),
    ('project_calendar','view'), ('month_overview','view'), ('bookings_table','view'),
    ('bookings','create'), ('bookings','update'), ('bookings','approve'),
    ('project_tasks','manage')
  ) as g(r, a)
  on conflict do nothing;

  -- Team Member.
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_member, r, a from (values
    ('my_calendar','view'), ('my_tasks','view'),
    ('project_tasks','manage'), ('media','manage')
  ) as g(r, a)
  on conflict do nothing;

  -- Client Portal: fixed, minimal.
  insert into role_grants (tenant_id, role_id, resource, action)
  values (p_tenant, v_portal, 'portal', 'view')
  on conflict do nothing;

  perform set_config('app.system_op', 'off', true);
end $$;

-- Backfill scope on roles that already exist (seed's on-conflict won't update them).
-- Non-system roles only need touching; system roles keep the column default 'tenant'
-- (client_portal set below under system_op since the protect trigger guards it).
update roles set scope = 'department' where key = 'department_lead';
update roles set scope = 'team'       where key = 'team_lead';
update roles set scope = 'self'       where key = 'team_member';
do $$ begin
  perform set_config('app.system_op', 'on', true);
  update roles set scope = 'self' where key = 'client_portal';
  perform set_config('app.system_op', 'off', true);
end $$;

-- Backfill: add Team Leader (and its grants) to every existing tenant. Idempotent.
select app.seed_tenant_roles(id) from tenants;
