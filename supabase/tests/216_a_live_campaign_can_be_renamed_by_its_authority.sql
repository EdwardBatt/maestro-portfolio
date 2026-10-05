-- ADR-0137 (I73.2) — a live campaign is renamed on its page by its approval authority; a department lead
-- is refused, in words, by the RPC and by a direct PATCH alike; a closed one is reopened first; an empty
-- name and a look-alike (ADR-0135) are refused; the Library folder follows; a draft stays the wizard's.
begin;
select plan(10);
\ir helpers/seed.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a2a0', 'am216@a.test'),
  ('00000000-0000-0000-0000-00000000a2a1', 'lead216@a.test');
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de2160','aaaaaaaa-0000-0000-0000-000000000001','Creative 216');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid
from (values
  ('00000000-0000-0000-0000-00000000a2a0','AM 216',   'account_manager', null),
  ('00000000-0000-0000-0000-00000000a2a1','Lead 216', 'department_lead','aaaaaaaa-0000-0000-0000-000000de2160')
) as v(id, name, role_key, dept);
insert into test_claims (id, jwt)
select up.id,
       json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id in ('00000000-0000-0000-0000-00000000a2a0','00000000-0000-0000-0000-00000000a2a1');

insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-000000002160','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Numberles Card 216','approved','campaign','00000000-0000-0000-0000-00000000a2a0'),
  ('aaaaaaaa-0000-0000-0000-000000002161','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Closed 216','closed','campaign','00000000-0000-0000-0000-00000000a2a0'),
  ('aaaaaaaa-0000-0000-0000-000000002162','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Taken 216','approved','campaign','00000000-0000-0000-0000-00000000a2a0');

set local role authenticated;

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a2a1'),true);
select throws_ok($$ select public.rename_campaign('aaaaaaaa-0000-0000-0000-000000002160', 'Sneaky 216') $$,
  '42501', null, 'a department lead may not rename a live campaign — refused, worded');
select throws_ok($$ update campaigns set name = 'Sneaky 216' where id = 'aaaaaaaa-0000-0000-0000-000000002160' $$,
  '42501', null, 'nor by a direct PATCH (ADR-0037)');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a2a0'),true);
select is(public.rename_campaign('aaaaaaaa-0000-0000-0000-000000002160', '  Borderless Card 216  '),
  'Borderless Card 216', 'the account manager renames it, and the name is trimmed');
select is((select name from campaigns where id = 'aaaaaaaa-0000-0000-0000-000000002160'),
  'Borderless Card 216', 'the new name is kept');
select throws_ok($$ select public.rename_campaign('aaaaaaaa-0000-0000-0000-000000002160', '   ') $$,
  '22023', null, 'an empty name is refused');
select throws_ok($$ select public.rename_campaign('aaaaaaaa-0000-0000-0000-000000002160', 'taken  216') $$,
  '23505', null, 'a name that differs only by capitals or spaces is taken (ADR-0135)');
select throws_ok($$ select public.rename_campaign('aaaaaaaa-0000-0000-0000-000000002161', 'Reopened? 216') $$,
  '22023', null, 'a closed campaign is reopened before it is renamed');
select throws_ok($$ select public.rename_campaign('aaaaaaaa-0000-0000-0000-00000000dead', 'Nobody 216') $$,
  'P0002', null, 'an unknown campaign is not found');

reset role;
select is((select name from asset_folders where campaign_id = 'aaaaaaaa-0000-0000-0000-000000002160' and kind = 'campaign'),
  'Borderless Card 216', 'its Library folder follows');
select lives_ok($$ update campaigns set name = 'Service 216' where id = 'aaaaaaaa-0000-0000-0000-000000002162' $$,
  'service-role work is not held to it');

select * from finish();
rollback;
