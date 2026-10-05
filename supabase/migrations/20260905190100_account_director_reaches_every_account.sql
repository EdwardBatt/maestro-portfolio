-- I40 (ADR-0073 d.2/d.3) — the account branch of `app.in_write_scope` gains an all-accounts case.
--
-- The Account Director is `account`-scoped, exactly like the Account Manager, and differs in ONE
-- place: where the Account Manager reaches rows they are the named manager of, the Director reaches
-- every account in the tenant. Putting that here rather than in each caller is the whole point —
-- ADR-0073 d.2: *"No function may enumerate roles"*, and this is the one place a role key is read,
-- inside the primitive that already answers "this person, over this thing".
--
-- WHY NOT `tenant` SCOPE, WHICH WOULD NEED NO CODE. Because `tenant` is the systems tier: it is what
-- makes Power Admin pass every RLS branch in the product, including user administration, roles and
-- the audit log. Widening client reach by borrowing it is how a role acquires powers nobody decided
-- to give it. One line here is cheaper than that, and reversible.
--
-- Reproduced WHOLE from `20260824120000_privatise_grant_tables.sql:81`, the house pattern for
-- `create or replace`: a bare replace resets `proconfig` and silently drops the ADR-0033
-- `search_path` pin. The ONLY edit is the `when 'account'` branch.

begin;

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
      -- ADR-0073 d.3. An Account Director oversees every account, so the named-manager test that
      -- bounds an Account Manager does not bound them. Read from `roles.key` rather than from a
      -- claim, so revoking the role takes effect on the next request (ADR-0037).
      when 'account'    then
        (p_account_manager is not null and p_account_manager = auth.uid())
        or exists (
             select 1 from public.roles r
             where r.id = app.current_role_id() and r.key = 'account_director')
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
  'ADR-0009/0014 + ADR-0036 + ADR-0037 + ADR-0073: role-derived scope OR an additive per-user '
  'department/team target. SECURITY DEFINER since L6.11 so it can read the now-private '
  'user_scope_grants. The account branch passes an Account Director for EVERY account (ADR-0073 '
  'd.3) — the one place in the system a role key is read, deliberately in the primitive so that no '
  'caller has to name a role.';

commit;
