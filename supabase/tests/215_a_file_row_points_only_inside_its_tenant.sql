-- ADR-0134 d.2 (I72) — a file row may only name a stored object inside its own tenant.
--   An upload's row naming another tenant's object is refused, on assets and on asset_versions,
--   on insert and on a later update; the thumbnail key is held to the same rule; a key inside the
--   tenant — under another client, or a review round's `<tenant>/<deliverable>/…` — is allowed.
begin;
select plan(7);
\ir helpers/seed.sql
select app.seed_tenant_asset_grants(id) from tenants;

create temp table f215 as
select id from asset_folders
 where campaign_id = 'aaaaaaaa-0000-0000-0000-00000000e001' and kind = 'asset_type' and name = 'References';
grant select on f215 to public;

set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

select throws_ok($$ insert into assets (tenant_id, folder_id, name, object_key)
    values ('aaaaaaaa-0000-0000-0000-000000000001', (select id from f215), 'Stolen.pdf',
            'bbbbbbbb-0000-0000-0000-000000000001/x/secret.pdf') $$,
  '42501', 'a stored file must be inside its own tenant', 'an upload naming another tenant''s object is refused');

select throws_ok($$ insert into assets (tenant_id, folder_id, name, object_key, thumb_object_key)
    values ('aaaaaaaa-0000-0000-0000-000000000001', (select id from f215), 'Pic.png',
            'aaaaaaaa-0000-0000-0000-000000000001/c/pic.png', 'bbbbbbbb-0000-0000-0000-000000000001/x/pic.webp') $$,
  '42501', 'a stored file must be inside its own tenant', 'its picture is held to the same rule');

select lives_ok($$ insert into assets (id, tenant_id, folder_id, name, object_key)
    values ('aaaaaaaa-0000-0000-0000-0000000a5215', 'aaaaaaaa-0000-0000-0000-000000000001', (select id from f215), 'Own.pdf',
            'aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-0000-0000-0000-00000000c001/own.pdf') $$,
  'a key inside the tenant is allowed');

select lives_ok($$ insert into asset_versions (tenant_id, asset_id, version, object_key)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000a5215', 1,
            'aaaaaaaa-0000-0000-0000-000000000001/some-deliverable/round.png') $$,
  'a review round''s key (tenant / deliverable) is inside the tenant, so it is allowed');

select throws_ok($$ insert into asset_versions (tenant_id, asset_id, version, object_key)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000a5215', 2,
            'bbbbbbbb-0000-0000-0000-000000000001/x/v2.pdf') $$,
  '42501', 'a stored file must be inside its own tenant', 'a version naming another tenant''s object is refused');

select throws_ok($$ update assets set object_key = 'bbbbbbbb-0000-0000-0000-000000000001/x/secret.pdf'
    where id = 'aaaaaaaa-0000-0000-0000-0000000a5215' $$,
  '42501', 'a stored file must be inside its own tenant', 'pointing an existing row at another tenant''s object is refused');

reset role;
select lives_ok($$ update assets set object_key = 'bbbbbbbb-0000-0000-0000-000000000001/x/moved.pdf'
    where id = 'aaaaaaaa-0000-0000-0000-0000000a5215' $$,
  'service-role work (the sweeps, the archive) is not held to it');

select * from finish();
rollback;
