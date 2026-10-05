-- L6.2 (ADR-0036): teach the two authorization primitives the per-user overlay.
--
-- This is the whole enforcement change. Every RLS policy and Edge Function already funnels
-- through app.has_permission (permission axis) and app.in_write_scope (scope axis), so extending
-- these two functions applies the overlay everywhere with NO policy rewrites.
--
--   has_permission := (role grants it OR the user has an allow-grant) AND NOT (user has a
--                     deny-grant).  Deny wins.
--   in_write_scope := the existing role-scope test OR the resource's department/team is an
--                     additive per-user scope target (a granted DEPARTMENT covers its teams,
--                     mirroring the ADR-0014 department-implies-teams rule).
--
-- Both are STABLE invoker SQL (no SECURITY DEFINER) and read the overlay tables under the
-- caller's own RLS. user_grants / user_scope_grants have grant-FREE tenant-only SELECT policies
-- (20260823100000), so these reads cannot recurse back into a grant check.
--
-- ADR-0033: search_path is pinned INLINE on both create-or-replace definitions (the hardening
-- migration set it via ALTER FUNCTION; a bare create-or-replace would drop it — so we re-pin).
-- User grants key on the real actor (auth.uid()), independent of the role claim: the Dev
-- "view as role" preview (ADR-0019) never changes auth.uid(), so server enforcement is
-- unaffected by preview, exactly as before.

begin;

-- --------------------------------------------------------- has_permission ----
create or replace function app.has_permission(p_resource text, p_action text)
returns boolean language sql stable
set search_path = public, app, extensions as $$
  select
    (
      -- role grant (ADR-0008)…
      exists (
        select 1 from public.role_grants rg
        where rg.role_id   = app.current_role_id()
          and rg.tenant_id = app.current_tenant_id()
          and rg.resource  = p_resource
          and rg.action    = p_action
      )
      -- …or an additive per-user allow-grant (ADR-0036)
      or exists (
        select 1 from public.user_grants ug
        where ug.user_id   = auth.uid()
          and ug.tenant_id = app.current_tenant_id()
          and ug.resource  = p_resource
          and ug.action    = p_action
          and ug.effect    = 'allow'
      )
    )
    -- deny wins over both (ADR-0036). RBAC-admin grants can never be denied (chk constraint,
    -- 20260823100000), so this cannot brick a tenant's own administration.
    and not exists (
      select 1 from public.user_grants ug
      where ug.user_id   = auth.uid()
        and ug.tenant_id = app.current_tenant_id()
        and ug.resource  = p_resource
        and ug.action    = p_action
        and ug.effect    = 'deny'
    )
$$;
comment on function app.has_permission(text, text) is
  'ADR-0008 + ADR-0036: (role grant OR per-user allow-grant) AND NOT per-user deny-grant. '
  'Deny takes precedence. THE authorization primitive; fail-closed; runs as the caller.';

-- --------------------------------------------------------- in_write_scope ----
create or replace function app.in_write_scope(p_department uuid, p_team uuid, p_account_manager uuid)
returns boolean language sql stable
set search_path = public, app, extensions as $$
  select
    -- role-derived scope (ADR-0009/0010/0014) — unchanged
    case app.current_scope()
      when 'tenant'     then true
      when 'department' then
        (p_department is not null and p_department = app.current_department_id())
        or (p_team is not null and exists (
              select 1 from public.teams t
              where t.id = p_team and t.department_id = app.current_department_id()))
      when 'team'       then p_team is not null and p_team = app.current_team_id()
      when 'account'    then p_account_manager is not null and p_account_manager = auth.uid()
      else false                       -- 'self': no role-derived reach (owner predicates handle
                                       --  it); the ADR-0036 overlay OR below still applies to it

    end
    -- ADR-0036 additive scope targets (apply to ANY role, including 'self'):
    -- a granted DEPARTMENT (directly, or as the parent of the resource's team) …
    or (exists (
          select 1 from public.user_scope_grants usg
          where usg.user_id   = auth.uid()
            and usg.tenant_id = app.current_tenant_id()
            and usg.department_id is not null
            and (
              (p_department is not null and usg.department_id = p_department)
              or (p_team is not null and exists (
                    select 1 from public.teams t
                    where t.id = p_team and t.department_id = usg.department_id))
            )))
    -- … or a granted TEAM (exactly that team)
    or (p_team is not null and exists (
          select 1 from public.user_scope_grants usg
          where usg.user_id   = auth.uid()
            and usg.tenant_id = app.current_tenant_id()
            and usg.team_id = p_team))
$$;
comment on function app.in_write_scope(uuid, uuid, uuid) is
  'ADR-0009/0010/0014 role scope OR ADR-0036 additive per-user scope targets (granted department '
  'covers its teams; granted team is exact). Consumed by every scoped write policy.';

commit;
