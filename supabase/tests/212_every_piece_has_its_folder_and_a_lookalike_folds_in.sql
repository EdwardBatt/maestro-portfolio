-- ADR-0134 d.21–d.25 (I72) — every piece has its folder; review versions show there; a closed look-alike
-- folds its files into the job that stays.
--
--   PIECE      a deliverable of a campaign gets a locked folder under Deliverables, named by its code and
--              name; it follows a rename and a move to another campaign; a taken name gets a suffix.
--   VERSIONS   library_piece_folders lists every review version with how its review went, nothing
--              copied, and the working files filed for the piece (SOURCE).
--   PROOF      a brief receipt's screenshot is marked a proof.
--   LOOK-ALIKE closing the duplicate moves its live files and made folders to the open job of the same
--              client with the same name ignoring capitals and spaces; never across clients; reopening
--              clears the mark.
begin;
select plan(27);
\ir helpers/seed.sql
select app.seed_tenant_asset_grants(id) from tenants;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000021201', 'lead212@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select '00000000-0000-0000-0000-000000021201', 'aaaaaaaa-0000-0000-0000-000000000001', 'Lead 212',
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = 'department_lead'),
       'aaaaaaaa-0000-0000-0000-0000000de0ff';

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000f2120', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000e001', 'S212');
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d2121', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000f2120',
   'Hero banner', 'in_progress', now() + interval '20 days', '00000000-0000-0000-0000-000000021201',
   'aaaaaaaa-0000-0000-0000-0000000de0ff');

create temp table f212 as
select 'deliverables'::text as k, id from asset_folders
 where campaign_id = 'aaaaaaaa-0000-0000-0000-00000000e001' and kind = 'asset_type' and name = 'Deliverables'
union all
select 'piece', id from asset_folders where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2121';
grant select on f212 to public;

-- ================================================================================ PIECE ====
select is((select count(*)::int from f212 where k = 'piece'), 1, 'piece: a deliverable gets its own folder (d.22)');
select is((select parent_id from asset_folders where id = (select id from f212 where k = 'piece')),
  (select id from f212 where k = 'deliverables'), 'piece: under its project''s Deliverables');
select is((select name from asset_folders where id = (select id from f212 where k = 'piece')),
  (select code || ' · Hero banner' from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d2121'),
  'piece: named by its code and name');
select is((select kind || '|' || is_system from asset_folders where id = (select id from f212 where k = 'piece')),
  'deliverable|true', 'piece: a standard folder');

set local app.system_op = 'on';
update deliverables set name = 'Hero banner — wide' where id = 'aaaaaaaa-0000-0000-0000-0000000d2121';
set local app.system_op = 'off';
select is((select name from asset_folders where id = (select id from f212 where k = 'piece')),
  (select code || ' · Hero banner — wide' from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d2121'),
  'piece: the folder follows a rename');

-- A made folder already holds the name a new piece would take.
insert into asset_folders (tenant_id, client_id, parent_id, name, kind) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001', (select id from f212 where k = 'deliverables'),
   'ZZ-9 · Banner', 'custom');
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id, department_id, code) values
  ('aaaaaaaa-0000-0000-0000-0000000d2122', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000f2120',
   'Banner', 'in_progress', now() + interval '20 days', '00000000-0000-0000-0000-000000021201',
   'aaaaaaaa-0000-0000-0000-0000000de0ff', 'ZZ-9');
select is((select name from asset_folders where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2122'),
  'ZZ-9 · Banner (aaaa)', 'piece: a name already taken there is told apart by the id');

set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select throws_ok($$ update asset_folders set name = 'Mine now' where id = (select id from f212 where k = 'piece') $$,
  '42501', 'standard folder', 'piece: nobody renames a piece''s folder');
select throws_ok($$ delete from asset_folders where id = (select id from f212 where k = 'piece') $$,
  '42501', 'standard folder', 'piece: or deletes it');

-- A working file filed for the piece.
insert into assets (id, tenant_id, folder_id, name, is_source) values
  ('aaaaaaaa-0000-0000-0000-0000000a5221', 'aaaaaaaa-0000-0000-0000-000000000001', (select id from f212 where k = 'piece'),
   'hero.psd', true);
select is((select deliverable_id from assets where id = 'aaaaaaaa-0000-0000-0000-0000000a5221'),
  'aaaaaaaa-0000-0000-0000-0000000d2121'::uuid, 'piece: a file filed in its folder belongs to the piece');

-- ============================================================================= VERSIONS ====
reset role;
insert into media_records (id, tenant_id, deliverable_id, version, object_key, file_name, content_type) values
  ('aaaaaaaa-0000-0000-0000-0000000b2121', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d2121',
   1, 'k/212/v1', 'hero-v1.png', 'image/png');
insert into media_records (id, tenant_id, deliverable_id, version, object_key, file_name, content_type) values
  ('aaaaaaaa-0000-0000-0000-0000000b2122', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d2121',
   2, 'k/212/v2', 'hero-v2.png', 'image/png');
set local role authenticated;
create temp table p212 as select public.library_piece_folders((select id from f212 where k = 'deliverables')) as j;
select is((select (j ->> 'piece_count')::int from p212), 2, 'versions: every piece of the project is listed');
create temp table v212 as
  select e from p212, jsonb_array_elements(j -> 'pieces') e where e ->> 'deliverable_id' = 'aaaaaaaa-0000-0000-0000-0000000d2121';
select is((select jsonb_agg(v ->> 'review_state') from v212, jsonb_array_elements(e -> 'versions') v),
  '["in_review", "superseded"]'::jsonb, 'versions: each review version with how its review went, newest first (d.23)');
select is((select e -> 'versions' -> 0 ->> 'file_name' from v212), 'hero-v2.png', 'versions: by its own file name');
select is((select e -> 'versions' -> 0 ->> 'id' from v212), 'aaaaaaaa-0000-0000-0000-0000000b2122',
  'versions: the review version itself (a media record — nothing copied)');
select is((select jsonb_array_length(e -> 'sources') from v212), 1, 'versions: and the piece''s working files');
select is((select e ->> 'folder_id' from v212), (select id::text from f212 where k = 'piece'), 'versions: with its folder');

reset role;
update media_records set delivered_at = now() where id = 'aaaaaaaa-0000-0000-0000-0000000b2121';
set local role authenticated;
select is((select v ->> 'review_state'
             from jsonb_array_elements(public.library_piece_folders((select id from f212 where k = 'deliverables')) -> 'pieces') e,
                  jsonb_array_elements(e -> 'versions') v
            where v ->> 'id' = 'aaaaaaaa-0000-0000-0000-0000000b2121'), 'delivered',
  'versions: a delivered round says so');

-- ================================================================================ PROOF ====
reset role;
insert into assets (id, tenant_id, folder_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000a5222', 'aaaaaaaa-0000-0000-0000-000000000001',
   (select id from asset_folders where campaign_id = 'aaaaaaaa-0000-0000-0000-00000000e001' and name = 'References'),
   'Brief received.png');
insert into campaign_brief_receipts (tenant_id, campaign_id, asset_id, subject, received_at, received_tz) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000e001', 'aaaaaaaa-0000-0000-0000-0000000a5222',
   'Ramadan', now(), 'Asia/Baghdad');
select is((select is_proof from assets where id = 'aaaaaaaa-0000-0000-0000-0000000a5222'), true,
  'proof: a brief receipt''s screenshot is a proof (d.25)');
select is((select kind_bucket from public.library_search('brief received', null, null)), 'proof',
  'proof: and search files it under proofs');

-- =========================================================================== MOVE PIECE ====
insert into campaigns (id, tenant_id, client_id, name, status) values
  ('aaaaaaaa-0000-0000-0000-0000000e2121', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Eid 2027', 'approved');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000f2121', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000e2121', 'Eid');
set local app.system_op = 'on';
update deliverables set stream_id = 'aaaaaaaa-0000-0000-0000-0000000f2121' where id = 'aaaaaaaa-0000-0000-0000-0000000d2121';
set local app.system_op = 'off';
select is((select p.campaign_id from asset_folders f join asset_folders p on p.id = f.parent_id
            where f.id = (select id from f212 where k = 'piece')),
  'aaaaaaaa-0000-0000-0000-0000000e2121'::uuid, 'piece: a piece moved to another project takes its folder along');
select is((select folder_id from assets where id = 'aaaaaaaa-0000-0000-0000-0000000a5221'),
  (select id from f212 where k = 'piece'), 'piece: with its files');

-- ============================================================================ LOOK-ALIKE ====
-- ADR-0135's index makes a new look-alike impossible; the live ones predate it. Dropped here (rolled
-- back) to stand them up.
select set_config('request.jwt.claims', '', true);
drop index uq_campaigns_tenant_name;
insert into clients (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000c2120', 'aaaaaaaa-0000-0000-0000-000000000001', 'Other 212');
insert into campaigns (id, tenant_id, client_id, name, status, created_at) values
  ('aaaaaaaa-0000-0000-0000-0000000e2122', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'Borderless card', 'approved', now() - interval '2 days'),
  ('aaaaaaaa-0000-0000-0000-0000000e2123', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   ' Borderless  Card', 'approved', now() - interval '1 day'),
  ('aaaaaaaa-0000-0000-0000-0000000e2124', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000c2120',
   'BORDERLESS CARD', 'approved', now());

create temp table d212 as
select 'keep_refs'::text as k, id from asset_folders where campaign_id = 'aaaaaaaa-0000-0000-0000-0000000e2122' and name = 'References'
union all select 'keep_work', id from asset_folders where campaign_id = 'aaaaaaaa-0000-0000-0000-0000000e2122' and name = 'Working Files'
union all select 'dup_refs', id from asset_folders where campaign_id = 'aaaaaaaa-0000-0000-0000-0000000e2123' and name = 'References'
union all select 'dup_work', id from asset_folders where campaign_id = 'aaaaaaaa-0000-0000-0000-0000000e2123' and name = 'Working Files'
union all select 'other_refs', id from asset_folders where campaign_id = 'aaaaaaaa-0000-0000-0000-0000000e2124' and name = 'References';
grant select on d212 to public;

insert into assets (id, tenant_id, folder_id, name, deleted_at) values
  ('aaaaaaaa-0000-0000-0000-0000000a5231', 'aaaaaaaa-0000-0000-0000-000000000001', (select id from d212 where k = 'dup_refs'), 'card.ai', null),
  ('aaaaaaaa-0000-0000-0000-0000000a5232', 'aaaaaaaa-0000-0000-0000-000000000001', (select id from d212 where k = 'dup_refs'), 'old.ai', now()),
  ('aaaaaaaa-0000-0000-0000-0000000a5233', 'aaaaaaaa-0000-0000-0000-000000000001', (select id from d212 where k = 'other_refs'), 'theirs.ai', null);
insert into asset_folders (id, tenant_id, client_id, parent_id, name, kind) values
  ('aaaaaaaa-0000-0000-0000-0000000f5212', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   (select id from d212 where k = 'dup_work'), 'Client links', 'custom');

set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select is((select p -> 'lookalike' ->> 'campaign_id'
             from jsonb_array_elements(public.library_client_overview('aaaaaaaa-0000-0000-0000-00000000c001') -> 'projects') p
            where p ->> 'campaign_id' = 'aaaaaaaa-0000-0000-0000-0000000e2123'),
  'aaaaaaaa-0000-0000-0000-0000000e2122', 'look-alike: the pair is flagged, linking the other job (d.21)');
reset role;

update campaigns set status = 'closed', closed_at = now() where id = 'aaaaaaaa-0000-0000-0000-0000000e2123';
select is((select folder_id from assets where id = 'aaaaaaaa-0000-0000-0000-0000000a5231'), (select id from d212 where k = 'keep_refs'),
  'look-alike: closing the duplicate moves its files into the matching folder of the job that stays');
select is((select folder_id from assets where id = 'aaaaaaaa-0000-0000-0000-0000000a5232'), (select id from d212 where k = 'dup_refs'),
  'look-alike: a Recently-deleted file stays where it was');
select is((select parent_id::text || '|' || campaign_id::text from asset_folders where id = 'aaaaaaaa-0000-0000-0000-0000000f5212'),
  (select id::text from d212 where k = 'keep_work') || '|aaaaaaaa-0000-0000-0000-0000000e2122',
  'look-alike: a made folder moves with its contents');
select is((select merged_into_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-0000000e2123'),
  'aaaaaaaa-0000-0000-0000-0000000e2122'::uuid, 'look-alike: the duplicate records where its files went');

update campaigns set status = 'closed', closed_at = now() where id = 'aaaaaaaa-0000-0000-0000-0000000e2124';
select is((select folder_id from assets where id = 'aaaaaaaa-0000-0000-0000-0000000a5233'), (select id from d212 where k = 'other_refs'),
  'look-alike: never across clients — another client''s look-alike keeps its files');

update campaigns set status = 'approved', closed_at = null where id = 'aaaaaaaa-0000-0000-0000-0000000e2123';
select is((select merged_into_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-0000000e2123'), null::uuid,
  'look-alike: reopening clears the mark');

select * from finish();
rollback;
