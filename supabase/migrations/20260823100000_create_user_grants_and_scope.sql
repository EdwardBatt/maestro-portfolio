-- L6.1 (ADR-0036): per-user permission & scope grants — the flexible RBAC overlay.
--
-- Roles stay the foundation (ADR-0008). This adds a thin per-user OVERLAY on both axes:
--   user_grants        additive allow + explicit deny on the permission axis. `allow` adds an
--                      ability the role lacks; `deny` removes one the role grants. Deny wins —
--                      the precedence is applied in app.has_permission (L6.2, next migration).
--   user_scope_grants  additive cross-team/department targets on the scope axis. Each row means
--                      "also treat this department/team as within the user's write scope",
--                      consumed by app.in_write_scope (L6.2).
--
-- Only two authorization primitives change (L6.2); every RLS policy + Edge Function inherits
-- the overlay through them — nothing here rewrites a data-table policy.
--
-- Grant tables are ADD/REMOVE like role_grants (20260802102000): a grant exists or it does not.
-- There is NO update path — flipping allow<->deny or re-pointing a scope target is delete+insert
-- (so the L6.4 editor toggles by insert/delete, never upsert-update). Hence no updated_at.
--
-- RECURSION NOTE (mirrors role_grants, 20260802100000): app.has_permission() will SELECT from
-- user_grants (L6.2), so this table's SELECT policy MUST stay grant-free (a plain tenant check).
-- A has_permission-based read policy here would recurse. The write policies MAY call
-- has_permission (they gate on user_grants:manage) because writes never re-enter the read path.
--
-- Administration is Power Admin-only for now (ADR-0036 acceptance condition): the new catalog
-- entries user_grants:view/manage are auto-granted to every tenant's power_admin by the
-- grant_new_catalog_to_power_admin trigger, and to no one else until an admin grants them.
-- Guardrails: no self-grant (a second admin must elevate you), target must be in the caller's
-- tenant, external client_portal identities can never receive an overlay grant, granted_by is
-- stamped server-side (never client-trusted), and the two RBAC-admin grants (user_grants:manage,
-- roles:manage) can never be denied — so the overlay can't brick a tenant's ability to administer
-- itself (a conservative fence on the deny-precedence risk noted in ADR-0036 Consequences).

begin;

-- ------------------------------------------------------------ catalog ----
-- Auto-granted to power_admin by the existing after-insert trigger; no other role gets them
-- until explicitly granted from the Roles screen.
insert into permission_catalog (resource, action, description) values
  ('user_grants', 'view',   'Admin: view per-user permission & scope grants'),
  ('user_grants', 'manage', 'Admin: grant/revoke per-user permissions & scope targets')
on conflict do nothing;

-- ------------------------------------------------------------ helpers ----
-- Is this user an external client-portal identity? Overlay grants are fenced from them.
-- Tenant-filtered as defense-in-depth (callers already scope to the tenant; this runs
-- invoker-side under RLS too, so a foreign-tenant id is invisible regardless).
create or replace function app.is_portal_user(p_user uuid)
returns boolean language sql stable
set search_path = public, app, extensions as $$
  select exists (
    select 1 from public.user_profiles up
    join public.roles r on r.id = up.role_id
    where up.id = p_user
      and up.tenant_id = app.current_tenant_id()
      and r.key = 'client_portal'
  )
$$;
comment on function app.is_portal_user(uuid) is
  'True if the user''s role is the fenced client_portal system role (in the caller''s tenant). '
  'Used to bar overlay grants.';

-- The shared administration gate for BOTH overlay tables: the caller holds user_grants:manage,
-- the target is not the caller (no self-elevation — segregation of duties), the target is in
-- the caller's tenant, and the target is not a client_portal user.
create or replace function app.can_admin_user_grants(p_target uuid)
returns boolean language sql stable
set search_path = public, app, extensions as $$
  select app.has_permission('user_grants', 'manage')
     and p_target is not null
     and p_target <> auth.uid()
     and exists (
       select 1 from public.user_profiles up
       where up.id = p_target and up.tenant_id = app.current_tenant_id()
     )
     and not app.is_portal_user(p_target)
$$;
comment on function app.can_admin_user_grants(uuid) is
  'ADR-0036 overlay write gate: caller holds user_grants:manage AND target<>self AND target is '
  'in the caller''s tenant AND target is not client_portal. No self-grant is enforced here.';

-- Stamp granted_by = the true actor (never client-supplied), on insert. Grant tables have no
-- update path, so insert-only. auth.uid() is always present for the authenticated admin who
-- writes these; a path with no JWT would fail the NOT NULL, which is intended (overlay
-- administration is an authenticated action only).
create or replace function app.tg_stamp_granted_by() returns trigger
language plpgsql set search_path = public, app, extensions as $$
begin
  new.granted_by := auth.uid();
  return new;
end $$;
comment on function app.tg_stamp_granted_by() is
  'Forces granted_by = auth.uid() on insert (server-side actor pin; client value is ignored).';

-- ------------------------------------------------------- user_grants ----
-- One effect per (user, resource, action): a triple is either allowed or denied, never both.
create table user_grants (
  tenant_id  uuid not null references tenants(id),
  user_id    uuid not null references user_profiles(id) on delete cascade,
  resource   text not null,
  action     text not null,
  effect     text not null check (effect in ('allow', 'deny')),
  granted_by uuid not null references user_profiles(id),
  reason     text,
  created_at timestamptz not null default now(),
  primary key (user_id, resource, action),
  foreign key (resource, action) references permission_catalog (resource, action),
  -- Never let the overlay deny the permissions that administer RBAC itself — otherwise a
  -- deny (which L6.2 makes win over even the power_admin role grant) could brick a tenant.
  constraint chk_user_grants_no_deny_admin check (
    not (effect = 'deny' and (resource, action) in (('user_grants', 'manage'), ('roles', 'manage')))
  )
);
create index idx_user_grants_tenant_id on user_grants (tenant_id);
-- (user_id lookups — the L6.2 has_permission read path — are served by the composite PK's
--  leading column; no extra index needed.)

alter table user_grants enable row level security;
alter table user_grants force row level security;

-- Read: plain tenant check — MUST stay grant-free (has_permission selects this table; L6.2).
create policy user_grants_tenant_select on user_grants
  for select to authenticated
  using (tenant_id = app.current_tenant_id());

create policy user_grants_admin_insert on user_grants
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id() and app.can_admin_user_grants(user_id));

-- No UPDATE policy by design (add/remove convention, like role_grants).
create policy user_grants_admin_delete on user_grants
  for delete to authenticated
  using (tenant_id = app.current_tenant_id() and app.can_admin_user_grants(user_id));

create trigger stamp_granted_by before insert on user_grants
  for each row execute function app.tg_stamp_granted_by();

comment on table user_grants is
  'ADR-0036: per-user permission overlay (additive allow + explicit deny). Deny takes precedence '
  'over role + user-allow; applied in app.has_permission (L6.2). Add/remove only (no update). '
  'Administration is Power Admin-only; no self-grant; client_portal fenced; RBAC-admin grants '
  'un-deny-able. Audited by the universal audit trigger.';

-- -------------------------------------------------- user_scope_grants ----
-- Each row grants ONE additional write-scope target (a department OR a team, never both/neither).
create table user_scope_grants (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  user_id       uuid not null references user_profiles(id) on delete cascade,
  department_id uuid references departments(id),
  team_id       uuid references teams(id),
  granted_by    uuid not null references user_profiles(id),
  reason        text,
  created_at    timestamptz not null default now(),
  constraint chk_user_scope_grants_one_target check (num_nonnulls(department_id, team_id) = 1)
);
create index idx_user_scope_grants_tenant_id on user_scope_grants (tenant_id);
create index idx_user_scope_grants_user_id on user_scope_grants (user_id);
create unique index uq_user_scope_grants_user_dept on user_scope_grants (user_id, department_id)
  where department_id is not null;
create unique index uq_user_scope_grants_user_team on user_scope_grants (user_id, team_id)
  where team_id is not null;

alter table user_scope_grants enable row level security;
alter table user_scope_grants force row level security;

-- Read: plain tenant check (grant-free — in_write_scope selects this table; L6.2).
create policy user_scope_grants_tenant_select on user_scope_grants
  for select to authenticated
  using (tenant_id = app.current_tenant_id());

-- Write: shared admin gate + the named department/team must belong to the caller's tenant.
create policy user_scope_grants_admin_insert on user_scope_grants
  for insert to authenticated
  with check (
    tenant_id = app.current_tenant_id()
    and app.can_admin_user_grants(user_id)
    and (department_id is null or exists (
          select 1 from departments d where d.id = department_id and d.tenant_id = app.current_tenant_id()))
    and (team_id is null or exists (
          select 1 from teams t where t.id = team_id and t.tenant_id = app.current_tenant_id()))
  );

-- No UPDATE policy by design (add/remove convention).
create policy user_scope_grants_admin_delete on user_scope_grants
  for delete to authenticated
  using (tenant_id = app.current_tenant_id() and app.can_admin_user_grants(user_id));

create trigger stamp_granted_by before insert on user_scope_grants
  for each row execute function app.tg_stamp_granted_by();

comment on table user_scope_grants is
  'ADR-0036: per-user scope overlay — additive write-scope targets (one department OR team per '
  'row), consumed by app.in_write_scope (L6.2). Add/remove only. Same admin gate/fences as '
  'user_grants.';

-- --------------------------------------------------- universal audit ----
-- ADR-0008 §8: every business table is audited regardless of write path. Composite-key
-- user_grants logs a null entity_id (the payload identifies the grant), like role_grants;
-- user_scope_grants has an id, so entity_id is populated.
create trigger audit_row_change
  after insert or update or delete on user_grants
  for each row execute function app.audit_row_change();

create trigger audit_row_change
  after insert or update or delete on user_scope_grants
  for each row execute function app.audit_row_change();

commit;
