-- I18.1 (ADR-0051) — the deliverable taxonomy as tenant data.
--
-- Today a deliverable is a sentence: `deliverables` carries name, state, due_at, owner and the
-- revision counters, and "60-second hero film" is free text in the name column. The rest of the
-- specification IS collected — the wizard asks for quantity and a commence date — and then filed
-- into a JSON blob on the campaign, where it cannot be filtered, counted, constrained, joined or
-- used to decide anything. `campaign-api.ts:158` says so in as many words.
--
-- Three tables, all tenant-scoped, all seed-then-edit (the seed is I18.2, next migration):
--
--   deliverable_categories        16 rows — the first level of Category -> Deliverable
--   deliverable_types            240 rows — what a deliverable IS. The CODE is the key, not the
--                                name: twelve names appear under two codes (Reel is SOC-004 and
--                                VID-008; Billboard is ADV-006 and ENV-010)
--   deliverable_attribute_values  48 rows across six attributes, NONE of them a Postgres enum
--
-- WHY SEEDING THIS IS SAFE WHEN SEEDING DISCIPLINES WAS NOT (ADR-0050). A TVC is a TVC in Baghdad
-- and in Berlin. This vocabulary describes the ARTEFACT, never the people or the org chart, so
-- nothing here can tell a tenant how to structure itself — which is exactly what the seeded
-- `work_types` list did wrong. Seed vocabulary, never structure.
--
-- WHY THE ATTRIBUTE VALUES ARE ROWS AND NOT ENUMS. A Postgres enum is global to the estate, not
-- per tenant: "closed" would mean closed for every agency on the platform, forever. Extending one
-- is a two-migration job (`20260817110000` explains why in its own header) plus a type regen. And
-- nothing across ADR-0051..0054 branches on any of these six columns yet — so an enum would buy
-- permanent rigidity for a code path that does not exist. A pharma client needing a seventh
-- approval level is a row, not a release.
--
-- The one enum here is `deliverable_attribute` itself, and that is the right instrument: a seventh
-- attribute needs a seventh column on `deliverables`, so it is a migration however the values are
-- stored.

begin;

create type deliverable_attribute as enum
  ('channel', 'format', 'orientation', 'production_type', 'complexity', 'client_approval');

-- ------------------------------------------------------------------ categories ----
create table deliverable_categories (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  code        text not null check (code = upper(code) and length(code) between 2 and 12),
  name_en     text not null check (length(trim(name_en)) > 0),
  -- Nullable by design: the seed ships Arabic, but a tenant adding its own category should not be
  -- blocked on translating it. Surfaces fall back to name_en (ADR-0051 d.6).
  name_ar     text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint uq_deliverable_categories_tenant_code unique (tenant_id, code)
);
create index idx_deliverable_categories_tenant_id on deliverable_categories (tenant_id);

alter table deliverable_categories enable row level security;
alter table deliverable_categories force row level security;

create policy deliverable_categories_tenant_select on deliverable_categories
  for select using (tenant_id = app.current_tenant_id());
create policy deliverable_categories_manage_write on deliverable_categories
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'));

create trigger set_updated_at before update on deliverable_categories
  for each row execute function app.set_updated_at();

-- ----------------------------------------------------------------------- types ----
-- The tenant fence is the composite FK pattern `20260826100000` established: referencing
-- (tenant_id, code) rather than a bare id makes it structurally impossible to point a type at
-- another tenant's category. FKs ignore RLS, so this is the only thing that actually stops it.
alter table deliverable_categories
  add constraint uq_deliverable_categories_tenant_id_code unique (tenant_id, code);

create table deliverable_types (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  code           text not null check (length(trim(code)) > 0),
  category_code  text not null,
  name_en        text not null check (length(trim(name_en)) > 0),
  name_ar        text,
  is_active      boolean not null default true,

  -- ADR-0051 d.12: four of the five `work_types` settings live here now. They are WRITTEN but
  -- READ BY NOTHING until ADR-0056 makes them the live source — a deliberate, documented overlap,
  -- not an oversight. `accountability_profile_id` is the fifth and stays behind: accountability is
  -- about people, and its consumer P2.2 is still gated on OD 7.
  lead_time_hours   integer  check (lead_time_hours is null or lead_time_hours > 0),
  default_load_pct  numeric(5,1) check (default_load_pct is null or default_load_pct > 0),
  revision_limit    integer  check (revision_limit is null or revision_limit >= 0),
  sla_profile_id    uuid references sla_profiles(id),

  -- ADR-0051 d.15: a bare uuid with NO foreign key. ADR-0052's migration adds the constraint in
  -- the same migration that creates `workflow_templates`; if ADR-0052 is never taken, this column
  -- is dropped rather than left dangling.
  default_workflow_template_id uuid,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint uq_deliverable_types_tenant_code unique (tenant_id, code),
  constraint fk_deliverable_types_category
    foreign key (tenant_id, category_code)
    references deliverable_categories (tenant_id, code)
);
create index idx_deliverable_types_tenant_id on deliverable_types (tenant_id);
create index idx_deliverable_types_category on deliverable_types (tenant_id, category_code);
create index idx_deliverable_types_sla_profile_id on deliverable_types (sla_profile_id);

alter table deliverable_types enable row level security;
alter table deliverable_types force row level security;

create policy deliverable_types_tenant_select on deliverable_types
  for select using (tenant_id = app.current_tenant_id());
create policy deliverable_types_manage_write on deliverable_types
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'));

create trigger set_updated_at before update on deliverable_types
  for each row execute function app.set_updated_at();

comment on column deliverable_types.code is
  'ADR-0051 d.4: THE KEY. Twelve names in the seeded taxonomy appear under two codes, so the name '
  'is not unique and never resolves anything — lookups, imports and model output all key on this.';
comment on column deliverable_types.category_code is
  'ADR-0051 d.5: not null, FK-fenced to the tenant''s own categories. Matching the code prefix to '
  'the category is the SEEDING CONVENTION and deliberately not a constraint — a tenant''s own '
  'codes are its own business, and the FK is what holds the grouping together.';

-- ------------------------------------------------------------ attribute values ----
create table deliverable_attribute_values (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  attribute   deliverable_attribute not null,
  code        text not null check (length(trim(code)) > 0),
  label_en    text not null check (length(trim(label_en)) > 0),
  label_ar    text,
  -- ADR-0051 d.10: the escape hatch. Nullable, unread and unwritten today. When a code path first
  -- needs a bounded set — "does this approval level require legal sign-off?" — it defines the keys
  -- for its own attribute, and a tenant's seventh value maps onto an existing branch instead of
  -- needing a migration.
  behaviour   text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint uq_deliverable_attribute_values_tenant_attr_code unique (tenant_id, attribute, code)
);
create index idx_deliverable_attribute_values_tenant_id on deliverable_attribute_values (tenant_id);
create index idx_deliverable_attribute_values_attr on deliverable_attribute_values (tenant_id, attribute);

alter table deliverable_attribute_values enable row level security;
alter table deliverable_attribute_values force row level security;

create policy deliverable_attribute_values_tenant_select on deliverable_attribute_values
  for select using (tenant_id = app.current_tenant_id());
create policy deliverable_attribute_values_manage_write on deliverable_attribute_values
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'));

create trigger set_updated_at before update on deliverable_attribute_values
  for each row execute function app.set_updated_at();

commit;
