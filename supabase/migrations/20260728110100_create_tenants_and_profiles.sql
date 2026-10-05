-- M1.1 tenancy spine + M2-ready user profiles.

create type user_role as enum
  ('creative', 'booker', 'team_lead', 'support', 'admin', 'client_portal');

create table tenants (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  slug                text not null unique,
  odoo_analytic_code  text,                       -- §9.5: nullable free-text until Finance confirms format
  settings            jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table tenants enable row level security;
alter table tenants force row level security;

create policy tenants_tenant_select on tenants
  for select to authenticated
  using (id = app.current_tenant_id());
-- No insert/update/delete policies for authenticated: tenant provisioning is a
-- privileged (service-role) operation only.

create trigger set_updated_at before update on tenants
  for each row execute function app.set_updated_at();

create table offices (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  name        text not null,
  timezone    text not null,  -- IANA, e.g. Asia/Baghdad, Asia/Dubai, Africa/Cairo
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint uq_offices_tenant_name unique (tenant_id, name)
);
create index idx_offices_tenant_id on offices (tenant_id);

alter table offices enable row level security;
alter table offices force row level security;

create policy offices_tenant_select on offices
  for select to authenticated
  using (tenant_id = app.current_tenant_id());
create policy offices_admin_insert on offices
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id() and app.is_admin());
create policy offices_admin_update on offices
  for update to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());
create policy offices_admin_delete on offices
  for delete to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin());

create trigger set_updated_at before update on offices
  for each row execute function app.set_updated_at();

create table user_profiles (
  id            uuid primary key references auth.users(id),
  tenant_id     uuid not null references tenants(id),
  display_name  text not null,
  role          user_role not null default 'creative',
  locale        text not null default 'en' check (locale in ('en', 'ar')),
  office_id     uuid references offices(id),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_user_profiles_tenant_id on user_profiles (tenant_id);
create index idx_user_profiles_office_id on user_profiles (office_id);

alter table user_profiles enable row level security;
alter table user_profiles force row level security;

create policy user_profiles_tenant_select on user_profiles
  for select to authenticated
  using (tenant_id = app.current_tenant_id());
-- Self may update own non-privileged fields; role changes are admin-only.
create policy user_profiles_self_update on user_profiles
  for update to authenticated
  using (id = auth.uid() and tenant_id = app.current_tenant_id())
  with check (id = auth.uid() and tenant_id = app.current_tenant_id()
              and role = (select up.role from user_profiles up where up.id = auth.uid()));
create policy user_profiles_admin_all on user_profiles
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

create trigger set_updated_at before update on user_profiles
  for each row execute function app.set_updated_at();
