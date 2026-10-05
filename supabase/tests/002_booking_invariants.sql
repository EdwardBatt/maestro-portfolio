-- The hard invariant (§4.2) and booking-shape rules, exercised as Booker A.
begin;
select plan(8);
\ir helpers/seed.sql

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);

-- Confirmed booking on the exclusive camera.
select lives_ok($$
  insert into bookings (tenant_id, resource_id, starts_at, ends_at, state)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-00000000d002',
          '2026-08-03T09:00Z', '2026-08-03T13:00Z', 'confirmed')
$$, 'booker A confirms the camera 09–13');

-- Trigger derived exclusivity from the resource (client never supplies it).
select is(
  (select is_exclusive from bookings
   where resource_id = 'aaaaaaaa-0000-0000-0000-00000000d002' limit 1),
  true, 'trigger set is_exclusive from the resource');

-- THE invariant: overlapping CONFIRMED booking on an exclusive resource → 23P01.
select throws_ok($$
  insert into bookings (tenant_id, resource_id, starts_at, ends_at, state)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-00000000d002',
          '2026-08-03T11:00Z', '2026-08-03T15:00Z', 'confirmed')
$$, '23P01', null, 'exclusion constraint blocks double-booked exclusive resource');

-- Tentatives MAY coexist with confirmed on the same window (§4.2).
select lives_ok($$
  insert into bookings (tenant_id, resource_id, starts_at, ends_at, state)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-00000000d002',
          '2026-08-03T11:00Z', '2026-08-03T15:00Z', 'tentative')
$$, 'tentative may overlap confirmed (approval decides)');

-- Load-based humans: overlapping CONFIRMED bookings are allowed (warn-and-allow
-- lives in app logic, never as a DB block — §4.1).
select lives_ok($$
  insert into bookings (tenant_id, resource_id, starts_at, ends_at, state, load_pct) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001',
   '2026-08-03T09:00Z', '2026-08-03T17:00Z', 'confirmed', 60.0),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d001',
   '2026-08-03T10:00Z', '2026-08-03T16:00Z', 'confirmed', 60.0)
$$, 'overlapping confirmed load on a human is allowed (115% is a warning, not an error)');

-- Zero/negative spans rejected.
select throws_ok($$
  insert into bookings (tenant_id, resource_id, starts_at, ends_at, state)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-00000000d001',
          '2026-08-04T10:00Z', '2026-08-04T10:00Z', 'tentative')
$$, '23514', null, 'zero-length span rejected');

-- soft_hold requires an expiry.
select throws_ok($$
  insert into bookings (tenant_id, resource_id, starts_at, ends_at, state)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-00000000d001',
          '2026-08-04T10:00Z', '2026-08-04T12:00Z', 'soft_hold')
$$, '23514', null, 'soft_hold without expiry rejected');

-- Deny-by-default: a team member (Creative) holds no bookings:create grant, so booking is refused.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select throws_ok($$
  insert into bookings (tenant_id, resource_id, starts_at, ends_at, state)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-00000000d001',
          '2026-08-05T10:00Z', '2026-08-05T12:00Z', 'tentative')
$$, '42501', null, 'team member cannot create a booking (no grant)');

select * from finish();
rollback;
