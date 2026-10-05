-- ADR-0134 d.1–d.3, d.19–d.20, d.27 (I72) — the Library's row rules, adversarially.
--
--   READ     everyone with assets:view reads every client; a per-user DENY of assets:view reads nothing;
--            another tenant reads nothing.
--   CHANGE   assets:manage within reach — a self-scoped maker changes the client of their task and not
--            another; a department lead the client of their department's piece; an account manager their
--            own client's; nobody else.
--   DELETE   personal: the uploader, the client's account manager, a Power Admin — never anyone else, not
--            by the RPC and not by writing deleted_at directly. No user DELETE at all. A deleted file is
--            hidden from everyone who could not bring it back.
--   FOLDERS  standard folders are locked; a made folder is deleted only empty, by its maker / the AM / a
--            Power Admin; Recently-deleted files inside it move to the parent; nothing crosses clients;
--            nothing moves into its own subtree.
begin;
select plan(47);
\ir helpers/seed.sql
select app.seed_tenant_asset_grants(id) from tenants;

-- ------------------------------------------------------------------------------ fixtures ----
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000d2100', 'aaaaaaaa-0000-0000-0000-000000000001', 'Other dept 210');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000021010', 'am210@a.test'),
  ('00000000-0000-0000-0000-000000021011', 'idle210@a.test'),
  ('00000000-0000-0000-0000-000000021012', 'lead210@a.test'),
  ('00000000-0000-0000-0000-000000021013', 'otherlead210@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid
from (values
  ('00000000-0000-0000-0000-000000021010', 'AM 210',         'account_manager', null),
  ('00000000-0000-0000-0000-000000021011', 'Idle maker 210', 'team_member',     'aaaaaaaa-0000-0000-0000-0000000de0ff'),
  ('00000000-0000-0000-0000-000000021012', 'Lead 210',       'department_lead', 'aaaaaaaa-0000-0000-0000-0000000de0ff'),
  ('00000000-0000-0000-0000-000000021013', 'Other lead 210', 'department_lead', 'aaaaaaaa-0000-0000-0000-0000000d2100')
) as v(id, name, role_key, dept);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id::text like '00000000-0000-0000-0000-00000002101%';

-- C2: the account manager's client, with one project.
insert into clients (id, tenant_id, name, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-0000000c2100', 'aaaaaaaa-0000-0000-0000-000000000001', 'Zeta 210',
   '00000000-0000-0000-0000-000000021010');
insert into campaigns (id, tenant_id, client_id, name, status) values
  ('aaaaaaaa-0000-0000-0000-0000000e2100', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000c2100', 'Zeta launch 210', 'approved');

-- C1 (Kite Card, the seed's): a piece of the fixture department, with a task assigned to Creative A (self).
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000f2100', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001', 'S210');
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d2101', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000f2100',
   'Poster 210', 'in_progress', now() + interval '20 days', '00000000-0000-0000-0000-000000021012',
   'aaaaaaaa-0000-0000-0000-0000000de0ff');
set local app.system_op = 'on';
set local session_replication_role = replica;
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order, assignee_id, sla_hours, starts_at, due_at, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000a2101', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d2101',
   'Design 210', 'todo', 1, '00000000-0000-0000-0000-00000000a003', 4, now() + interval '2 days', now() + interval '3 days',
   'aaaaaaaa-0000-0000-0000-0000000de0ff');
set local session_replication_role = origin;
set local app.system_op = 'off';

create temp table f210 as
select 'c1_refs'::text as k, id from asset_folders
 where campaign_id = 'aaaaaaaa-0000-0000-0000-00000000e001' and kind = 'asset_type' and name = 'References'
union all
select 'c1_work', id from asset_folders
 where campaign_id = 'aaaaaaaa-0000-0000-0000-00000000e001' and kind = 'asset_type' and name = 'Working Files'
union all
select 'c2_refs', id from asset_folders
 where campaign_id = 'aaaaaaaa-0000-0000-0000-0000000e2100' and kind = 'asset_type' and name = 'References';
grant select on f210 to public;

-- A file in each client, uploaded by the Power Admin.
insert into assets (id, tenant_id, folder_id, name, object_key, uploaded_by) values
  ('aaaaaaaa-0000-0000-0000-0000000a5201', 'aaaaaaaa-0000-0000-0000-000000000001', (select id from f210 where k = 'c2_refs'),
   'zeta-brief.pdf', 'aaaaaaaa-0000-0000-0000-000000000001/k/210/zeta', '00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-0000000a5202', 'aaaaaaaa-0000-0000-0000-000000000001', (select id from f210 where k = 'c1_refs'),
   'kite-brief.pdf', 'aaaaaaaa-0000-0000-0000-000000000001/k/210/kite', '00000000-0000-0000-0000-00000000a001');

set local role authenticated;

-- =================================================================================== READ ====
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-000000021011'), true);
select is((select count(*)::int from assets where id in ('aaaaaaaa-0000-0000-0000-0000000a5201', 'aaaaaaaa-0000-0000-0000-0000000a5202')),
  2, 'read: a maker with no work reads both clients'' files (d.1)');
select ok((select count(*) from asset_folders where client_id = 'aaaaaaaa-0000-0000-0000-0000000c2100') > 0,
  'read: and every client''s folders');

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000b001'), true);
select is((select count(*)::int from assets), 0, 'read: another tenant''s Power Admin reads no file');
select is((select count(*)::int from asset_folders where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0,
  'read: and no folder');
select is(public.library_can_change('aaaaaaaa-0000-0000-0000-00000000c001'), false,
  'change: another tenant''s Power Admin cannot change this tenant''s client');
select throws_ok($$ select public.library_folder((select id from f210 where k = 'c1_refs')) $$, 'P0002', 'folder not found',
  'read: library_folder of another tenant''s folder is "not found"');
select throws_ok($$ insert into assets (tenant_id, folder_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', (select id from f210 where k = 'c1_refs'), 'x.png') $$,
  '42501', null, 'change: another tenant cannot file into this tenant''s folder');

-- ============================================================================== CHANGE ====
-- Creative A: self-scoped, with a task on Kite Card's piece.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select is(public.library_can_change('aaaaaaaa-0000-0000-0000-00000000c001'), true,
  'reach: a self-scoped maker changes the client of their own task');
select is(public.library_can_change('aaaaaaaa-0000-0000-0000-0000000c2100'), false,
  'reach: and not another client');
select lives_ok($$ insert into assets (id, tenant_id, folder_id, name, object_key, uploaded_by) values
  ('aaaaaaaa-0000-0000-0000-0000000a5203', 'aaaaaaaa-0000-0000-0000-000000000001', (select id from f210 where k = 'c1_refs'),
   'my-sketch.png', 'aaaaaaaa-0000-0000-0000-000000000001/k/210/sketch', '00000000-0000-0000-0000-00000000a001') $$,
  'change: the maker uploads into their client');
select is((select uploaded_by from assets where id = 'aaaaaaaa-0000-0000-0000-0000000a5203'),
  '00000000-0000-0000-0000-00000000a003'::uuid,
  'change: the database says who uploaded — a claimed uploader is overwritten by the caller');
select throws_ok($$ insert into assets (tenant_id, folder_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', (select id from f210 where k = 'c2_refs'), 'nope.png') $$,
  '42501', null, 'change: the maker cannot upload into a client outside their reach');
update assets set name = 'renamed.pdf' where id = 'aaaaaaaa-0000-0000-0000-0000000a5201';
select is((select name from assets where id = 'aaaaaaaa-0000-0000-0000-0000000a5201'), 'zeta-brief.pdf',
  'change: nor rename a file there (the update matches nothing)');
select throws_ok($$ select public.library_rename('aaaaaaaa-0000-0000-0000-0000000a5201', 'renamed') $$,
  '42501', null, 'change: and the rename RPC refuses in words');
select throws_ok($$ insert into asset_folders (tenant_id, client_id, parent_id, name, kind) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000c2100', (select id from f210 where k = 'c2_refs'),
   'Mine', 'custom') $$,
  '42501', null, 'change: nor make a folder in that client');

-- The idle maker: same role, same department, no task — no reach.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-000000021011'), true);
select is(public.library_can_change('aaaaaaaa-0000-0000-0000-00000000c001'), false,
  'reach: the same role with no task of the client has no reach');

-- Department leads: the piece's department reaches the client; another department does not.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-000000021012'), true);
select is(public.library_can_change('aaaaaaaa-0000-0000-0000-00000000c001'), true,
  'reach: a department lead reaches the client of their department''s piece');
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-000000021013'), true);
select is(public.library_can_change('aaaaaaaa-0000-0000-0000-00000000c001'), false,
  'reach: another department''s lead does not');

-- The account manager: their client, not another.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-000000021010'), true);
select is(public.library_can_change('aaaaaaaa-0000-0000-0000-0000000c2100'), true,
  'reach: an account manager reaches their own client');
select is(public.library_can_change('aaaaaaaa-0000-0000-0000-00000000c001'), false,
  'reach: and not a client they do not manage');

-- ============================================================================== DELETE ====
-- Creative A cannot delete the Power Admin's file in Kite Card, though it is within their reach.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select throws_ok($$ select public.library_delete('aaaaaaaa-0000-0000-0000-0000000a5202') $$,
  '42501', null, 'delete: reach is not enough — not the uploader, not the AM, not a Power Admin');
select throws_ok($$ update assets set deleted_at = now() where id = 'aaaaaaaa-0000-0000-0000-0000000a5202' $$,
  '42501', null, 'delete: nor by writing deleted_at directly');
select lives_ok($$ select public.library_delete('aaaaaaaa-0000-0000-0000-0000000a5203') $$,
  'delete: the uploader deletes their own file');
select is((select count(*)::int from assets where id = 'aaaaaaaa-0000-0000-0000-0000000a5203'), 1,
  'delete: and still sees it — in Recently deleted');
select is((select deleted_by from assets where id = 'aaaaaaaa-0000-0000-0000-0000000a5203'),
  '00000000-0000-0000-0000-00000000a003'::uuid, 'delete: who deleted it is recorded');

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-000000021011'), true);
select is((select count(*)::int from assets where id = 'aaaaaaaa-0000-0000-0000-0000000a5203'), 0,
  'delete: a deleted file is hidden from someone who could not bring it back (d.23)');
select is((select count(*)::int from asset_versions where asset_id = 'aaaaaaaa-0000-0000-0000-0000000a5203'), 0,
  'delete: and so are its versions');
select throws_ok($$ select public.library_restore('aaaaaaaa-0000-0000-0000-0000000a5203') $$,
  '42501', null, 'restore: someone else cannot bring it back');

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select is((select count(*)::int from assets where id = 'aaaaaaaa-0000-0000-0000-0000000a5203'), 1,
  'delete: a Power Admin sees it in Recently deleted');
delete from assets where id = 'aaaaaaaa-0000-0000-0000-0000000a5202';
select is((select count(*)::int from assets where id = 'aaaaaaaa-0000-0000-0000-0000000a5202'), 1,
  'delete: there is no user DELETE — even a Power Admin''s removes nothing (the purge is the sweep''s)');

-- The account manager deletes a file in their client that someone else uploaded.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-000000021010'), true);
select lives_ok($$ select public.library_delete('aaaaaaaa-0000-0000-0000-0000000a5201') $$,
  'delete: the client''s account manager deletes any of its files');
select lives_ok($$ select public.library_restore('aaaaaaaa-0000-0000-0000-0000000a5201') $$,
  'restore: and brings it back');

-- =============================================================================== FOLDERS ====
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select throws_ok($$ update asset_folders set name = 'Refs' where id = (select id from f210 where k = 'c1_refs') $$,
  '42501', 'standard folder', 'folders: a standard folder cannot be renamed, even by a Power Admin');
select throws_ok($$ delete from asset_folders where id = (select id from f210 where k = 'c1_refs') $$,
  '42501', 'standard folder', 'folders: nor deleted');
select throws_ok($$ select public.library_move_folder((select id from f210 where k = 'c1_refs'), (select id from f210 where k = 'c1_work')) $$,
  '42501', 'standard folder', 'folders: nor moved');
select throws_ok($$ insert into asset_folders (tenant_id, client_id, parent_id, name, kind, is_system) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001', (select id from f210 where k = 'c1_refs'),
   'Fake standard', 'custom', true) $$,
  '42501', 'standard folder', 'folders: nobody makes a standard folder');

-- Creative A makes a folder, files into it, and tries to delete it.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
insert into asset_folders (id, tenant_id, client_id, parent_id, name, kind) values
  ('aaaaaaaa-0000-0000-0000-0000000f5210', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   (select id from f210 where k = 'c1_refs'), 'Moodboard', 'custom');
insert into assets (id, tenant_id, folder_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000a5204', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000f5210', 'mood-1.jpg'),
  ('aaaaaaaa-0000-0000-0000-0000000a5205', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000f5210', 'mood-2.jpg');
select is((select campaign_id from asset_folders where id = 'aaaaaaaa-0000-0000-0000-0000000f5210'),
  'aaaaaaaa-0000-0000-0000-00000000e001'::uuid, 'folders: a made folder belongs to the project it sits in');
select throws_ok($$ delete from asset_folders where id = 'aaaaaaaa-0000-0000-0000-0000000f5210' $$,
  'P0001', 'folder not empty: 2 files', 'folders: a folder with files is not deleted (d.20)');
select throws_ok($$ select public.library_move_folder('aaaaaaaa-0000-0000-0000-0000000f5210', 'aaaaaaaa-0000-0000-0000-0000000f5210') $$,
  '22023', 'a folder cannot be moved into itself', 'folders: a folder cannot be moved into itself');
select lives_ok($$ select public.library_delete('aaaaaaaa-0000-0000-0000-0000000a5204') $$, 'one file deleted');
select lives_ok($$ select public.library_move('aaaaaaaa-0000-0000-0000-0000000a5205', (select id from f210 where k = 'c1_work')) $$,
  'the other moved out, within the client');

-- Another maker of the same reach cannot delete Creative A's empty folder (not maker, not AM, not PA).
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-000000021012'), true);
delete from asset_folders where id = 'aaaaaaaa-0000-0000-0000-0000000f5210';
select is((select count(*)::int from asset_folders where id = 'aaaaaaaa-0000-0000-0000-0000000f5210'), 1,
  'folders: someone who did not make it cannot delete an empty folder');

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select lives_ok($$ delete from asset_folders where id = 'aaaaaaaa-0000-0000-0000-0000000f5210' $$,
  'folders: its maker deletes it once empty');
select is((select folder_id from assets where id = 'aaaaaaaa-0000-0000-0000-0000000a5204'),
  (select id from f210 where k = 'c1_refs'),
  'folders: its Recently-deleted file moved to the parent and keeps its 30 days');

-- Nothing crosses clients — not even for a Power Admin.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select throws_ok($$ select public.library_move('aaaaaaaa-0000-0000-0000-0000000a5202', (select id from f210 where k = 'c2_refs')) $$,
  '42501', 'another client', 'move: a file never moves to another client (RPC)');
select throws_ok($$ update assets set folder_id = (select id from f210 where k = 'c2_refs') where id = 'aaaaaaaa-0000-0000-0000-0000000a5202' $$,
  '42501', 'another client', 'move: nor by a direct update');

-- A per-user DENY of assets:view (ADR-0036) reads nothing.
reset role;
insert into user_grants (tenant_id, user_id, resource, action, effect) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000021011', 'assets', 'view', 'deny');
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-000000021011'), true);
select is((select count(*)::int from assets), 0, 'read: a per-user deny of assets:view reads no file');

select * from finish();
rollback;
