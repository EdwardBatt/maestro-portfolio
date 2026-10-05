-- I74.28 (ADR-0134 d.2, d.22) — a deliverable's owner adds links and files to THAT deliverable's own
-- Library folder, and nowhere else in the client; nobody else's reach changes.
--
--   OWNER     a team lead with no task of the client (no d.2 reach) owns Poster 224: she adds a link,
--             uploads (asset + v1 row), adds a new version of a file and of a link in its folder.
--   FENCE     the same owner is refused in the project's Working Files and References, the Deliverables
--             folder above, another deliverable's folder, a subfolder made inside her own — by the RPC
--             and by a direct insert; she does not rename or move a file in her folder (reach rule).
--   OTHERS    a team member with no task of the client is refused in the owner's folder; a team member
--             with a task of it keeps d.2's self reach (unchanged); the other deliverable's owner adds
--             only to hers; a Power Admin anywhere; another tenant nowhere.
begin;
select plan(34);
\ir helpers/seed.sql
select app.seed_tenant_asset_grants(id) from tenants;

-- ------------------------------------------------------------------------------ fixtures ----
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000022401', 'owner224@a.test'),
  ('00000000-0000-0000-0000-000000022402', 'otherowner224@a.test'),
  ('00000000-0000-0000-0000-000000022403', 'idle224@a.test'),
  ('00000000-0000-0000-0000-000000022404', 'maker224@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       'aaaaaaaa-0000-0000-0000-0000000de0ff'
from (values
  ('00000000-0000-0000-0000-000000022401', 'Owner 224',       'team_lead'),
  ('00000000-0000-0000-0000-000000022402', 'Other owner 224', 'team_lead'),
  ('00000000-0000-0000-0000-000000022403', 'Idle member 224', 'team_member'),
  ('00000000-0000-0000-0000-000000022404', 'Maker 224',       'team_member')
) as v(id, name, role_key);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id::text like '00000000-0000-0000-0000-00000002240%';

-- A client of its own, with one project and two deliverables.
insert into clients (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000c2240', 'aaaaaaaa-0000-0000-0000-000000000001', 'Auracell 224');
insert into campaigns (id, tenant_id, client_id, name, status) values
  ('aaaaaaaa-0000-0000-0000-0000000e2240', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000c2240', 'Eid 224', 'approved');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000f2240', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000e2240', 'S224');
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d2241', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000f2240',
   'Poster 224', 'in_progress', now() + interval '20 days', '00000000-0000-0000-0000-000000022401',
   'aaaaaaaa-0000-0000-0000-0000000de0ff'),
  ('aaaaaaaa-0000-0000-0000-0000000d2242', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000f2240',
   'Banner 224', 'in_progress', now() + interval '20 days', '00000000-0000-0000-0000-000000022402',
   'aaaaaaaa-0000-0000-0000-0000000de0ff');

-- Maker 224 holds a task of Poster 224 (d.2 self reach). Nobody else holds one.
set local app.system_op = 'on';
set local session_replication_role = replica;
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order, assignee_id, sla_hours, starts_at, due_at, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000a2241', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d2241',
   'Design 224', 'todo', 1, '00000000-0000-0000-0000-000000022404', 4, now() + interval '2 days', now() + interval '3 days',
   'aaaaaaaa-0000-0000-0000-0000000de0ff');
set local session_replication_role = origin;
set local app.system_op = 'off';

create temp table f224 as
select 'mine'::text as k, id from asset_folders where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2241' and kind = 'deliverable'
union all
select 'theirs', id from asset_folders where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2242' and kind = 'deliverable'
union all
select 'deliverables', parent_id from asset_folders where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2241' and kind = 'deliverable'
union all
select 'work', id from asset_folders
 where campaign_id = 'aaaaaaaa-0000-0000-0000-0000000e2240' and kind = 'asset_type' and name = 'Working Files'
union all
select 'refs', id from asset_folders
 where campaign_id = 'aaaaaaaa-0000-0000-0000-0000000e2240' and kind = 'asset_type' and name = 'References';
grant select on f224 to public;

-- A subfolder someone made inside the owner's folder, and a file in References — by the Power Admin.
insert into asset_folders (id, tenant_id, client_id, parent_id, name, kind, created_by) values
  ('aaaaaaaa-0000-0000-0000-0000000f5224', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000c2240',
   (select id from f224 where k = 'mine'), 'Drafts', 'custom', '00000000-0000-0000-0000-00000000a001');
insert into assets (id, tenant_id, folder_id, name, object_key, uploaded_by) values
  ('aaaaaaaa-0000-0000-0000-0000000a5241', 'aaaaaaaa-0000-0000-0000-000000000001', (select id from f224 where k = 'refs'),
   'brief.pdf', 'aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-0000-0000-0000-0000000c2240/r/brief', '00000000-0000-0000-0000-00000000a001');

select is((select count(*)::int from f224 where id is not null), 5, 'fixture: every folder the test needs exists');

set local role authenticated;

-- ================================================================================= OWNER ====
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-000000022401'), true);
select is(public.library_can_change('aaaaaaaa-0000-0000-0000-0000000c2240'), false,
  'reach unchanged: owning a deliverable does not put its client within reach (d.2)');
select is(public.library_can_add((select id from f224 where k = 'mine')), true,
  'owner: may add to her deliverable''s own folder');
select lives_ok($$ select public.library_add_link((select id from f224 where k = 'mine'), 'Master cut', 'https://drive.google.com/x224') $$,
  'owner: adds a link to her deliverable''s folder at the first press');
select is((select deliverable_id from assets where name = 'Master cut'), 'aaaaaaaa-0000-0000-0000-0000000d2241'::uuid,
  'owner: the link sits in her deliverable''s folder, filed for it');
select lives_ok($$ insert into assets (id, tenant_id, folder_id, name, provider, object_key, content_type, size_bytes, current_version, uploaded_by) values
  ('aaaaaaaa-0000-0000-0000-0000000a5242', 'aaaaaaaa-0000-0000-0000-000000000001', (select id from f224 where k = 'mine'), 'poster.png', 'b2',
   'aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-0000-0000-0000-0000000c2240/m/poster', 'image/png', 10, 1,
   '00000000-0000-0000-0000-000000022401') $$,
  'owner: uploads a file into her deliverable''s folder (the uploader''s asset row)');
select lives_ok($$ insert into asset_versions (tenant_id, asset_id, version, object_key, content_type, size_bytes, uploaded_by) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000a5242', 1,
   'aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-0000-0000-0000-0000000c2240/m/poster', 'image/png', 10,
   '00000000-0000-0000-0000-000000022401') $$,
  'owner: and its first version row');
select is(public.library_add_version('aaaaaaaa-0000-0000-0000-0000000a5242',
  'aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-0000-0000-0000-0000000c2240/m/poster-2', 'image/png', 12), 2,
  'owner: adds a new version of a file already there');
select is((select current_version from assets where id = 'aaaaaaaa-0000-0000-0000-0000000a5242'), 2,
  'owner: and the file now reads v2');
select is(public.library_add_link_version((select id from assets where name = 'Master cut'), 'https://drive.google.com/x224-v2'), 2,
  'owner: adds a new version of a link');

-- ================================================================================= FENCE ====
select is(public.library_can_add((select id from f224 where k = 'work')), false, 'fence: not the project''s Working Files');
select throws_ok($$ select public.library_add_link((select id from f224 where k = 'work'), 'x', 'https://x.test/1') $$,
  '42501', 'you cannot change this client''s files', 'fence: a link into Working Files is refused');
select throws_ok($$ select public.library_add_link((select id from f224 where k = 'refs'), 'x', 'https://x.test/2') $$,
  '42501', null, 'fence: a link into References is refused');
select throws_ok($$ select public.library_add_link((select id from f224 where k = 'deliverables'), 'x', 'https://x.test/3') $$,
  '42501', null, 'fence: a link into the Deliverables folder above hers is refused');
select throws_ok($$ select public.library_add_link((select id from f224 where k = 'theirs'), 'x', 'https://x.test/4') $$,
  '42501', null, 'fence: a link into another deliverable''s folder is refused');
select throws_ok($$ select public.library_add_link('aaaaaaaa-0000-0000-0000-0000000f5224', 'x', 'https://x.test/5') $$,
  '42501', null, 'fence: a link into a subfolder made inside hers is refused');
select throws_ok($$ insert into assets (tenant_id, folder_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', (select id from f224 where k = 'work'), 'w.png') $$,
  '42501', null, 'fence: an upload into Working Files is refused');
select throws_ok($$ insert into assets (tenant_id, folder_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', (select id from f224 where k = 'theirs'), 't.png') $$,
  '42501', null, 'fence: an upload into another deliverable''s folder is refused');
select throws_ok($$ insert into asset_versions (tenant_id, asset_id, version, object_key) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000a5241', 9,
   'aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-0000-0000-0000-0000000c2240/r/brief-9') $$,
  '42501', null, 'fence: a version row for a file in References is refused');
select throws_ok($$ select public.library_add_version('aaaaaaaa-0000-0000-0000-0000000a5241',
  'aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-0000-0000-0000-0000000c2240/r/brief-2', 'application/pdf', 5) $$,
  '42501', 'you cannot change this client''s files', 'fence: a new version of a file in References is refused');
select throws_ok($$ select public.library_rename('aaaaaaaa-0000-0000-0000-0000000a5242', 'renamed') $$,
  '42501', null, 'fence: she does not rename a file in her folder (the reach rule''s)');
select throws_ok($$ update assets set name = 'renamed.png' where id = 'aaaaaaaa-0000-0000-0000-0000000a5242' $$,
  '42501', 'you cannot change this client''s files', 'fence: nor by a direct update');
select throws_ok($$ update assets set folder_id = (select id from f224 where k = 'theirs') where id = 'aaaaaaaa-0000-0000-0000-0000000a5242' $$,
  '42501', null, 'fence: nor move it into another deliverable''s folder');
select is((select count(*)::int from assets a join f224 on f224.id = a.folder_id where f224.k <> 'mine' and a.name <> 'brief.pdf'), 0,
  'fence: nothing of hers landed outside her folder');

-- ================================================================================ OTHERS ====
-- A team member with no task of the client.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-000000022403'), true);
select is(public.library_can_add((select id from f224 where k = 'mine')), false,
  'others: a team member with no task of it may not add to the owner''s folder');
select throws_ok($$ select public.library_add_link((select id from f224 where k = 'mine'), 'Mine too', 'https://x.test/6') $$,
  '42501', 'you cannot change this client''s files', 'others: her link is refused in words');
select throws_ok($$ insert into assets (tenant_id, folder_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', (select id from f224 where k = 'mine'), 'm.png') $$,
  '42501', null, 'others: and her upload row');
select throws_ok($$ select public.library_add_version('aaaaaaaa-0000-0000-0000-0000000a5242',
  'aaaaaaaa-0000-0000-0000-000000000001/aaaaaaaa-0000-0000-0000-0000000c2240/m/poster-3', 'image/png', 12) $$,
  '42501', null, 'others: and her new version');

-- A team member with a task of the deliverable: d.2's self reach, unchanged by this migration.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-000000022404'), true);
select is(public.library_can_change('aaaaaaaa-0000-0000-0000-0000000c2240'), true,
  'unchanged: a team member with a task of the client keeps d.2''s self reach');

-- The other deliverable's owner: hers, not Poster 224's.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-000000022402'), true);
select is(public.library_can_add((select id from f224 where k = 'theirs')), true, 'others: Banner 224''s owner adds to hers');
select is(public.library_can_add((select id from f224 where k = 'mine')), false, 'others: and not to Poster 224''s');

-- A Power Admin: every folder, as before.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select is(public.library_can_add((select id from f224 where k = 'work')), true, 'unchanged: a Power Admin adds anywhere in the client');

-- Another tenant: nowhere.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000b001'), true);
select is(public.library_can_add((select id from f224 where k = 'mine')), false, 'tenant: another tenant cannot add to the folder');
select throws_ok($$ select public.library_add_link((select id from f224 where k = 'mine'), 'x', 'https://x.test/7') $$,
  'P0002', null, 'tenant: and the folder is "not found" to them');

select * from finish();
rollback;
