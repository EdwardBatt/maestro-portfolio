-- ADR-0022: client asset filing structure + company reference library.
-- Schema + grants + auto-provisioning. Bytes live on Backblaze B2 (signed URLs via an
-- Edge Function, added separately); this migration is the tracked data model only.
--
-- Folders are an explicit, browsable tree (visible even when empty), auto-provisioned
-- per client on creation: Client → {Brand Assets → per brand → asset-type},
-- {Projects → per campaign → asset-type}. Assets live in exactly one folder and can be
-- REFERENCED (not copied) by brands/campaigns/streams/deliverables. Versioned.

-- ---------------------------------------------------------------- tables ----

create table asset_folders (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  client_id   uuid not null references clients(id) on delete cascade,
  parent_id   uuid references asset_folders(id) on delete cascade,
  name        text not null,
  kind        text not null default 'custom'
                check (kind in ('client_root','brand_root','brand','projects_root','campaign','asset_type','custom')),
  brand_id    uuid references brands(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete cascade,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint uq_asset_folders_sibling unique (client_id, parent_id, name)
);
create index idx_asset_folders_tenant on asset_folders (tenant_id);
create index idx_asset_folders_client on asset_folders (client_id);
create index idx_asset_folders_parent on asset_folders (parent_id);
create index idx_asset_folders_brand on asset_folders (brand_id);
create index idx_asset_folders_campaign on asset_folders (campaign_id);

create table assets (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  folder_id       uuid not null references asset_folders(id) on delete cascade,
  name            text not null,
  provider        text not null default 'b2' check (provider in ('b2','r2','supabase','external')),
  object_key      text,
  content_type    text,
  size_bytes      bigint check (size_bytes is null or size_bytes >= 0),
  storage_tier    text not null default 'hot' check (storage_tier in ('hot','cold','proxy_only')),
  retention_state text not null default 'active' check (retention_state in ('active','archived','dropped')),
  current_version integer not null default 1 check (current_version >= 1),
  uploaded_by     uuid references user_profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_assets_tenant on assets (tenant_id);
create index idx_assets_folder on assets (folder_id);

create table asset_versions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  asset_id     uuid not null references assets(id) on delete cascade,
  version      integer not null check (version >= 1),
  object_key   text,
  content_type text,
  size_bytes   bigint check (size_bytes is null or size_bytes >= 0),
  uploaded_by  uuid references user_profiles(id),
  created_at   timestamptz not null default now(),
  constraint uq_asset_versions unique (asset_id, version)
);
create index idx_asset_versions_asset on asset_versions (asset_id);

-- "referenced, not copied" (design §8.1): a brand asset reused by campaigns etc.
create table asset_references (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id),
  asset_id   uuid not null references assets(id) on delete cascade,
  ref_type   text not null check (ref_type in ('brand','campaign','stream','deliverable')),
  ref_id     uuid not null,
  created_at timestamptz not null default now(),
  constraint uq_asset_references unique (asset_id, ref_type, ref_id)
);
create index idx_asset_references_asset on asset_references (asset_id);
create index idx_asset_references_target on asset_references (ref_type, ref_id);

-- ------------------------------------------------------------------ RLS ----
-- Reads tenant-wide (the company reference library is internal-wide); writes gated
-- by assets:manage. Surfaces are additionally gated by assets:view (ADR-0008).

do $$
declare t text;
begin
  foreach t in array array['asset_folders','assets','asset_versions','asset_references'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($f$create policy %1$s_tenant_select on %1$s
        for select to authenticated using (tenant_id = app.current_tenant_id())$f$, t);
    execute format($f$create policy %1$s_tenant_write on %1$s
        for all to authenticated
        using (tenant_id = app.current_tenant_id() and app.has_permission('assets','manage'))
        with check (tenant_id = app.current_tenant_id() and app.has_permission('assets','manage'))$f$, t);
  end loop;
end $$;

create trigger set_updated_at before update on asset_folders for each row execute function app.set_updated_at();
create trigger set_updated_at before update on assets for each row execute function app.set_updated_at();

-- --------------------------------------------------------- grants (RBAC) ----

insert into permission_catalog (resource, action, description) values
  ('assets', 'view',   'Browse client asset folders and the company reference library (ADR-0022)'),
  ('assets', 'manage', 'Upload, version, organise and delete assets (ADR-0022)')
on conflict (resource, action) do nothing;

-- Idempotent grant seeder (kept small; folded into the provisioning wrapper below
-- so future tenants get it too, without re-pasting the whole role seeder).
create or replace function app.seed_tenant_asset_grants(p_tenant uuid) returns void
language plpgsql as $$
begin
  -- Power Admin is a system role; its grants are fenced by protect_system_role_grants,
  -- so writes here must run under the system-op flag (same as the role seeder).
  perform set_config('app.system_op', 'on', true);

  -- assets:view → every internal role (browse the company reference library)
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, id, 'assets', 'view'
  from roles where tenant_id = p_tenant and key <> 'client_portal'
  on conflict do nothing;
  -- assets:manage → Client Services + the roles that already handle media/creative work
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, id, 'assets', 'manage'
  from roles where tenant_id = p_tenant
    and key in ('power_admin','scheduler','account_manager','department_lead','team_lead','deputy_team_lead','team_member')
  on conflict do nothing;

  perform set_config('app.system_op', 'off', true);
end $$;

select app.seed_tenant_asset_grants(id) from tenants;

-- Future tenants: fold into the provisioning wrapper (alongside roles + disciplines).
create or replace function public.seed_tenant_roles(p_tenant uuid) returns void
language sql as $$
  select app.seed_tenant_roles(p_tenant);
  select app.seed_tenant_disciplines(p_tenant);
  select app.seed_tenant_asset_grants(p_tenant);
$$;
revoke execute on function public.seed_tenant_roles(uuid) from public, anon, authenticated;
grant execute on function public.seed_tenant_roles(uuid) to service_role;

-- ------------------------------------------------ auto-provision the tree ----
-- SECURITY DEFINER so the standard skeleton is created regardless of who inserted
-- the client/brand/campaign (the creator may hold clients:manage but not assets:manage).
-- All idempotent via NOT EXISTS, so backfill + re-runs are safe.

create or replace function app.provision_brand_folders(p_brand uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  v_tenant uuid; v_client uuid; v_name text; v_brand_root uuid; v_brand_folder uuid; t text;
begin
  select tenant_id, client_id, name into v_tenant, v_client, v_name from brands where id = p_brand;
  if v_client is null then return; end if;

  select id into v_brand_root from asset_folders
    where client_id = v_client and kind = 'brand_root' limit 1;
  if v_brand_root is null then
    perform app.provision_client_folders(v_client);
    select id into v_brand_root from asset_folders where client_id = v_client and kind = 'brand_root' limit 1;
  end if;
  if v_brand_root is null then return; end if;

  insert into asset_folders (tenant_id, client_id, parent_id, name, kind, brand_id, is_system)
  select v_tenant, v_client, v_brand_root, v_name, 'brand', p_brand, true
  where not exists (select 1 from asset_folders where client_id = v_client and parent_id = v_brand_root and brand_id = p_brand);
  select id into v_brand_folder from asset_folders
    where client_id = v_client and parent_id = v_brand_root and brand_id = p_brand limit 1;

  foreach t in array array['Logos','Fonts','Guidelines','Key Visuals'] loop
    insert into asset_folders (tenant_id, client_id, parent_id, name, kind, brand_id, is_system)
    select v_tenant, v_client, v_brand_folder, t, 'asset_type', p_brand, true
    where not exists (select 1 from asset_folders where parent_id = v_brand_folder and name = t);
  end loop;
end $$;

create or replace function app.provision_campaign_folders(p_campaign uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  v_tenant uuid; v_client uuid; v_name text; v_proj_root uuid; v_camp_folder uuid; t text;
begin
  select tenant_id, client_id, name into v_tenant, v_client, v_name from campaigns where id = p_campaign;
  if v_client is null then return; end if;

  select id into v_proj_root from asset_folders
    where client_id = v_client and kind = 'projects_root' limit 1;
  if v_proj_root is null then
    perform app.provision_client_folders(v_client);
    select id into v_proj_root from asset_folders where client_id = v_client and kind = 'projects_root' limit 1;
  end if;
  if v_proj_root is null then return; end if;

  insert into asset_folders (tenant_id, client_id, parent_id, name, kind, campaign_id, is_system)
  select v_tenant, v_client, v_proj_root, v_name, 'campaign', p_campaign, true
  where not exists (select 1 from asset_folders where client_id = v_client and parent_id = v_proj_root and campaign_id = p_campaign);
  select id into v_camp_folder from asset_folders
    where client_id = v_client and parent_id = v_proj_root and campaign_id = p_campaign limit 1;

  foreach t in array array['Working Files','Deliverables','Final Assets','References'] loop
    insert into asset_folders (tenant_id, client_id, parent_id, name, kind, campaign_id, is_system)
    select v_tenant, v_client, v_camp_folder, t, 'asset_type', p_campaign, true
    where not exists (select 1 from asset_folders where parent_id = v_camp_folder and name = t);
  end loop;
end $$;

create or replace function app.provision_client_folders(p_client uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  v_tenant uuid; v_name text; v_root uuid; r record;
begin
  select tenant_id, name into v_tenant, v_name from clients where id = p_client;
  if v_tenant is null then return; end if;

  -- client root
  insert into asset_folders (tenant_id, client_id, parent_id, name, kind, is_system)
  select v_tenant, p_client, null, v_name, 'client_root', true
  where not exists (select 1 from asset_folders where client_id = p_client and kind = 'client_root');
  select id into v_root from asset_folders where client_id = p_client and kind = 'client_root' limit 1;

  -- two roots under it
  insert into asset_folders (tenant_id, client_id, parent_id, name, kind, is_system)
  select v_tenant, p_client, v_root, 'Brand Assets', 'brand_root', true
  where not exists (select 1 from asset_folders where client_id = p_client and kind = 'brand_root');
  insert into asset_folders (tenant_id, client_id, parent_id, name, kind, is_system)
  select v_tenant, p_client, v_root, 'Projects', 'projects_root', true
  where not exists (select 1 from asset_folders where client_id = p_client and kind = 'projects_root');

  -- existing brands + campaigns for this client
  for r in select id from brands where client_id = p_client loop
    perform app.provision_brand_folders(r.id);
  end loop;
  for r in select id from campaigns where client_id = p_client loop
    perform app.provision_campaign_folders(r.id);
  end loop;
end $$;

-- Triggers: provision on creation of a client / brand / campaign.
create or replace function app.tg_provision_client_folders() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin perform app.provision_client_folders(new.id); return new; end $$;
create trigger provision_folders_after_client_insert
  after insert on clients for each row execute function app.tg_provision_client_folders();

create or replace function app.tg_provision_brand_folders() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin perform app.provision_brand_folders(new.id); return new; end $$;
create trigger provision_folders_after_brand_insert
  after insert on brands for each row execute function app.tg_provision_brand_folders();

create or replace function app.tg_provision_campaign_folders() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin perform app.provision_campaign_folders(new.id); return new; end $$;
create trigger provision_folders_after_campaign_insert
  after insert on campaigns for each row execute function app.tg_provision_campaign_folders();

-- Backfill existing clients (cascades to their brands + campaigns).
select app.provision_client_folders(id) from clients;
