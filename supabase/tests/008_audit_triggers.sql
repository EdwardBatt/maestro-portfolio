-- ADR-0008 Decision 8: universal audit — every write path leaves a trail,
-- and the trail itself stays append-only.
begin;
select plan(8);
\ir helpers/seed.sql

-- Baseline: seeding itself was audited (superuser writes fire triggers too).
select cmp_ok(
  (select count(*)::int from audit_events where entity = 'user_profiles' and action = 'insert'),
  '>=', 5, 'profile creation left audit rows');

-- === Direct PostgREST-style write as Scheduler A ===
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);

insert into bookings (id, tenant_id, resource_id, starts_at, ends_at, state)
values ('aaaaaaaa-0000-0000-0000-00000000ad01',
        'aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-00000000d001',
        '2026-09-10T09:00Z', '2026-09-10T13:00Z', 'tentative');

-- Scheduler holds no audit:view — the trail is invisible to them (by design),
-- so assertions read as superuser after resetting role.
reset role;
select is(
  (select count(*)::int from audit_events
    where entity = 'bookings' and action = 'insert'
      and entity_id = 'aaaaaaaa-0000-0000-0000-00000000ad01'
      and actor_user_id = '00000000-0000-0000-0000-00000000a002'),
  1, 'insert audited with the acting user');

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);
update bookings set state = 'confirmed'
  where id = 'aaaaaaaa-0000-0000-0000-00000000ad01';
reset role;

select is(
  (select payload ->> 'state' from audit_events
    where entity = 'bookings' and action = 'update'
      and entity_id = 'aaaaaaaa-0000-0000-0000-00000000ad01'
    order by created_at desc limit 1),
  'confirmed', 'update audited with changed fields only');

select ok(
  (select (payload -> 'resource_id') is null from audit_events
    where entity = 'bookings' and action = 'update'
      and entity_id = 'aaaaaaaa-0000-0000-0000-00000000ad01'
    order by created_at desc limit 1),
  'unchanged fields are not in the update payload');

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);
delete from bookings where id = 'aaaaaaaa-0000-0000-0000-00000000ad01';
reset role;
select is(
  (select count(*)::int from audit_events
    where entity = 'bookings' and action = 'delete'
      and entity_id = 'aaaaaaaa-0000-0000-0000-00000000ad01'),
  1, 'delete audited');

-- === RBAC changes are audited too (the rules screen leaves a trail) ===
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
insert into roles (tenant_id, key, name)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'auditor', 'Auditor');
select is(
  (select count(*)::int from audit_events
    where entity = 'roles' and action = 'insert'
      and payload ->> 'key' = 'auditor'
      and actor_user_id = '00000000-0000-0000-0000-00000000a001'),
  1, 'role creation audited with actor');

-- === The trail is untouchable from the app ===
select throws_ok($$
  update audit_events set payload = '{}' where entity = 'bookings'
$$, '42501', null, 'audit rows cannot be edited');
select throws_ok($$
  delete from audit_events where entity = 'bookings'
$$, '42501', null, 'audit rows cannot be deleted');

select * from finish();
rollback;
