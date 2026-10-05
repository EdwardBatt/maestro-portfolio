-- M4 schema: series + approval flag, with isolation and shape checks.
begin;
select plan(6);
\ir helpers/seed.sql

-- approval flag default off
select is(
  (select requires_approval from resources where name = 'RED Camera'),
  false, 'requires_approval defaults to false');

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);

-- booker creates a series + instances
select lives_ok($$
  insert into booking_series (id, tenant_id, resource_id, created_by, freq, repeat_count, first_starts_at, first_ends_at)
  values ('aaaaaaaa-0000-0000-0000-00000000e101', 'aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-00000000a002',
          'weekly', 4, '2026-08-02T07:00Z', '2026-08-02T11:00Z')
$$, 'booker creates a weekly series');

select lives_ok($$
  insert into bookings (tenant_id, resource_id, starts_at, ends_at, state, load_pct, series_id)
  select 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001',
         ('2026-08-02T07:00Z'::timestamptz + (n || ' weeks')::interval),
         ('2026-08-02T11:00Z'::timestamptz + (n || ' weeks')::interval),
         'confirmed', 40.0, 'aaaaaaaa-0000-0000-0000-00000000e101'
  from generate_series(0, 3) n
$$, 'four instances attach to the series');

select is(
  (select count(*)::int from bookings where series_id = 'aaaaaaaa-0000-0000-0000-00000000e101'),
  4, 'series has 4 instances');

-- repeat_count bounds enforced
select throws_ok($$
  insert into booking_series (tenant_id, resource_id, freq, repeat_count, first_starts_at, first_ends_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001',
          'weekly', 1, '2026-08-02T07:00Z', '2026-08-02T11:00Z')
$$, '23514', null, 'repeat_count below 2 rejected');

-- cross-tenant isolation on the new table
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000b002'), true);
select is((select count(*)::int from booking_series), 0, 'B sees no A series');

select * from finish();
rollback;
