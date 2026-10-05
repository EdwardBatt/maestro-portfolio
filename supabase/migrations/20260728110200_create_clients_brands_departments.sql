-- M1.2 org entities: clients (lightweight, inside the tenant — §10.1),
-- brands (a client may hold several — §10.1), departments (org-chart aligned).

create table clients (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  name                text not null,
  odoo_analytic_code  text,
  related_client_id   uuid references clients(id),   -- Kite-group sibling relations
  portal_enabled      boolean not null default false, -- M10 flips this per client
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint uq_clients_tenant_name unique (tenant_id, name),
  constraint chk_clients_no_self_relation check (related_client_id is distinct from id)
);
create index idx_clients_tenant_id on clients (tenant_id);
create index idx_clients_related_client_id on clients (related_client_id);

alter table clients enable row level security;
alter table clients force row level security;

create policy clients_tenant_select on clients
  for select to authenticated
  using (tenant_id = app.current_tenant_id());
create policy clients_admin_write on clients
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

create trigger set_updated_at before update on clients
  for each row execute function app.set_updated_at();

create table brands (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  client_id   uuid not null references clients(id),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint uq_brands_client_name unique (client_id, name)
);
create index idx_brands_tenant_id on brands (tenant_id);
create index idx_brands_client_id on brands (client_id);

alter table brands enable row level security;
alter table brands force row level security;

create policy brands_tenant_select on brands
  for select to authenticated
  using (tenant_id = app.current_tenant_id());
create policy brands_admin_write on brands
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

create trigger set_updated_at before update on brands
  for each row execute function app.set_updated_at();

create table departments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  name        text not null,   -- Art & Video / Copy, Social & Content / Production / ... (§5.1)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint uq_departments_tenant_name unique (tenant_id, name)
);
create index idx_departments_tenant_id on departments (tenant_id);

alter table departments enable row level security;
alter table departments force row level security;

create policy departments_tenant_select on departments
  for select to authenticated
  using (tenant_id = app.current_tenant_id());
create policy departments_admin_write on departments
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

create trigger set_updated_at before update on departments
  for each row execute function app.set_updated_at();
