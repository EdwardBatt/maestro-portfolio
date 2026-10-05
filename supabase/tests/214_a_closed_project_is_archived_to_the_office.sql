-- ADR-0136 (I72) — a closed project's working files go to the office server 90 days after it closes.
--
--   CLOCK      due only once closed_at + archive_after_days has passed; the tenant setting moves it;
--              reopening stops it; an open project is never due.
--   WHAT       working files, sources, every version but the one in use, every review round but the
--              piece's latest — never Final Assets, References, or a key a kept row still names.
--   MARK       the online object may be removed only when no row staying online names its key.
--   BRING BACK by anyone who may change the client's files, one request at a time, only for an archived
--              file; the job brings it online for 30 days and tells the requester; then it goes again.
--   FENCES     the job's RPCs are service-role only; requests are read in-tenant and never edited by a
--              person; a request is made as oneself.
begin;
select plan(30);
\ir helpers/seed.sql
select app.seed_tenant_asset_grants(id) from tenants;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000021401', 'lead214@a.test'),
  ('00000000-0000-0000-0000-000000021402', 'idle214@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       'aaaaaaaa-0000-0000-0000-0000000de0ff'
from (values ('00000000-0000-0000-0000-000000021401', 'Lead 214', 'department_lead'),
             ('00000000-0000-0000-0000-000000021402', 'Idle 214', 'team_member')) v(id, name, role_key);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id::text like '00000000-0000-0000-0000-00000002140%';

insert into campaigns (id, tenant_id, client_id, name, status) values
  ('aaaaaaaa-0000-0000-0000-0000000e2140', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Archive 214', 'approved');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000f2140', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000e2140', 'S214');
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d2140', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000f2140',
   'Poster 214', 'approved', now() + interval '20 days', '00000000-0000-0000-0000-000000021401',
   'aaaaaaaa-0000-0000-0000-0000000de0ff');

create or replace function pg_temp.f214(p_name text) returns uuid language sql as $$
  select id from asset_folders where campaign_id = 'aaaaaaaa-0000-0000-0000-0000000e2140' and kind = 'asset_type' and name = p_name
$$;
create or replace function pg_temp.add214(p_id uuid, p_folder uuid, p_name text, p_keys text[], p_source boolean default false)
returns void language plpgsql as $$
declare i int;
begin
  insert into assets (id, tenant_id, folder_id, name, object_key, current_version, is_source)
  values (p_id, 'aaaaaaaa-0000-0000-0000-000000000001', p_folder, p_name, p_keys[array_length(p_keys, 1)], array_length(p_keys, 1), p_source);
  for i in 1 .. array_length(p_keys, 1) loop
    insert into asset_versions (tenant_id, asset_id, version, object_key, size_bytes)
    values ('aaaaaaaa-0000-0000-0000-000000000001', p_id, i, p_keys[i], 10);
  end loop;
end $$;

select pg_temp.add214('aaaaaaaa-0000-0000-0000-0000000a2141', pg_temp.f214('Working Files'), 'layout.indd', array['k/w1', 'k/w2']);
select pg_temp.add214('aaaaaaaa-0000-0000-0000-0000000a2142', pg_temp.f214('References'),    'ref.pdf',     array['k/r1']);
select pg_temp.add214('aaaaaaaa-0000-0000-0000-0000000a2143', pg_temp.f214('Final Assets'),  'final.png',   array['k/shared']);
select pg_temp.add214('aaaaaaaa-0000-0000-0000-0000000a2144', pg_temp.f214('Deliverables'),  'Poster',      array['k/d1', 'k/d2']);
select pg_temp.add214('aaaaaaaa-0000-0000-0000-0000000a2145',
  (select id from asset_folders where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2140'), 'poster.psd', array['k/s1'], true);
-- Review rounds: v1 shares the delivered v1's key; v2 is the Final asset's object; v3 is in use.
insert into media_records (id, tenant_id, deliverable_id, version, object_key) values
  ('aaaaaaaa-0000-0000-0000-0000000b2141', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d2140', 1, 'k/d1');
insert into media_records (id, tenant_id, deliverable_id, version, object_key) values
  ('aaaaaaaa-0000-0000-0000-0000000b2142', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d2140', 2, 'k/shared');
insert into media_records (id, tenant_id, deliverable_id, version, object_key) values
  ('aaaaaaaa-0000-0000-0000-0000000b2143', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d2140', 3, 'k/m3');

-- ================================================================================ CLOCK ====
select is((select count(*)::int from app.library_archive_due('aaaaaaaa-0000-0000-0000-000000000001')), 0,
  'clock: an open project is never due (d.1 — nothing in a live project is archived)');
update campaigns set status = 'closed', closed_at = now() - interval '10 days' where id = 'aaaaaaaa-0000-0000-0000-0000000e2140';
select is((select count(*)::int from app.library_archive_due('aaaaaaaa-0000-0000-0000-000000000001')), 0,
  'clock: closed 10 days ago is not yet due (90 by default)');
insert into tenant_storage_settings (tenant_id, archive_after_days) values ('aaaaaaaa-0000-0000-0000-000000000001', 5)
on conflict (tenant_id) do update set archive_after_days = 5;
select is((select count(*)::int from app.library_archive_due('aaaaaaaa-0000-0000-0000-000000000001')), 5,
  'clock: the tenant''s setting moves it');
update tenant_storage_settings set archive_after_days = 90 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';
update campaigns set closed_at = now() - interval '91 days' where id = 'aaaaaaaa-0000-0000-0000-0000000e2140';

-- ================================================================================= WHAT ====
select results_eq(
  $$ select item_type, object_key from app.library_archive_due('aaaaaaaa-0000-0000-0000-000000000001') order by 1, 2 $$,
  $$ values ('asset_version'::text, 'k/d1'::text), ('asset_version', 'k/s1'), ('asset_version', 'k/w1'),
            ('asset_version', 'k/w2'), ('media_record', 'k/d1') $$,
  'what: working files, a source, the version not in use, the round not in use (d.2)');
select is((select count(*)::int from app.library_archive_due('aaaaaaaa-0000-0000-0000-000000000001') where object_key in ('k/r1', 'k/shared')), 0,
  'what: never References or Final Assets — nor a review round whose object a Final asset uses');
select is((select count(*)::int from app.library_archive_due('aaaaaaaa-0000-0000-0000-000000000001') where object_key in ('k/d2', 'k/m3')), 0,
  'what: never the piece''s version in use');
select is((select count(*)::int from app.library_archive_due('bbbbbbbb-0000-0000-0000-000000000001')), 0,
  'what: another tenant''s due set does not include this one''s');

update campaigns set status = 'approved', closed_at = null where id = 'aaaaaaaa-0000-0000-0000-0000000e2140';
select is((select count(*)::int from app.library_archive_due('aaaaaaaa-0000-0000-0000-000000000001')), 0,
  'clock: reopening stops it');
update campaigns set status = 'closed', closed_at = now() - interval '91 days' where id = 'aaaaaaaa-0000-0000-0000-0000000e2140';

-- ================================================================================= MARK ====
select is(public.library_archive_mark('asset_version',
            (select id from asset_versions where asset_id = 'aaaaaaaa-0000-0000-0000-0000000a2144' and version = 1), 'office://214/d1'),
  false, 'mark: an object another online row still names is kept online');
select is(public.library_archive_mark('media_record', 'aaaaaaaa-0000-0000-0000-0000000b2141', 'office://214/d1'), true,
  'mark: and removed once the last row naming it is archived (d.3)');
select is((select retention_state from media_records where id = 'aaaaaaaa-0000-0000-0000-0000000b2141'), 'archived',
  'mark: the review round says archived');
select is(public.library_archive_mark('asset_version',
            (select id from asset_versions where asset_id = 'aaaaaaaa-0000-0000-0000-0000000a2141' and version = 2), 'office://214/w2'),
  true, 'mark: the working file''s version in use goes too');
select ok((select archived_at is not null from assets where id = 'aaaaaaaa-0000-0000-0000-0000000a2141'),
  'mark: and the file is marked Archived where it is listed (d.4)');
select is((select count(*)::int from app.library_archive_due('aaaaaaaa-0000-0000-0000-000000000001')), 2,
  'mark: what is archived is no longer due');

-- =========================================================================== BRING BACK ====
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-000000021402'), true);
select throws_ok($$ select public.library_bring_back('aaaaaaaa-0000-0000-0000-0000000a2141') $$, '42501', null,
  'bring back: not by someone who may not change the client''s files (d.4)');
select throws_ok($$ insert into library_archive_requests (tenant_id, asset_id, requested_by) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000a2141', '00000000-0000-0000-0000-000000021402') $$,
  '42501', null, 'bring back: nor by writing the request directly');
select throws_ok($$ select public.library_archive_mark('media_record', 'aaaaaaaa-0000-0000-0000-0000000b2143', 'x') $$,
  '42501', null, 'fences: a person cannot mark anything archived');
select throws_ok($$ select * from public.library_archive_due_items('aaaaaaaa-0000-0000-0000-000000000001', 10) $$,
  '42501', null, 'fences: nor read the job''s due list');

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);
select throws_ok($$ select public.library_bring_back('aaaaaaaa-0000-0000-0000-0000000a2142') $$, '22023', null,
  'bring back: only an archived file');
select throws_ok($$ insert into library_archive_requests (tenant_id, asset_id, requested_by) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000a2141', '00000000-0000-0000-0000-00000000a001') $$,
  '42501', null, 'bring back: a request is made as oneself');
create temp table r214 as select public.library_bring_back('aaaaaaaa-0000-0000-0000-0000000a2141') as id;
select ok((select id from r214) is not null, 'bring back: a scheduler with reach asks for it');
select is(public.library_bring_back('aaaaaaaa-0000-0000-0000-0000000a2141'), (select id from r214),
  'bring back: asking again is the same request');
update library_archive_requests set status = 'restored' where id = (select id from r214);
select is((select status from library_archive_requests where id = (select id from r214)), 'pending',
  'fences: a person cannot move a request along');

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000b001'), true);
select is((select count(*)::int from library_archive_requests), 0, 'fences: another tenant sees no request');

reset role;
select set_config('request.jwt.claims', '', true);
select is((select jsonb_array_length(items) from public.library_bring_back_pending(10) where request_id = (select id from r214)), 1,
  'job: the pending request with its archived version');
select lives_ok($$ select public.library_bring_back_done((select id from r214), true) $$, 'job: it is online again');
select ok((select brought_back_until between now() + interval '29 days' and now() + interval '31 days'
             from assets where id = 'aaaaaaaa-0000-0000-0000-0000000a2141'), 'job: for 30 days (d.4)');
select is((select user_id from notifications where type = 'file_brought_back'), '00000000-0000-0000-0000-00000000a002'::uuid,
  'job: and the person who asked is told it is ready');
select is((select count(*)::int from app.library_archive_due('aaaaaaaa-0000-0000-0000-000000000001')
            where asset_id = 'aaaaaaaa-0000-0000-0000-0000000a2141'), 0,
  'job: a brought-back file is not archived again while it is back');

update assets set brought_back_until = now() - interval '1 minute' where id = 'aaaaaaaa-0000-0000-0000-0000000a2141';
select is((select object_keys from public.library_brought_back_expired(10) where asset_id = 'aaaaaaaa-0000-0000-0000-0000000a2141'),
  array['k/w2'], 'job: after 30 days its online copy goes again — the office copy is already confirmed');

select * from finish();
rollback;
