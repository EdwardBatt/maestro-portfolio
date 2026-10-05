-- L6.8 (ADR-0037): the PostgREST-visible doorway to the authorization primitive.
--
-- What must hold for the Edge Functions that now call it:
--   * it agrees with app.has_permission exactly — role grant, per-user allow, and DENY WINS;
--   * anon cannot execute it (an unauthenticated caller must never resolve a permission);
--   * it is invoker, not SECURITY DEFINER (the privileged read belongs in the primitive — L6.11
--     flips the primitive, never this doorway);
--   * with no JWT it answers false, so a service-role caller cannot smuggle a true out of it.
--
-- Subjects (helpers/seed.sql, tenant A): a001 = power_admin, a003 = team_member (holds
-- media:manage from its role, project_tasks:manage from the seed fixture; holds no audit:view, no bookings:create).
-- Overlay rows go in via the authenticated admin path — app.tg_stamp_granted_by forces
-- granted_by = auth.uid(), so a superuser insert would violate NOT NULL.

begin;
select plan(12);
\ir helpers/seed.sql

set local role authenticated;

-- ---------------------------------------------------------------- shape --
select has_function('public', 'has_permission', array['text', 'text'],
  'public.has_permission(text,text) exists');
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'has_permission'),
  false,
  'the doorway is INVOKER — the privileged read stays inside the primitive (ADR-0037 d.1)');
select is(
  (select provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'has_permission'),
  's'::"char",
  'STABLE, so Postgres caches it per statement');
select isnt(
  (select proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'has_permission'),
  null,
  'search_path is pinned inline (ADR-0033)');

-- ------------------------------------------------------------ execution --
select ok(
  not has_function_privilege('anon', 'public.has_permission(text,text)', 'execute'),
  'anon cannot execute it — an unauthenticated caller never resolves a permission');
select ok(
  has_function_privilege('authenticated', 'public.has_permission(text,text)', 'execute'),
  'authenticated can execute it — this is the Edge Function path');

-- --------------------------------------------------------- agreement ------
-- 1) role grant: team_member holds media:manage from its role.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select is(public.has_permission('media', 'manage'), true,
  'role grant resolves true through the doorway');
select is(public.has_permission('media', 'manage'), app.has_permission('media', 'manage'),
  'doorway agrees with the primitive (role grant)');

-- 2) baseline: no bookings:create from the role. This is the exact shape that broke live —
--    subtask-schedule refused a user whose overlay said otherwise.
select is(public.has_permission('bookings', 'create'), false,
  'baseline: team member holds no bookings:create');

-- 3) a per-user ALLOW must be visible through the doorway.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
insert into user_grants (tenant_id, user_id, resource, action, effect)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-00000000a003', 'bookings', 'create', 'allow');
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select is(public.has_permission('bookings', 'create'), true,
  'per-user ALLOW reaches the doorway — the L6.2 gap that blocked a real user');

-- 4) a per-user DENY must beat a role grant through the doorway (the fail-open half).
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
insert into user_grants (tenant_id, user_id, resource, action, effect)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-00000000a003', 'media', 'manage', 'deny');
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select is(public.has_permission('media', 'manage'), false,
  'per-user DENY beats the role grant through the doorway');

-- 5) no JWT at all → false. A service-role caller has no auth.uid() and must not pass.
select set_config('request.jwt.claims', null, true);
select is(coalesce(public.has_permission('media', 'manage'), false), false,
  'no caller identity resolves to false — fail closed');

select * from finish();
rollback;
