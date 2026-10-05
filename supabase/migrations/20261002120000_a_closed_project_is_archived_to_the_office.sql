-- ADR-0136 (I72) — a closed project's working files go to the office server 90 days after it closes.
--
-- One clock (d.1): `campaigns.closed_at` + the tenant's `archive_after_days` (default 90, added with
-- the other storage settings in 20261002100000, which also retired ADR-0023 d.4's 60-day clock).
-- Reopening clears `closed_at` and so stops the clock; the next close starts it again.
--
-- What is due (d.2): working files, source files, every version except the one in use, every review
-- round. What stays online as well: Final Assets, References, each piece's version in use. A storage
-- key still named by any row that stays online is never due — a delivered review round shares its
-- object with the Library (ADR-0023), and removing it would take the kept copy with it.
--
-- The transfer itself is the `library-archive` Edge Function (d.6), SWITCHED OFF until the office
-- server's address and credential exist (d.7). Everything here is the bookkeeping it reads and writes:
--   * `app.library_archive_due(p_tenant)` — the due set;
--   * archive state on asset_versions / media_records (assets.archived_at came with 20261002100000);
--   * `library_archive_requests` — Bring back (d.4), by anyone who may change that client's files;
--   * the service-role RPCs the job calls, and the `file_brought_back` notice.

begin;

-- ===================================================================== columns ====

alter table media_records
  add column if not exists archived_at timestamptz,
  add column if not exists archive_ref text;
alter table asset_versions
  add column if not exists archive_ref text;

comment on column asset_versions.archived_at is
  'ADR-0136 d.2-d.3: copied to the office server and confirmed (size + checksum); the online object was then removed. archive_ref is where it is.';
comment on column media_records.archived_at is
  'ADR-0136 d.2-d.3: this review round was copied to the office server and confirmed; its online object was then removed.';

-- ============================================================= bring-back requests ====

create table library_archive_requests (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  asset_id     uuid not null references assets(id) on delete cascade,
  requested_by uuid not null references user_profiles(id),
  status       text not null default 'pending' check (status in ('pending', 'restored', 'failed')),
  attempts     integer not null default 0 check (attempts >= 0),
  last_error   text,
  restored_at  timestamptz,
  online_until timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  updated_by   uuid
);
comment on table library_archive_requests is
  'ADR-0136 d.4: a person''s "Bring back" of an archived Library file. Written by library_bring_back; '
  'worked by the library-archive job (service role), which copies the file online for 30 days.';

create index idx_library_archive_requests_tenant on library_archive_requests (tenant_id);
create index idx_library_archive_requests_asset on library_archive_requests (asset_id);
create unique index uq_library_archive_requests_pending on library_archive_requests (asset_id)
  where status = 'pending';

alter table library_archive_requests enable row level security;
alter table library_archive_requests force row level security;

-- Everyone who reads the Library sees that a file is on its way back.
create policy library_archive_requests_tenant_select on library_archive_requests
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and (select app.has_permission('assets', 'view')));
-- A request is made by someone who may change that client's files (d.4), as themselves.
create policy library_archive_requests_reach_insert on library_archive_requests
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id()
              and requested_by = auth.uid()
              and (select app.has_permission('assets', 'manage'))
              and app.library_client_in_reach(app.library_asset_client(asset_id)));
-- No user UPDATE / DELETE: the job (service role) moves a request along.

create trigger audit_row_change
  after insert or update or delete on library_archive_requests
  for each row execute function app.audit_row_change();
create trigger set_updated_at before update on library_archive_requests
  for each row execute function app.set_updated_at();
create trigger set_actor_columns before insert or update on library_archive_requests
  for each row execute function app.set_actor_columns();

-- d.4: the requester is told when the file is ready.
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
  -- ADR-0134 d.18, ADR-0136 d.4
  'link_expiring', 'file_brought_back'
]::text[]));

-- ===================================================================== the due set ====
-- SECURITY INVOKER: called by the service-role job (which crosses every tenant by design) through the
-- wrapper below; under an authenticated caller RLS fences it to their own tenant's visible rows.
create or replace function app.library_archive_due(p_tenant uuid)
returns table (item_type text, item_id uuid, asset_id uuid, version integer, object_key text,
               size_bytes bigint, campaign_id uuid)
language sql stable set search_path = public, app, extensions as $$
  with recursive closed as (
    select c.id
      from campaigns c
      left join tenant_storage_settings s on s.tenant_id = c.tenant_id
     where c.tenant_id = p_tenant
       and c.status = 'closed' and c.closed_at is not null
       and c.closed_at + make_interval(days => coalesce(s.archive_after_days, 90)) <= now()
  ),
  tree as (                       -- every folder of a closed project, with the standard folder it is in
    select f.id, f.campaign_id, f.kind, null::text as section
      from asset_folders f
     where f.campaign_id in (select id from closed) and f.kind = 'campaign'
    union all
    select c.id, t.campaign_id, c.kind, coalesce(t.section, case when c.kind = 'asset_type' then c.name end)
      from asset_folders c join tree t on c.parent_id = t.id
  ),
  versions as (
    select 'asset_version'::text as item_type, v.id as item_id, a.id as asset_id, v.version,
           v.object_key, v.size_bytes, t.campaign_id
      from tree t
      join assets a on a.folder_id = t.id
      join asset_versions v on v.asset_id = a.id
     where coalesce(t.section, '') not in ('Final Assets', 'References')
       and a.deleted_at is null
       and (a.brought_back_until is null or a.brought_back_until <= now())
       and v.archived_at is null
       and v.object_key is not null
       and (v.version <> a.current_version                       -- every version but the one in use
            or a.is_source                                       -- source files
            or t.section = 'Working Files'                       -- working files
            or t.kind = 'deliverable')                           -- a piece's own working files (d.24)
  ),
  rounds as (
    select 'media_record'::text, m.id, null::uuid, m.version, m.object_key, m.size_bytes,
           coalesce(s.campaign_id, j.campaign_id)
      from deliverables d
      left join streams s on s.id = d.stream_id
      left join jobs j on j.id = d.job_id
      join media_records m on m.deliverable_id = d.id
     where coalesce(s.campaign_id, j.campaign_id) in (select id from closed)
       and m.archived_at is null
       and m.object_key is not null
       and exists (select 1 from media_records n where n.deliverable_id = m.deliverable_id and n.version > m.version)
  ),
  candidates as (
    select * from versions
    union all
    select * from rounds
  )
  select c.*
    from candidates c
   where not exists (                 -- a key that a row staying online still names is never due
           select 1 from asset_versions o
            where o.object_key = c.object_key and o.archived_at is null
              and not exists (select 1 from candidates x where x.item_type = 'asset_version' and x.item_id = o.id))
     and not exists (
           select 1 from media_records o
            where o.object_key = c.object_key and o.archived_at is null
              and not exists (select 1 from candidates x where x.item_type = 'media_record' and x.item_id = o.id))
$$;

comment on function app.library_archive_due(uuid) is
  'ADR-0136 d.1-d.2: what is due for the office server — working files, sources, every version but the one in '
  'use, every review round — of projects closed archive_after_days ago. Never Final Assets, References, a '
  'piece''s version in use, or a key a kept row still names.';

revoke execute on function app.library_archive_due(uuid) from public, anon;
grant execute on function app.library_archive_due(uuid) to authenticated, service_role;

-- ============================================================ the job's RPCs (service role) ====
-- SECURITY INVOKER, granted to service_role only: the job runs with no user and crosses tenants.

create or replace function public.library_archive_due_items(p_tenant uuid, p_limit integer default 100)
returns table (item_type text, item_id uuid, asset_id uuid, version integer, object_key text,
               size_bytes bigint, campaign_id uuid)
language sql stable set search_path = public, app, extensions as $$
  select * from app.library_archive_due(p_tenant) limit greatest(coalesce(p_limit, 100), 1)
$$;

-- After the office server confirmed the copy (size + checksum, d.3). Returns whether the online object
-- may now be removed: only when no row that stays online still names its key.
create or replace function public.library_archive_mark(p_item_type text, p_item_id uuid, p_ref text)
returns boolean
language plpgsql set search_path = public, app, extensions as $$
declare
  v_key text;
  v_asset uuid;
  v_version int;
begin
  if p_item_type = 'asset_version' then
    update asset_versions set archived_at = now(), archive_ref = p_ref
     where id = p_item_id and archived_at is null
    returning object_key, asset_id, version into v_key, v_asset, v_version;
    if v_asset is not null then
      update assets set archived_at = now()
       where id = v_asset and current_version = v_version and archived_at is null;
    end if;
  elsif p_item_type = 'media_record' then
    update media_records set archived_at = now(), archive_ref = p_ref,
                             retention_state = 'archived', storage_tier = 'cold'
     where id = p_item_id and archived_at is null
    returning object_key into v_key;
  else
    raise exception 'unknown item type %', p_item_type using errcode = '22023';
  end if;

  if v_key is null then
    return false;
  end if;
  return not exists (select 1 from asset_versions o where o.object_key = v_key and o.archived_at is null)
     and not exists (select 1 from media_records o where o.object_key = v_key and o.archived_at is null)
     and not exists (select 1 from assets a join asset_versions v on v.asset_id = a.id
                      where v.object_key = v_key and a.brought_back_until > now());
end $$;

-- Pending Bring back requests, each with the archived versions of its file.
create or replace function public.library_bring_back_pending(p_limit integer default 50)
returns table (request_id uuid, tenant_id uuid, asset_id uuid, requested_by uuid, items jsonb)
language sql stable set search_path = public, app, extensions as $$
  select r.id, r.tenant_id, r.asset_id, r.requested_by,
         coalesce((select jsonb_agg(jsonb_build_object('item_type', 'asset_version', 'id', v.id, 'version', v.version,
                                                        'object_key', v.object_key, 'archive_ref', v.archive_ref,
                                                        'size_bytes', v.size_bytes)
                                    order by v.version)
                     from asset_versions v where v.asset_id = r.asset_id and v.archived_at is not null), '[]'::jsonb)
    from library_archive_requests r
   where r.status = 'pending'
   order by r.created_at
   limit greatest(coalesce(p_limit, 50), 1)
$$;

-- The file is online again (p_ok) for 30 days and the requester is told; or the attempt failed and is
-- retried next run (failed for good after five).
create or replace function public.library_bring_back_done(p_request uuid, p_ok boolean, p_error text default null)
returns void
language plpgsql set search_path = public, app, extensions as $$
declare
  r library_archive_requests;
  a assets;
begin
  select * into r from library_archive_requests where id = p_request and status = 'pending' for update;
  if r.id is null then
    return;
  end if;
  if not p_ok then
    update library_archive_requests
       set attempts = attempts + 1, last_error = left(p_error, 500),
           status = case when attempts + 1 >= 5 then 'failed' else 'pending' end
     where id = r.id;
    return;
  end if;

  update library_archive_requests
     set status = 'restored', restored_at = now(), online_until = now() + interval '30 days', last_error = null
   where id = r.id;
  update assets set brought_back_until = now() + interval '30 days' where id = r.asset_id
  returning * into a;

  insert into notifications (tenant_id, user_id, type, label, context_label, detail)
  select r.tenant_id, r.requested_by, 'file_brought_back', a.name, c.name,
         jsonb_build_object('asset_id', a.id, 'folder_id', a.folder_id, 'client_id', f.client_id,
                            'online_until', now() + interval '30 days')
    from asset_folders f join clients c on c.id = f.client_id
   where f.id = a.folder_id;
end $$;

-- Brought-back files whose 30 days are over (d.4): the online objects the job removes again. The
-- office copy is already confirmed, so nothing is sent.
create or replace function public.library_brought_back_expired(p_limit integer default 100)
returns table (asset_id uuid, object_keys text[])
language sql stable set search_path = public, app, extensions as $$
  select a.id,
         coalesce(array_agg(distinct v.object_key) filter (
           where v.object_key is not null
             and not exists (select 1 from asset_versions o where o.object_key = v.object_key and o.archived_at is null)
             and not exists (select 1 from media_records o where o.object_key = v.object_key and o.archived_at is null)), '{}')
    from assets a
    join asset_versions v on v.asset_id = a.id and v.archived_at is not null
   where a.brought_back_until is not null and a.brought_back_until <= now()
   group by a.id
   limit greatest(coalesce(p_limit, 100), 1)
$$;

create or replace function public.library_brought_back_clear(p_asset uuid)
returns void
language sql set search_path = public, app, extensions as $$
  update assets set brought_back_until = null
   where id = p_asset and brought_back_until is not null and brought_back_until <= now()
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.library_archive_due_items(uuid, integer)',
    'public.library_archive_mark(text, uuid, text)',
    'public.library_bring_back_pending(integer)',
    'public.library_bring_back_done(uuid, boolean, text)',
    'public.library_brought_back_expired(integer)',
    'public.library_brought_back_clear(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

-- ================================================================= Bring back (d.4) ====
-- SECURITY INVOKER: the insert policy is the rule (assets:manage + reach, as the requester); the
-- explicit check first makes the refusal worded.
create or replace function public.library_bring_back(p_asset uuid)
returns uuid
language plpgsql set search_path = public, app, extensions as $$
declare
  a assets;
  v_id uuid;
begin
  select * into a from assets where id = p_asset and deleted_at is null;
  if a.id is null then
    raise exception 'file not found' using errcode = 'P0002';
  end if;
  if not public.library_can_change(app.library_folder_client(a.folder_id)) then
    raise exception 'you cannot change this client''s files' using errcode = '42501';
  end if;
  if a.archived_at is null and not exists (select 1 from asset_versions v where v.asset_id = a.id and v.archived_at is not null) then
    raise exception 'this file is not archived' using errcode = '22023';
  end if;

  select r.id into v_id from library_archive_requests r where r.asset_id = a.id and r.status = 'pending';
  if v_id is not null then
    return v_id;                                   -- already on its way: one request, not two
  end if;
  insert into library_archive_requests (tenant_id, asset_id, requested_by)
  values (a.tenant_id, a.id, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.library_bring_back(uuid) from public, anon;
grant execute on function public.library_bring_back(uuid) to authenticated;

commit;
