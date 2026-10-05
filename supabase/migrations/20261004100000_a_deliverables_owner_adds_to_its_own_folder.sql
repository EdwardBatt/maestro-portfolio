-- I74.28 (ADR-0134 d.2, d.22) — a deliverable's owner adds links and files to that deliverable's own
-- Library folder, and nowhere else in the client.
--
-- Found 4 Oct by the review walk (Figma SC-09, the booking window's Files tab): the Library lets a team
-- lead change a client's files only through an open task her team holds (`app.library_client_in_reach`).
-- Owning the deliverable did not count, so her "Add a link" was refused ("you cannot change this
-- client's files") until her team held a task of that client. Edward, 4 Oct, "A for now": the owner of
-- a deliverable may upload, add a link and add a new version of a file already there — in THAT
-- deliverable's folder (asset_folders.kind = 'deliverable' for it) and nowhere else: not its parent,
-- not a sibling deliverable's folder, not a subfolder made inside it. Nothing else about reach changes.
--
-- The permission axis is unchanged (`assets:manage`, ADR-0037); the owner branch is a scope branch:
--   app.library_owns_folder(folder)    the caller owns the deliverable this folder is the folder of
--   app.library_may_add_to(folder)     its client is within reach (d.2) OR the caller owns the folder
--   public.library_can_add(folder)     assets:manage AND library_may_add_to — asked by asset-url for an
--                                      upload, as library_can_change(client) is for everything else
-- Applied to every write the Files tab and the upload box make: the assets / asset_versions INSERT
-- policies (the uploader writes the row), the assets UPDATE policy (a new version moves the asset's
-- current columns), library_add_link, library_add_version and library_add_link_version.
--
-- What the owner still may NOT do through the UPDATE policy (the asset guard refuses it when the
-- caller's only standing is ownership): rename, move, re-mark a file — those stay the reach rule's
-- (library_rename / library_move / library_make_current keep library_asset_for_change, unchanged).
-- Deleting stays personal (d.3, library_delete), as before.
--
-- Re-emitted whole from 20261002100000 (their only definition): tg_library_asset_guard,
-- library_add_version, library_add_link_version, library_add_link, and the three policies. No data
-- changes; safe on a populated database. pgTAP 224.
begin;

-- ======================================================================== helpers ====

-- SECURITY DEFINER: the deliverable's owner is read from a row the caller's RLS may hide (another
-- department's deliverable). Tenant from the JWT, never a parameter; answers a boolean about the caller.
create or replace function app.library_owns_folder(p_folder uuid) returns boolean
language sql stable security definer set search_path = public, app, extensions as $$
  select auth.uid() is not null and exists (
    select 1
      from asset_folders f
      join deliverables d on d.id = f.deliverable_id and d.tenant_id = f.tenant_id
     where f.id = p_folder
       and f.kind = 'deliverable'
       and f.tenant_id = app.current_tenant_id()
       and d.owner_user_id = auth.uid())
$$;
comment on function app.library_owns_folder(uuid) is
  'I74.28: is this folder the Library folder (kind deliverable) of a deliverable the caller owns? '
  'SECURITY DEFINER (reads the owner of a deliverable the caller may not see); tenant from the JWT; boolean only.';

create or replace function app.library_may_add_to(p_folder uuid) returns boolean
language sql stable set search_path = public, app, extensions as $$
  select coalesce(app.library_client_in_reach(app.library_folder_client(p_folder))
                  or app.library_owns_folder(p_folder), false)
$$;
comment on function app.library_may_add_to(uuid) is
  'I74.28: the scope axis for ADDING to a folder — the client within reach (ADR-0134 d.2), or the folder '
  'is the caller''s own deliverable''s.';

-- SECURITY DEFINER: as library_asset_client — the folder of an asset the caller''s RLS may hide (a
-- deleted one). Returns an id only, own tenant only.
create or replace function app.library_asset_folder(p_asset uuid) returns uuid
language sql stable security definer set search_path = public, app, extensions as $$
  select a.folder_id from assets a
   where a.id = p_asset and a.tenant_id = app.current_tenant_id()
$$;

create or replace function public.library_can_add(p_folder uuid) returns boolean
language sql stable set search_path = public, app, extensions as $$
  select coalesce(app.has_permission('assets', 'manage') and app.library_may_add_to(p_folder), false)
$$;
comment on function public.library_can_add(uuid) is
  'I74.28: may the caller upload, add a link or add a version in THIS folder — assets:manage AND (the '
  'client within reach OR the folder is their own deliverable''s). Asked by asset-url (ADR-0037).';

revoke execute on function app.library_owns_folder(uuid) from public, anon;
revoke execute on function app.library_may_add_to(uuid) from public, anon;
revoke execute on function app.library_asset_folder(uuid) from public, anon;
revoke execute on function public.library_can_add(uuid) from public, anon;
grant execute on function app.library_owns_folder(uuid) to authenticated, service_role;
grant execute on function app.library_may_add_to(uuid) to authenticated, service_role;
grant execute on function app.library_asset_folder(uuid) to authenticated, service_role;
grant execute on function public.library_can_add(uuid) to authenticated;

-- ============================================================================ RLS ====

drop policy if exists assets_reach_insert on assets;
create policy assets_reach_insert on assets
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id()
              and (select app.has_permission('assets', 'manage'))
              and app.library_may_add_to(folder_id));

drop policy if exists assets_reach_update on assets;
create policy assets_reach_update on assets
  for update to authenticated
  using (tenant_id = app.current_tenant_id()
         and (select app.has_permission('assets', 'manage'))
         and app.library_may_add_to(folder_id))
  with check (tenant_id = app.current_tenant_id()
              and (select app.has_permission('assets', 'manage'))
              and app.library_may_add_to(folder_id));

drop policy if exists asset_versions_reach_insert on asset_versions;
create policy asset_versions_reach_insert on asset_versions
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id()
              and (select app.has_permission('assets', 'manage'))
              and app.library_may_add_to(app.library_asset_folder(asset_id)));

-- ================================================================== the asset guard ====
-- Re-emitted whole; the one addition is the owner-only fence on UPDATE (marked I74.28).
-- SECURITY INVOKER on purpose (see tg_library_folder_guard). The folder lookups run as the writer:
-- a folder they cannot see is "another client".
create or replace function app.tg_library_asset_guard() returns trigger
language plpgsql set search_path = public, app, extensions as $$
declare
  v_system boolean := app.library_system_context();
  v_old_client uuid;
  v_new_client uuid;
  v_piece uuid;
begin
  if tg_op = 'INSERT' then
    if not v_system then
      new.uploaded_by := auth.uid();
      new.deleted_at := null;
      new.deleted_by := null;
    end if;
    if new.deliverable_id is null then
      select f.deliverable_id into v_piece from asset_folders f where f.id = new.folder_id and f.kind = 'deliverable';
      new.deliverable_id := v_piece;
    end if;
    return new;
  end if;

  -- UPDATE
  if not v_system then
    new.uploaded_by := old.uploaded_by;
    new.created_by  := old.created_by;
    -- I74.28: a caller whose only standing is owning the deliverable adds versions — she does not
    -- rename, move or re-mark the file; those stay the reach rule's (ADR-0134 d.2).
    if not app.library_client_in_reach(app.library_folder_client(old.folder_id))
       and (new.name is distinct from old.name
            or new.folder_id is distinct from old.folder_id
            or new.is_source is distinct from old.is_source
            or new.is_proof is distinct from old.is_proof
            or new.deliverable_id is distinct from old.deliverable_id) then
      raise exception 'you cannot change this client''s files' using errcode = '42501';
    end if;
  end if;
  if new.folder_id is distinct from old.folder_id then
    select client_id into v_old_client from asset_folders where id = old.folder_id;
    select client_id, case when kind = 'deliverable' then deliverable_id end
      into v_new_client, v_piece from asset_folders where id = new.folder_id;
    if v_new_client is null or v_new_client is distinct from v_old_client then
      raise exception 'another client' using errcode = '42501';
    end if;
    if v_piece is not null then
      new.deliverable_id := v_piece;
    end if;
  end if;
  if (new.deleted_at is distinct from old.deleted_at or new.deleted_by is distinct from old.deleted_by)
     and not v_system then
    if not app.library_may_delete(old.id) then
      raise exception 'only the uploader, the client''s account manager or a Power Admin may delete or bring back this file'
        using errcode = '42501';
    end if;
    new.deleted_by := case when new.deleted_at is null then null else auth.uid() end;
  end if;
  return new;
end $$;

-- ================================================================== the add RPCs ====

-- private: the asset the caller is adding a version to — the reach rule, or her own deliverable's folder
create or replace function app.library_asset_for_adding(p_asset uuid) returns assets
language plpgsql stable set search_path = public, app, extensions as $$
declare a assets;
begin
  select * into a from assets where id = p_asset and deleted_at is null;   -- RLS: tenant + view
  if a.id is null then
    raise exception 'file not found' using errcode = 'P0002';
  end if;
  if not public.library_can_add(a.folder_id) then
    raise exception 'you cannot change this client''s files' using errcode = '42501';
  end if;
  return a;
end $$;
revoke execute on function app.library_asset_for_adding(uuid) from public, anon;
grant execute on function app.library_asset_for_adding(uuid) to authenticated;

-- 5 (re-emitted; the only change: library_asset_for_adding in place of library_asset_for_change) ----
create or replace function public.library_add_version(
  p_asset uuid, p_object_key text, p_content_type text, p_size bigint,
  p_thumb_object_key text default null, p_duration numeric default null)
returns integer
language plpgsql set search_path = public, app, extensions as $$
declare
  a assets := app.library_asset_for_adding(p_asset);
  v int;
begin
  if p_object_key is null then
    raise exception 'a new version needs its file' using errcode = '22023';
  end if;
  perform app.library_check_object_key(p_object_key, app.library_folder_client(a.folder_id));
  perform app.library_check_object_key(p_thumb_object_key, app.library_folder_client(a.folder_id));
  select current_version + 1 into v from assets where id = a.id for update;
  insert into asset_versions (tenant_id, asset_id, version, object_key, content_type, size_bytes,
                              thumb_object_key, duration_seconds, uploaded_by)
  values (a.tenant_id, a.id, v, p_object_key, p_content_type, p_size, p_thumb_object_key, p_duration, auth.uid());
  update assets
     set current_version = v, object_key = p_object_key, content_type = p_content_type, size_bytes = p_size,
         thumb_object_key = p_thumb_object_key, duration_seconds = p_duration,
         provider = case when provider = 'external' then 'b2' else provider end,
         link_url = null, link_expires_on = null, link_expiry_notified_at = null,
         archived_at = null, brought_back_until = null
   where id = a.id;
  return v;
end $$;

-- 6 (re-emitted; the same one change) ---------------------------------------------------
create or replace function public.library_add_link_version(p_asset uuid, p_url text, p_expires_on date default null)
returns integer
language plpgsql set search_path = public, app, extensions as $$
declare
  a assets := app.library_asset_for_adding(p_asset);
  v int;
begin
  if p_url is null or p_url !~* '^https?://\S+$' then
    raise exception 'a link must start with http:// or https://' using errcode = '22023';
  end if;
  if a.provider <> 'external' then
    raise exception 'only a link takes a new link' using errcode = '22023';
  end if;
  select current_version + 1 into v from assets where id = a.id for update;
  insert into asset_versions (tenant_id, asset_id, version, link_url, uploaded_by)
  values (a.tenant_id, a.id, v, btrim(p_url), auth.uid());
  update assets
     set current_version = v, link_url = btrim(p_url), link_expires_on = p_expires_on,
         link_expiry_notified_at = null
   where id = a.id;
  return v;
end $$;

-- 15 (re-emitted; the only change: library_can_add(folder) in place of library_can_change(client)) --
create or replace function public.library_add_link(p_folder uuid, p_name text, p_url text, p_expires_on date default null)
returns uuid
language plpgsql set search_path = public, app, extensions as $$
declare
  v_client uuid := app.library_folder_client(p_folder);
  v_id uuid;
begin
  if v_client is null then
    raise exception 'folder not found' using errcode = 'P0002';
  end if;
  if not public.library_can_add(p_folder) then
    raise exception 'you cannot change this client''s files' using errcode = '42501';
  end if;
  if p_url is null or p_url !~* '^https?://\S+$' then
    raise exception 'a link must start with http:// or https://' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'a name is required' using errcode = '22023';
  end if;
  insert into assets (tenant_id, folder_id, name, provider, object_key, current_version, link_url, link_expires_on, uploaded_by)
  values (app.current_tenant_id(), p_folder, btrim(p_name), 'external', null, 1, btrim(p_url), p_expires_on, auth.uid())
  returning id into v_id;
  insert into asset_versions (tenant_id, asset_id, version, link_url, uploaded_by)
  values (app.current_tenant_id(), v_id, 1, btrim(p_url), auth.uid());
  return v_id;
end $$;

-- create or replace keeps grants; restated so the file stands alone.
revoke execute on function public.library_add_version(uuid, text, text, bigint, text, numeric) from public, anon;
revoke execute on function public.library_add_link_version(uuid, text, date) from public, anon;
revoke execute on function public.library_add_link(uuid, text, text, date) from public, anon;
grant execute on function public.library_add_version(uuid, text, text, bigint, text, numeric) to authenticated;
grant execute on function public.library_add_link_version(uuid, text, date) to authenticated;
grant execute on function public.library_add_link(uuid, text, text, date) to authenticated;

commit;
