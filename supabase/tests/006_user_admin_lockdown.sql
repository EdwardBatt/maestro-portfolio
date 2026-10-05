-- L1 user-administration lockdown (migration 20260801090000).
-- The role claim and the profile row must never diverge, so role / is_active /
-- email are writable ONLY by the service-role Edge Functions — no PostgREST
-- client, not even an admin, can touch them (column privileges, 42501).
begin;
select plan(7);
\ir helpers/seed.sql

select has_column('public', 'user_profiles', 'email', 'user_profiles.email exists');

-- === Admin A: RLS lets them update tenant rows, but only the display columns ===
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

select throws_ok($$
  update user_profiles set role_id = (select id from roles where key = 'power_admin' limit 1)
  where id = '00000000-0000-0000-0000-00000000a003'
$$, '42501', null, 'even an admin cannot change role_id client-side (claim would desync)');

select throws_ok($$
  update user_profiles set is_active = false
  where id = '00000000-0000-0000-0000-00000000a003'
$$, '42501', null, 'even an admin cannot deactivate client-side (ban would desync)');

select throws_ok($$
  update user_profiles set email = 'spoof@a.test'
  where id = '00000000-0000-0000-0000-00000000a003'
$$, '42501', null, 'email mirror is not client-writable');

select lives_ok($$
  update user_profiles set display_name = 'Creative A (renamed)'
  where id = '00000000-0000-0000-0000-00000000a003'
$$, 'admin can update display fields client-side');

-- === Creative A: self-update of display fields only, no reach into others ===
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);

select lives_ok($$
  update user_profiles set locale = 'ar'
  where id = '00000000-0000-0000-0000-00000000a003'
$$, 'user can update own locale');

-- RLS silently filters foreign rows: the update hits 0 rows, name unchanged.
update user_profiles set display_name = 'hijacked'
  where id = '00000000-0000-0000-0000-00000000a002';
select is(
  (select display_name from user_profiles where id = '00000000-0000-0000-0000-00000000a002'),
  'Booker A', 'non-admin cannot rename another user (0 rows under RLS)');

select * from finish();
rollback;
