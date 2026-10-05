-- L1.8 (ADR-0008): configurable RBAC core — catalog, roles, grants, helpers.
--
-- Three pieces:
--   permission_catalog  platform vocabulary of resource × action (reference data,
--                       like an enum; NOT tenant-scoped — exception documented in
--                       pgTAP 001 alongside tenants/joint_projects)
--   roles               tenant-scoped, admin-manageable rows. Power Admin +
--                       Client Portal are is_system (protected by trigger).
--   role_grants         deny-by-default matrix: a grant row EXISTS or the answer
--                       is no. Power Admin holds the full catalog and is kept
--                       complete automatically by trigger when the catalog grows.
--
-- app.has_permission() replaces app.is_admin() in every policy (rewrite is the
-- companion migration 20260802102000). No SECURITY DEFINER anywhere: the helper
-- runs as the caller; role_grants' select policy is a plain tenant check, so
-- there is no recursion and no privilege escalation path.
--
-- System-role writes are fenced by a transaction-local GUC (app.system_op) that
-- only the seeding/maintenance functions set — an admin cannot delete Power
-- Admin, edit Client Portal's fixed grants, or mint a new is_system role.

-- ---------------------------------------------------------------- catalog --
create table permission_catalog (
  resource    text not null,
  action      text not null check (action in
                ('view', 'create', 'update', 'delete', 'approve', 'export', 'manage', 'moderate')),
  description text not null,
  created_at  timestamptz not null default now(),
  primary key (resource, action)
);

alter table permission_catalog enable row level security;
alter table permission_catalog force row level security;

-- Everyone signed-in may read the vocabulary (the rules screen needs it);
-- writes are migrations/service only — deny by default.
create policy permission_catalog_tenant_select on permission_catalog
  for select to authenticated using (true);

insert into permission_catalog (resource, action, description) values
  -- view grants: screens/surfaces (grant opens the window; data policies still apply)
  ('schedule',           'view',    'Master booking grid'),
  ('my_calendar',        'view',    'Personal calendar of own linked resource'),
  ('my_tasks',           'view',    'Personal task list'),
  ('project_calendar',   'view',    'Per-project calendar'),
  ('month_overview',     'view',    'Month density overview'),
  ('bookings_table',     'view',    'Bookings table / task list views'),
  ('admin.users',        'view',    'Admin: users screen'),
  ('admin.resources',    'view',    'Admin: resources screen'),
  ('admin.organization', 'view',    'Admin: offices, departments, clients, projects'),
  ('admin.roles',        'view',    'Admin: roles & permissions screen'),
  ('team',               'view',    'Team lead surface (load & exceptions)'),
  ('portal',             'view',    'Client portal surface'),
  -- action grants: data abilities
  ('bookings',           'create',  'Create bookings (incl. series)'),
  ('bookings',           'update',  'Move/edit bookings'),
  ('bookings',           'delete',  'Cancel/delete bookings'),
  ('bookings',           'approve', 'Approve/reject requires-approval bookings'),
  ('bookings',           'export',  'Export booking data (CSV)'),
  ('blackouts',          'manage',  'Manage leave/maintenance/holiday blackouts'),
  ('projects',           'manage',  'Create/edit campaigns, streams, ad-hoc jobs'),
  ('project_tasks',      'manage',  'Create/edit deliverables (tasks)'),
  ('media',              'manage',  'Manage media records'),
  ('reviews',            'moderate','Resolve/edit any review feedback'),
  ('resources',          'manage',  'Create/edit resources'),
  ('rates',              'view',    'See resource cost/charge rates'),
  ('organization',       'manage',  'Manage offices, departments, clients, work config'),
  ('users',              'manage',  'Invite/update/deactivate users'),
  ('roles',              'manage',  'Create roles and edit permission grants'),
  ('audit',              'view',    'Read the audit trail'),
  ('joint_projects',     'manage',  'Manage joint projects and cross-tenant grants');

-- ------------------------------------------------------------------ roles --
create table roles (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  key           text not null,          -- stable slug; immutable (trigger)
  name          text not null,          -- display name; editable
  description   text,
  is_system     boolean not null default false,
  default_route text not null default '/my-work',
  status        text not null default 'active' check (status in ('active', 'archived')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint uq_roles_tenant_key unique (tenant_id, key)
);
create index idx_roles_tenant_id on roles (tenant_id);

alter table roles enable row level security;
alter table roles force row level security;

create policy roles_tenant_select on roles
  for select to authenticated
  using (tenant_id = app.current_tenant_id());
-- write policies are created in 20260802102000 (they need app.has_permission,
-- and grants must be seeded first) — until then: deny by default.

create trigger set_updated_at before update on roles
  for each row execute function app.set_updated_at();

-- ------------------------------------------------------------ role_grants --
create table role_grants (
  tenant_id  uuid not null references tenants(id),
  role_id    uuid not null references roles(id) on delete cascade,
  resource   text not null,
  action     text not null,
  created_at timestamptz not null default now(),
  primary key (role_id, resource, action),
  foreign key (resource, action) references permission_catalog (resource, action)
);
create index idx_role_grants_tenant_id on role_grants (tenant_id);

alter table role_grants enable row level security;
alter table role_grants force row level security;

-- Plain tenant read — MUST stay grant-free: app.has_permission() selects from
-- this table, so a grant-based select policy here would recurse.
create policy role_grants_tenant_select on role_grants
  for select to authenticated
  using (tenant_id = app.current_tenant_id());
-- write policies in 20260802102000, same reason as roles.

-- -------------------------------------------------------------- helpers ---
create or replace function app.current_role_id() returns uuid
language sql stable as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'app_role_id', '')::uuid
$$;

-- THE authorization primitive (ADR-0008): does the caller's role hold this
-- grant in the caller's tenant? Runs as the caller under RLS; fail-closed.
create or replace function app.has_permission(p_resource text, p_action text)
returns boolean
language sql stable as $$
  select exists (
    select 1 from public.role_grants rg
    where rg.role_id  = app.current_role_id()
      and rg.tenant_id = app.current_tenant_id()
      and rg.resource = p_resource
      and rg.action   = p_action
  )
$$;

create or replace function app.is_system_op() returns boolean
language sql stable as $$
  select coalesce(current_setting('app.system_op', true), '') = 'on'
$$;

-- --------------------------------------------------- system-role fencing --
create or replace function app.protect_system_roles() returns trigger
language plpgsql as $$
begin
  if app.is_system_op() then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' and new.is_system then
    raise exception 'system roles are created by the platform only';
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.is_system then
    if tg_op = 'DELETE' then
      raise exception 'system role % cannot be deleted', old.key;
    end if;
    if new.key <> old.key or new.is_system <> old.is_system or new.status <> old.status then
      raise exception 'system role % key/system/status are immutable', old.key;
    end if;
  end if;
  if tg_op = 'UPDATE' and new.key <> old.key then
    raise exception 'role keys are immutable (rename via the name field)';
  end if;
  return coalesce(new, old);
end $$;

create trigger protect_system_roles
  before insert or update or delete on roles
  for each row execute function app.protect_system_roles();

create or replace function app.protect_system_role_grants() returns trigger
language plpgsql as $$
declare v_key text; v_is_system boolean;
begin
  if app.is_system_op() then
    return coalesce(new, old);
  end if;
  select r.key, r.is_system into v_key, v_is_system
    from roles r where r.id = coalesce(new.role_id, old.role_id);
  if v_is_system then
    raise exception 'grants of system role % are managed by the platform', v_key;
  end if;
  return coalesce(new, old);
end $$;

create trigger protect_system_role_grants
  before insert or update or delete on role_grants
  for each row execute function app.protect_system_role_grants();

-- Power Admin never falls behind: any future catalog entry is granted to every
-- tenant's power_admin automatically (full access by coverage, never bypass).
create or replace function app.grant_new_catalog_to_power_admin() returns trigger
language plpgsql as $$
begin
  perform set_config('app.system_op', 'on', true);
  insert into role_grants (tenant_id, role_id, resource, action)
  select r.tenant_id, r.id, new.resource, new.action
  from roles r
  where r.key = 'power_admin'
  on conflict do nothing;
  perform set_config('app.system_op', 'off', true);
  return new;
end $$;

create trigger grant_new_catalog_to_power_admin
  after insert on permission_catalog
  for each row execute function app.grant_new_catalog_to_power_admin();

-- ---------------------------------------------------------------- seeding --
-- Called for every existing tenant below, and by provisioning (bootstrap) for
-- new tenants. Idempotent. Plain invoker function — runs as migration owner
-- here and as service role at provision time; never callable to escalate by
-- authenticated users (no execute grant beyond service_role).
create or replace function app.seed_tenant_roles(p_tenant uuid) returns void
language plpgsql as $$
declare
  v_power uuid; v_sched uuid; v_lead uuid; v_member uuid; v_portal uuid;
begin
  perform set_config('app.system_op', 'on', true);

  insert into roles (tenant_id, key, name, description, is_system, default_route) values
    (p_tenant, 'power_admin',     'Power Admin',     'Full access — holds every grant, automatically including future ones', true,  '/admin'),
    (p_tenant, 'client_portal',   'Client Portal',   'External client access — fixed portal-only grants',                    true,  '/portal'),
    (p_tenant, 'scheduler',       'Scheduler',       'Plans and manages bookings across the team',                           false, '/schedule'),
    (p_tenant, 'department_lead', 'Department Lead', 'Scheduler abilities plus approvals and the audit trail',               false, '/team'),
    (p_tenant, 'team_member',     'Team Member',     'Sees own calendar and tasks; works own deliverables',                  false, '/my-work')
  on conflict (tenant_id, key) do nothing;

  select id into v_power  from roles where tenant_id = p_tenant and key = 'power_admin';
  select id into v_sched  from roles where tenant_id = p_tenant and key = 'scheduler';
  select id into v_lead   from roles where tenant_id = p_tenant and key = 'department_lead';
  select id into v_member from roles where tenant_id = p_tenant and key = 'team_member';
  select id into v_portal from roles where tenant_id = p_tenant and key = 'client_portal';

  -- Power Admin: the whole catalog.
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_power, resource, action from permission_catalog
  on conflict do nothing;

  -- Scheduler.
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_sched, r, a from (values
    ('schedule','view'), ('my_calendar','view'), ('my_tasks','view'),
    ('project_calendar','view'), ('month_overview','view'), ('bookings_table','view'),
    ('bookings','create'), ('bookings','update'), ('bookings','delete'), ('bookings','export'),
    ('blackouts','manage'), ('projects','manage'), ('project_tasks','manage'), ('media','manage')
  ) as g(r, a)
  on conflict do nothing;

  -- Department Lead: scheduler + approvals + audit + review moderation.
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_lead, resource, action from role_grants
  where role_id = v_sched
  on conflict do nothing;
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_lead, r, a from (values
    ('bookings','approve'), ('audit','view'), ('reviews','moderate'), ('team','view')
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

revoke execute on function app.seed_tenant_roles(uuid) from public, anon, authenticated;

-- Service-side RPC so provisioning (bootstrap-admin.mjs) can seed a new
-- tenant's roles over PostgREST. service_role only.
create or replace function public.seed_tenant_roles(p_tenant uuid) returns void
language sql as $$ select app.seed_tenant_roles(p_tenant) $$;
revoke execute on function public.seed_tenant_roles(uuid) from public, anon, authenticated;
grant execute on function public.seed_tenant_roles(uuid) to service_role;

-- Seed every tenant that already exists (Meridian on dev; any on prod at apply time).
select app.seed_tenant_roles(id) from tenants;
