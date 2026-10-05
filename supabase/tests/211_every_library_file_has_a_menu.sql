-- ADR-0134 d.4–d.18, d.22–d.27 (I72) — the file menu, the reads behind the screens, and the daily sweep.
--
--   VERSIONS  a new version keeps the name; going back copies the old one to the top with a note; the
--             history never goes backwards; a key from another client is refused.
--   LINKS     an address must be http(s); a new link is the next version.
--   NAMES     rename keeps the file's own extension; a same-folder clash is 23505; find-by-name ignores case.
--   COPY      within the client only; the copy starts at v1.
--   READS     clients, a client's overview, a folder, search with its counts, usage, Recently deleted.
--   SWEEP     the link-expiry notice goes once, two days before, to the adder; the purge returns only
--             keys no other row names, and only after 30 days; both are service-role only.
begin;
select plan(57);
\ir helpers/seed.sql
select app.seed_tenant_asset_grants(id) from tenants;

insert into clients (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000c2110', 'aaaaaaaa-0000-0000-0000-000000000001', 'Other 211');
insert into campaigns (id, tenant_id, client_id, name, status) values
  ('aaaaaaaa-0000-0000-0000-0000000e2110', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000c2110', 'Other project 211', 'approved');

create temp table f211 as
select 'refs'::text as k, id from asset_folders
 where campaign_id = 'aaaaaaaa-0000-0000-0000-00000000e001' and kind = 'asset_type' and name = 'References'
union all
select 'work', id from asset_folders
 where campaign_id = 'aaaaaaaa-0000-0000-0000-00000000e001' and kind = 'asset_type' and name = 'Working Files'
union all
select 'other_refs', id from asset_folders
 where campaign_id = 'aaaaaaaa-0000-0000-0000-0000000e2110' and kind = 'asset_type' and name = 'References';
grant select on f211 to public;
create temp table k211 as select 'aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-0000-0000-0000-00000000c001/'::text as prefix;
grant select on k211 to public;

set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

-- ============================================================================= VERSIONS ====
insert into assets (id, tenant_id, folder_id, name, object_key, content_type, size_bytes) values
  ('aaaaaaaa-0000-0000-0000-0000000a5211', 'aaaaaaaa-0000-0000-0000-000000000001', (select id from f211 where k = 'refs'),
   'Teaser.mp4', (select prefix || 'f/v1-teaser.mp4' from k211), 'video/mp4', 100);
insert into asset_versions (tenant_id, asset_id, version, object_key, content_type, size_bytes) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000a5211', 1,
   (select prefix || 'f/v1-teaser.mp4' from k211), 'video/mp4', 100);

select is(public.library_add_version('aaaaaaaa-0000-0000-0000-0000000a5211', (select prefix || 'f/v2-teaser_final.mp4' from k211),
          'video/mp4', 200, (select prefix || 'f/v2-teaser_final.mp4.thumb.webp' from k211), 6.5),
  2, 'versions: a new version is v2');
select is((select name from assets where id = 'aaaaaaaa-0000-0000-0000-0000000a5211'), 'Teaser.mp4',
  'versions: and the file keeps its name (d.7)');
select is((select duration_seconds from assets where id = 'aaaaaaaa-0000-0000-0000-0000000a5211'), 6.5::numeric,
  'versions: the current version''s duration is the file''s');
select throws_ok($$ select public.library_add_version('aaaaaaaa-0000-0000-0000-0000000a5211',
    'aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-0000-0000-0000-0000000c2110/x/v3.mp4', 'video/mp4', 1) $$,
  '42501', 'another client', 'versions: an object stored under another client is refused');
select is(public.library_make_current('aaaaaaaa-0000-0000-0000-0000000a5211', 1), 3,
  'versions: making v1 current makes v3 (d.7 — copied to the top)');
select is((select object_key from assets where id = 'aaaaaaaa-0000-0000-0000-0000000a5211'),
  (select prefix || 'f/v1-teaser.mp4' from k211), 'versions: v3 is v1''s file');
select results_eq(
  $$ select version, note from public.library_versions('aaaaaaaa-0000-0000-0000-0000000a5211') $$,
  $$ values (3, 'made current from v1'::text), (2, null::text), (1, null::text) $$,
  'versions: the history is newest first, nothing lost, the copy says where it came from');
select is((select uploaded_by_name from public.library_versions('aaaaaaaa-0000-0000-0000-0000000a5211') where version = 3),
  'Admin A', 'versions: each version says who added it');

-- ================================================================================= NAMES ====
select is(public.library_rename('aaaaaaaa-0000-0000-0000-0000000a5211', 'Ramadan teaser'), 'Ramadan teaser.mp4',
  'rename: the extension is the file''s own (d.8)');
select is(public.library_rename('aaaaaaaa-0000-0000-0000-0000000a5211', 'Ramadan teaser.MP4'), 'Ramadan teaser.mp4',
  'rename: a typed extension is not doubled');
insert into assets (id, tenant_id, folder_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000a5212', 'aaaaaaaa-0000-0000-0000-000000000001', (select id from f211 where k = 'refs'), 'Brief.pdf'),
  ('aaaaaaaa-0000-0000-0000-0000000a5213', 'aaaaaaaa-0000-0000-0000-000000000001', (select id from f211 where k = 'refs'), 'Draft.mp4');
select is(public.library_rename('aaaaaaaa-0000-0000-0000-0000000a5212', 'Ramadan teaser.mp4'), 'Ramadan teaser.mp4.pdf',
  'rename: the extension cannot be changed by typing another');
select lives_ok($$ select public.library_rename('aaaaaaaa-0000-0000-0000-0000000a5212', 'Brief') $$, 'rename: and back');
select throws_ok($$ select public.library_rename('aaaaaaaa-0000-0000-0000-0000000a5213', 'ramadan TEASER') $$,
  '23505', null, 'rename: a name already in the folder is refused');
select is((select id from public.library_find_by_name((select id from f211 where k = 'refs'), 'RAMADAN teaser.mp4')),
  'aaaaaaaa-0000-0000-0000-0000000a5211'::uuid, 'upload clash: find-by-name finds the file whatever the capitals (d.12)');
select is((select current_version from public.library_find_by_name((select id from f211 where k = 'refs'), 'Ramadan teaser.mp4')),
  3, 'upload clash: with its current version');
select is((select count(*)::int from public.library_find_by_name((select id from f211 where k = 'refs'), 'nothing.mp4')), 0,
  'upload clash: no row when the name is free');

-- ================================================================================= LINKS ====
select throws_ok($$ select public.library_add_link((select id from f211 where k = 'refs'), 'Masters', 'ftp://x.test/a', null) $$,
  '22023', null, 'links: an address must be http(s)');
select throws_ok($$ select public.library_add_link((select id from f211 where k = 'refs'), 'Masters', 'javascript:alert(1)', null) $$,
  '22023', null, 'links: never a script address');
select lives_ok($$ select public.library_add_link((select id from f211 where k = 'refs'), 'Masters on Drive',
                    'https://drive.google.com/drive/folders/abc', current_date + 1) $$,
  'links: a link is added as a row in its folder (d.16)');
create temp table l211 as select id from assets where name = 'Masters on Drive';
select is((select provider || '|' || coalesce(object_key, 'no object') from assets where id = (select id from l211)),
  'external|no object', 'links: a link has no stored object');
select is(public.library_add_link_version((select id from l211), 'https://www.dropbox.com/s/xyz', current_date + 30), 2,
  'links: a new link is the next version (d.17)');
select is((select link_url from public.library_versions((select id from l211)) where version = 1),
  'https://drive.google.com/drive/folders/abc', 'links: the old address stays in the history');
select throws_ok($$ select public.library_add_link_version('aaaaaaaa-0000-0000-0000-0000000a5211', 'https://x.test', null) $$,
  '22023', null, 'links: a file does not take a link version');

-- ================================================================================== COPY ====
select lives_ok($$ select public.library_copy_record('aaaaaaaa-0000-0000-0000-0000000a5211', (select id from f211 where k = 'work'),
                    (select prefix || 'g/copy-teaser.mp4' from k211), null) $$,
  'copy: within the client');
select is((select current_version from assets where folder_id = (select id from f211 where k = 'work') and name = 'Ramadan teaser.mp4'),
  1, 'copy: the copy starts at v1 (d.10)');
select is((select count(*)::int from asset_versions v join assets a on a.id = v.asset_id
            where a.folder_id = (select id from f211 where k = 'work') and a.name = 'Ramadan teaser.mp4'), 1,
  'copy: with one version');
select is((select current_version from assets where id = 'aaaaaaaa-0000-0000-0000-0000000a5211'), 3,
  'copy: the original keeps its history');
select throws_ok($$ select public.library_copy_record('aaaaaaaa-0000-0000-0000-0000000a5211', (select id from f211 where k = 'other_refs'),
                    'aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-0000-0000-0000-0000000c2110/g/x.mp4', null) $$,
  '42501', 'another client', 'copy: never to another client');

-- ================================================================================= READS ====
select is((select file_count from public.library_clients() where id = 'aaaaaaaa-0000-0000-0000-00000000c001'), 5::bigint,
  'clients: each client with its live file count');
select is((select can_change from public.library_clients() where id = 'aaaaaaaa-0000-0000-0000-00000000c001'), true,
  'clients: and whether the caller may change it');
select ok((public.library_client_overview('aaaaaaaa-0000-0000-0000-00000000c001') -> 'projects') @>
          '[{"name": "Ramadan 2027", "kind": "campaign", "file_count": 5}]'::jsonb,
  'overview: the project with its file count');
select ok((public.library_client_overview('aaaaaaaa-0000-0000-0000-00000000c001') ->> 'projects_root_id') is not null,
  'overview: and the roots to open');
select is(public.library_client_overview('bbbbbbbb-0000-0000-0000-00000000c001'), null,
  'overview: another tenant''s client is null');

create temp table j211 as select public.library_folder((select id from f211 where k = 'refs')) as j;
select is(jsonb_array_length((select j -> 'files' from j211)), 4, 'folder: its live files');
select is((select jsonb_agg(e -> 'name') from j211, jsonb_array_elements(j -> 'chain') e),
  '["Kite Card", "Projects", "Ramadan 2027", "References"]'::jsonb, 'folder: the chain from the client down');
select is((select j -> 'campaign' ->> 'name' from j211), 'Ramadan 2027', 'folder: and the project it is in');
select is((select (j ->> 'can_delete_folder')::boolean from j211), false, 'folder: a standard folder offers no delete');
select ok((select j -> 'files' from j211) @> '[{"name": "Brief.pdf", "uploaded_by_name": "Admin A", "can_delete": true}]'::jsonb,
  'folder: each file says who added it and whether the caller may delete it');

select is((select path from public.library_search('teaser', null, null) where id = 'aaaaaaaa-0000-0000-0000-0000000a5211'),
  'Kite Card / Projects / Ramadan 2027 / References', 'search: each result carries its full path (d.27)');
select is((select count(*)::int from public.library_search('teaser', 'video', null)), 2,
  'search: filtered by kind');
select is((select count(*)::int from public.library_search('dropbox', 'link', null)), 1,
  'search: a link is found by its address (N3)');
select is((select n from public.library_search_counts('teaser', null) where kind_bucket = 'video'), 2::bigint,
  'search: with a count per kind');
select is((select count(*)::int from public.library_search('teaser', null, 'aaaaaaaa-0000-0000-0000-0000000c2110')), 0,
  'search: filtered by client');

-- usage: a piece that references the file
reset role;
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000f2110', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000e001', 'S211');
-- (the piece's own rules — owner, department, due date — are not what this file tests)
set local session_replication_role = replica;
insert into deliverables (id, tenant_id, stream_id, name, reviewer_id, due_at) values
  ('aaaaaaaa-0000-0000-0000-0000000d2111', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000f2110',
   'Teaser cut', '00000000-0000-0000-0000-00000000a001', now() + interval '20 days');
set local session_replication_role = origin;
insert into asset_references (tenant_id, asset_id, ref_type, ref_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000a5211', 'deliverable', 'aaaaaaaa-0000-0000-0000-0000000d2111');
set local role authenticated;
select results_eq($$ select campaign_name, piece_name from public.library_usage('aaaaaaaa-0000-0000-0000-0000000a5211') $$,
  $$ values ('Ramadan 2027'::text, 'Teaser cut'::text) $$, 'usage: the pieces that use a file are named (d.9)');

-- Recently deleted
select lives_ok($$ select public.library_delete('aaaaaaaa-0000-0000-0000-0000000a5212') $$, 'delete: Brief.pdf');
select is((select purge_on from public.library_recently_deleted('aaaaaaaa-0000-0000-0000-00000000c001')
            where id = 'aaaaaaaa-0000-0000-0000-0000000a5212'), (now() + interval '30 days')::date,
  'recently deleted: with the day it goes for good');
select is((select count(*)::int from public.library_search('brief', null, null)), 0, 'search: a deleted file is not found');
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select is((select count(*)::int from public.library_recently_deleted('aaaaaaaa-0000-0000-0000-00000000c001')), 0,
  'recently deleted: lists only what the viewer could bring back (d.23)');

-- ================================================================================= SWEEP ====
select throws_ok($$ select * from public.library_sweep_link_notices(false) $$, '42501', null,
  'sweep: a person cannot run the link notices');
select throws_ok($$ select * from public.library_sweep_purge_due(10) $$, '42501', null,
  'sweep: nor read the purge list');

reset role;
select set_config('request.jwt.claims', '', true);
update assets set link_expires_on = current_date + 2, link_expiry_notified_at = null where id = (select id from l211);
select is((select count(*)::int from public.library_sweep_link_notices(true)), 1, 'sweep: the dry run lists the link due');
select is((select count(*)::int from notifications where type = 'link_expiring'), 0, 'sweep: and sends nothing');
select is((select count(*)::int from public.library_sweep_link_notices(false)), 1, 'sweep: the run sends it');
select is((select user_id from notifications where type = 'link_expiring'), '00000000-0000-0000-0000-00000000a001'::uuid,
  'sweep: to the person who added the link (d.18)');
select is((select count(*)::int from public.library_sweep_link_notices(false)), 0, 'sweep: once');

-- purge: Brief.pdf deleted 31 days ago; its second key is shared with a review round, which keeps it.
insert into asset_versions (tenant_id, asset_id, version, object_key) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000a5212', 1, 'k/211/brief-v1'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000a5212', 2, 'k/211/shared');
insert into media_records (tenant_id, deliverable_id, version, object_key) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d2111', 1, 'k/211/shared');
update assets set deleted_at = now() - interval '29 days' where id = 'aaaaaaaa-0000-0000-0000-0000000a5212';
select is((select count(*)::int from public.library_sweep_purge_due(10)), 0, 'purge: nothing before 30 days');
update assets set deleted_at = now() - interval '31 days' where id = 'aaaaaaaa-0000-0000-0000-0000000a5212';
select is((select object_keys from public.library_sweep_purge_due(10) where asset_id = 'aaaaaaaa-0000-0000-0000-0000000a5212'),
  array['k/211/brief-v1'], 'purge: after 30 days, only the keys no other row names');

select * from finish();
rollback;
