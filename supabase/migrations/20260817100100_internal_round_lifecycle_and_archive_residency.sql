-- ADR-0023: internal-round lifecycle + per-tenant archive residency (retention side).
--
-- Internal review rounds (undelivered media_records) stay hot during the active project.
-- Once a version is SUPERSEDED (a newer internal round exists on the same deliverable and
-- this one was never delivered) a retention clock starts; on expiry the archive-sweep job
-- (Edge Function, added separately) relocates the bytes to the tenant's ARCHIVE store and
-- flips retention_state → archived. Postgres metadata (media_records + review_feedback) is
-- kept permanently regardless of where the bytes live (P2.6.3). Delivered versions are
-- EXEMPT — they live in the Library on the normal asset lifecycle.
--
-- Archive residency is per-tenant: cloud (B2/R2) OR local (on-prem, e.g. the Iraq server),
-- an admin one-time setting. Advances OD 30 (storage residency = per-tenant data). Reuses the
-- existing provider-swappable model (media_records.provider) + the ADR-0016 cloud-first-active
-- + tenant-local-archive pattern. Retention on a LOCAL archive is the company's own decision —
-- the sweep hands bytes off and stops there; it never force-purges on-prem storage.
--
-- Tasks: P2.6.1 (operational intermediate default — 60d), P2.6.3, INF.1 (OD 30).

-- ------------------------------------------ per-tenant archive residency ----
create table tenant_storage_settings (
  tenant_id              uuid primary key references tenants(id),
  archive_target         text not null default 'cloud' check (archive_target in ('cloud', 'local')),
  archive_provider       text check (archive_provider in ('b2', 'r2', 'supabase', 'external')),
  archive_location       text,     -- opaque label / on-prem endpoint id; credentials live in secrets, never here
  working_retention_days integer not null default 60 check (working_retention_days between 1 and 3650),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
comment on table tenant_storage_settings is
  'ADR-0023: per-tenant archive residency (cloud|local) + working-round retention window (default 60d). Admin one-time config; no secrets stored here.';

alter table tenant_storage_settings enable row level security;
alter table tenant_storage_settings force row level security;

create policy tenant_storage_settings_tenant_select on tenant_storage_settings
  for select to authenticated
  using (tenant_id = app.current_tenant_id());
create policy tenant_storage_settings_admin_write on tenant_storage_settings
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'));

create trigger set_updated_at before update on tenant_storage_settings
  for each row execute function app.set_updated_at();

-- Default row per tenant (idempotent), folded into the provisioning wrapper for new tenants.
create or replace function app.seed_tenant_storage_settings(p_tenant uuid) returns void
language plpgsql as $$
begin
  insert into tenant_storage_settings (tenant_id) values (p_tenant)
  on conflict (tenant_id) do nothing;
end $$;

select app.seed_tenant_storage_settings(id) from tenants;

create or replace function public.seed_tenant_roles(p_tenant uuid) returns void
language sql as $$
  select app.seed_tenant_roles(p_tenant);
  select app.seed_tenant_disciplines(p_tenant);
  select app.seed_tenant_asset_grants(p_tenant);
  select app.seed_tenant_storage_settings(p_tenant);
$$;
revoke execute on function public.seed_tenant_roles(uuid) from public, anon, authenticated;
grant execute on function public.seed_tenant_roles(uuid) to service_role;

-- Note: media_records.superseded_at / archive_due_at and the idx_media_records_archive_due
-- partial index are added in the prior migration (20260817100000), alongside the deliver RPC
-- that clears the clock — so this migration only adds the automation that reads/writes them.

-- ----------------------------------------------- supersession automation ----
-- On a new review version, prior UNDELIVERED rounds on the same deliverable start their
-- retention clock. Delivered rounds are skipped (exempt); an already-running clock is not
-- reset. SECURITY DEFINER (pinned search_path) so the bookkeeping update on sibling rows is
-- not blocked by the inserter's row-level write policy; scoped to new.tenant_id / deliverable,
-- so no cross-tenant reach. Retention window is the tenant's setting (default 60).
create or replace function app.tg_media_supersede_prior() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_days integer;
begin
  select working_retention_days into v_days
    from tenant_storage_settings where tenant_id = new.tenant_id;
  v_days := coalesce(v_days, 60);

  update media_records
     set superseded_at  = now(),
         archive_due_at = now() + make_interval(days => v_days)
   where deliverable_id = new.deliverable_id
     and tenant_id      = new.tenant_id
     and version        < new.version   -- only genuinely-prior rounds; never the current head
     and delivered_at is null           -- delivered versions live in the Library; never on this clock
     and superseded_at is null;         -- don't restart a clock already running
  return new;
end $$;

comment on function app.tg_media_supersede_prior() is
  'ADR-0023: start the retention clock on prior undelivered rounds when a newer review version arrives.';

create trigger media_supersede_prior after insert on media_records
  for each row execute function app.tg_media_supersede_prior();

-- --------------------------------------------------- due-for-archive view ----
-- The archive-sweep Edge Function (service_role) selects the due internal rounds through
-- this function. SECURITY INVOKER: under service_role it spans all tenants (RLS bypassed for
-- the job); under an authenticated caller it is naturally fenced to their own tenant by RLS,
-- which is what the pgTAP suite asserts. Only undelivered, active, past-due rounds qualify.
create or replace function app.media_records_due_for_archive()
returns setof media_records
language sql stable set search_path = public as $$
  select *
  from media_records
  where retention_state = 'active'
    and delivered_at is null
    and archive_due_at is not null
    and archive_due_at <= now()
$$;

comment on function app.media_records_due_for_archive() is
  'ADR-0023: internal rounds due to be relocated to the tenant archive (undelivered, active, past archive_due_at).';

revoke execute on function app.media_records_due_for_archive() from public, anon;
grant execute on function app.media_records_due_for_archive() to authenticated, service_role;
