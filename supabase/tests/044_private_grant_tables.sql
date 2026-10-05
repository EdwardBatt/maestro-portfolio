-- L6.11 (ADR-0037 decisions 0, 4, 5): the grant tables are private, and everything still works.
--
-- The failure this guards against is total: if app.has_permission stayed INVOKER while the tables
-- became private, every permission would evaluate false for everyone — including administrators,
-- since deciding whether they hold admin.roles:view would require reading role_grants, which would
-- require admin.roles:view. The first assertions below fail loudly if anyone ever "simplifies" the
-- SECURITY DEFINER away.
--
-- Also pinned: an ordinary user cannot enumerate anyone's permissions (the least-privilege fix), can
-- still resolve their OWN (or every session breaks), and cannot use the picker RPC to ask who holds
-- administrative permissions (the allowlist).
--
-- Subjects (helpers/seed.sql, tenant A): a001 = power_admin, a003 = team_member.

begin;
select plan(16);
\ir helpers/seed.sql

-- --------------------------------------------------------- definer, on purpose ----
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'has_permission'),
  true,
  'app.has_permission is SECURITY DEFINER — invoker + private tables = total lockout');
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'in_write_scope'),
  true,
  'app.in_write_scope is SECURITY DEFINER — it reads the private user_scope_grants');
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'user_holds_permission'),
  true,
  'app.user_holds_permission is SECURITY DEFINER — the reviewer picker depends on it');

select ok(not has_function_privilege('anon', 'public.my_permissions()', 'execute'),
          'anon cannot call my_permissions');
select ok(has_function_privilege('authenticated', 'public.my_permissions()', 'execute'),
          'authenticated can — every session needs it on load');

set local role authenticated;

-- ------------------------------------------------- the tables are actually private ----
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);

select is((select count(*) from role_grants)::int, 0,
          'an ordinary user reads NO role_grants — they can no longer enumerate every role');
select is((select count(*) from user_grants)::int, 0,
          'an ordinary user reads NO user_grants — nor every colleague''s overrides');
select is((select count(*) from user_scope_grants)::int, 0,
          'an ordinary user reads NO user_scope_grants');

-- …while the checks that read them still work, because they run as DEFINER
select is(app.has_permission('media', 'manage'), true,
          'the permission check still resolves for that same user — DEFINER reads what they cannot');
select is(app.has_permission('audit', 'view'), false,
          'and still says no where the answer is no');

-- ---------------------------------------------------- self-scoped, no grant needed ----
select ok((select count(*) from public.my_permissions()) > 0,
          'my_permissions returns the caller''s own set without any grant');
select ok(
  exists (select 1 from public.my_permissions() where resource = 'media' and action = 'manage'),
  'and it contains what the role grants');

-- deny must win here exactly as it does in app.has_permission — one formula, two callers
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
insert into user_grants (tenant_id, user_id, resource, action, effect)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-00000000a003', 'media', 'manage', 'deny');
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select ok(
  not exists (select 1 from public.my_permissions() where resource = 'media' and action = 'manage'),
  'a per-user DENY removes it from my_permissions too — the frontend and the DB agree');

-- ------------------------------------------------------ an admin can still read ----
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select ok((select count(*) from role_grants) > 0,
          'a holder of admin.roles:view still reads role_grants — the Roles screen works');
select ok((select count(*) from user_grants) > 0,
          'a holder of user_grants:view still reads user_grants — the per-user editor works');

-- ------------------------------------------------------------ the allowlist ----
-- Left open, this would let any user ask who holds users:manage and build a target list.
select throws_ok(
  $$select * from public.users_holding_permission('users', 'manage')$$,
  '42501',
  null,
  'users_holding_permission refuses a non-allowlisted lookup');

select * from finish();
rollback;
