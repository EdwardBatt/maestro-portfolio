-- ADR-0134 (I72) — the Library is a reference everyone reads, every file has a menu, and nothing is
-- lost by a change.
--
-- What changes, in one place:
--   * Reading is company-wide (`assets:view`, every client). Changing is `assets:manage` WITHIN the
--     holder's reach (d.2) — `app.library_client_in_reach`. Deleting is personal: the uploader (a
--     folder's maker), the client's account manager, or a Power Admin (d.3) — and it is a soft
--     delete into the client's Recently deleted for 30 days (d.9); the purge is the sweep's.
--   * The standard folders are locked in the DATABASE (d.19, closing L1.5's parked trigger); a made
--     folder is deleted only when empty (d.20/d.24); nothing moves across clients (d.10/d.27).
--   * Every deliverable of a campaign gets its own folder under Deliverables (d.22).
--   * Links are rows (`provider='external'`, `link_url`, optional expiry — d.16–18); versions carry a
--     note ("made current from v2", d.7) and thumbnails sit beside objects (d.26).
--   * Look-alike projects: closing the duplicate folds its files into the one that stays (d.21).
--   * ADR-0136 d.1 retires ADR-0023 d.4's 60-day clock on replaced review rounds — here, because the
--     columns this migration adds are the ones the new single clock (migration 3) reads.
--
-- SECURITY DEFINER in this file — each one carries its reason beside it (AGENTS.md §6). The pattern
-- throughout is ADR-0022's provisioning functions and ADR-0037's primitives: the helpers that DECIDE
-- (reach, may-delete) read rows the caller's own RLS may hide (another person's task, a client's
-- account manager), so they run as definer, take no tenant from a parameter, and answer only a
-- boolean or an id about the caller's own tenant.

begin;

-- ======================================================================== columns ====

alter table assets
  add column if not exists deleted_at              timestamptz,
  add column if not exists deleted_by              uuid references user_profiles(id),
  add column if not exists link_url                text,
  add column if not exists link_expires_on         date,
  add column if not exists link_expiry_notified_at timestamptz,
  add column if not exists thumb_object_key        text,
  add column if not exists duration_seconds        numeric,
  add column if not exists is_source               boolean not null default false,
  add column if not exists is_proof                boolean not null default false,
  add column if not exists archived_at             timestamptz,
  add column if not exists brought_back_until      timestamptz,
  add column if not exists deliverable_id          uuid references deliverables(id) on delete set null;

alter table assets
  add constraint chk_assets_link_url check (link_url is null or link_url ~* '^https?://'),
  add constraint chk_assets_duration check (duration_seconds is null or duration_seconds >= 0);

comment on column assets.deleted_at is
  'ADR-0134 d.9: in the client''s Recently deleted since then; purged from storage and removed 30 days later by library-sweep.';
comment on column assets.link_url is
  'ADR-0134 d.16: a link row (provider = external, no object_key). The current version''s address.';
comment on column assets.deliverable_id is
  'ADR-0134 d.22/d.24: the piece this file was filed for (set from its piece folder).';

create index if not exists idx_assets_deleted on assets (deleted_at) where deleted_at is not null;
create index if not exists idx_assets_link_expiry on assets (link_expires_on)
  where link_expires_on is not null and deleted_at is null and link_expiry_notified_at is null;
create index if not exists idx_assets_deliverable on assets (deliverable_id) where deliverable_id is not null;

alter table asset_versions
  add column if not exists link_url         text,
  add column if not exists thumb_object_key text,
  add column if not exists duration_seconds numeric,
  add column if not exists note             text,
  add column if not exists archived_at      timestamptz;
alter table asset_versions
  add constraint chk_asset_versions_link_url check (link_url is null or link_url ~* '^https?://');

-- Piece folders (d.22).
alter table asset_folders drop constraint if exists asset_folders_kind_check;
alter table asset_folders add constraint asset_folders_kind_check
  check (kind in ('client_root','brand_root','brand','projects_root','campaign','asset_type','custom','deliverable'));
alter table asset_folders
  add column if not exists deliverable_id uuid references deliverables(id) on delete cascade;
create unique index if not exists uq_asset_folders_deliverable on asset_folders (deliverable_id)
  where deliverable_id is not null;

-- ADR-0136 d.1: the archive clock's length, a Power Admin setting, beside the other storage settings.
alter table tenant_storage_settings
  add column if not exists archive_after_days integer not null default 90
    check (archive_after_days between 1 and 3650);
comment on column tenant_storage_settings.archive_after_days is
  'ADR-0136 d.1: a closed project''s working files go to the office server this many days after it closes.';
comment on column tenant_storage_settings.working_retention_days is
  'RETIRED by ADR-0136 d.1 (ADR-0023 d.4''s 60-day clock on replaced review rounds). Read by nothing.';

-- ADR-0134 d.21 / ADR-0135 d.3: a closed duplicate that folded its files into the job that stays.
-- The normalised-name index (migration 2) leaves it out, which is what lets the duplicates be closed
-- first and the rule go on after (ADR-0135 d.3). Reopening it clears this and meets the index.
alter table campaigns
  add column if not exists merged_into_id uuid references campaigns(id) on delete set null;
comment on column campaigns.merged_into_id is
  'ADR-0134 d.21: closed as a look-alike of this campaign; its files were moved there.';

-- ================================================================== small helpers ====

create or replace function app.library_normal_name(p_name text) returns text
language sql immutable set search_path = pg_catalog as $$
  select lower(regexp_replace(btrim(p_name), '\s+', ' ', 'g'))
$$;

-- Who is acting, as a system rather than a person: a trigger fired by another trigger (a cascade, a
-- rename that follows a campaign), a SECURITY DEFINER function that decided authority itself (it runs
-- as its owner, never as `authenticated`), a definer RPC that raised `app.system_op`, or no user at all
-- (migrations, service-role jobs). A person is the `authenticated` role writing directly — PostgREST,
-- or one of the SECURITY INVOKER RPCs below. Called only from the INVOKER guard triggers, so
-- current_user is the writer's.
create or replace function app.library_system_context() returns boolean
language sql stable set search_path = public, app, extensions as $$
  select pg_trigger_depth() > 1
      or coalesce(current_setting('app.system_op', true), '') = 'on'
      or auth.uid() is null
      or current_user not in ('authenticated', 'anon')
$$;

-- SECURITY DEFINER: the caller's RLS hides deleted rows and (for a portal-less but view-less role)
-- folders; the policies below need the client of a row regardless. Returns an id only, own tenant only.
create or replace function app.library_folder_client(p_folder uuid) returns uuid
language sql stable security definer set search_path = public, app, extensions as $$
  select f.client_id from asset_folders f
   where f.id = p_folder and f.tenant_id = app.current_tenant_id()
$$;

create or replace function app.library_asset_client(p_asset uuid) returns uuid
language sql stable security definer set search_path = public, app, extensions as $$
  select f.client_id from assets a join asset_folders f on f.id = a.folder_id
   where a.id = p_asset and a.tenant_id = app.current_tenant_id()
$$;

-- ==================================================================== reach (d.2) ====
-- SECURITY DEFINER: reach is decided from rows the caller cannot necessarily read — a task assigned
-- to somebody else in their department, a campaign's account manager, a scope grant — exactly as
-- app.in_write_scope is. Tenant from the JWT, never a parameter; answers a boolean.
--
--   tenant / all_accounts  every client
--   account                the client's account manager, or any of its campaigns'
--   department             a live task of the client's work assigned to someone in my department,
--                          or a piece of the client's whose department is mine
--   team                   a live task of the client's work in my team
--   self                   a task of the client's work assigned to me
--   + user_scope_grants    a granted department / team, read as the department / team rules
--   + any scope            a campaign of the client I am account manager of, or started — so the
--                          person who opened a job can file its brief proof before any task exists
create or replace function app.library_client_in_reach(p_client uuid) returns boolean
language plpgsql stable security definer set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_me     uuid := auth.uid();
  v_scope  text;
  v_dept   uuid;
  v_team   uuid;
begin
  if p_client is null or v_tenant is null or v_me is null then
    return false;
  end if;
  if not exists (select 1 from clients c where c.id = p_client and c.tenant_id = v_tenant) then
    return false;
  end if;

  v_scope := app.current_scope();
  if v_scope in ('tenant', 'all_accounts') then
    return true;
  end if;

  if exists (select 1 from clients c where c.id = p_client and c.account_manager_id = v_me)
     or exists (select 1 from campaigns c
                 where c.client_id = p_client and c.tenant_id = v_tenant
                   and (c.account_manager_id = v_me or c.created_by = v_me)) then
    return true;
  end if;

  v_dept := app.current_department_id();
  v_team := app.current_team_id();

  return exists (
    select 1
      from deliverables d
      left join streams s   on s.id = d.stream_id
      left join campaigns c on c.id = s.campaign_id
      left join jobs j      on j.id = d.job_id
     where d.tenant_id = v_tenant
       and coalesce(c.client_id, j.client_id) = p_client
       and (
         (v_scope = 'department' and v_dept is not null and d.department_id = v_dept)
         or exists (
           select 1 from user_scope_grants g
            where g.user_id = v_me and g.tenant_id = v_tenant
              and g.department_id is not null and g.department_id = d.department_id)
         or exists (
           select 1
             from sub_tasks t
             left join user_profiles u on u.id = t.assignee_id
            where t.deliverable_id = d.id
              and (
                (v_scope = 'self' and t.assignee_id = v_me)
                or (t.status not in ('done', 'cancelled') and (
                      (v_scope = 'department' and v_dept is not null
                         and (u.department_id = v_dept or t.department_id = v_dept))
                   or (v_scope = 'team' and v_team is not null
                         and (u.team_id = v_team or t.team_id = v_team))
                   or exists (
                        select 1 from user_scope_grants g
                         where g.user_id = v_me and g.tenant_id = v_tenant
                           and ((g.department_id is not null
                                   and (u.department_id = g.department_id or t.department_id = g.department_id))
                             or (g.team_id is not null
                                   and (u.team_id = g.team_id or t.team_id = g.team_id))))
                ))
              ))
       ));
end $$;

comment on function app.library_client_in_reach(uuid) is
  'ADR-0134 d.2: is this client within the caller''s reach for changing Library files? SECURITY DEFINER '
  '(reads tasks and account managers the caller may not see); tenant from the JWT; boolean only.';

revoke execute on function app.library_client_in_reach(uuid) from public, anon;
grant execute on function app.library_client_in_reach(uuid) to authenticated, service_role;

create or replace function public.library_can_change(p_client uuid) returns boolean
language sql stable set search_path = public, app, extensions as $$
  select coalesce(app.has_permission('assets', 'manage') and app.library_client_in_reach(p_client), false)
$$;
comment on function public.library_can_change(uuid) is
  'ADR-0134 d.2: assets:manage AND the client within reach. THE check for every Library change — the '
  'asset-url Edge Function asks it through the caller-scoped client (ADR-0037).';
revoke execute on function public.library_can_change(uuid) from public, anon;
grant execute on function public.library_can_change(uuid) to authenticated;

-- =============================================================== may delete (d.3) ====
-- SECURITY DEFINER: the client's account manager and the caller's role key are read from rows the
-- caller may not see; tenant-fenced; boolean only.
create or replace function app.library_may_delete_by(p_owner uuid, p_client uuid) returns boolean
language sql stable security definer set search_path = public, app, extensions as $$
  select auth.uid() is not null
     and exists (select 1 from clients c where c.id = p_client and c.tenant_id = app.current_tenant_id())
     and (
       p_owner = auth.uid()
       or exists (select 1 from clients c where c.id = p_client and c.account_manager_id = auth.uid())
       or exists (select 1 from roles r where r.id = app.current_role_id() and r.key = 'power_admin')
     )
$$;

create or replace function app.library_may_delete(p_asset uuid) returns boolean
language sql stable security definer set search_path = public, app, extensions as $$
  select coalesce((
    select app.library_may_delete_by(coalesce(a.uploaded_by, a.created_by), f.client_id)
      from assets a join asset_folders f on f.id = a.folder_id
     where a.id = p_asset and a.tenant_id = app.current_tenant_id()), false)
$$;

create or replace function app.library_may_delete_folder(p_folder uuid) returns boolean
language sql stable security definer set search_path = public, app, extensions as $$
  select coalesce((
    select app.library_may_delete_by(f.created_by, f.client_id)
      from asset_folders f
     where f.id = p_folder and f.tenant_id = app.current_tenant_id()), false)
$$;

revoke execute on function app.library_may_delete_by(uuid, uuid) from public, anon;
revoke execute on function app.library_may_delete(uuid) from public, anon;
revoke execute on function app.library_may_delete_folder(uuid) from public, anon;
grant execute on function app.library_may_delete_by(uuid, uuid) to authenticated, service_role;
grant execute on function app.library_may_delete(uuid) to authenticated, service_role;
grant execute on function app.library_may_delete_folder(uuid) to authenticated, service_role;

-- ============================================================================ RLS ====
-- The tenant-wide write policies of 20260816120000 go; FORCE RLS stays as it was.

drop policy if exists asset_folders_tenant_select on asset_folders;
drop policy if exists asset_folders_tenant_write on asset_folders;
drop policy if exists assets_tenant_select on assets;
drop policy if exists assets_tenant_write on assets;
drop policy if exists asset_versions_tenant_select on asset_versions;
drop policy if exists asset_versions_tenant_write on asset_versions;
drop policy if exists asset_references_tenant_select on asset_references;
drop policy if exists asset_references_tenant_write on asset_references;

-- ---- asset_folders
create policy asset_folders_tenant_select on asset_folders
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and (select app.has_permission('assets', 'view')));
create policy asset_folders_reach_insert on asset_folders
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id()
              and (select app.has_permission('assets', 'manage'))
              and app.library_client_in_reach(client_id));
create policy asset_folders_reach_update on asset_folders
  for update to authenticated
  using (tenant_id = app.current_tenant_id()
         and (select app.has_permission('assets', 'manage'))
         and app.library_client_in_reach(client_id))
  with check (tenant_id = app.current_tenant_id()
              and (select app.has_permission('assets', 'manage'))
              and app.library_client_in_reach(client_id));
create policy asset_folders_owner_delete on asset_folders
  for delete to authenticated
  using (tenant_id = app.current_tenant_id() and app.library_may_delete_folder(id));

-- ---- assets (no user DELETE: the purge is library-sweep's, under the service role)
create policy assets_tenant_select on assets
  for select to authenticated
  using (tenant_id = app.current_tenant_id()
         and (select app.has_permission('assets', 'view'))
         and (deleted_at is null
              or app.library_may_delete_by(coalesce(uploaded_by, created_by), app.library_folder_client(folder_id))));
create policy assets_reach_insert on assets
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id()
              and (select app.has_permission('assets', 'manage'))
              and app.library_client_in_reach(app.library_folder_client(folder_id)));
create policy assets_reach_update on assets
  for update to authenticated
  using (tenant_id = app.current_tenant_id()
         and (select app.has_permission('assets', 'manage'))
         and app.library_client_in_reach(app.library_folder_client(folder_id)))
  with check (tenant_id = app.current_tenant_id()
              and (select app.has_permission('assets', 'manage'))
              and app.library_client_in_reach(app.library_folder_client(folder_id)));

-- ---- asset_versions (visible with their asset — a deleted asset's versions hide with it)
create policy asset_versions_tenant_select on asset_versions
  for select to authenticated
  using (tenant_id = app.current_tenant_id()
         and (select app.has_permission('assets', 'view'))
         and exists (select 1 from assets a where a.id = asset_versions.asset_id));
create policy asset_versions_reach_insert on asset_versions
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id()
              and (select app.has_permission('assets', 'manage'))
              and app.library_client_in_reach(app.library_asset_client(asset_id)));
create policy asset_versions_reach_update on asset_versions
  for update to authenticated
  using (tenant_id = app.current_tenant_id()
         and (select app.has_permission('assets', 'manage'))
         and app.library_client_in_reach(app.library_asset_client(asset_id)))
  with check (tenant_id = app.current_tenant_id()
              and (select app.has_permission('assets', 'manage'))
              and app.library_client_in_reach(app.library_asset_client(asset_id)));

-- ---- asset_references
create policy asset_references_tenant_select on asset_references
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and (select app.has_permission('assets', 'view')));
create policy asset_references_reach_write on asset_references
  for all to authenticated
  using (tenant_id = app.current_tenant_id()
         and (select app.has_permission('assets', 'manage'))
         and app.library_client_in_reach(app.library_asset_client(asset_id)))
  with check (tenant_id = app.current_tenant_id()
              and (select app.has_permission('assets', 'manage'))
              and app.library_client_in_reach(app.library_asset_client(asset_id)));

-- ======================================================================= triggers ====

-- ---- folders: standard folders locked (d.19), made folders deleted only when empty (d.20/d.24),
--      moves within the client and never into their own subtree (d.27).
-- SECURITY DEFINER: the re-homing must reach every Recently-deleted file in the folder, including
-- another uploader's the person deleting the folder cannot see. Moves only that folder's files to its
-- own parent (same client by construction).
create or replace function app.library_rehome_deleted(p_folder uuid, p_parent uuid) returns void
language sql security definer set search_path = public, app, extensions as $$
  update assets set folder_id = p_parent
   where folder_id = p_folder and deleted_at is not null and tenant_id = app.current_tenant_id()
$$;
revoke execute on function app.library_rehome_deleted(uuid, uuid) from public, anon;
grant execute on function app.library_rehome_deleted(uuid, uuid) to authenticated, service_role;

-- SECURITY INVOKER on purpose: library_system_context reads current_user, which a definer would mask.
create or replace function app.tg_library_folder_guard() returns trigger
language plpgsql set search_path = public, app, extensions as $$
declare
  v_system  boolean := app.library_system_context();
  v_parent  asset_folders;
  v_files   int;
  v_folders int;
begin
  if tg_op = 'DELETE' then
    if v_system then
      return old;                        -- a cascade from a client / brand / campaign / piece
    end if;
    if old.is_system then
      raise exception 'standard folder' using errcode = '42501';
    end if;
    select count(*) into v_files from assets a where a.folder_id = old.id and a.deleted_at is null;
    if v_files > 0 then
      raise exception 'folder not empty: % files', v_files using errcode = 'P0001';
    end if;
    select count(*) into v_folders from asset_folders c where c.parent_id = old.id;
    if v_folders > 0 then
      raise exception 'folder not empty: % folders', v_folders using errcode = 'P0001';
    end if;
    -- Recently-deleted files inside it keep their 30 days, in the parent (d.9).
    perform app.library_rehome_deleted(old.id, old.parent_id);
    return old;
  end if;

  if tg_op = 'INSERT' then
    if not v_system then
      new.created_by := auth.uid();
      if new.is_system or new.kind <> 'custom' then
        raise exception 'standard folder' using errcode = '42501';
      end if;
      if new.parent_id is null then
        raise exception 'a folder is made inside another folder' using errcode = '22023';
      end if;
    end if;
    if new.parent_id is not null then
      select * into v_parent from asset_folders where id = new.parent_id;
      if v_parent.id is null or v_parent.client_id <> new.client_id or v_parent.tenant_id <> new.tenant_id then
        raise exception 'another client' using errcode = '42501';
      end if;
      -- A made folder belongs to the brand / project it sits in (counts and the archive read these).
      if new.kind = 'custom' then
        new.campaign_id := v_parent.campaign_id;
        new.brand_id    := v_parent.brand_id;
      end if;
    end if;
    return new;
  end if;

  -- UPDATE
  if new.client_id is distinct from old.client_id or new.tenant_id is distinct from old.tenant_id then
    raise exception 'another client' using errcode = '42501';
  end if;
  if not v_system then
    new.created_by := old.created_by;
    if old.is_system and (new.name is distinct from old.name
                          or new.parent_id is distinct from old.parent_id
                          or new.kind is distinct from old.kind
                          or new.is_system is distinct from old.is_system
                          or new.deliverable_id is distinct from old.deliverable_id) then
      raise exception 'standard folder' using errcode = '42501';
    end if;
    if not old.is_system and (new.is_system or new.kind <> 'custom') then
      raise exception 'standard folder' using errcode = '42501';
    end if;
  end if;
  if new.parent_id is distinct from old.parent_id then
    if new.parent_id is null then
      raise exception 'a folder is moved into another folder' using errcode = '22023';
    end if;
    select * into v_parent from asset_folders where id = new.parent_id;
    if v_parent.id is null or v_parent.client_id <> new.client_id then
      raise exception 'another client' using errcode = '42501';
    end if;
    if exists (
      with recursive sub as (
        select id from asset_folders where id = old.id
        union all
        select c.id from asset_folders c join sub on c.parent_id = sub.id
      )
      select 1 from sub where id = new.parent_id
    ) then
      raise exception 'a folder cannot be moved into itself' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists library_folder_guard on asset_folders;
create trigger library_folder_guard
  before insert or update or delete on asset_folders
  for each row execute function app.tg_library_folder_guard();

-- ---- assets: who uploaded is the database's to say, a deletion is the three's (d.3), a file never
--      changes client (d.10), a file filed into a piece's folder belongs to that piece (d.22).
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

drop trigger if exists library_asset_guard on assets;
create trigger library_asset_guard
  before insert or update on assets
  for each row execute function app.tg_library_asset_guard();

-- ==================================================================== backfills ====

-- Made folders take the brand / project of the folder they sit in (the guard does it from now on).
with recursive tree as (
  select f.id, f.campaign_id, f.brand_id from asset_folders f where f.kind <> 'custom'
  union all
  select c.id, t.campaign_id, t.brand_id
    from asset_folders c join tree t on c.parent_id = t.id
   where c.kind = 'custom'
)
update asset_folders f
   set campaign_id = t.campaign_id, brand_id = t.brand_id
  from tree t
 where f.id = t.id and f.kind = 'custom'
   and (f.campaign_id is distinct from t.campaign_id or f.brand_id is distinct from t.brand_id);

-- d.25: brief proofs filed into References are marked.
update assets a set is_proof = true
  from campaign_brief_receipts r
 where r.asset_id = a.id and not a.is_proof;

create or replace function app.tg_library_mark_proof() returns trigger
language plpgsql security definer set search_path = public, app, extensions as $$
-- SECURITY DEFINER: the receipt's writer need not hold assets:manage over the client (the wizard does
-- not require it, ADR-0044 §8); the flag is set on the one asset the receipt names, same tenant only.
begin
  if new.asset_id is not null then
    update assets set is_proof = true
     where id = new.asset_id and tenant_id = new.tenant_id and not is_proof;
  end if;
  return new;
end $$;

drop trigger if exists library_mark_proof on campaign_brief_receipts;
create trigger library_mark_proof
  after insert or update of asset_id on campaign_brief_receipts
  for each row execute function app.tg_library_mark_proof();

-- ADR-0136 d.1: ADR-0023 d.4's clock is retired. Nothing new goes on it, nothing on it is due.
create or replace function app.tg_media_supersede_prior() returns trigger
language plpgsql security definer set search_path = public, app as $$
-- SECURITY DEFINER (unchanged from 20260817100100): the bookkeeping update on sibling rows is not
-- blocked by the inserter's own write policy; scoped to new.tenant_id / deliverable.
begin
  update media_records
     set superseded_at = now()
   where deliverable_id = new.deliverable_id
     and tenant_id      = new.tenant_id
     and version        < new.version
     and delivered_at is null
     and superseded_at is null;
  return new;
end $$;
comment on function app.tg_media_supersede_prior() is
  'ADR-0023, amended by ADR-0136 d.1: records when a round was replaced. It no longer starts an archive clock.';

update media_records set archive_due_at = null where archive_due_at is not null;

create or replace function app.media_records_due_for_archive()
returns setof media_records
language sql stable set search_path = public as $$
  -- ADR-0136 d.1: retired. Nothing in a live project is archived; the one clock is
  -- app.library_archive_due (closed_at + archive_after_days).
  select * from media_records where false
$$;
comment on function app.media_records_due_for_archive() is
  'RETIRED by ADR-0136 d.1 — always empty. See app.library_archive_due.';

-- =========================================================== piece folders (d.22) ====

create or replace function app.library_piece_folder_name(p_code text, p_name text) returns text
language sql immutable set search_path = pg_catalog as $$
  select case when nullif(btrim(coalesce(p_code, '')), '') is null
              then coalesce(nullif(btrim(p_name), ''), 'Deliverable')
              else btrim(p_code) || ' · ' || coalesce(nullif(btrim(p_name), ''), 'Deliverable') end
$$;

-- SECURITY DEFINER: runs from the deliverables trigger, whoever wrote the piece (a lead with
-- project_tasks:manage need not hold assets:manage) — the ADR-0022 provisioning pattern. Writes only
-- the one folder of the piece it is given, in that piece's own tenant.
create or replace function app.library_sync_piece_folder(p_deliverable uuid) returns void
language plpgsql security definer set search_path = public, app, extensions as $$
declare
  d          deliverables;
  v_campaign uuid;
  v_parent   asset_folders;
  v_folder   asset_folders;
  v_name     text;
begin
  select * into d from deliverables where id = p_deliverable;
  if d.id is null then return; end if;
  v_campaign := app.deliverable_campaign(d.id);
  if v_campaign is null then return; end if;

  select * into v_parent from asset_folders
   where campaign_id = v_campaign and kind = 'asset_type' and name = 'Deliverables' limit 1;
  if v_parent.id is null then
    perform app.provision_campaign_folders(v_campaign);
    select * into v_parent from asset_folders
     where campaign_id = v_campaign and kind = 'asset_type' and name = 'Deliverables' limit 1;
  end if;
  if v_parent.id is null then return; end if;

  select * into v_folder from asset_folders where deliverable_id = d.id;
  if v_folder.id is not null and v_folder.client_id <> v_parent.client_id then
    return;                                            -- files never cross clients (d.10)
  end if;

  v_name := app.library_piece_folder_name(d.code, d.name);
  if exists (select 1 from asset_folders x
              where x.client_id = v_parent.client_id and x.parent_id = v_parent.id
                and x.name = v_name and x.id is distinct from v_folder.id) then
    v_name := v_name || ' (' || left(d.id::text, 4) || ')';
  end if;

  if v_folder.id is null then
    insert into asset_folders (tenant_id, client_id, parent_id, name, kind, campaign_id, deliverable_id, is_system)
    values (d.tenant_id, v_parent.client_id, v_parent.id, v_name, 'deliverable', v_campaign, d.id, true);
  elsif v_folder.name is distinct from v_name or v_folder.parent_id is distinct from v_parent.id
        or v_folder.campaign_id is distinct from v_campaign then
    update asset_folders
       set name = v_name, parent_id = v_parent.id, campaign_id = v_campaign
     where id = v_folder.id;
    -- Made folders inside the piece's folder go with it.
    with recursive sub as (
      select id from asset_folders where parent_id = v_folder.id
      union all
      select c.id from asset_folders c join sub on c.parent_id = sub.id
    )
    update asset_folders set campaign_id = v_campaign where id in (select id from sub);
  end if;
end $$;

create or replace function app.tg_library_piece_folder() returns trigger
language plpgsql security definer set search_path = public, app, extensions as $$
-- SECURITY DEFINER: see app.library_sync_piece_folder.
begin
  if tg_op = 'UPDATE'
     and new.name is not distinct from old.name and new.code is not distinct from old.code
     and new.stream_id is not distinct from old.stream_id and new.job_id is not distinct from old.job_id then
    return new;
  end if;
  perform app.library_sync_piece_folder(new.id);
  return new;
end $$;

drop trigger if exists library_piece_folder on deliverables;
create trigger library_piece_folder
  after insert or update of name, code, stream_id, job_id on deliverables
  for each row execute function app.tg_library_piece_folder();

select app.library_sync_piece_folder(d.id) from deliverables d order by d.created_at, d.id;

-- ======================================================= look-alike projects (d.21) ====
-- SECURITY DEFINER: closing is close_out_campaign's authority (projects:manage + scope), decided
-- before this runs; the person closing need not hold assets:manage. Moves only within one client and
-- one tenant, only live files, only from the campaign being closed.
create or replace function app.library_fold_lookalike(p_campaign uuid) returns uuid
language plpgsql security definer set search_path = public, app, extensions as $$
declare
  c        campaigns;
  v_keep   campaigns;
  v_src    record;
  v_dest   uuid;
begin
  select * into c from campaigns where id = p_campaign;
  if c.id is null then return null; end if;

  select * into v_keep from campaigns k
   where k.tenant_id = c.tenant_id and k.client_id = c.client_id and k.id <> c.id
     and k.status <> 'closed' and k.merged_into_id is null
     and app.library_normal_name(k.name) = app.library_normal_name(c.name)
   order by k.created_at, k.id
   limit 1;
  if v_keep.id is null then return null; end if;

  perform app.provision_campaign_folders(v_keep.id);

  -- The campaign root and its four standard folders each have a counterpart.
  for v_src in
    select f.id, f.kind, f.name from asset_folders f
     where f.campaign_id = c.id and f.kind in ('campaign', 'asset_type')
  loop
    select t.id into v_dest from asset_folders t
     where t.campaign_id = v_keep.id and t.kind = v_src.kind
       and (v_src.kind = 'campaign' or t.name = v_src.name)
     limit 1;
    continue when v_dest is null;

    update assets set folder_id = v_dest where folder_id = v_src.id and deleted_at is null;

    -- Made folders move with their contents; a name already taken there is told apart.
    update asset_folders m
       set parent_id = v_dest,
           name = case when exists (select 1 from asset_folders x where x.parent_id = v_dest and x.name = m.name)
                       then m.name || ' (' || c.name || ')' else m.name end
     where m.parent_id = v_src.id and m.kind = 'custom';
  end loop;

  with recursive sub as (
    select f.id from asset_folders f
     where f.campaign_id = c.id and f.kind = 'custom'
       and f.parent_id in (select id from asset_folders where campaign_id = v_keep.id)
    union all
    select x.id from asset_folders x join sub on x.parent_id = sub.id
  )
  update asset_folders set campaign_id = v_keep.id where id in (select id from sub);

  update campaigns set merged_into_id = v_keep.id where id = c.id;
  return v_keep.id;
end $$;

create or replace function app.tg_library_fold_lookalike() returns trigger
language plpgsql security definer set search_path = public, app, extensions as $$
-- SECURITY DEFINER: see app.library_fold_lookalike. Reopening clears the mark (ADR-0135's index then
-- refuses the reopen while the look-alike stays open, which is the rule).
begin
  if new.status = 'closed' and old.status is distinct from 'closed' then
    perform app.library_fold_lookalike(new.id);
  elsif new.status <> 'closed' and old.status = 'closed' and new.merged_into_id is not null then
    update campaigns set merged_into_id = null where id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists library_fold_lookalike on campaigns;
create trigger library_fold_lookalike
  after update of status on campaigns
  for each row execute function app.tg_library_fold_lookalike();

-- ============================================================== read helpers ====

create or replace function app.library_folder_path(p_folder uuid) returns text
language sql stable set search_path = public, app, extensions as $$
  with recursive up as (
    select f.id, f.parent_id, f.name, 0 as depth from asset_folders f where f.id = p_folder
    union all
    select p.id, p.parent_id, p.name, up.depth + 1 from asset_folders p join up on p.id = up.parent_id
  )
  select string_agg(name, ' / ' order by depth desc) from up
$$;

create or replace function app.library_kind_bucket(p_content_type text, p_link_url text, p_is_proof boolean)
returns text language sql immutable set search_path = pg_catalog as $$
  select case
    when p_is_proof then 'proof'
    when p_link_url is not null then 'link'
    when p_content_type like 'image/%' then 'image'
    when p_content_type like 'video/%' then 'video'
    when p_content_type = 'application/pdf'
      or p_content_type like 'text/%'
      or p_content_type like 'application/msword%'
      or p_content_type like 'application/vnd.openxmlformats-officedocument%'
      or p_content_type like 'application/vnd.ms-%'
      or p_content_type like 'application/vnd.oasis.opendocument%'
      or p_content_type in ('application/rtf', 'application/vnd.apple.pages', 'application/vnd.apple.keynote',
                            'application/vnd.apple.numbers')
      then 'document'
    else 'other' end
$$;

-- One file as the frontend reads it (library_folder / library_piece_folders).
create or replace function app.library_file_json(p assets) returns jsonb
language sql stable set search_path = public, app, extensions as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'content_type', p.content_type, 'size_bytes', p.size_bytes,
    'current_version', p.current_version, 'uploaded_by', p.uploaded_by,
    'uploaded_by_name', (select u.display_name from user_profiles u where u.id = coalesce(p.uploaded_by, p.created_by)),
    'created_at', p.created_at, 'updated_at', p.updated_at, 'link_url', p.link_url,
    'link_expires_on', p.link_expires_on, 'thumb_object_key', p.thumb_object_key,
    'duration_seconds', p.duration_seconds, 'is_source', p.is_source, 'is_proof', p.is_proof,
    'archived_at', p.archived_at, 'can_delete', app.library_may_delete(p.id))
$$;

-- How a review version's review went (d.23). Read from the task it was uploaded for, or the piece.
create or replace function app.library_review_state(p media_records) returns text
language sql stable set search_path = public, app, extensions as $$
  select case
    when p.delivered_at is not null then 'delivered'
    when exists (select 1 from media_records n
                  where n.deliverable_id = p.deliverable_id and n.version > p.version
                    and n.sub_task_id is not distinct from p.sub_task_id) then 'superseded'
    when p.sub_task_id is not null then (
      select case
        when t.status = 'done' then 'approved'
        when t.status = 'review' then 'in_review'
        when t.status in ('todo', 'in_progress') and coalesce(p.round, 1) <= t.revision_number then 'changes_requested'
        else 'in_review' end
        from sub_tasks t where t.id = p.sub_task_id)
    else (
      select case
        when d.state in ('approved', 'delivered', 'archived') then 'approved'
        when d.state = 'in_review' then 'in_review'
        when coalesce(p.round, 1) <= d.revision_round then 'changes_requested'
        else 'in_review' end
        from deliverables d where d.id = p.deliverable_id)
  end
$$;

-- live files in a folder's whole subtree
create or replace function app.library_subtree_file_count(p_folder uuid) returns bigint
language sql stable set search_path = public, app, extensions as $$
  with recursive sub as (
    select id from asset_folders where id = p_folder
    union all
    select c.id from asset_folders c join sub on c.parent_id = sub.id
  )
  select count(*) from assets a where a.folder_id in (select id from sub) and a.deleted_at is null
$$;

-- =========================================================================== RPCs ====
-- SECURITY INVOKER unless stated: RLS is the enforcement, and every change RPC also asks
-- library_can_change first so a refusal is worded (42501) instead of "0 rows".

-- 1 ------------------------------------------------------------------------------------
create or replace function public.library_clients()
returns table (id uuid, name text, file_count bigint, can_change boolean)
language sql stable set search_path = public, app, extensions as $$
  select c.id, c.name,
         (select count(*) from assets a join asset_folders f on f.id = a.folder_id
           where f.client_id = c.id and a.deleted_at is null) as file_count,
         public.library_can_change(c.id) as can_change
    from clients c
   where c.tenant_id = app.current_tenant_id() and c.status = 'active'
     and (select app.has_permission('assets', 'view'))
   order by c.name
$$;

-- 2 ------------------------------------------------------------------------------------
create or replace function public.library_client_overview(p_client uuid)
returns jsonb
language sql stable set search_path = public, app, extensions as $$
  select case when cl.id is null then null else jsonb_build_object(
    'brand_root_id', (select f.id from asset_folders f where f.client_id = cl.id and f.kind = 'brand_root' limit 1),
    'projects_root_id', (select f.id from asset_folders f where f.client_id = cl.id and f.kind = 'projects_root' limit 1),
    'can_change', public.library_can_change(cl.id),
    'brands', coalesce((
      select jsonb_agg(jsonb_build_object(
               'folder_id', bf.id, 'name', bf.name,
               'file_count', app.library_subtree_file_count(bf.id),
               'subfolders', coalesce((select jsonb_agg(s.name order by s.name) from asset_folders s where s.parent_id = bf.id), '[]'::jsonb))
             order by bf.name)
        from asset_folders bf
       where bf.client_id = cl.id and bf.kind = 'brand'), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
               'folder_id', pf.id, 'campaign_id', c.id, 'name', c.name, 'kind', c.kind,
               'brand_name', b.name,
               'phase_count', (select count(*) from campaign_phases ph where ph.campaign_id = c.id),
               'file_count', (select count(*) from assets a join asset_folders f on f.id = a.folder_id
                               where f.campaign_id = c.id and a.deleted_at is null),
               'delivered_count', (select count(*) from deliverables d join streams s on s.id = d.stream_id
                                    where s.campaign_id = c.id and d.state = 'delivered'),
               'in_review', exists (select 1 from deliverables d join streams s on s.id = d.stream_id
                                     where s.campaign_id = c.id and d.state = 'in_review'),
               'status', c.status,
               'lookalike', (select jsonb_build_object('campaign_id', o.id, 'name', o.name,
                                      'folder_id', (select of.id from asset_folders of where of.campaign_id = o.id and of.kind = 'campaign' limit 1))
                               from campaigns o
                              where o.tenant_id = c.tenant_id and o.id <> c.id
                                and app.library_normal_name(o.name) = app.library_normal_name(c.name)
                              order by o.created_at, o.id limit 1))
             order by c.created_at desc)
        from asset_folders pf
        join campaigns c on c.id = pf.campaign_id
        left join brands b on b.id = c.brand_id
       where pf.client_id = cl.id and pf.kind = 'campaign'), '[]'::jsonb))
  end
  from (select c.id from clients c
         where c.id = p_client and c.tenant_id = app.current_tenant_id()
           and (select app.has_permission('assets', 'view'))) cl
  right join (select 1) one on true
$$;

-- 3 ------------------------------------------------------------------------------------
create or replace function public.library_folder(p_folder uuid)
returns jsonb
language plpgsql stable set search_path = public, app, extensions as $$
declare
  f asset_folders;
  v_campaign jsonb;
begin
  select * into f from asset_folders where id = p_folder;      -- RLS: same tenant + assets:view
  if f.id is null then
    raise exception 'folder not found' using errcode = 'P0002';
  end if;

  if f.campaign_id is not null then
    select jsonb_build_object(
             'id', c.id, 'name', c.name, 'kind', c.kind, 'brand_name', b.name,
             'file_count', (select count(*) from assets a join asset_folders x on x.id = a.folder_id
                             where x.campaign_id = c.id and a.deleted_at is null),
             'opened_by_name', (select u.display_name from user_profiles u where u.id = c.created_by),
             'opened_at', c.created_at)
      into v_campaign
      from campaigns c left join brands b on b.id = c.brand_id
     where c.id = f.campaign_id;
  end if;

  return jsonb_build_object(
    'folder', jsonb_build_object('id', f.id, 'name', f.name, 'kind', f.kind, 'is_system', f.is_system,
                                 'client_id', f.client_id, 'campaign_id', f.campaign_id, 'brand_id', f.brand_id,
                                 'deliverable_id', f.deliverable_id, 'created_by', f.created_by),
    'chain', (with recursive up as (
                select x.id, x.parent_id, x.name, x.kind, 0 as depth from asset_folders x where x.id = f.id
                union all
                select p.id, p.parent_id, p.name, p.kind, up.depth + 1 from asset_folders p join up on p.id = up.parent_id)
              select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kind', kind) order by depth desc) from up),
    'subfolders', coalesce((
       select jsonb_agg(jsonb_build_object(
                'id', s.id, 'name', s.name, 'kind', s.kind, 'is_system', s.is_system,
                'file_count', app.library_subtree_file_count(s.id),
                'updated_at', greatest(s.updated_at, (select max(a.updated_at) from assets a where a.folder_id = s.id and a.deleted_at is null)),
                'note', null)
              order by s.is_system desc, s.name)
         from asset_folders s where s.parent_id = f.id), '[]'::jsonb),
    'files', coalesce((
       select jsonb_agg(app.library_file_json(a) order by lower(a.name), a.created_at)
         from assets a where a.folder_id = f.id and a.deleted_at is null), '[]'::jsonb),
    'can_change', public.library_can_change(f.client_id),
    'can_delete_folder', (not f.is_system) and app.library_may_delete_folder(f.id),
    'campaign', v_campaign);
end $$;

-- 4 ------------------------------------------------------------------------------------
-- Returns an OBJECT — {pieces: [...], piece_count, delivered_count}: the spec's "array plus counts".
create or replace function public.library_piece_folders(p_folder uuid)
returns jsonb
language plpgsql stable set search_path = public, app, extensions as $$
declare
  f asset_folders;
  v_pieces jsonb;
begin
  select * into f from asset_folders where id = p_folder;      -- RLS: same tenant + assets:view
  if f.id is null or f.campaign_id is null then
    raise exception 'folder not found' using errcode = 'P0002';
  end if;

  with pieces as (
    select d.* from deliverables d
      left join streams s on s.id = d.stream_id
      left join jobs j on j.id = d.job_id
     where coalesce(s.campaign_id, j.campaign_id) = f.campaign_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'deliverable_id', d.id, 'code', d.code, 'name', d.name,
           'workstream_name', w.name, 'type_name', t.name_en, 'phase_name', ph.name,
           'state', d.state,
           'folder_id', pf.id,
           'versions', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'id', m.id, 'file_name', m.file_name, 'version', m.version, 'round', m.round,
                       'content_type', m.content_type, 'size_bytes', m.size_bytes,
                       'review_state', app.library_review_state(m), 'created_at', m.created_at)
                     order by m.version desc)
                from media_records m where m.deliverable_id = d.id), '[]'::jsonb),
           'sources', coalesce((
              select jsonb_agg(app.library_file_json(a) order by lower(a.name))
                from assets a where a.folder_id = pf.id and a.deleted_at is null), '[]'::jsonb))
         order by d.code nulls last, d.created_at), '[]'::jsonb)
    into v_pieces
    from pieces d
    left join workstreams w on w.id = d.workstream_id
    left join deliverable_types t on t.id = d.deliverable_type_id
    left join campaign_phases ph on ph.id = d.phase_id
    left join asset_folders pf on pf.deliverable_id = d.id;

  return jsonb_build_object(
    'pieces', v_pieces,
    'piece_count', jsonb_array_length(v_pieces),
    'delivered_count', (select count(*) from jsonb_array_elements(v_pieces) e where e ->> 'state' = 'delivered'));
end $$;

-- private: the asset the caller is changing, with its client — or a worded refusal
create or replace function app.library_asset_for_change(p_asset uuid) returns assets
language plpgsql stable set search_path = public, app, extensions as $$
declare a assets;
begin
  select * into a from assets where id = p_asset and deleted_at is null;   -- RLS: tenant + view
  if a.id is null then
    raise exception 'file not found' using errcode = 'P0002';
  end if;
  if not public.library_can_change(app.library_folder_client(a.folder_id)) then
    raise exception 'you cannot change this client''s files' using errcode = '42501';
  end if;
  return a;
end $$;

create or replace function app.library_check_object_key(p_key text, p_client uuid) returns void
language plpgsql stable set search_path = public, app, extensions as $$
begin
  if p_key is not null and p_key not like app.current_tenant_id()::text || '/' || p_client::text || '/%' then
    raise exception 'another client' using errcode = '42501';
  end if;
end $$;

-- 5 ------------------------------------------------------------------------------------
create or replace function public.library_add_version(
  p_asset uuid, p_object_key text, p_content_type text, p_size bigint,
  p_thumb_object_key text default null, p_duration numeric default null)
returns integer
language plpgsql set search_path = public, app, extensions as $$
declare
  a assets := app.library_asset_for_change(p_asset);
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

-- 6 ------------------------------------------------------------------------------------
create or replace function public.library_add_link_version(p_asset uuid, p_url text, p_expires_on date default null)
returns integer
language plpgsql set search_path = public, app, extensions as $$
declare
  a assets := app.library_asset_for_change(p_asset);
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

-- 7 ------------------------------------------------------------------------------------
create or replace function public.library_make_current(p_asset uuid, p_version integer)
returns integer
language plpgsql set search_path = public, app, extensions as $$
declare
  a assets := app.library_asset_for_change(p_asset);
  src asset_versions;
  v int;
begin
  select * into src from asset_versions where asset_id = a.id and version = p_version;
  if src.id is null then
    raise exception 'version % not found', p_version using errcode = 'P0002';
  end if;
  if src.archived_at is not null then
    raise exception 'that version is archived — bring it back first' using errcode = '22023';
  end if;
  select current_version + 1 into v from assets where id = a.id for update;
  insert into asset_versions (tenant_id, asset_id, version, object_key, content_type, size_bytes, link_url,
                              thumb_object_key, duration_seconds, note, uploaded_by)
  values (a.tenant_id, a.id, v, src.object_key, src.content_type, src.size_bytes, src.link_url,
          src.thumb_object_key, src.duration_seconds, 'made current from v' || p_version, auth.uid());
  update assets
     set current_version = v, object_key = src.object_key, content_type = src.content_type,
         size_bytes = src.size_bytes, link_url = src.link_url, thumb_object_key = src.thumb_object_key,
         duration_seconds = src.duration_seconds, link_expiry_notified_at = null
   where id = a.id;
  return v;
end $$;

-- 8 ------------------------------------------------------------------------------------
create or replace function public.library_versions(p_asset uuid)
returns table (version integer, has_file boolean, link_url text, content_type text, size_bytes bigint,
               uploaded_by_name text, created_at timestamptz, note text, review_note text)
language sql stable set search_path = public, app, extensions as $$
  select v.version, v.object_key is not null, v.link_url, v.content_type, v.size_bytes,
         (select u.display_name from user_profiles u where u.id = coalesce(v.uploaded_by, v.created_by)),
         v.created_at, v.note,
         case when a.deliverable_id is not null and v.object_key is not null then (
           select app.library_review_state(m) from media_records m
            where m.deliverable_id = a.deliverable_id and m.object_key = v.object_key
            order by m.version desc limit 1) end
    from asset_versions v
    join assets a on a.id = v.asset_id
   where v.asset_id = p_asset
   order by v.version desc
$$;

-- 9 ------------------------------------------------------------------------------------
create or replace function public.library_rename(p_asset uuid, p_base text)
returns text
language plpgsql set search_path = public, app, extensions as $$
declare
  a assets := app.library_asset_for_change(p_asset);
  v_ext  text;
  v_base text := btrim(coalesce(p_base, ''));
  v_name text;
begin
  if v_base = '' then
    raise exception 'a name is required' using errcode = '22023';
  end if;
  -- d.8: the extension is the file's own and cannot be typed — strip one the person typed, keep ours.
  if a.provider <> 'external' then
    v_ext := substring(a.name from '(\.[A-Za-z0-9]{1,10})$');
  end if;
  if v_ext is not null and lower(right(v_base, length(v_ext))) = lower(v_ext) then
    v_base := btrim(left(v_base, length(v_base) - length(v_ext)));
  end if;
  v_name := v_base || coalesce(v_ext, '');
  if exists (select 1 from assets x where x.folder_id = a.folder_id and x.id <> a.id and x.deleted_at is null
                                      and lower(x.name) = lower(v_name)) then
    raise exception 'a file named % is already in this folder', v_name using errcode = '23505';
  end if;
  update assets set name = v_name where id = a.id;
  return v_name;
end $$;

-- 10 -----------------------------------------------------------------------------------
create or replace function public.library_move(p_asset uuid, p_folder uuid)
returns void
language plpgsql set search_path = public, app, extensions as $$
declare
  a assets := app.library_asset_for_change(p_asset);
begin
  if app.library_folder_client(p_folder) is distinct from app.library_folder_client(a.folder_id) then
    raise exception 'another client' using errcode = '42501';
  end if;
  update assets set folder_id = p_folder where id = a.id;
end $$;

create or replace function public.library_move_folder(p_folder uuid, p_parent uuid)
returns void
language plpgsql set search_path = public, app, extensions as $$
declare
  f asset_folders;
  p asset_folders;
begin
  select * into f from asset_folders where id = p_folder;
  select * into p from asset_folders where id = p_parent;
  if f.id is null or p.id is null then
    raise exception 'folder not found' using errcode = 'P0002';
  end if;
  if not public.library_can_change(f.client_id) then
    raise exception 'you cannot change this client''s files' using errcode = '42501';
  end if;
  if f.is_system then
    raise exception 'standard folder' using errcode = '42501';
  end if;
  if p.client_id <> f.client_id then
    raise exception 'another client' using errcode = '42501';
  end if;
  update asset_folders set parent_id = p.id, campaign_id = p.campaign_id, brand_id = p.brand_id where id = f.id;
  with recursive sub as (
    select id from asset_folders where parent_id = f.id
    union all
    select c.id from asset_folders c join sub on c.parent_id = sub.id
  )
  update asset_folders set campaign_id = p.campaign_id, brand_id = p.brand_id where id in (select id from sub);
end $$;

create or replace function public.library_rename_folder(p_folder uuid, p_name text)
returns void
language plpgsql set search_path = public, app, extensions as $$
declare
  f asset_folders;
begin
  select * into f from asset_folders where id = p_folder;
  if f.id is null then
    raise exception 'folder not found' using errcode = 'P0002';
  end if;
  if not public.library_can_change(f.client_id) then
    raise exception 'you cannot change this client''s files' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'a name is required' using errcode = '22023';
  end if;
  update asset_folders set name = btrim(p_name) where id = f.id;     -- guard: standard folder; uq: 23505
end $$;

-- 11 -----------------------------------------------------------------------------------
create or replace function public.library_copy_record(
  p_asset uuid, p_folder uuid, p_object_key text, p_thumb_object_key text default null)
returns uuid
language plpgsql set search_path = public, app, extensions as $$
declare
  a assets;
  v_client uuid;
  v_id uuid;
begin
  select * into a from assets where id = p_asset and deleted_at is null;
  if a.id is null then
    raise exception 'file not found' using errcode = 'P0002';
  end if;
  v_client := app.library_folder_client(p_folder);
  if v_client is null then
    raise exception 'folder not found' using errcode = 'P0002';
  end if;
  if v_client is distinct from app.library_folder_client(a.folder_id) then
    raise exception 'another client' using errcode = '42501';
  end if;
  if not public.library_can_change(v_client) then
    raise exception 'you cannot change this client''s files' using errcode = '42501';
  end if;
  if a.provider <> 'external' and p_object_key is null then
    raise exception 'a copy needs its file' using errcode = '22023';
  end if;
  perform app.library_check_object_key(p_object_key, v_client);
  perform app.library_check_object_key(p_thumb_object_key, v_client);

  insert into assets (tenant_id, folder_id, name, provider, object_key, content_type, size_bytes,
                      current_version, link_url, link_expires_on, thumb_object_key, duration_seconds,
                      is_source, uploaded_by)
  values (a.tenant_id, p_folder, a.name, a.provider, case when a.provider = 'external' then null else p_object_key end,
          a.content_type, a.size_bytes, 1, a.link_url, a.link_expires_on,
          case when a.provider = 'external' then null else p_thumb_object_key end, a.duration_seconds,
          a.is_source, auth.uid())
  returning id into v_id;
  insert into asset_versions (tenant_id, asset_id, version, object_key, content_type, size_bytes, link_url,
                              thumb_object_key, duration_seconds, uploaded_by)
  select tenant_id, id, 1, object_key, content_type, size_bytes, link_url, thumb_object_key, duration_seconds, auth.uid()
    from assets where id = v_id;
  return v_id;
end $$;

-- 12 -----------------------------------------------------------------------------------
create or replace function public.library_usage(p_asset uuid)
returns table (deliverable_id uuid, campaign_name text, piece_name text)
language sql stable set search_path = public, app, extensions as $$
  with refs as (
    select ar.ref_id as deliverable_id from asset_references ar
     where ar.asset_id = p_asset and ar.ref_type = 'deliverable'
    union
    select a.deliverable_id from assets a where a.id = p_asset and a.deliverable_id is not null
  )
  select d.id, c.name, d.name
    from refs r
    join deliverables d on d.id = r.deliverable_id
    left join campaigns c on c.id = app.deliverable_campaign(d.id)
   order by c.name, d.name
$$;

-- 13 -----------------------------------------------------------------------------------
-- SECURITY DEFINER: deleting is personal (d.3), not reach-scoped — an uploader whose reach has since
-- moved still deletes their own file, and the RLS update policy is reach-scoped. Authority is checked
-- here, once, with app.library_may_delete (tenant from the JWT).
create or replace function public.library_delete(p_asset uuid)
returns void
language plpgsql security definer set search_path = public, app, extensions as $$
begin
  if not app.library_may_delete(p_asset) then
    raise exception 'only the uploader, the client''s account manager or a Power Admin may delete this file'
      using errcode = '42501';
  end if;
  update assets set deleted_at = now(), deleted_by = auth.uid()
   where id = p_asset and tenant_id = app.current_tenant_id() and deleted_at is null;
end $$;

-- SECURITY DEFINER: as library_delete. A file whose folder was deleted was re-homed to the parent then.
create or replace function public.library_restore(p_asset uuid)
returns void
language plpgsql security definer set search_path = public, app, extensions as $$
begin
  if not app.library_may_delete(p_asset) then
    raise exception 'only the uploader, the client''s account manager or a Power Admin may bring back this file'
      using errcode = '42501';
  end if;
  update assets set deleted_at = null, deleted_by = null
   where id = p_asset and tenant_id = app.current_tenant_id() and deleted_at is not null;
end $$;

-- 14 -----------------------------------------------------------------------------------
create or replace function public.library_recently_deleted(p_client uuid)
returns table (id uuid, name text, folder_path text, deleted_at timestamptz, deleted_by_name text, purge_on date)
language sql stable set search_path = public, app, extensions as $$
  select a.id, a.name, app.library_folder_path(a.folder_id), a.deleted_at,
         (select u.display_name from user_profiles u where u.id = a.deleted_by),
         (a.deleted_at + interval '30 days')::date
    from assets a
    join asset_folders f on f.id = a.folder_id
   where f.client_id = p_client and a.deleted_at is not null
     and app.library_may_delete(a.id)
   order by a.deleted_at desc
$$;

-- 15 -----------------------------------------------------------------------------------
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
  if not public.library_can_change(v_client) then
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

-- 16 -----------------------------------------------------------------------------------
create or replace function public.library_search(p_query text, p_kind text default null, p_client uuid default null)
returns table (id uuid, name text, folder_id uuid, client_id uuid, client_name text, path text,
               content_type text, link_url text, size_bytes bigint, updated_at timestamptz, kind_bucket text)
language sql stable set search_path = public, app, extensions as $$
  select a.id, a.name, a.folder_id, f.client_id, c.name, app.library_folder_path(a.folder_id),
         a.content_type, a.link_url, a.size_bytes, a.updated_at,
         app.library_kind_bucket(a.content_type, a.link_url, a.is_proof)
    from assets a
    join asset_folders f on f.id = a.folder_id
    join clients c on c.id = f.client_id
   where a.deleted_at is null
     and (p_client is null or f.client_id = p_client)
     and (nullif(btrim(coalesce(p_query, '')), '') is null
          or a.name ilike '%' || btrim(p_query) || '%'
          or a.link_url ilike '%' || btrim(p_query) || '%')
     and (nullif(p_kind, '') is null or p_kind = 'all'
          or app.library_kind_bucket(a.content_type, a.link_url, a.is_proof) = p_kind)
   order by a.updated_at desc
   limit 200
$$;

create or replace function public.library_search_counts(p_query text, p_client uuid default null)
returns table (kind_bucket text, n bigint)
language sql stable set search_path = public, app, extensions as $$
  select app.library_kind_bucket(a.content_type, a.link_url, a.is_proof), count(*)
    from assets a
    join asset_folders f on f.id = a.folder_id
   where a.deleted_at is null
     and (p_client is null or f.client_id = p_client)
     and (nullif(btrim(coalesce(p_query, '')), '') is null
          or a.name ilike '%' || btrim(p_query) || '%'
          or a.link_url ilike '%' || btrim(p_query) || '%')
   group by 1
   order by 1
$$;

-- 18 -----------------------------------------------------------------------------------
create or replace function public.library_find_by_name(p_folder uuid, p_name text)
returns table (id uuid, current_version integer)
language sql stable set search_path = public, app, extensions as $$
  select a.id, a.current_version from assets a
   where a.folder_id = p_folder and a.deleted_at is null
     and lower(btrim(a.name)) = lower(btrim(p_name))
   order by a.created_at
   limit 1
$$;

-- grants -------------------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.library_clients()',
    'public.library_client_overview(uuid)',
    'public.library_folder(uuid)',
    'public.library_piece_folders(uuid)',
    'public.library_add_version(uuid, text, text, bigint, text, numeric)',
    'public.library_add_link_version(uuid, text, date)',
    'public.library_make_current(uuid, integer)',
    'public.library_versions(uuid)',
    'public.library_rename(uuid, text)',
    'public.library_move(uuid, uuid)',
    'public.library_move_folder(uuid, uuid)',
    'public.library_rename_folder(uuid, text)',
    'public.library_copy_record(uuid, uuid, text, text)',
    'public.library_usage(uuid)',
    'public.library_delete(uuid)',
    'public.library_restore(uuid)',
    'public.library_recently_deleted(uuid)',
    'public.library_add_link(uuid, text, text, date)',
    'public.library_search(text, text, uuid)',
    'public.library_search_counts(text, uuid)',
    'public.library_find_by_name(uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- ============================================================ the daily sweep (d.9, d.18) ====
-- Called by the library-sweep Edge Function under the service role (cron, no user). SECURITY INVOKER
-- and granted to service_role only: the service role crosses RLS by design, and nobody else may call
-- them.

-- d.18: a link's adder is told two days before it expires (bell + email through notify-email).
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check check (type = any (array[
  'assigned', 'review_requested', 'changes_requested', 'signed_off', 'due_soon', 'dependency_ready', 'cancelled',
  'resource_clash', 'resource_required', 'campaign_approved', 'deliverable_reassigned', 'rescheduled', 'chat_added',
  'task_reinstated', 'feedback_collected', 'assignment_requested', 'assignment_approved', 'assignment_refused',
  'assignment_superseded', 'extension_requested', 'extension_approved', 'extension_refused', 'deliverable_added',
  'deliverable_owner_removed', 'task_reassigned_away', 'feedback_requested', 'assignment_overdue', 'task_reopened',
  'deliverable_reopened', 'task_blocked', 'untimed_round', 'extension_forwarded', 'change_request_sent',
  'change_request_answered', 'change_request_resolved', 'question_asked', 'question_replied', 'nudged', 'too_much',
  'too_much_answered', 'escalated', 'review_reminder', 'over_capacity', 'task_unblocked',
  'client_activation_requested', 'deliverable_type_changed', 'deliverable_edited',
  'handover_list', 'deactivation_complete',
  -- ADR-0134 d.18
  'link_expiring'
]::text[]));

create or replace function public.library_sweep_link_notices(p_dry_run boolean default false)
returns table (asset_id uuid, user_id uuid, name text, expires_on date)
language plpgsql set search_path = public, app, extensions as $$
begin
  return query
  with due as (
    select a.id, a.tenant_id, coalesce(a.uploaded_by, a.created_by) as owner, a.name, a.link_expires_on,
           a.link_url, a.folder_id, f.client_id, c.name as client_name
      from assets a
      join asset_folders f on f.id = a.folder_id
      join clients c on c.id = f.client_id
     where a.link_expires_on is not null
       and a.link_url is not null
       and a.deleted_at is null
       and a.link_expiry_notified_at is null
       and a.link_expires_on between current_date and current_date + 2
       and coalesce(a.uploaded_by, a.created_by) is not null
     for update of a skip locked
  ), sent as (
    insert into notifications (tenant_id, user_id, type, label, context_label, detail)
    select d.tenant_id, d.owner, 'link_expiring', d.name, d.client_name,
           jsonb_build_object('asset_id', d.id, 'folder_id', d.folder_id, 'client_id', d.client_id,
                              'expires_on', d.link_expires_on, 'url', d.link_url)
      from due d
     where not p_dry_run
    returning 1
  ), stamped as (
    update assets a set link_expiry_notified_at = now()
      from due d
     where a.id = d.id and not p_dry_run
    returning a.id
  )
  -- (data-modifying CTEs always run to completion, whether or not the outer query reads them)
  select d.id, d.owner, d.name, d.link_expires_on from due d;
end $$;

-- d.9: files deleted more than 30 days ago, with the storage keys that are theirs alone — a key still
-- named by any other row (a delivered review version shares its object with the Library, ADR-0023)
-- is never returned. A file that is the evidence of a change request is kept (its row is referenced
-- with no cascade) and stays in Recently deleted.
create or replace function public.library_sweep_purge_due(p_limit integer default 200)
returns table (asset_id uuid, tenant_id uuid, object_keys text[])
language sql stable set search_path = public, app, extensions as $$
  with due as (
    select a.id, a.tenant_id from assets a
     where a.deleted_at is not null and a.deleted_at < now() - interval '30 days'
       and not exists (select 1 from deliverable_change_requests r where r.evidence_asset_id = a.id)
     order by a.deleted_at
     limit greatest(coalesce(p_limit, 200), 1)
  ), keys as (
    select d.id, k.key
      from due d
      cross join lateral (
        select a.object_key as key from assets a where a.id = d.id
        union select a.thumb_object_key from assets a where a.id = d.id
        union select v.object_key from asset_versions v where v.asset_id = d.id
        union select v.thumb_object_key from asset_versions v where v.asset_id = d.id
      ) k
     where k.key is not null
  )
  select d.id, d.tenant_id,
         coalesce(array_agg(k.key order by k.key) filter (
           where k.key is not null
             and not exists (select 1 from assets o where o.id <> d.id and (o.object_key = k.key or o.thumb_object_key = k.key))
             and not exists (select 1 from asset_versions o where o.asset_id <> d.id and (o.object_key = k.key or o.thumb_object_key = k.key))
             and not exists (select 1 from media_records m where m.object_key = k.key)
         ), '{}')
    from due d
    left join keys k on k.id = d.id
   group by d.id, d.tenant_id
$$;

-- Called after the objects are gone from storage: the row, its versions and references go.
create or replace function public.library_sweep_purge_confirm(p_asset uuid)
returns boolean
language plpgsql set search_path = public, app, extensions as $$
declare v_n int;
begin
  delete from assets
   where id = p_asset and deleted_at is not null and deleted_at < now() - interval '30 days'
     and not exists (select 1 from deliverable_change_requests r where r.evidence_asset_id = p_asset);
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

revoke execute on function public.library_sweep_link_notices(boolean) from public, anon, authenticated;
revoke execute on function public.library_sweep_purge_due(integer) from public, anon, authenticated;
revoke execute on function public.library_sweep_purge_confirm(uuid) from public, anon, authenticated;
grant execute on function public.library_sweep_link_notices(boolean) to service_role;
grant execute on function public.library_sweep_purge_due(integer) to service_role;
grant execute on function public.library_sweep_purge_confirm(uuid) to service_role;

commit;
