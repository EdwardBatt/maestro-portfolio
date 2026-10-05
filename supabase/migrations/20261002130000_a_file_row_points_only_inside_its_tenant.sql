-- ADR-0134 d.2 (I72) — a file row may only name a stored object inside its own tenant.
--
-- Found 1 Oct writing the Library's browser tests: `library_add_version` and `library_copy_record` check
-- that an object key sits under the tenant and client, but a plain INSERT of a new file (the uploader's
-- path) and an UPDATE of a key checked nothing. Anyone allowed to upload could write a row naming an
-- object stored for ANOTHER TENANT, and `asset-url`'s download, preview and copy sign whatever key the
-- row holds — a cross-tenant read. The old Library had the same gap.
--
-- The check is the tenant only, not the client: review rounds are stored `<tenant>/<deliverable>/…`
-- (review-media) and a delivered version is filed into the Library under that same key (ADR-0023 d.1,
-- `deliver_deliverable_version`). Inside one tenant every internal reader may read every client
-- (ADR-0134 d.1), so the tenant is the line that matters. Service-role work (the sweeps, the archive)
-- is exempt, as it is from the other Library guards.
begin;

create or replace function app.tg_object_key_in_tenant() returns trigger
language plpgsql set search_path = public, app, extensions as $$
begin
  if app.library_system_context() then
    return new;
  end if;
  if new.object_key is not null and new.object_key not like new.tenant_id::text || '/%' then
    raise exception 'a stored file must be inside its own tenant' using errcode = '42501';
  end if;
  if new.thumb_object_key is not null and new.thumb_object_key not like new.tenant_id::text || '/%' then
    raise exception 'a stored file must be inside its own tenant' using errcode = '42501';
  end if;
  return new;
end $$;

comment on function app.tg_object_key_in_tenant() is
  'ADR-0134 d.2: an asset or asset version may name a stored object only under its own tenant''s prefix. '
  'Closes a cross-tenant read through asset-url, which signs whatever key a row holds.';

drop trigger if exists trg_assets_object_key_in_tenant on assets;
create trigger trg_assets_object_key_in_tenant
  before insert or update of object_key, thumb_object_key, tenant_id on assets
  for each row execute function app.tg_object_key_in_tenant();

drop trigger if exists trg_asset_versions_object_key_in_tenant on asset_versions;
create trigger trg_asset_versions_object_key_in_tenant
  before insert or update of object_key, thumb_object_key, tenant_id on asset_versions
  for each row execute function app.tg_object_key_in_tenant();

commit;
