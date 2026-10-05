-- ADR-0123 (I62.2, I62.3, I62.8) — a client is registered as a draft and the account director activates it.
--
-- 1. `clients:approve` — a new permission, seeded to the Account Director (the Power Admin holds every permission
--    through the catalogue trigger). Anyone with `clients:manage` still starts and edits a client (d.1).
-- 2. `countries` — the organisation's list of countries, each with its working week (ISO weekdays, Mon = 1 … Sun = 7,
--    as `offices.working_days`, ADR-0005). The client's country is the calendar for its work's deadlines (d.3).
-- 3. `clients.status` (draft | active), who activated it and when, and its country. A client is a draft from its
--    first save; activating needs `clients:approve` and a name, a country and an account manager; an active client
--    never goes back to draft. Every client that exists today is made active, in Iraq (d.2, d.3).
-- 4. A draft is never used: a campaign or a job for a draft client is refused here, whatever the screen offers (d.2).
-- 5. Client rules lock on activation: once active, only `clients:approve` changes `profile.rules` (d.5). A rule's
--    languages live on the rule (`profile.rules[].languages`); a rule without any applies in every language.
-- 6. `brands.short_name` — what lists and pickers show (d.7).
-- 7. `client_contacts` — the people at the client: records, not logins (d.4).
--
-- RLS and the audit trigger ride with every new table in this file (AGENTS.md §6).
begin;

-- ---------------------------------------------------------------- 1. the permission ----
insert into permission_catalog (resource, action, description) values
  ('clients', 'approve', 'Activate a draft client, and change an active client''s dos and don''ts (ADR-0123)')
on conflict (resource, action) do nothing;

create or replace function app.seed_tenant_client_activation(p_tenant uuid) returns void
language plpgsql
set search_path = public, app, extensions as $$
begin
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, r.id, 'clients', 'approve'
    from roles r
   where r.tenant_id = p_tenant and r.key = 'account_director'
  on conflict do nothing;
end $$;

comment on function app.seed_tenant_client_activation(uuid) is
  'ADR-0123 d.1: clients:approve for the Account Director of one tenant. The Power Admin holds it through '
  'grant_new_catalog_to_power_admin. Called by the provisioning wrapper, after the Account Director is seeded.';

-- ---------------------------------------------------------------- 2. countries ----
create table public.countries (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  code         text not null check (code ~ '^[A-Z]{2}$'),
  name_en      text not null,
  name_ar      text not null,
  working_days smallint[] not null check (working_days <@ array[1,2,3,4,5,6,7]::smallint[] and cardinality(working_days) between 1 and 7),
  sort_order   integer not null default 0,
  created_by   uuid references user_profiles(id),
  updated_by   uuid references user_profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, code)
);
create index idx_countries_tenant_id on public.countries (tenant_id);

alter table public.countries enable row level security;
alter table public.countries force row level security;

create policy countries_tenant_select on public.countries
  for select to authenticated
  using (tenant_id = app.current_tenant_id());
create policy countries_tenant_write on public.countries
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'));

create trigger audit_row_change
  after insert or update or delete on public.countries
  for each row execute function app.audit_row_change();
create trigger set_actor_columns before insert or update on public.countries
  for each row execute function app.set_actor_columns();

create or replace function app.seed_tenant_countries(p_tenant uuid) returns void
language plpgsql
set search_path = public, app, extensions as $$
begin
  insert into countries (tenant_id, code, name_en, name_ar, working_days, sort_order)
  select p_tenant, v.code, v.en, v.ar, v.days, v.ord
    from (values
      ('IQ', 'Iraq',                 'العراق',              array[7,1,2,3,4]::smallint[],  1),
      ('AE', 'United Arab Emirates', 'الإمارات',            array[1,2,3,4,5]::smallint[],  2),
      ('SA', 'Saudi Arabia',         'السعودية',            array[7,1,2,3,4]::smallint[],  3),
      ('KW', 'Kuwait',               'الكويت',              array[7,1,2,3,4]::smallint[],  4),
      ('QA', 'Qatar',                'قطر',                 array[7,1,2,3,4]::smallint[],  5),
      ('BH', 'Bahrain',              'البحرين',             array[7,1,2,3,4]::smallint[],  6),
      ('OM', 'Oman',                 'عُمان',               array[7,1,2,3,4]::smallint[],  7),
      ('JO', 'Jordan',               'الأردن',              array[7,1,2,3,4]::smallint[],  8),
      ('EG', 'Egypt',                'مصر',                 array[7,1,2,3,4]::smallint[],  9),
      ('LB', 'Lebanon',              'لبنان',               array[1,2,3,4,5]::smallint[], 10),
      ('TR', 'Türkiye',              'تركيا',               array[1,2,3,4,5]::smallint[], 11),
      ('GB', 'United Kingdom',       'المملكة المتحدة',     array[1,2,3,4,5]::smallint[], 12)
    ) as v(code, en, ar, days, ord)
  on conflict (tenant_id, code) do nothing;
end $$;

comment on function app.seed_tenant_countries(uuid) is
  'ADR-0123 d.3: the countries a client can be in, each with its working week (ISO weekdays). '
  '`on conflict do nothing`: a tenant''s own edits are kept. Called by the provisioning wrapper.';

select app.seed_tenant_countries(id) from tenants;

-- ---------------------------------------------------------------- 3. a client's status and country ----
alter table public.clients
  add column status       text not null default 'active' check (status in ('draft', 'active')),
  add column activated_at timestamptz,
  add column activated_by uuid references user_profiles(id),
  add column country_code text;

alter table public.clients
  add constraint clients_country_fk foreign key (tenant_id, country_code) references public.countries (tenant_id, code);

comment on column public.clients.status is
  'ADR-0123 d.1/d.2: draft from the first save; active once the account director activates it. A draft is never '
  'offered on a job and no campaign or job can be raised for it. A person without clients:approve always saves a '
  'draft (the trigger sees to it); the default serves the system''s own inserts (migrations, the seed, tests).';
comment on column public.clients.country_code is
  'ADR-0123 d.3: the client''s country — its working week is the calendar for its work''s deadlines.';

-- Every client that exists today is active, and is worked from Iraq (the office it always has been).
set local session_replication_role = replica;
update public.clients
   set status = 'active', activated_at = coalesce(activated_at, created_at), country_code = coalesce(country_code, 'IQ');
set local session_replication_role = origin;

create or replace function app.client_lifecycle() returns trigger
language plpgsql
set search_path = public, app, extensions as $$
declare
  -- The system's own writes — a migration, the seed, a test fixture, a service — carry no person and are not gated.
  v_system boolean := coalesce(current_setting('app.system_op', true), '') = 'on' or auth.uid() is null;
  v_director boolean := v_system or app.has_permission('clients', 'approve');
begin
  -- An internal client (an ad-hoc container, ADR-0029) is never a draft: nobody registers it.
  if new.is_internal then
    new.status := 'active';
    new.activated_at := coalesce(new.activated_at, now());
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- d.1: anyone who may manage clients starts one — as a draft, whatever they asked for.
    if not v_director then
      new.status := 'draft';
    end if;
  else
    if old.status = 'active' and new.status = 'draft' then
      raise exception 'client: an active client does not go back to draft (ADR-0123)' using errcode = '55000';
    end if;
    -- d.5: an active client's dos and don'ts are the director's.
    if old.status = 'active' and not v_director
       and (new.profile -> 'rules') is distinct from (old.profile -> 'rules') then
      raise exception 'client: an active client''s dos and don''ts are changed by the account director (ADR-0123)'
        using errcode = '42501';
    end if;
  end if;

  if new.status = 'active' and (tg_op = 'INSERT' or old.status = 'draft') then
    if not v_director then
      raise exception 'client: only the account director activates a client (ADR-0123)' using errcode = '42501';
    end if;
    if not v_system and (new.country_code is null or new.account_manager_id is null or coalesce(btrim(new.name), '') = '') then
      raise exception 'client: a client needs a name, a country and an account manager to be activated (ADR-0123)'
        using errcode = '23514';
    end if;
    new.activated_at := now();
    new.activated_by := auth.uid();
  end if;
  return new;
end $$;

create trigger clients_lifecycle
  before insert or update on public.clients
  for each row execute function app.client_lifecycle();

-- ---------------------------------------------------------------- 4. a draft is never used ----
create or replace function app.refuse_work_for_a_draft_client() returns trigger
language plpgsql
set search_path = public, app, extensions as $$
begin
  if new.client_id is not null and exists (
       select 1 from clients c where c.id = new.client_id and c.status = 'draft') then
    raise exception 'client: work cannot be raised for a draft client — the account director activates it first (ADR-0123)'
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger campaigns_refuse_draft_client
  before insert or update of client_id on public.campaigns
  for each row execute function app.refuse_work_for_a_draft_client();
create trigger jobs_refuse_draft_client
  before insert or update of client_id on public.jobs
  for each row execute function app.refuse_work_for_a_draft_client();

-- ---------------------------------------------------------------- 6. a brand's short name ----
alter table public.brands add column short_name text check (short_name is null or btrim(short_name) <> '');
comment on column public.brands.short_name is 'ADR-0123 d.7: what lists and pickers show ("Luma · LUMA").';

-- ---------------------------------------------------------------- 7. the people at the client ----
create table public.client_contacts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  client_id   uuid not null references clients(id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  role_title  text,
  reach       text[] not null default '{}' check (reach <@ array['whatsapp', 'email', 'phone']::text[]),
  can_request boolean not null default false,
  signs_off   boolean not null default false,
  is_copied   boolean not null default false,
  sort_order  integer not null default 0,
  created_by  uuid references user_profiles(id),
  updated_by  uuid references user_profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_client_contacts_tenant_id on public.client_contacts (tenant_id);
create index idx_client_contacts_client_id on public.client_contacts (client_id);

comment on table public.client_contacts is
  'ADR-0123 d.4: the people at a client — who may ask for work, who signs off, who is copied. Records, not logins.';

alter table public.client_contacts enable row level security;
alter table public.client_contacts force row level security;

create policy client_contacts_tenant_select on public.client_contacts
  for select to authenticated
  using (tenant_id = app.current_tenant_id());
create policy client_contacts_tenant_write on public.client_contacts
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('clients', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('clients', 'manage'));

create trigger audit_row_change
  after insert or update or delete on public.client_contacts
  for each row execute function app.audit_row_change();
create trigger set_actor_columns before insert or update on public.client_contacts
  for each row execute function app.set_actor_columns();

-- ---------------------------------------------------------------- grants and provisioning ----
select app.seed_tenant_client_activation(id) from tenants;

-- Reproduced WHOLE from 20260926180000 (the last definition), plus the two new calls at the end.
create or replace function public.seed_tenant_roles(p_tenant uuid) returns void
language sql as $$
  select app.seed_tenant_roles(p_tenant);
  select app.seed_tenant_asset_grants(p_tenant);
  select app.seed_tenant_storage_settings(p_tenant);
  select app.seed_tenant_reminder_settings(p_tenant);
  select app.seed_tenant_brief_approval_grants(p_tenant);
  select app.seed_tenant_brief_templates(p_tenant);
  select app.seed_tenant_deliverable_taxonomy(p_tenant);
  select app.seed_tenant_taxonomy_amendments(p_tenant);
  select app.seed_tenant_workflow_templates(p_tenant);
  select app.seed_tenant_workflow_step_corrections(p_tenant);
  select app.seed_tenant_step_review_modes(p_tenant);
  select app.seed_tenant_default_workflows(p_tenant);
  select app.seed_tenant_i38_deactivations(p_tenant);
  select app.seed_tenant_digital_build_brief(p_tenant);
  select app.seed_tenant_brief_template_names(p_tenant);
  select app.seed_tenant_brief_essentials(p_tenant);
  select app.seed_tenant_i38_step_names(p_tenant);
  select app.seed_tenant_i38_direction_steps(p_tenant);
  select app.seed_tenant_i38_new_templates(p_tenant);
  select app.seed_tenant_i38_branding_components(p_tenant);
  select app.seed_tenant_brief_deliverable_types(p_tenant);
  select app.seed_account_director(p_tenant);
  select app.seed_tenant_escalation_rules(p_tenant);
  select app.seed_tenant_languages(p_tenant);
  -- ---- ADR-0123 (I62.2) ----
  -- After the Account Director (it grants that role); the countries before any client is registered.
  select app.seed_tenant_client_activation(p_tenant);
  select app.seed_tenant_countries(p_tenant);
$$;

commit;
