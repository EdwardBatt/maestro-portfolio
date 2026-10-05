-- I52.17 (17 Sep) — a campaign's account manager can be changed, by the people who may approve it.
--
--   * MAY: a Power Admin (tenant-wide reach); the campaign's current account manager.
--   * MAY NOT: a department lead (42501, worded); naming somebody who is not eligible (22023).
--   * A plain PATCH is governed exactly as the RPC.
--   * Once corrected, the new manager may approve the campaign — the point of the change.
begin;
select plan(8);
\ir helpers/seed.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a060', 'am-one@a.test'),
  ('00000000-0000-0000-0000-00000000a061', 'am-two@a.test'),
  ('00000000-0000-0000-0000-00000000a062', 'lead@a.test');
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de1270','aaaaaaaa-0000-0000-0000-000000000001','Creative');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid
from (values
  ('00000000-0000-0000-0000-00000000a060','AM One',  'account_manager', null),
  ('00000000-0000-0000-0000-00000000a061','AM Two',  'account_manager', null),
  ('00000000-0000-0000-0000-00000000a062','A Lead',  'department_lead', 'aaaaaaaa-0000-0000-0000-000000de1270')
) as v(id, name, role_key, dept);
insert into test_claims (id, jwt)
select up.id,
       json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id in ('00000000-0000-0000-0000-00000000a060','00000000-0000-0000-0000-00000000a061','00000000-0000-0000-0000-00000000a062');

-- A pending campaign whose row names AM One, on a client whose manager is nobody.
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-000000001270','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Campaign 127','pending_approval','campaign','00000000-0000-0000-0000-00000000a060');

set local role authenticated;

-- MAY NOT: a department lead.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a062'),true);
select throws_ok($$
  select public.set_campaign_account_manager('aaaaaaaa-0000-0000-0000-000000001270', '00000000-0000-0000-0000-00000000a061')
$$, '42501', null, 'a department lead may not change it — refused, worded');

-- MAY NOT be named: somebody without account_manager:manage.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select throws_ok($$
  select public.set_campaign_account_manager('aaaaaaaa-0000-0000-0000-000000001270', '00000000-0000-0000-0000-00000000a062')
$$, '22023', null, 'a person who cannot be an account manager cannot be named');

-- MAY: the Power Admin — the backup Edward reached for.
select lives_ok($$
  select public.set_campaign_account_manager('aaaaaaaa-0000-0000-0000-000000001270', '00000000-0000-0000-0000-00000000a061')
$$, 'a Power Admin changes it');
select is((select account_manager_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-000000001270'),
  '00000000-0000-0000-0000-00000000a061', 'and it is AM Two now');

-- MAY: the current manager hands it on.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a061'),true);
select lives_ok($$
  select public.set_campaign_account_manager('aaaaaaaa-0000-0000-0000-000000001270', '00000000-0000-0000-0000-00000000a060')
$$, 'the current account manager hands it to another');

-- A PATCH by the lead is refused identically.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a062'),true);
select throws_ok($$
  update campaigns set account_manager_id = '00000000-0000-0000-0000-00000000a061' where id = 'aaaaaaaa-0000-0000-0000-000000001270'
$$, '42501', null, 'a direct UPDATE by the lead is refused the same way — the trigger is the rule (ADR-0037)');

-- The point: the corrected manager may approve.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a060'),true);
select lives_ok($$ select public.approve_campaign('aaaaaaaa-0000-0000-0000-000000001270') $$,
  'the campaign''s (corrected) account manager approves it');
select is((select status from campaigns where id = 'aaaaaaaa-0000-0000-0000-000000001270'), 'approved', 'approved');

select * from finish();
rollback;
