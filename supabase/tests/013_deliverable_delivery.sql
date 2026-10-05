-- ADR-0023 delivery + Library-reconciliation suite. Proves the hinge:
--   * an explicit per-version deliver files the round into the campaign's Deliverables
--     folder as a NEW asset_version — every client-delivered round persists;
--   * internal (undelivered) rounds NEVER become Library assets;
--   * delivery requires projects:manage AND assets:manage, is tenant-fenced;
--   * approval promotes the accepted version into Final Assets (is_final);
--   * delivery/approval land on the append-only sla_events log.
-- Portal-side adversarial scoping is M10 (the portal isn't built yet); the isolation asserted
-- here is the structural guarantee that underpins it: internal rounds are not in the Library.
begin;
select plan(13);
\ir helpers/seed.sql

-- Grants the base fixture doesn't seed (asset grants live in a separate ADR-0022 seeder;
-- storage settings in ADR-0023's). Superuser path — before any SET ROLE.
select app.seed_tenant_asset_grants(id) from tenants;
select app.seed_tenant_storage_settings(id) from tenants;

-- A campaign deliverable (base seed's campaign e001 already has its folder tree provisioned)
-- with three review rounds: v1, v2 will be delivered; v3 stays internal.
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000a301', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001', 'Creative');
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-00000000a401', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000a301', 'Key Visual', 'draft', '00000000-0000-0000-0000-00000000a001');
insert into media_records (id, tenant_id, deliverable_id, version, object_key) values
  ('aaaaaaaa-0000-0000-0000-00000000a501', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000a401', 1, 'a/kv/v1'),
  ('aaaaaaaa-0000-0000-0000-00000000a502', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000a401', 2, 'a/kv/v2'),
  ('aaaaaaaa-0000-0000-0000-00000000a503', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000a401', 3, 'a/kv/v3');

-- ---- as Booker A (scheduler: holds projects:manage + assets:manage) → can deliver ----
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);

select lives_ok($$ select deliver_deliverable_version('aaaaaaaa-0000-0000-0000-00000000a501') $$,
  'scheduler delivers round 1');
select lives_ok($$ select deliver_deliverable_version('aaaaaaaa-0000-0000-0000-00000000a502') $$,
  'scheduler delivers round 2 (re-enterable)');

-- Every DELIVERED round persisted as an asset_version; the internal v3 did NOT.
select is(
  (select count(*)::int from asset_versions av
     join asset_references ar on ar.asset_id = av.asset_id
    where ar.ref_type = 'deliverable' and ar.ref_id = 'aaaaaaaa-0000-0000-0000-00000000a401'),
  2, 'two delivered rounds persisted as asset_versions (internal v3 excluded)');

select is(
  (select current_version from assets a
     join asset_references ar on ar.asset_id = a.id
    where ar.ref_id = 'aaaaaaaa-0000-0000-0000-00000000a401' and not a.is_final),
  2, 'Deliverables asset advanced to current_version 2');

-- Filed into the campaign's Deliverables folder specifically.
select is(
  (select f.name from assets a
     join asset_references ar on ar.asset_id = a.id
     join asset_folders f on f.id = a.folder_id
    where ar.ref_id = 'aaaaaaaa-0000-0000-0000-00000000a401' and not a.is_final),
  'Deliverables', 'delivered rounds land in the Deliverables folder');

-- Delivery stamped on the internal rounds; round numbers mirror the asset_versions.
select is((select delivery_round from media_records where id = 'aaaaaaaa-0000-0000-0000-00000000a501'),
  1, 'v1 stamped delivery_round 1');
select is((select delivery_round from media_records where id = 'aaaaaaaa-0000-0000-0000-00000000a502'),
  2, 'v2 stamped delivery_round 2');
select ok((select delivered_at is null from media_records where id = 'aaaaaaaa-0000-0000-0000-00000000a503'),
  'internal v3 never marked delivered');

-- Approval promotes the accepted delivered version into Final Assets (is_final).
select lives_ok($$ select promote_delivered_version_to_final('aaaaaaaa-0000-0000-0000-00000000a502') $$,
  'scheduler promotes the approved version to Final Assets');
select is(
  (select count(*)::int from assets a
     join asset_references ar on ar.asset_id = a.id
     join asset_folders f on f.id = a.folder_id
    where ar.ref_id = 'aaaaaaaa-0000-0000-0000-00000000a401' and a.is_final and f.name = 'Final Assets'),
  1, 'one is_final asset filed in Final Assets');

-- Delivery + approval recorded on the append-only event log.
select is(
  (select count(*)::int from sla_events
    where deliverable_id = 'aaaaaaaa-0000-0000-0000-00000000a401' and event_type = 'delivered'),
  2, 'two delivery events logged');

-- ---- as Creative A (team_member: assets:manage but NOT projects:manage) → denied ----
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select throws_ok($$ select deliver_deliverable_version('aaaaaaaa-0000-0000-0000-00000000a503') $$,
  '42501', null, 'team_member without projects:manage cannot deliver');

-- ---- as Booker B (other tenant) → cannot even see the row (cross-tenant fenced) ----
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000b002'), true);
select throws_ok($$ select deliver_deliverable_version('aaaaaaaa-0000-0000-0000-00000000a503') $$,
  'P0002', null, 'cross-tenant deliver denied — record not visible');

select * from finish();
rollback;
