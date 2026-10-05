-- L6.11 (ADR-0037 decisions 0, 4, 5): the grant tables become private, and the primitives become
-- SECURITY DEFINER so they still work once they are.
--
-- WHY. role_grants, user_grants and user_scope_grants each carried a bare
-- `tenant_id = app.current_tenant_id()` SELECT policy, so ANY authenticated user could enumerate
-- every role's and every colleague's permissions. Not an escalation route — a least-privilege
-- failure on sensitive metadata. Closing it also delivers the strong form of the ADR-0037 call-path
-- rule: an ordinary caller, including an Edge Function running as one, CANNOT read these tables, so
-- it cannot re-implement the permission check even by accident. Enforcement by capability rather
-- than by convention; the CI grep stays as a cheap second line.
--
-- ORDER MATTERS INSIDE THIS FILE. Narrowing the policies without the rest of it locks out the whole
-- tenant, so all three parts ship in one transaction:
--   A. the primitives become SECURITY DEFINER   (or every permission evaluates false — see below)
--   B. the SELECT policies narrow
--   C. self-scoped RPCs replace the three ordinary-user reads
--
-- A IS NOT OPTIONAL. app.has_permission is currently INVOKER and reads the grant tables under the
-- caller's own RLS; 20260823100100 records that this is safe precisely BECAUSE those tables have
-- grant-free SELECT policies. Narrowing them breaks that on two counts:
--   * lockout — an invoker check reading a table the caller may not read returns zero rows, so every
--     permission evaluates false, INCLUDING an administrator's: deciding whether they hold
--     admin.roles:view would require reading role_grants, which would require admin.roles:view;
--   * recursion — a grant-dependent SELECT policy on user_grants re-enters has_permission, which
--     reads user_grants, forever.
-- Reading the grant tables as DEFINER dissolves both. This is the pattern Supabase's own RBAC guide
-- uses for the same reason: definer is what lets the check read the permission table despite
-- restrictive policies on it. Each function still returns one boolean about the caller and reads
-- nothing else — that narrowness is the justification for the elevated privilege.
--
-- BREAK-GLASS. If this misfires, re-widen with service-role SQL:
--   alter policy role_grants_tenant_select on role_grants using (tenant_id = app.current_tenant_id());
-- (and the same for user_grants / user_scope_grants).
--
-- search_path pinned inline throughout, per ADR-0033.

begin;

-- ============================================================================
-- A) the two primitives become SECURITY DEFINER — bodies otherwise UNCHANGED
-- ============================================================================
-- Reproduced verbatim from 20260823100100 with only `security definer` added, so a diff of the two
-- files shows exactly one difference per function.

create or replace function app.has_permission(p_resource text, p_action text)
returns boolean language sql stable security definer
set search_path = public, app, extensions as $$
  select
    (
      exists (
        select 1 from public.role_grants rg
        where rg.role_id   = app.current_role_id()
          and rg.tenant_id = app.current_tenant_id()
          and rg.resource  = p_resource
          and rg.action    = p_action
      )
      or exists (
        select 1 from public.user_grants ug
        where ug.user_id   = auth.uid()
          and ug.tenant_id = app.current_tenant_id()
          and ug.resource  = p_resource
          and ug.action    = p_action
          and ug.effect    = 'allow'
      )
    )
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
  'ADR-0008 + ADR-0036 + ADR-0037: (role grant OR per-user allow) AND NOT per-user deny. Deny wins. '
  'THE authorization primitive; fail-closed. SECURITY DEFINER since L6.11 solely so it can read the '
  'now-private grant tables — it returns one boolean about the caller and must never grow a second '
  'responsibility.';

create or replace function app.in_write_scope(p_department uuid, p_team uuid, p_account_manager uuid)
returns boolean language sql stable security definer
set search_path = public, app, extensions as $$
  select
    case app.current_scope()
      when 'tenant'     then true
      when 'department' then
        (p_department is not null and p_department = app.current_department_id())
        or (p_team is not null and exists (
              select 1 from public.teams t
              where t.id = p_team and t.department_id = app.current_department_id()))
      when 'team'       then p_team is not null and p_team = app.current_team_id()
      when 'account'    then p_account_manager is not null and p_account_manager = auth.uid()
      else false
    end
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
    or (p_team is not null and exists (
          select 1 from public.user_scope_grants usg
          where usg.user_id   = auth.uid()
            and usg.tenant_id = app.current_tenant_id()
            and usg.team_id = p_team))
$$;
comment on function app.in_write_scope(uuid, uuid, uuid) is
  'ADR-0009/0014 + ADR-0036 + ADR-0037: role-derived scope OR an additive per-user department/team '
  'target. SECURITY DEFINER since L6.11 so it can read the now-private user_scope_grants.';

-- app.user_holds_permission (L6.7) answers the same question about an ARBITRARY user and reads the
-- same tables, so it needs the same treatment or the reviewer picker breaks.
create or replace function app.user_holds_permission(p_user uuid, p_resource text, p_action text)
returns boolean language sql stable security definer
set search_path = public, app, extensions as $$
  select (
    exists (
      select 1 from public.role_grants rg
      join public.user_profiles up on up.role_id = rg.role_id
      where up.id = p_user and rg.resource = p_resource and rg.action = p_action
    )
    or exists (
      select 1 from public.user_grants ug
      where ug.user_id = p_user and ug.resource = p_resource and ug.action = p_action and ug.effect = 'allow'
    )
  )
  and not exists (
    select 1 from public.user_grants ug
    where ug.user_id = p_user and ug.resource = p_resource and ug.action = p_action and ug.effect = 'deny'
  )
$$;

-- ============================================================================
-- B) the grant tables become private
-- ============================================================================
-- Gated on the EXISTING catalog entries: admin.roles:view is what the Roles screen already requires,
-- user_grants:view is what the per-user editor already requires. (There is no `roles:view` — the
-- write side is roles:manage.) Both remain tenant-fenced.

drop policy role_grants_tenant_select on role_grants;
create policy role_grants_admin_select on role_grants
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('admin.roles', 'view'));

drop policy user_grants_tenant_select on user_grants;
create policy user_grants_admin_select on user_grants
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('user_grants', 'view'));

drop policy user_scope_grants_tenant_select on user_scope_grants;
create policy user_scope_grants_admin_select on user_scope_grants
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('user_grants', 'view'));

-- ============================================================================
-- C) self-scoped RPCs — the replacements for the three ordinary-user reads
-- ============================================================================
-- Without these, privatising the tables fails every non-admin session closed: permissions.tsx reads
-- the caller's own grants on EVERY page load, and two pickers read them tenant-wide.

-- The caller's own effective permissions. Requires no grant: it is about themselves. DEFINER for the
-- same reason as the primitives, and it computes (role ∪ allow) − deny in ONE place, which also
-- removes the last copy of that formula from the frontend.
create or replace function public.my_permissions()
returns table (resource text, action text)
language sql stable security definer
set search_path = public, app, extensions as $$
  select rg.resource, rg.action
  from public.role_grants rg
  where rg.role_id = app.current_role_id() and rg.tenant_id = app.current_tenant_id()
  union
  select ug.resource, ug.action
  from public.user_grants ug
  where ug.user_id = auth.uid() and ug.tenant_id = app.current_tenant_id() and ug.effect = 'allow'
  except
  select ug.resource, ug.action
  from public.user_grants ug
  where ug.user_id = auth.uid() and ug.tenant_id = app.current_tenant_id() and ug.effect = 'deny'
$$;
comment on function public.my_permissions() is
  'ADR-0037: the caller''s own effective permissions — (role ∪ user-allow) − user-deny, the same '
  'formula as app.has_permission. Self-scoped, so it needs no grant. Replaces the frontend reading '
  'role_grants/user_grants directly (permissions.tsx).';
revoke execute on function public.my_permissions() from public;
revoke execute on function public.my_permissions() from anon;
grant  execute on function public.my_permissions() to authenticated;

-- The caller's own additive scope targets — drives the schedule's canBook mirror (ADR-0036).
create or replace function public.my_scope_grants()
returns table (department_id uuid, team_id uuid)
language sql stable security definer
set search_path = public, app, extensions as $$
  select usg.department_id, usg.team_id
  from public.user_scope_grants usg
  where usg.user_id = auth.uid() and usg.tenant_id = app.current_tenant_id()
$$;
comment on function public.my_scope_grants() is
  'ADR-0037: the caller''s own additive department/team scope targets. Self-scoped; no grant needed.';
revoke execute on function public.my_scope_grants() from public;
revoke execute on function public.my_scope_grants() from anon;
grant  execute on function public.my_scope_grants() to authenticated;

-- Who holds a permission — for the reviewer and account-manager pickers.
--
-- ALLOWLISTED DELIBERATELY. An open (resource, action) parameter would let any user ask "who holds
-- users:manage?" and rebuild a target list for social engineering, undoing the least-privilege fix
-- that section B exists to make. A future screen that needs a third pair adds it here, on purpose.
create or replace function public.users_holding_permission(p_resource text, p_action text)
returns table (id uuid, name text)
language plpgsql stable security definer
set search_path = public, app, extensions as $$
begin
  if (p_resource, p_action) not in (('reviews', 'moderate'), ('account_manager', 'manage')) then
    raise exception 'users_holding_permission: % : % is not an allowlisted lookup', p_resource, p_action
      using errcode = '42501';
  end if;
  return query
    select up.id, up.display_name
    from public.user_profiles up
    where up.tenant_id = app.current_tenant_id()
      and up.is_active                                  -- a deactivated person is not a candidate
      and app.user_holds_permission(up.id, p_resource, p_action)
    order by up.display_name;
end;
$$;
comment on function public.users_holding_permission(text, text) is
  'ADR-0037: the users holding an ALLOWLISTED permission (reviews:moderate, account_manager:manage), '
  'tenant-fenced, id + display name only. Allowlisted so it cannot be used to enumerate who holds '
  'administrative permissions. Replaces useReviewers and the account-manager picker reading the '
  'grant tables directly.';
revoke execute on function public.users_holding_permission(text, text) from public;
revoke execute on function public.users_holding_permission(text, text) from anon;
grant  execute on function public.users_holding_permission(text, text) to authenticated;

commit;
