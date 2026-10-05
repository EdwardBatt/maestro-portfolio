-- L6.10 (ADR-0037 decision 6): identity resolved from the database, not the login token.
--
-- The behaviour that matters, and the reason for the change: a role change takes effect on the NEXT
-- REQUEST, not the next token refresh. The test proves it by changing a role while holding the SAME
-- unchanged JWT — which is exactly the situation a user is in after an admin edits them, and exactly
-- where the old implementation was wrong for up to an hour.
--
-- Also pinned here: the JWT fallback (nobody without a profile row is locked out), and the
-- recursion that forced SECURITY DEFINER — user_profiles_admin_all calls app.has_permission, so an
-- invoker read of user_profiles would re-enter it forever. If someone "simplifies" the definer away,
-- the last test hangs or errors rather than passing quietly.
--
-- Subjects (helpers/seed.sql, tenant A): a001 = power_admin, a003 = team_member.

begin;
select plan(11);
\ir helpers/seed.sql

-- ------------------------------------------------------------------- shape ----
select has_function('app', 'current_identity', 'app.current_identity() exists');
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'current_identity'),
  true,
  'current_identity is SECURITY DEFINER — an invoker read would recurse through user_profiles RLS');
select isnt(
  (select proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'current_identity'),
  null,
  'search_path pinned inline (ADR-0033)');
select ok(
  not has_function_privilege('anon', 'app.current_identity()', 'execute'),
  'anon cannot execute it');

set local role authenticated;

-- --------------------------------------------------- live, not from the token ----
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);

select is(app.current_role_id(),
          (select role_id from user_profiles where id = '00000000-0000-0000-0000-00000000a003'),
          'baseline: the helper agrees with the profile row');
select is(app.has_permission('media', 'manage'), true,
          'baseline: team_member holds media:manage through its role');
select is(app.has_permission('audit', 'view'), false,
          'baseline: team_member does not hold audit:view');

-- Move a003 to the power_admin role WITHOUT touching their JWT. Under the old implementation the
-- helper read app_role_id from the token, so this would have changed nothing until it refreshed.
set local role postgres;
update user_profiles
   set role_id = (select id from roles
                  where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'power_admin')
 where id = '00000000-0000-0000-0000-00000000a003';
set local role authenticated;

select is(app.current_role_id(),
          (select id from roles
           where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'power_admin'),
          'role change is visible immediately, on the same unchanged token');
select is(app.has_permission('audit', 'view'), true,
          'and the permission it carries applies at once — no waiting for token refresh');

-- ------------------------------------------------------------- JWT fallback ----
-- A caller with no profile row falls back to the claim, so provisioning gaps degrade to the old
-- behaviour rather than to a lockout.
set local role postgres;
insert into auth.users (id, email) values ('aaaaaaaa-0000-0000-0000-0000000000f1', 'noprofile@a.test');
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', 'aaaaaaaa-0000-0000-0000-0000000000f1',
                    'role', 'authenticated',
                    'app_metadata', json_build_object(
                      'tenant_id', 'aaaaaaaa-0000-0000-0000-000000000001',
                      'app_role_id', (select id from roles
                                      where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                                        and key = 'scheduler')))::text, true);
select is(app.current_role_id(),
          (select id from roles
           where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'scheduler'),
          'no profile row falls back to the JWT claim — nobody is locked out by this change');

-- ------------------------------------------------------- recursion is broken ----
-- Reading user_profiles as an ordinary caller evaluates user_profiles_admin_all, which calls
-- app.has_permission, which calls current_role_id, which reads user_profiles. This completes only
-- because current_identity is DEFINER and does not re-enter the policy.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select lives_ok(
  $$select count(*) from user_profiles$$,
  'selecting user_profiles does not recurse through has_permission');

select * from finish();
rollback;
