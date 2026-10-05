-- M1 consolidated apply — paste ONCE into the Supabase SQL Editor (maestro-dev) and Run.
-- Produces the identical end state to 'supabase db push', including migration
-- history, so the CLI reads as in-sync later. Safe to run once only.
begin;

-- ========== 20260728110000_extensions_and_app_helpers.sql ==========
-- M1.1 foundations: extensions + the app schema every later migration relies on.
-- Tenant identity comes from JWT claims ONLY (app_metadata.tenant_id) — never
-- from client-supplied parameters (AGENTS.md §6).

create extension if not exists btree_gist;

create schema if not exists app;
grant usage on schema app to anon, authenticated, service_role;

-- Tenant of the calling user, from the JWT. Set into app_metadata at
-- invite/provision time (server-side only — users cannot change app_metadata).
create or replace function app.current_tenant_id() returns uuid
language sql stable as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')::uuid
$$;

-- Application role claim (creative / booker / team_lead / support / admin / client_portal).
create or replace function app.jwt_role() returns text
language sql stable as $$
  select auth.jwt() -> 'app_metadata' ->> 'app_role'
$$;

create or replace function app.is_admin() returns boolean
language sql stable as $$
  select app.jwt_role() = 'admin'
$$;

-- updated_at maintenance
create or replace function app.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ========== 20260728110100_create_tenants_and_profiles.sql ==========
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

-- ========== 20260728110200_create_clients_brands_departments.sql ==========
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

-- ========== 20260728110300_create_resources.sql ==========
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

-- ========== 20260728110400_create_work_structure.sql ==========
-- M1.4 work structure: work types as first-class entities (§5.3), the
-- Campaign → Stream → Deliverable hierarchy (§8.1, one campaign per stream),
-- and M1.5 the ad-hoc job shape (optional campaign + source-deliverable links,
-- both-null is a normal case — §8.1).

create type deliverable_state as enum
  ('draft', 'in_progress', 'in_review', 'approved', 'delivered', 'archived');

-- Accountability profiles: pluggable per-role measurement framework (§5.2).
-- Schema-ready stub; surfaces arrive Phase 2 (P2.2).
create table accountability_profiles (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  name        text not null,
  kind        text not null check (kind in
                ('deliverable_sla', 'response_sla', 'outcome', 'coverage', 'none')),
  config      jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint uq_accountability_profiles_tenant_name unique (tenant_id, name)
);
create index idx_accountability_profiles_tenant_id on accountability_profiles (tenant_id);

alter table accountability_profiles enable row level security;
alter table accountability_profiles force row level security;
create policy accountability_profiles_tenant_select on accountability_profiles
  for select to authenticated using (tenant_id = app.current_tenant_id());
create policy accountability_profiles_admin_write on accountability_profiles
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());
create trigger set_updated_at before update on accountability_profiles
  for each row execute function app.set_updated_at();

-- SLA profiles: per-work-type machinery config (§5.4) — measured points,
-- committed vs estimated, revision allowance, breach handling. Config detail
-- lives in jsonb until the SLA engine surfaces (P2.1) firm the columns.
create table sla_profiles (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  name        text not null,
  config      jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint uq_sla_profiles_tenant_name unique (tenant_id, name)
);
create index idx_sla_profiles_tenant_id on sla_profiles (tenant_id);

alter table sla_profiles enable row level security;
alter table sla_profiles force row level security;
create policy sla_profiles_tenant_select on sla_profiles
  for select to authenticated using (tenant_id = app.current_tenant_id());
create policy sla_profiles_admin_write on sla_profiles
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());
create trigger set_updated_at before update on sla_profiles
  for each row execute function app.set_updated_at();

-- Work type: ties scheduling, SLAs and billing together (§5.3). Lead time
-- drives deadline derivation forward (§5.4) and commence-by backward (§10.2).
create table work_types (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references tenants(id),
  name                      text not null,
  lead_time_hours           integer check (lead_time_hours > 0),
  default_load_pct          numeric(5,1) check (default_load_pct > 0),
  sla_profile_id            uuid references sla_profiles(id),
  accountability_profile_id uuid references accountability_profiles(id),
  is_active                 boolean not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint uq_work_types_tenant_name unique (tenant_id, name)
);
create index idx_work_types_tenant_id on work_types (tenant_id);
create index idx_work_types_sla_profile_id on work_types (sla_profile_id);
create index idx_work_types_accountability_profile_id on work_types (accountability_profile_id);

alter table work_types enable row level security;
alter table work_types force row level security;
create policy work_types_tenant_select on work_types
  for select to authenticated using (tenant_id = app.current_tenant_id());
create policy work_types_admin_write on work_types
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_admin())
  with check (tenant_id = app.current_tenant_id() and app.is_admin());
create trigger set_updated_at before update on work_types
  for each row execute function app.set_updated_at();

-- Campaign: holds the strategic core once (§8.1). The campaign calendar (M9)
-- is a projection over campaigns/streams/deliverables — no new tables.
create table campaigns (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  client_id           uuid not null references clients(id),
  brand_id            uuid references brands(id),
  name                text not null,
  audience            text,
  insight             text,
  proposition         text,
  go_live_at          timestamptz,
  odoo_analytic_code  text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint uq_campaigns_tenant_name unique (tenant_id, name)
);
create index idx_campaigns_tenant_id on campaigns (tenant_id);
create index idx_campaigns_client_id on campaigns (client_id);
create index idx_campaigns_brand_id on campaigns (brand_id);

alter table campaigns enable row level security;
alter table campaigns force row level security;
create policy campaigns_tenant_select on campaigns
  for select to authenticated using (tenant_id = app.current_tenant_id());
create policy campaigns_tenant_write on campaigns
  for all to authenticated
  using (tenant_id = app.current_tenant_id()
         and app.jwt_role() in ('admin', 'team_lead', 'booker'))
  with check (tenant_id = app.current_tenant_id()
              and app.jwt_role() in ('admin', 'team_lead', 'booker'));
create trigger set_updated_at before update on campaigns
  for each row execute function app.set_updated_at();

-- Stream: belongs to exactly ONE campaign (§8.1 rule) — campaign_id NOT NULL.
create table streams (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  campaign_id    uuid not null references campaigns(id),
  work_type_id   uuid references work_types(id),
  name           text not null,
  owner_user_id  uuid references user_profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint uq_streams_campaign_name unique (campaign_id, name)
);
create index idx_streams_tenant_id on streams (tenant_id);
create index idx_streams_campaign_id on streams (campaign_id);
create index idx_streams_work_type_id on streams (work_type_id);
create index idx_streams_owner_user_id on streams (owner_user_id);

alter table streams enable row level security;
alter table streams force row level security;
create policy streams_tenant_select on streams
  for select to authenticated using (tenant_id = app.current_tenant_id());
create policy streams_tenant_write on streams
  for all to authenticated
  using (tenant_id = app.current_tenant_id()
         and app.jwt_role() in ('admin', 'team_lead', 'booker'))
  with check (tenant_id = app.current_tenant_id()
              and app.jwt_role() in ('admin', 'team_lead', 'booker'));
create trigger set_updated_at before update on streams
  for each row execute function app.set_updated_at();

-- Ad-hoc job (§8.1): hangs off the client; optional campaign link, optional
-- source-deliverable link (added after deliverables exist, same migration
-- ordering constraint), both-null is normal. Full accountability citizen.
create table jobs (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id),
  client_id              uuid not null references clients(id),
  campaign_id            uuid references campaigns(id),
  work_type_id           uuid references work_types(id),
  owner_user_id          uuid references user_profiles(id),
  name                   text not null,
  odoo_analytic_code     text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index idx_jobs_tenant_id on jobs (tenant_id);
create index idx_jobs_client_id on jobs (client_id);
create index idx_jobs_campaign_id on jobs (campaign_id);
create index idx_jobs_work_type_id on jobs (work_type_id);
create index idx_jobs_owner_user_id on jobs (owner_user_id);

alter table jobs enable row level security;
alter table jobs force row level security;
create policy jobs_tenant_select on jobs
  for select to authenticated using (tenant_id = app.current_tenant_id());
create policy jobs_tenant_write on jobs
  for all to authenticated
  using (tenant_id = app.current_tenant_id()
         and app.jwt_role() in ('admin', 'team_lead', 'booker'))
  with check (tenant_id = app.current_tenant_id()
              and app.jwt_role() in ('admin', 'team_lead', 'booker'));
create trigger set_updated_at before update on jobs
  for each row execute function app.set_updated_at();

-- Deliverable: produced within a stream OR by an ad-hoc job (at least one parent).
create table deliverables (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  stream_id       uuid references streams(id),
  job_id          uuid references jobs(id),
  name            text not null,
  state           deliverable_state not null default 'draft',
  due_at          timestamptz,
  revision_round  integer not null default 0 check (revision_round >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint chk_deliverables_has_parent check (stream_id is not null or job_id is not null)
);
create index idx_deliverables_tenant_id on deliverables (tenant_id);
create index idx_deliverables_stream_id on deliverables (stream_id);
create index idx_deliverables_job_id on deliverables (job_id);

alter table deliverables enable row level security;
alter table deliverables force row level security;
create policy deliverables_tenant_select on deliverables
  for select to authenticated using (tenant_id = app.current_tenant_id());
create policy deliverables_tenant_write on deliverables
  for all to authenticated
  using (tenant_id = app.current_tenant_id()
         and app.jwt_role() in ('admin', 'team_lead', 'booker', 'creative'))
  with check (tenant_id = app.current_tenant_id()
              and app.jwt_role() in ('admin', 'team_lead', 'booker', 'creative'));
create trigger set_updated_at before update on deliverables
  for each row execute function app.set_updated_at();

-- Ad-hoc source-deliverable link (§8.1): version lineage vs job lineage are
-- different axes; the link is contextual.
alter table jobs add column source_deliverable_id uuid references deliverables(id);
create index idx_jobs_source_deliverable_id on jobs (source_deliverable_id);

-- ========== 20260728110500_create_bookings_and_blackouts.sql ==========
-- M1.6 bookings: flexible states in app logic, ONE hard invariant in the DB —
-- no two confirmed bookings overlap for an exclusive resource (§4.2), enforced
-- physically (race-proof) by an exclusion constraint.
-- M1.7 blackouts: unavailability as its own concept, separate from bookings (§4.3).

create type booking_state as enum
  ('soft_hold', 'tentative', 'confirmed', 'cancelled', 'expired');

create table bookings (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),  -- tenant-tagged allocation (§10.4)
  resource_id      uuid not null references resources(id),
  booked_by        uuid references user_profiles(id),
  deliverable_id   uuid references deliverables(id),
  job_id           uuid references jobs(id),
  work_type_id     uuid references work_types(id),        -- null ⇒ never enters SLA machinery (§5.3)
  state            booking_state not null default 'tentative',
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  timespan         tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,
  load_pct         numeric(5,1) check (load_pct is null or load_pct > 0),  -- load-based humans
  soft_hold_expires_at timestamptz,   -- soft_hold only; expiry handled by Edge Function
  notes            text,
  is_exclusive     boolean not null default false,  -- trigger-maintained copy of the resource's model
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint chk_bookings_span check (ends_at > starts_at),
  constraint chk_bookings_soft_hold_expiry
    check (state <> 'soft_hold' or soft_hold_expires_at is not null)
);
create index idx_bookings_tenant_id on bookings (tenant_id);
create index idx_bookings_resource_id on bookings (resource_id);
create index idx_bookings_deliverable_id on bookings (deliverable_id);
create index idx_bookings_job_id on bookings (job_id);
create index idx_bookings_work_type_id on bookings (work_type_id);
create index idx_bookings_booked_by on bookings (booked_by);
create index idx_bookings_timespan on bookings using gist (resource_id, timespan);

-- Keep is_exclusive true to the resource's capacity model. SECURITY of this
-- copy: maintained only by trigger, never client-writable in any meaningful
-- way (a lying client value is overwritten before row storage).
create or replace function app.set_booking_exclusivity() returns trigger
language plpgsql as $$
begin
  select (r.capacity_model = 'exclusive') into strict new.is_exclusive
  from resources r where r.id = new.resource_id;
  return new;
end $$;

create trigger set_booking_exclusivity
  before insert or update of resource_id on bookings
  for each row execute function app.set_booking_exclusivity();

-- THE hard invariant (§4.2): confirmed + exclusive ⇒ no overlap. Everything
-- else (soft-holds, tentatives, load accumulation) is application logic.
alter table bookings add constraint excl_bookings_confirmed_exclusive_overlap
  exclude using gist (resource_id with =, timespan with &&)
  where (state = 'confirmed' and is_exclusive);

alter table bookings enable row level security;
alter table bookings force row level security;

create policy bookings_tenant_select on bookings
  for select to authenticated
  using (tenant_id = app.current_tenant_id());
create policy bookings_scheduler_insert on bookings
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id()
              and app.jwt_role() in ('admin', 'team_lead', 'booker'));
create policy bookings_scheduler_update on bookings
  for update to authenticated
  using (tenant_id = app.current_tenant_id()
         and app.jwt_role() in ('admin', 'team_lead', 'booker'))
  with check (tenant_id = app.current_tenant_id()
              and app.jwt_role() in ('admin', 'team_lead', 'booker'));
create policy bookings_scheduler_delete on bookings
  for delete to authenticated
  using (tenant_id = app.current_tenant_id()
         and app.jwt_role() in ('admin', 'team_lead', 'booker'));

create trigger set_updated_at before update on bookings
  for each row execute function app.set_updated_at();

-- Blackouts / unavailability (§4.3): leave, maintenance, holidays. Its own
-- concept — never modeled as bookings, never consumes capacity.
create table resource_unavailability (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  resource_id  uuid not null references resources(id),
  kind         text not null check (kind in ('leave', 'maintenance', 'holiday', 'other')),
  reason       text,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  timespan     tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint chk_unavailability_span check (ends_at > starts_at)
);
create index idx_resource_unavailability_tenant_id on resource_unavailability (tenant_id);
create index idx_resource_unavailability_resource_id on resource_unavailability (resource_id);
create index idx_resource_unavailability_timespan
  on resource_unavailability using gist (resource_id, timespan);

alter table resource_unavailability enable row level security;
alter table resource_unavailability force row level security;

create policy resource_unavailability_tenant_select on resource_unavailability
  for select to authenticated
  using (tenant_id = app.current_tenant_id());
create policy resource_unavailability_scheduler_write on resource_unavailability
  for all to authenticated
  using (tenant_id = app.current_tenant_id()
         and app.jwt_role() in ('admin', 'team_lead', 'booker'))
  with check (tenant_id = app.current_tenant_id()
              and app.jwt_role() in ('admin', 'team_lead', 'booker'));

create trigger set_updated_at before update on resource_unavailability
  for each row execute function app.set_updated_at();

-- ========== 20260728110600_create_append_only_event_logs.sql ==========
-- M1.8 accountability-ready event logs (§5.5): append-only from day one.
-- Once outcomes affect rewards, records become contestable — so events are an
-- immutable log: INSERT-only policies, and UPDATE/DELETE revoked outright.
-- No updated_at column on purpose: these rows never change.

create type attribution_party as enum ('assignee', 'client', 'dependency', 'approver');

create table sla_events (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  deliverable_id  uuid references deliverables(id),
  job_id          uuid references jobs(id),
  booking_id      uuid references bookings(id),
  event_type      text not null check (event_type in (
                    'deadline_set', 'deadline_changed', 'scope_change',
                    'clock_paused', 'clock_resumed',
                    'blocked_flagged', 'block_cleared',
                    'delivered', 'revision_requested', 'approved'
                  )),
  attributed_to   attribution_party,
  actor_user_id   uuid references user_profiles(id),
  payload         jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  constraint chk_sla_events_has_subject
    check (deliverable_id is not null or job_id is not null or booking_id is not null)
);
create index idx_sla_events_tenant_id on sla_events (tenant_id);
create index idx_sla_events_deliverable_id on sla_events (deliverable_id);
create index idx_sla_events_job_id on sla_events (job_id);
create index idx_sla_events_booking_id on sla_events (booking_id);
create index idx_sla_events_created_at on sla_events (created_at);

alter table sla_events enable row level security;
alter table sla_events force row level security;

create policy sla_events_tenant_select on sla_events
  for select to authenticated
  using (tenant_id = app.current_tenant_id());
create policy sla_events_tenant_insert on sla_events
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id() and actor_user_id = auth.uid());
-- NO update/delete policies — and belt-and-braces at the grant level:
revoke update, delete on sla_events from authenticated, anon;

create table audit_events (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  actor_user_id  uuid references user_profiles(id),
  action         text not null,
  entity         text not null,
  entity_id      uuid,
  payload        jsonb not null default '{}',
  created_at     timestamptz not null default now()
);
create index idx_audit_events_tenant_id on audit_events (tenant_id);
create index idx_audit_events_entity on audit_events (entity, entity_id);
create index idx_audit_events_created_at on audit_events (created_at);

alter table audit_events enable row level security;
alter table audit_events force row level security;

create policy audit_events_admin_select on audit_events
  for select to authenticated
  using (tenant_id = app.current_tenant_id()
         and app.jwt_role() in ('admin', 'team_lead'));
create policy audit_events_tenant_insert on audit_events
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id() and actor_user_id = auth.uid());
revoke update, delete on audit_events from authenticated, anon;

-- ========== 20260728110700_create_joint_project_shape.sql ==========
-- M1 schema-readiness for M8 (§10.4): joint projects — single nominal host
-- owns configuration (OD 12 resolved), bounded bidirectional visibility.
-- This migration lands the SHAPE (tables + host/invited tenant policies).
-- The two-part cross-tenant RLS ("your rows + granted joint-project rows,
-- per-field, symmetric") is milestone M8 and gets its own migrations plus
-- the disproportionate pgTAP suite — deliberately NOT smuggled in here.

create table joint_projects (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null unique references campaigns(id),
  host_tenant_id     uuid not null references tenants(id),  -- owns config & final say
  invited_tenant_id  uuid not null references tenants(id),
  status             text not null default 'active' check (status in ('active', 'closed')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint chk_joint_projects_distinct_tenants
    check (host_tenant_id <> invited_tenant_id)
);
create index idx_joint_projects_host_tenant_id on joint_projects (host_tenant_id);
create index idx_joint_projects_invited_tenant_id on joint_projects (invited_tenant_id);

alter table joint_projects enable row level security;
alter table joint_projects force row level security;

-- Both sides may SEE the joint project row; only the host administers it.
create policy joint_projects_member_select on joint_projects
  for select to authenticated
  using (app.current_tenant_id() in (host_tenant_id, invited_tenant_id));
create policy joint_projects_host_admin_write on joint_projects
  for all to authenticated
  using (host_tenant_id = app.current_tenant_id() and app.is_admin())
  with check (host_tenant_id = app.current_tenant_id() and app.is_admin());

create trigger set_updated_at before update on joint_projects
  for each row execute function app.set_updated_at();

-- Project-scoped grant: collaborator keeps home-tenant identity; home role
-- does NOT carry over (§10.4) — the granted role applies only inside the project.
create table joint_project_grants (
  id                uuid primary key default gen_random_uuid(),
  joint_project_id  uuid not null references joint_projects(id),
  user_id           uuid not null references user_profiles(id),
  user_tenant_id    uuid not null references tenants(id),
  granted_role      text not null check (granted_role in ('viewer', 'contributor', 'scheduler')),
  created_at        timestamptz not null default now(),
  constraint uq_joint_project_grants unique (joint_project_id, user_id)
);
create index idx_joint_project_grants_project on joint_project_grants (joint_project_id);
create index idx_joint_project_grants_user on joint_project_grants (user_id);
create index idx_joint_project_grants_user_tenant on joint_project_grants (user_tenant_id);

alter table joint_project_grants enable row level security;
alter table joint_project_grants force row level security;

-- Members of either side see the grant list for their shared project; only
-- the HOST tenant's admin manages grants (single ownership).
create policy joint_project_grants_member_select on joint_project_grants
  for select to authenticated
  using (exists (
    select 1 from joint_projects jp
    where jp.id = joint_project_id
      and app.current_tenant_id() in (jp.host_tenant_id, jp.invited_tenant_id)
  ));
create policy joint_project_grants_host_admin_write on joint_project_grants
  for all to authenticated
  using (app.is_admin() and exists (
    select 1 from joint_projects jp
    where jp.id = joint_project_id and jp.host_tenant_id = app.current_tenant_id()
  ))
  with check (app.is_admin() and exists (
    select 1 from joint_projects jp
    where jp.id = joint_project_id and jp.host_tenant_id = app.current_tenant_id()
  ));

-- ========== 20260728110800_create_media_and_review_records.sql ==========
-- M1.10 media + Tier-2 review record shapes. The client portal's feedback
-- action (M10) rides on review_feedback, so the shape exists from day one.
-- Media record is provider-swappable (§8.3): provider + key + URL + tier +
-- retention-state. Metadata history is permanent; heavy files are tiered.

create table media_records (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id),
  deliverable_id       uuid not null references deliverables(id),
  version              integer not null check (version >= 1),
  provider             text not null default 'b2'
                         check (provider in ('b2', 'r2', 'supabase', 'external')),
  object_key           text,             -- keyed on campaign/stream/deliverable hierarchy (§8.4)
  content_type         text,
  size_bytes           bigint check (size_bytes is null or size_bytes >= 0),
  storage_tier         text not null default 'hot'
                         check (storage_tier in ('hot', 'cold', 'proxy_only')),
  retention_state      text not null default 'active'
                         check (retention_state in ('active', 'archived', 'dropped')),
  external_review_url  text,             -- Frame.io link-out (OD 18: loose coupling default)
  uploaded_by          uuid references user_profiles(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint uq_media_records_deliverable_version unique (deliverable_id, version)
);
create index idx_media_records_tenant_id on media_records (tenant_id);
create index idx_media_records_deliverable_id on media_records (deliverable_id);

alter table media_records enable row level security;
alter table media_records force row level security;

create policy media_records_tenant_select on media_records
  for select to authenticated
  using (tenant_id = app.current_tenant_id());
create policy media_records_tenant_write on media_records
  for all to authenticated
  using (tenant_id = app.current_tenant_id()
         and app.jwt_role() in ('admin', 'team_lead', 'booker', 'creative'))
  with check (tenant_id = app.current_tenant_id()
              and app.jwt_role() in ('admin', 'team_lead', 'booker', 'creative'));

create trigger set_updated_at before update on media_records
  for each row execute function app.set_updated_at();

-- Tier-2 positional feedback (§8.2): pinned x/y on images, timecoded on video.
-- Provenance matters for attribution (§5.5/§10.2): source records WHERE the
-- feedback was captured; portal-sourced rows are client-attributed at source.
create table review_feedback (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  media_record_id uuid not null references media_records(id),
  round           integer not null default 1 check (round >= 1),
  source          text not null check (source in ('client', 'internal')),
  body            text not null,
  timecode_ms     integer check (timecode_ms is null or timecode_ms >= 0),
  pos_x           numeric(6,4) check (pos_x is null or (pos_x >= 0 and pos_x <= 1)),
  pos_y           numeric(6,4) check (pos_y is null or (pos_y >= 0 and pos_y <= 1)),
  resolved        boolean not null default false,
  author_user_id  uuid references user_profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_review_feedback_tenant_id on review_feedback (tenant_id);
create index idx_review_feedback_media_record_id on review_feedback (media_record_id);

alter table review_feedback enable row level security;
alter table review_feedback force row level security;

create policy review_feedback_tenant_select on review_feedback
  for select to authenticated
  using (tenant_id = app.current_tenant_id());
create policy review_feedback_tenant_insert on review_feedback
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id() and author_user_id = auth.uid());
-- Author may resolve/edit own comment; leads/admins may resolve any.
create policy review_feedback_author_update on review_feedback
  for update to authenticated
  using (tenant_id = app.current_tenant_id()
         and (author_user_id = auth.uid() or app.jwt_role() in ('admin', 'team_lead')))
  with check (tenant_id = app.current_tenant_id());

create trigger set_updated_at before update on review_feedback
  for each row execute function app.set_updated_at();

-- ========== migration history (what db push would have recorded) ==========
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
insert into supabase_migrations.schema_migrations (version, name) values
  ('20260728110000', 'extensions_and_app_helpers'),
  ('20260728110100', 'create_tenants_and_profiles'),
  ('20260728110200', 'create_clients_brands_departments'),
  ('20260728110300', 'create_resources'),
  ('20260728110400', 'create_work_structure'),
  ('20260728110500', 'create_bookings_and_blackouts'),
  ('20260728110600', 'create_append_only_event_logs'),
  ('20260728110700', 'create_joint_project_shape'),
  ('20260728110800', 'create_media_and_review_records');

commit;
