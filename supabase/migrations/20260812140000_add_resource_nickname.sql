-- ADR-0011: internal users are bookable resources by default, provisioned at
-- invite. Display NAME stops being the unique key (two staff genuinely share a
-- name across the org, rarely even within a team); a short, unique NICKNAME
-- becomes the unambiguous handle. The nickname is auto-generated as a fun,
-- editable MENA-flavoured handle in invite-user (docs/nickname-wordlists.md).
--
-- Reversal of the M1.3 rule: drop uq_resources_tenant_name (name no longer
-- unique) and add unique(tenant_id, nickname). Nickname is nullable — equipment
-- and rooms need no handle, and Postgres treats NULLs as distinct so any number
-- of un-nicknamed resources coexist; only real handles must be unique.

alter table resources
  add column nickname text;

comment on column resources.nickname is
  'Short, unique-per-tenant handle (ADR-0011). Auto-generated at invite for human '
  'resources (adjective + noun, e.g. "Turbo Koshari"), editable. The unambiguous '
  'identifier when display names collide; nullable for equipment/rooms.';

-- Name is no longer unique per tenant (people share names); nickname takes over
-- the uniqueness role.
alter table resources
  drop constraint uq_resources_tenant_name;

-- A blank string is not a handle — normalise '' to NULL so the unique index
-- never treats empty handles as colliding, and trim on the way in.
alter table resources
  add constraint chk_resources_nickname_nonblank
    check (nickname is null or char_length(btrim(nickname)) >= 1);

create unique index uq_resources_tenant_nickname
  on resources (tenant_id, nickname)
  where nickname is not null;
