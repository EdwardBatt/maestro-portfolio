-- ADR-0025 (I3.1): internal review version chain foundations.
--
-- Two changes on media_records, the per-deliverable review-media chain:
--   1) server-stamp `version` monotonically per deliverable (the client never sends it),
--      serialized by a per-deliverable advisory lock so concurrent uploads can't collide on
--      uq_media_records_deliverable_version;
--   2) move writes off the pre-ADR-0008 role policy (`app.jwt_role() in (...)`) to the
--      grant-driven `media:manage` (ADR-0008). Reads stay tenant-wide (unchanged).
--
-- review_feedback keeps its policies for now — ADR-0025 §7 modernises it in I3.2 alongside the
-- round-stamping trigger, when comments are first written. Audit is already universal on both
-- tables (20260802103000), so version-create is logged without adding a trigger here.

-- 1) version stamping -------------------------------------------------------
-- SECURITY INVOKER: runs in the caller's context, so the max(version) read sees the caller's
-- tenant rows under RLS — and a deliverable's versions are all in one tenant, so the max is
-- complete. The advisory lock serialises concurrent inserts for the same deliverable.
create or replace function app.tg_media_record_set_version()
returns trigger language plpgsql as $$
begin
  if new.deliverable_id is null then
    raise exception 'media_records.deliverable_id is required' using errcode = '23502';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.deliverable_id::text, 0));
  select coalesce(max(version), 0) + 1 into new.version
    from media_records
   where deliverable_id = new.deliverable_id;
  return new;
end $$;
comment on function app.tg_media_record_set_version() is
  'ADR-0025: BEFORE INSERT — stamp media_records.version = next per deliverable, serialised by a per-deliverable advisory lock. The client never sets version.';

create trigger media_record_set_version
  before insert on media_records
  for each row execute function app.tg_media_record_set_version();

-- 2) grant-driven write policy (retire jwt_role) ----------------------------
drop policy media_records_tenant_write on media_records;

create policy media_records_media_write on media_records
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('media', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('media', 'manage'));
