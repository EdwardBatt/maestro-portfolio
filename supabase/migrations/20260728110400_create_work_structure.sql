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
