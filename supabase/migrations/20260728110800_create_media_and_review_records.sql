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
