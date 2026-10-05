-- L6.10 (ADR-0037 decision 6): resolve the caller's role, department and team from the DATABASE,
-- not from their login token.
--
-- WHY. app.current_role_id / current_department_id / current_team_id read
-- auth.jwt() -> 'app_metadata'. A token is immutable until it refreshes (default 1h), so changing
-- somebody's role, department or team did nothing for up to an hour while every screen insisted it
-- had worked. That is the same "I changed it and nothing happened" confusion the ADR-0036 overlay
-- was built to end — and the overlay itself never had the problem, because user_grants keys on
-- auth.uid() and is read live.
--
-- The closest published analogue to this schema (point-source/supabase-tenant-rbac) resolves roles
-- by live lookup for exactly this reason. Supabase's own RBAC guide caches the role in the JWT via a
-- custom access token hook and does not address staleness at all; this deviates from that default in
-- the safer direction and pays one lookup per check for it.
--
-- RECURSION — the reason for SECURITY DEFINER. The user_profiles_admin_all policy calls
-- app.has_permission. If current_role_id() read user_profiles under RLS, evaluating that policy
-- would re-enter has_permission, which would read user_profiles again, forever. Reading the row as
-- DEFINER bypasses RLS for that one lookup and breaks the cycle. The function returns three ids
-- about the caller themselves and nothing else; that narrowness is the whole justification for the
-- elevated privilege, and it must not grow.
--
-- FALLBACK. If the caller has no user_profiles row (a freshly invited account mid-provisioning, or
-- a service context), the JWT claim is used exactly as before. Nobody can be locked out by this
-- change: the worst case is the behaviour we already had.
--
-- The claims are still written to app_metadata by update-user, for debugging and for anything
-- outside the database that reads them. They are simply no longer authoritative.
--
-- search_path pinned inline per ADR-0033.

begin;

-- --------------------------------------------------------------- the live read ----
-- One row, three columns, keyed on the caller. STABLE so Postgres evaluates it once per statement
-- rather than once per row — this sits underneath every RLS policy in the system.
create or replace function app.current_identity()
returns table (role_id uuid, department_id uuid, team_id uuid)
language sql stable security definer
set search_path = public, app, extensions as $$
  select up.role_id, up.department_id, up.team_id
  from public.user_profiles up
  where up.id = auth.uid()
$$;
comment on function app.current_identity() is
  'ADR-0037 (L6.10): the caller''s role/department/team read live from user_profiles. SECURITY '
  'DEFINER solely to bypass RLS on that one row — user_profiles_admin_all calls app.has_permission, '
  'so an invoker read would recurse. Returns three ids about the caller and nothing else.';
revoke execute on function app.current_identity() from public;
revoke execute on function app.current_identity() from anon;
grant  execute on function app.current_identity() to authenticated, service_role;

-- ------------------------------------------------------------ the three helpers ----
-- Same signatures, same return types, same NULL-when-unknown behaviour: every existing policy and
-- function keeps working untouched. Only the source of the answer changes.
create or replace function app.current_role_id() returns uuid
language sql stable
set search_path = public, app, extensions as $$
  select coalesce(
    (select i.role_id from app.current_identity() i),
    nullif(auth.jwt() -> 'app_metadata' ->> 'app_role_id', '')::uuid
  )
$$;

create or replace function app.current_department_id() returns uuid
language sql stable
set search_path = public, app, extensions as $$
  select coalesce(
    (select i.department_id from app.current_identity() i),
    nullif(auth.jwt() -> 'app_metadata' ->> 'department_id', '')::uuid
  )
$$;

create or replace function app.current_team_id() returns uuid
language sql stable
set search_path = public, app, extensions as $$
  select coalesce(
    (select i.team_id from app.current_identity() i),
    nullif(auth.jwt() -> 'app_metadata' ->> 'team_id', '')::uuid
  )
$$;

comment on function app.current_role_id() is
  'ADR-0037 (L6.10): the caller''s role, live from user_profiles, falling back to the JWT claim when '
  'the caller has no profile row. A role change now takes effect on the next request, not the next '
  'token refresh.';
comment on function app.current_department_id() is
  'ADR-0037 (L6.10): live department, JWT claim as fallback. Moving someone between departments '
  'takes effect immediately, which the scope axis (ADR-0009/0014) depends on.';
comment on function app.current_team_id() is
  'ADR-0037 (L6.10): live team, JWT claim as fallback.';

commit;
