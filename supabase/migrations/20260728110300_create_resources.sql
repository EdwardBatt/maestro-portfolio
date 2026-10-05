-- M1.3 resources — the spine of the system (§4). Capacity model is a property
-- of the resource; per-resource ceilings, not global constants (§4.1).
-- M1.9 finance-ready: dual rates (internal cost vs external charge, §9.5).

create type resource_kind as enum ('human', 'equipment', 'room');
create type capacity_model as enum ('exclusive', 'pooled', 'load_based');

create table resources (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id),
  kind              resource_kind not null,
  name              text not null,
  department_id     uuid references departments(id),
  office_id         uuid references offices(id),
  user_id           uuid references user_profiles(id),  -- set when a human resource maps to a login
  capacity_model    capacity_model not null,
  pool_size         integer,          -- pooled(n) only
  load_ceiling_pct  numeric(5,1),     -- load_based only, e.g. 120.0
  warn_at_pct       numeric(5,1),     -- load_based only, e.g. 100.0
  cost_rate         numeric(12,2),    -- internal labour cost / hour (never client-visible)
  charge_rate       numeric(12,2),    -- external charge / hour
  currency          text not null default 'USD' check (char_length(currency) = 3),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint uq_resources_tenant_name unique (tenant_id, name),
  constraint chk_resources_pooled_size
    check (capacity_model <> 'pooled' or (pool_size is not null and pool_size >= 1)),
  constraint chk_resources_load_params
    check (capacity_model <> 'load_based'
           or (load_ceiling_pct is not null and warn_at_pct is not null
               and load_ceiling_pct > 0 and warn_at_pct > 0
               and warn_at_pct <= load_ceiling_pct)),
  constraint chk_resources_human_load
    check (kind <> 'human' or capacity_model = 'load_based'),  -- §4.1: all humans load-based
  constraint chk_resources_human_user_only
    check (user_id is null or kind = 'human')
);
create index idx_resources_tenant_id on resources (tenant_id);
create index idx_resources_department_id on resources (department_id);
create index idx_resources_office_id on resources (office_id);
create index idx_resources_user_id on resources (user_id);

alter table resources enable row level security;
alter table resources force row level security;

create policy resources_tenant_select on resources
  for select to authenticated
  using (tenant_id = app.current_tenant_id());
create policy resources_admin_write on resources
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());

create trigger set_updated_at before update on resources
  for each row execute function app.set_updated_at();
