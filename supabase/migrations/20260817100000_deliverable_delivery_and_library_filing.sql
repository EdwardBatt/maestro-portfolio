-- ADR-0023: deliverable review-versioning ↔ Library reconciliation (delivery side).
--
-- The internal review store (media_records, one row per working version + review_feedback)
-- already exists (M1.10). This migration adds the HINGE that crosses a version from that
-- internal store into the persisted Library (assets, ADR-0022): an explicit, per-version,
-- re-enterable "Deliver to client" action, plus the "approve → Final Assets" promotion.
--
-- No bytes are copied: the Library asset/version REFERENCES the same stored object as the
-- delivered media_record (design §8.1 "referenced, not copied"). Every client-delivered
-- round persists as an asset_version; internal rounds never become assets. Delivery and
-- approval are logged to the append-only sla_events log (§5.5; event_types already exist).
--
-- Tasks: V1.8.1, V1.8.3, V1.9.4 (forced version at client delivery), M10.5 (approval).

-- ------------------------------------------------------- delivery columns ----
-- Delivery is recorded ON the version it delivers (the internal review row). delivery_round
-- mirrors the asset_version.version the delivery created, so the two stores stay reconcilable.
-- Delivery columns + the internal-round lifecycle columns the retention clock uses (migration
-- 20260817100100 adds the settings table, supersession trigger and sweep helper that populate
-- and read archive_due_at). Keeping the columns here lets the deliver RPC clear the clock when a
-- round is delivered (delivered ⇒ exempt), without a forward dependency on the next migration.
alter table media_records
  add column delivered_at    timestamptz,
  add column delivered_by    uuid references user_profiles(id),
  add column delivery_round  integer check (delivery_round is null or delivery_round >= 1),
  add column superseded_at   timestamptz,
  add column archive_due_at  timestamptz;

comment on column media_records.delivered_at is
  'ADR-0023: set when this version was delivered to the client (the Library-filing hinge). NULL = internal round.';
comment on column media_records.archive_due_at is
  'ADR-0023: when an undelivered, superseded round becomes due for relocation to the tenant archive. NULL = not on the clock (active head, or delivered/exempt).';

-- Sweep lookup index: only undelivered, still-active rounds are ever archive candidates.
create index idx_media_records_archive_due on media_records (archive_due_at)
  where retention_state = 'active' and delivered_at is null;

-- A delivered version filed into the Library is marked final on approval (§ promotion below).
alter table assets
  add column is_final boolean not null default false;
comment on column assets.is_final is
  'ADR-0023: true on the Final-Assets asset created when a delivered version is client-approved (M10.5).';

-- --------------------------------------------- deliver_deliverable_version ----
-- Explicit "Deliver to client" action. SECURITY DEFINER (authorized by ADR-0023; search_path
-- pinned; RLS bypass justified below) because filing into the Library spans media_records +
-- assets/asset_versions/asset_references and the campaign-folder tree — the same cross-cutting
-- shape the ADR-0022 provisioning functions use, where the deliverer's grant set may not line
-- up with every table's own write policy. Authorization is enforced EXPLICITLY here instead:
--   * tenant isolation — the target row must be in the caller's JWT tenant (never a param);
--   * capability — the caller must hold BOTH projects:manage (authority over the campaign /
--     deliverable) AND assets:manage (authority to file into the Library). Account Manager /
--     Scheduler / Power Admin hold both (ADR-0021/0022 seeds) — exactly who owns client work.
-- Re-enterable: each call adds the next asset_version, so delivering v3 then (post-feedback)
-- v5 files two Library versions — every client-delivered version persists (ADR-0023).
create or replace function public.deliver_deliverable_version(p_media_record uuid)
returns uuid
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_actor      uuid := auth.uid();
  v_tenant     uuid := app.current_tenant_id();
  v_deliverable uuid;
  v_dname      text;
  v_campaign   uuid;
  v_provider   text;
  v_object_key text;
  v_ctype      text;
  v_size       bigint;
  v_folder     uuid;
  v_asset      uuid;
  v_round      integer;
begin
  if v_actor is null or v_tenant is null then
    raise exception 'deliver: no authenticated tenant context' using errcode = '42501';
  end if;

  -- Load the version, fenced to the caller's tenant (cross-tenant delivery impossible).
  select mr.deliverable_id, mr.provider, mr.object_key, mr.content_type, mr.size_bytes
    into v_deliverable, v_provider, v_object_key, v_ctype, v_size
  from media_records mr
  where mr.id = p_media_record and mr.tenant_id = v_tenant;
  if v_deliverable is null then
    raise exception 'deliver: media record not found in this tenant' using errcode = 'P0002';
  end if;

  -- Capability gate (explicit, since we run as definer): both grants required.
  if not (app.has_permission('projects', 'manage') and app.has_permission('assets', 'manage')) then
    raise exception 'deliver: requires projects:manage and assets:manage' using errcode = '42501';
  end if;

  -- Resolve the campaign this deliverable belongs to (via its stream, or an ad-hoc job's
  -- campaign link). Delivery files into the campaign's Deliverables folder, so a campaign
  -- is required; ad-hoc work with no campaign has nowhere to file yet.
  select d.name, coalesce(s.campaign_id, j.campaign_id)
    into v_dname, v_campaign
  from deliverables d
  left join streams s on s.id = d.stream_id
  left join jobs    j on j.id = d.job_id
  where d.id = v_deliverable and d.tenant_id = v_tenant;
  if v_campaign is null then
    raise exception 'deliver: deliverable % has no campaign to file under', v_deliverable
      using errcode = '22023';
  end if;

  -- The Deliverables folder is auto-provisioned with the campaign (ADR-0022); provision
  -- defensively in case of an older campaign, then require it.
  select id into v_folder from asset_folders
   where campaign_id = v_campaign and name = 'Deliverables' and kind = 'asset_type' limit 1;
  if v_folder is null then
    perform app.provision_campaign_folders(v_campaign);
    select id into v_folder from asset_folders
     where campaign_id = v_campaign and name = 'Deliverables' and kind = 'asset_type' limit 1;
  end if;
  if v_folder is null then
    raise exception 'deliver: Deliverables folder missing for campaign %', v_campaign
      using errcode = 'P0002';
  end if;

  -- One Library asset per deliverable, living in Deliverables; each delivery is a new version.
  select a.id into v_asset
  from assets a
  join asset_references ar
    on ar.asset_id = a.id and ar.ref_type = 'deliverable' and ar.ref_id = v_deliverable
  where a.folder_id = v_folder and a.tenant_id = v_tenant
  limit 1;

  if v_asset is null then
    insert into assets (tenant_id, folder_id, name, provider, object_key, content_type,
                        size_bytes, storage_tier, retention_state, current_version, uploaded_by)
    values (v_tenant, v_folder, coalesce(nullif(btrim(v_dname), ''), 'Deliverable'),
            coalesce(v_provider, 'b2'), v_object_key, v_ctype, v_size, 'hot', 'active', 1, v_actor)
    returning id into v_asset;
    insert into asset_references (tenant_id, asset_id, ref_type, ref_id)
    values (v_tenant, v_asset, 'deliverable', v_deliverable)
    on conflict (asset_id, ref_type, ref_id) do nothing;
    v_round := 1;
  else
    -- Lock the asset row so concurrent deliveries of the same deliverable can't compute the
    -- same next version and collide on uq_asset_versions.
    select current_version + 1 into v_round from assets where id = v_asset for update;
    update assets
       set current_version = v_round, object_key = v_object_key, content_type = v_ctype,
           size_bytes = v_size, provider = coalesce(v_provider, provider)
     where id = v_asset;
  end if;

  insert into asset_versions (tenant_id, asset_id, version, object_key, content_type, size_bytes, uploaded_by)
  values (v_tenant, v_asset, v_round, v_object_key, v_ctype, v_size, v_actor);

  -- Stamp the delivery on the internal version (this is the forced snapshot, OD 25). A
  -- delivered round is exempt from the retention clock, so clear any supersession that a
  -- newer round had already set (delivered ⇒ exempt, per ADR-0023).
  update media_records
     set delivered_at = now(), delivered_by = v_actor, delivery_round = v_round,
         superseded_at = null, archive_due_at = null
   where id = p_media_record;

  -- Append-only delivery event (the 'delivered' event_type already exists on sla_events).
  insert into sla_events (tenant_id, deliverable_id, event_type, attributed_to, actor_user_id, payload)
  values (v_tenant, v_deliverable, 'delivered', 'assignee', v_actor,
          jsonb_build_object('media_record_id', p_media_record, 'asset_id', v_asset,
                             'asset_version', v_round));

  return v_asset;
end $$;

comment on function public.deliver_deliverable_version(uuid) is
  'ADR-0023: file a review version into the client Library (Deliverables folder) as a new asset_version and mark it delivered. SECURITY DEFINER — tenant + projects:manage + assets:manage enforced in-body.';

revoke execute on function public.deliver_deliverable_version(uuid) from public, anon;
grant execute on function public.deliver_deliverable_version(uuid) to authenticated;

-- ---------------------------------- promote_delivered_version_to_final ----
-- Client approval (M10.5, milestone/stream-level) marks the accepted delivered version.
-- The version is already in the Library from delivery, so this PROMOTES rather than persists:
-- it files the accepted object into the campaign's Final Assets folder (referenced, not copied)
-- and flags it is_final. Idempotent per deliverable: re-approval of a newer version updates the
-- single Final asset in place. Gated on projects:manage today (the campaign owner records the
-- acceptance); wires to the portal approval event when M10 ships. Only a DELIVERED version can
-- be promoted.
create or replace function public.promote_delivered_version_to_final(p_media_record uuid)
returns uuid
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_actor      uuid := auth.uid();
  v_tenant     uuid := app.current_tenant_id();
  v_deliverable uuid;
  v_dname      text;
  v_campaign   uuid;
  v_object_key text;
  v_ctype      text;
  v_size       bigint;
  v_provider   text;
  v_round      integer;
  v_folder     uuid;
  v_asset      uuid;
begin
  if v_actor is null or v_tenant is null then
    raise exception 'promote: no authenticated tenant context' using errcode = '42501';
  end if;

  select mr.deliverable_id, mr.object_key, mr.content_type, mr.size_bytes, mr.provider, mr.delivery_round
    into v_deliverable, v_object_key, v_ctype, v_size, v_provider, v_round
  from media_records mr
  where mr.id = p_media_record and mr.tenant_id = v_tenant and mr.delivered_at is not null;
  if v_deliverable is null then
    raise exception 'promote: no delivered version found in this tenant' using errcode = 'P0002';
  end if;

  if not app.has_permission('projects', 'manage') then
    raise exception 'promote: requires projects:manage' using errcode = '42501';
  end if;

  select d.name, coalesce(s.campaign_id, j.campaign_id)
    into v_dname, v_campaign
  from deliverables d
  left join streams s on s.id = d.stream_id
  left join jobs    j on j.id = d.job_id
  where d.id = v_deliverable and d.tenant_id = v_tenant;
  if v_campaign is null then
    raise exception 'promote: deliverable % has no campaign to file under', v_deliverable
      using errcode = '22023';
  end if;

  select id into v_folder from asset_folders
   where campaign_id = v_campaign and name = 'Final Assets' and kind = 'asset_type' limit 1;
  if v_folder is null then
    perform app.provision_campaign_folders(v_campaign);
    select id into v_folder from asset_folders
     where campaign_id = v_campaign and name = 'Final Assets' and kind = 'asset_type' limit 1;
  end if;
  if v_folder is null then
    raise exception 'promote: Final Assets folder missing for campaign %', v_campaign
      using errcode = 'P0002';
  end if;

  select a.id into v_asset
  from assets a
  join asset_references ar
    on ar.asset_id = a.id and ar.ref_type = 'deliverable' and ar.ref_id = v_deliverable
  where a.folder_id = v_folder and a.tenant_id = v_tenant and a.is_final
  limit 1;

  if v_asset is null then
    insert into assets (tenant_id, folder_id, name, provider, object_key, content_type,
                        size_bytes, storage_tier, retention_state, current_version, is_final, uploaded_by)
    values (v_tenant, v_folder, coalesce(nullif(btrim(v_dname), ''), 'Deliverable') || ' (final)',
            coalesce(v_provider, 'b2'), v_object_key, v_ctype, v_size, 'hot', 'active', 1, true, v_actor)
    returning id into v_asset;
    insert into asset_references (tenant_id, asset_id, ref_type, ref_id)
    values (v_tenant, v_asset, 'deliverable', v_deliverable)
    on conflict (asset_id, ref_type, ref_id) do nothing;
    insert into asset_versions (tenant_id, asset_id, version, object_key, content_type, size_bytes, uploaded_by)
    values (v_tenant, v_asset, 1, v_object_key, v_ctype, v_size, v_actor);
  else
    update assets
       set object_key = v_object_key, content_type = v_ctype, size_bytes = v_size,
           provider = coalesce(v_provider, provider), current_version = current_version + 1
     where id = v_asset;
    insert into asset_versions (tenant_id, asset_id, version, object_key, content_type, size_bytes, uploaded_by)
    select v_tenant, v_asset, current_version, v_object_key, v_ctype, v_size, v_actor
    from assets where id = v_asset;
  end if;

  insert into sla_events (tenant_id, deliverable_id, event_type, attributed_to, actor_user_id, payload)
  values (v_tenant, v_deliverable, 'approved', 'approver', v_actor,
          jsonb_build_object('media_record_id', p_media_record, 'final_asset_id', v_asset,
                             'delivery_round', v_round));

  return v_asset;
end $$;

comment on function public.promote_delivered_version_to_final(uuid) is
  'ADR-0023 / M10.5: file the client-approved delivered version into Final Assets (referenced, not copied) and flag is_final. SECURITY DEFINER — tenant + projects:manage enforced in-body.';

revoke execute on function public.promote_delivered_version_to_final(uuid) from public, anon;
grant execute on function public.promote_delivered_version_to_final(uuid) to authenticated;
