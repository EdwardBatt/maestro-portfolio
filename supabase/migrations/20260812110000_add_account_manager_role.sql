-- ADR-0009: Account Manager becomes a seeded starter role (write scope = 'account',
-- i.e. campaigns assigned to them). Also widens roles.scope to allow 'account'.
-- Reconciles the interim 20260812100100 push (which lacked AM and the 'account' value).
-- Idempotent; grants are admin-tunable afterwards via the Roles screen (ADR-0008).

alter table roles drop constraint if exists roles_scope_check;
alter table roles add constraint roles_scope_check
  check (scope in ('tenant', 'department', 'team', 'account', 'self'));

create or replace function app.seed_tenant_roles(p_tenant uuid) returns void
language plpgsql as $$
declare
  v_power uuid; v_sched uuid; v_am uuid; v_lead uuid; v_teamlead uuid; v_member uuid; v_portal uuid;
begin
  perform set_config('app.system_op', 'on', true);

  insert into roles (tenant_id, key, name, description, is_system, default_route, scope) values
    (p_tenant, 'power_admin',     'Power Admin',     'Full access — holds every grant, automatically including future ones', true,  '/admin',    'tenant'),
    (p_tenant, 'client_portal',   'Client Portal',   'External client access — fixed portal-only grants',                    true,  '/portal',   'self'),
    (p_tenant, 'scheduler',       'Scheduler',       'Plans and manages bookings across the whole organization',             false, '/schedule', 'tenant'),
    (p_tenant, 'account_manager', 'Account Manager', 'Owns assigned campaigns; client liaison; assigns/coordinates within their accounts', false, '/schedule', 'account'),
    (p_tenant, 'department_lead', 'Department Lead', 'Sees the org; approves and manages within their department',           false, '/team',     'department'),
    (p_tenant, 'team_lead',       'Team Leader',     'Sees the org; approves and manages within their team',                 false, '/team',     'team'),
    (p_tenant, 'team_member',     'Team Member',     'Sees own calendar and tasks; works own deliverables',                  false, '/my-work',  'self')
  on conflict (tenant_id, key) do nothing;

  select id into v_power    from roles where tenant_id = p_tenant and key = 'power_admin';
  select id into v_sched    from roles where tenant_id = p_tenant and key = 'scheduler';
  select id into v_am       from roles where tenant_id = p_tenant and key = 'account_manager';
  select id into v_lead     from roles where tenant_id = p_tenant and key = 'department_lead';
  select id into v_teamlead from roles where tenant_id = p_tenant and key = 'team_lead';
  select id into v_member   from roles where tenant_id = p_tenant and key = 'team_member';
  select id into v_portal   from roles where tenant_id = p_tenant and key = 'client_portal';

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_power, resource, action from permission_catalog on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_sched, r, a from (values
    ('schedule','view'),('my_calendar','view'),('my_tasks','view'),
    ('project_calendar','view'),('month_overview','view'),('bookings_table','view'),
    ('bookings','create'),('bookings','update'),('bookings','delete'),('bookings','export'),
    ('blackouts','manage'),('projects','manage'),('project_tasks','manage'),('media','manage')
  ) as g(r,a) on conflict do nothing;

  -- Account Manager (scope=account, enforced by policy in the next migration):
  -- owns their campaigns, assigns/coordinates sub-tasks, oversight views.
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_am, r, a from (values
    ('schedule','view'),('project_calendar','view'),('month_overview','view'),
    ('bookings_table','view'),('team','view'),
    ('projects','manage'),('project_tasks','manage')
  ) as g(r,a) on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_lead, resource, action from role_grants where role_id = v_sched on conflict do nothing;
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_lead, r, a from (values
    ('bookings','approve'),('audit','view'),('reviews','moderate'),('team','view')
  ) as g(r,a) on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_teamlead, r, a from (values
    ('team','view'),('schedule','view'),('my_calendar','view'),('my_tasks','view'),
    ('project_calendar','view'),('month_overview','view'),('bookings_table','view'),
    ('bookings','create'),('bookings','update'),('bookings','approve'),
    ('project_tasks','manage')
  ) as g(r,a) on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_member, r, a from (values
    ('my_calendar','view'),('my_tasks','view'),('project_tasks','manage'),('media','manage')
  ) as g(r,a) on conflict do nothing;

  insert into role_grants (tenant_id, role_id, resource, action)
  values (p_tenant, v_portal, 'portal', 'view') on conflict do nothing;

  perform set_config('app.system_op', 'off', true);
end $$;

update roles set scope = 'account' where key = 'account_manager';
select app.seed_tenant_roles(id) from tenants;
