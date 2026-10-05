-- ADR-0041 (L6.12): a role's reach is chosen, never defaulted.
--
-- THE DEFECT. `roles.scope` was added in 20260812100100 as `not null default 'tenant'`, and the
-- Roles screen never asked for it — "scope" appears nowhere in RolesPage.tsx, and neither
-- CreateRoleArgs nor UpdateRoleArgs carries the field. So a role created through the UI silently
-- got the WIDEST reach in the system. ADR-0008 d.2 says admins create roles from the UI; ADR-0009
-- d.3 gave roles a reach but named it only for the seeded ones. The column default answered the
-- question neither ADR asked.
--
-- It has already happened: the tenant holds a role `cco` (is_system false, scope 'tenant') that
-- appears in no seeder — created through the screen, its reach never decided by anyone.
--
-- The failure mode is quiet by construction. Reach only bites when a grant is exercised on a row
-- outside the holder's slice, so an over-wide role behaves exactly like a correct one until someone
-- edits something they should never have reached — and the audit trail then shows a PERMITTED
-- action, because it was one.
--
-- WHAT THIS MIGRATION DOES, AND DELIBERATELY DOES NOT. It changes the default so every future role
-- is born narrow, and it makes a system role's reach immutable. It does NOT touch a single existing
-- row (ADR-0041 d.7): silently re-scoping a live role in a migration would be exactly the kind of
-- unannounced authority change this ADR exists to prevent. `cco` keeps 'tenant' until Edward sets
-- it deliberately through the new field.
--
-- search_path pinned inline per ADR-0033.

begin;

-- ============================================================================
-- 1) born narrow, not wide
-- ============================================================================
-- The five permitted values are unchanged (roles_scope_check, 20260812110000). Only which one you
-- get by saying nothing changes: the narrowest, so a role can only ever be widened deliberately —
-- by any path, not just the UI (a console insert, a script, future code).
alter table roles alter column scope set default 'self';

comment on column roles.scope is
  'WRITE reach of this role: tenant | department | team | account | self. Reads are always '
  'tenant-wide; write policies consult this via app.in_write_scope(). RELATIVE to the holder — '
  '''department'' means THEIR department, which is why one Department Lead role serves every '
  'department. Reach to a NAMED department/team is a per-user grant (user_scope_grants, ADR-0036), '
  'never a property of a role. Defaults to ''self'' since ADR-0041: an authority setting takes the '
  'narrowest value it can when nobody chose one.';

-- ============================================================================
-- 2) a system role's reach is immutable
-- ============================================================================
-- ADR-0041 d.4: Power Admin stays tenant, Client Portal stays self. The UI disables the field for
-- them, but Postgres owns the invariant (AGENTS.md §2) — the screen is not the boundary.
--
-- Reproduced verbatim from 20260802100000 with `scope` added to the system-role immutable list and
-- the ADR-0033 search_path pin applied (the original predates that rule). Every other branch is
-- unchanged: system roles cannot be minted, deleted, or have key/is_system/status altered, and role
-- keys are immutable for everyone.
create or replace function app.protect_system_roles() returns trigger
language plpgsql
set search_path = public, app, extensions as $$
begin
  if app.is_system_op() then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' and new.is_system then
    raise exception 'system roles are created by the platform only';
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.is_system then
    if tg_op = 'DELETE' then
      raise exception 'system role % cannot be deleted', old.key;
    end if;
    if new.key <> old.key or new.is_system <> old.is_system or new.status <> old.status then
      raise exception 'system role % key/system/status are immutable', old.key;
    end if;
    -- ADR-0041 d.4: and its reach.
    if new.scope <> old.scope then
      raise exception 'system role % has a fixed reach (%) — it cannot be changed', old.key, old.scope
        using errcode = '42501';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.key <> old.key then
    raise exception 'role keys are immutable (rename via the name field)';
  end if;
  return coalesce(new, old);
end $$;

comment on function app.protect_system_roles() is
  'Fences the platform-owned roles: is_system rows cannot be minted, deleted, or have their '
  'key/is_system/status/scope changed, and role keys are immutable for every role. ADR-0041 added '
  'scope — Power Admin must stay tenant-wide and Client Portal must stay self.';

-- ============================================================================
-- 3) NO data change
-- ============================================================================
-- Stated as code so nobody adds one later thinking it was an oversight. Existing roles keep the
-- reach they have, including `cco`. See ADR-0041 d.7 and the header above.

commit;
