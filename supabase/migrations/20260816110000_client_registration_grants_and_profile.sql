-- ADR-0021: Client Registration becomes a Client-Services surface, and the
-- performance-marketing intake splits into a durable client profile + a per-campaign
-- performance brief. This migration does the data/RBAC half:
--
--   1) clients.profile jsonb — the general business profile (authored once, inherited
--      by every brief). Required core (name + what-they-sell + business types) lives
--      here alongside the optional/conditional sections; additive, backward-safe.
--   2) Two new grants split viewing from writing clients:
--        clients:view   → sees the Client Registration surface + list (read-only).
--                         Seeded to Account Manager, Scheduler, Power Admin; tunable
--                         to any role via the Roles screen ("so others can be added").
--        clients:manage → registers/edits clients + brands. Seeded to Account Manager
--                         (Client Services) + Power Admin.
--      The clients/brands WRITE policies move off organization:manage onto
--      clients:manage. Reads stay tenant-wide (clients_tenant_select unchanged), so
--      clients:view only governs surface visibility, never data access.

alter table clients add column if not exists profile jsonb;
comment on column clients.profile is
  'ADR-0021: general business profile (authored once, inherited by briefs). Includes businessTypes + the durable half of the performance intake.';

-- 1. New permissions (before any grant references them — role_grants FKs the catalog).
--    The grant_new_catalog_to_power_admin trigger grants both to every existing
--    tenant''s Power Admin automatically; the seeder below is idempotent regardless.
insert into permission_catalog (resource, action, description) values
  ('clients', 'view',   'See the Client Registration surface and client list (read-only, ADR-0021)'),
  ('clients', 'manage', 'Register and edit clients + brands (Client Services, ADR-0021)')
on conflict (resource, action) do nothing;

-- 2. Re-define the seeder with the two client grants folded into the relevant roles.
--    Based on 20260815120000 (latest), adding: clients:view → Scheduler + Account
--    Manager (+ Power Admin via the catalog select); clients:manage → Account Manager.
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
    (p_tenant, 'scheduler',        'Scheduler',           'Plans and manages bookings across the whole organization',             false, '/schedule', 'tenant'),
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

  -- Company directory (ADR-0017): every internal role; external client_portal excluded.
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, id, 'directory', 'view'
  from roles where tenant_id = p_tenant and key <> 'client_portal'
  on conflict do nothing;

  perform set_config('app.system_op', 'off', true);
end $$;

-- 3. Re-seed every existing tenant (idempotent — adds the client grants only).
select app.seed_tenant_roles(id) from tenants;

-- 4. Repoint the clients/brands WRITE policies onto clients:manage (ADR-0021).
--    Reads (clients_tenant_select / brands_tenant_select) stay tenant-wide.
drop policy clients_admin_write on clients;
create policy clients_admin_write on clients
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('clients', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('clients', 'manage'));

drop policy brands_admin_write on brands;
create policy brands_admin_write on brands
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('clients', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('clients', 'manage'));
