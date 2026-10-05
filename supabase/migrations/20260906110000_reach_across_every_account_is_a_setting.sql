-- I40.16 (ADR-0074) — "every account" becomes a reach a role can be SET to.
--
-- Edward, 6 Sep: *"The description in the Account Director's role is incorrect."*
--
-- The BEHAVIOUR is correct and is not touched here. An Account Director reaches every account; an
-- Account Manager reaches only campaigns they are named on. Test 087 asserts it.
--
-- What was wrong is that the Roles screen could not say so. `roles.scope` had five values, and the
-- Account Director sat on `account` — which that screen renders as *"Their own accounts — this role
-- can act on the clients and campaigns the person is named on."* That is the Account MANAGER's
-- rule, and the two roles were indistinguishable on the one screen whose job is to say how far a
-- role reaches. The extra reach was not a property of the role at all: it was
-- `roles.key = 'account_director'` written into `app.in_write_scope` by `20260905190100`.
--
-- ADR-0073 d.2 forbids that in every other function — *"No function may enumerate roles; that is
-- what this ADR exists to prevent"* — and then made one exception for itself, which its own
-- Consequences section flagged as *"the one place a role is consulted"*. This removes it, so the
-- rule holds with nothing left to remember.
--
-- **No behaviour changes.** The new branch returns what the exception returned, for the same people.
-- Checked rather than assumed: `create_campaign_from_brief` used to stamp an account-scoped creator
-- as the campaign's manager (`if app.current_scope() = 'account'`), which moving the role would have
-- altered — `20260829150000` made that an explicit parameter, and the live catalogue holds no
-- remaining reader of the branch.
--
-- Three readers of `roles.scope` exist and all three are updated together: this function, the reach
-- ladder on the Roles screen, and the client-side mirror in `src/features/schedule/lib/write-scope.ts`
-- (which leans ALLOW for this reach exactly as it does for `tenant`). The check constraint below is
-- what makes a missed fourth fail loudly instead of silently narrowing somebody.

begin;

-- ---------------------------------------------------------------- the sixth value ----
-- Widened, never narrowed: every existing value stays legal, so no role can be invalidated by this.
alter table roles drop constraint if exists roles_scope_check;
alter table roles add constraint roles_scope_check
  check (scope in ('tenant', 'all_accounts', 'department', 'team', 'account', 'self'));

comment on column roles.scope is
  'WRITE reach of this role: tenant | all_accounts | department | team | account | self. Reads are '
  'always tenant-wide; write policies consult this via app.in_write_scope(). RELATIVE to the holder '
  '— `department` means THEIR department, which is why one Department Lead role serves every '
  'department. `all_accounts` (ADR-0074) is the exception that proves it: reach over every client '
  'account rather than the ones they are named on, without the systems reach `tenant` carries. '
  'Reach to a NAMED department/team is a per-user grant (user_scope_grants, ADR-0036), never a role '
  'property. New roles default to `self` (ADR-0041).';

-- The role itself. `account_director` is not a system role (`is_system` false), so
-- `protect_system_role_grants` does not fence its scope — and it is set here rather than left to an
-- administrator, because until this runs the role's reach is a lie on the screen.
update roles set scope = 'all_accounts' where key = 'account_director';

-- ---------------------------------------------------------------- the primitive ----
-- Reproduced WHOLE per `20260905190100`'s warning: a bare `create or replace` resets `proconfig` and
-- silently drops the ADR-0033 `search_path` pin. Two edits, and no others: the `all_accounts` branch
-- is added, and the `roles.key = 'account_director'` test is removed from the `account` branch.
create or replace function app.in_write_scope(p_department uuid, p_team uuid, p_account_manager uuid)
returns boolean language sql stable security definer
set search_path = public, app, extensions as $$
  select
    case app.current_scope()
      when 'tenant'     then true
      -- ADR-0074 d.1/d.2. Every account's work, and nothing administrative — the grant axis is what
      -- says which ACTIONS, and this role holds no administrative grant (test 087). Where ADR-0073
      -- d.3 read a role's key to reach this answer, the role's own reach now says it.
      when 'all_accounts' then true
      when 'department' then
        (p_department is not null and p_department = app.current_department_id())
        or (p_team is not null and exists (
              select 1 from public.teams t
              where t.id = p_team and t.department_id = app.current_department_id()))
      -- ADR-0070 d.3 states it plainly: *"A team lead may approve their own department's brief."*
      -- Every OTHER call site passes a team alongside the department, and the two that do not —
      -- accepting a department brief, and generating one — are exactly the department-level
      -- questions the ADR is about, so a team lead was refused both.
      --
      -- Where a team IS named the original test stands unchanged, which is what keeps a team lead
      -- out of a sibling team's work. Only a question asked with NO team — "is this department
      -- yours?" — is answered by the department their team sits in.
      when 'team'       then
        (p_team is not null and p_team = app.current_team_id())
        or (p_team is null and p_department is not null and exists (
              select 1 from public.teams t
              where t.id = app.current_team_id() and t.department_id = p_department))
      -- The named manager, and only them. ADR-0073's `or exists (… key = 'account_director')` is
      -- GONE from here: that role now answers on the branch above, by its own reach.
      when 'account'    then
        (p_account_manager is not null and p_account_manager = auth.uid())
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
  'ADR-0037 write scope. ADR-0074: `all_accounts` reaches every account, replacing the '
  'ADR-0073 role-name exception — no function names a role any more. A team lead answers a '
  'DEPARTMENT-level question about the department their team sits in (ADR-0070 d.3), while a '
  'question that names a team still requires that team.';

-- ---------------------------------------------------------------- and for the next tenant ----
-- Reproduced whole so a tenant provisioned tomorrow gets the reach rather than the old value plus a
-- backfill nobody remembers to run. The ONLY edit is the scope literal.
create or replace function app.seed_account_director(p_tenant uuid) returns void
language plpgsql security definer
set search_path = public, app, extensions as $$
declare v_dir uuid; v_am uuid;
begin
  insert into roles (tenant_id, key, name, description, is_system, default_route, scope)
  values (
    p_tenant, 'account_director', 'Account Director',
    'Oversees every account — campaigns, clients and briefs across all of them. No administration.',
    false, '/campaigns', 'all_accounts'
  )
  on conflict (tenant_id, key) do nothing;

  -- A tenant seeded before ADR-0074 already has the row, so the insert above no-ops and the reach
  -- would stay wrong. Stated separately rather than as a `do update`, which would also overwrite a
  -- name or description an administrator had edited.
  update roles set scope = 'all_accounts'
   where tenant_id = p_tenant and key = 'account_director' and scope <> 'all_accounts';

  select id into v_dir from roles where tenant_id = p_tenant and key = 'account_director';
  select id into v_am  from roles where tenant_id = p_tenant and key = 'account_manager';

  -- Copied, never retyped. If the Account Manager gains a grant tomorrow, re-running this seed
  -- gives it to the Director too; retyping the list is how the two silently diverge.
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_dir, rg.resource, rg.action
    from role_grants rg
   where rg.role_id = v_am
  on conflict do nothing;

  -- ADR-0073 d.6. Added explicitly rather than inherited, because the Account Manager holds it for a
  -- different reason (ADR-0070 d.3) and this one holds it as the fallback of last resort.
  insert into role_grants (tenant_id, role_id, resource, action)
  values (p_tenant, v_dir, 'briefs', 'approve')
  on conflict do nothing;
end $$;

comment on function app.seed_account_director(uuid) is
  'ADR-0073 d.3/d.6, reach amended by ADR-0074. Account Director: all-accounts reach, the Account '
  'Manager''s grants copied rather than retyped, plus briefs:approve as the fallback approver. No '
  'administrative grant.';

commit;
