-- I52.19 (17 Sep) — a change of the client's account manager reaches its open campaigns.
--
--   * A campaign naming the OLD manager moves to the new one; one naming nobody does too.
--   * A campaign given a DIFFERENT manager on purpose keeps them.
--   * A CLOSED campaign keeps its record.
--   * Another client's campaigns are untouched.
--   * Afterwards the new manager may approve what moved — the point of the change.
begin;
select plan(7);
\ir helpers/seed.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a080', 'am-old@a.test'),
  ('00000000-0000-0000-0000-00000000a081', 'am-new@a.test'),
  ('00000000-0000-0000-0000-00000000a082', 'am-other@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = 'account_manager')
from (values
  ('00000000-0000-0000-0000-00000000a080','AM Old'),
  ('00000000-0000-0000-0000-00000000a081','AM New'),
  ('00000000-0000-0000-0000-00000000a082','AM Other')
) as v(id, name);
insert into test_claims (id, jwt)
select up.id,
       json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id = '00000000-0000-0000-0000-00000000a081';

insert into clients (id, tenant_id, name, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-00000000c129','aaaaaaaa-0000-0000-0000-000000000001','Client 129','00000000-0000-0000-0000-00000000a080'),
  ('aaaaaaaa-0000-0000-0000-00000000c130','aaaaaaaa-0000-0000-0000-000000000001','Client 130','00000000-0000-0000-0000-00000000a080');
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  -- names the old manager: follows
  ('aaaaaaaa-0000-0000-0000-000000001291','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000c129','Follows','pending_approval','campaign','00000000-0000-0000-0000-00000000a080'),
  -- names nobody: follows
  ('aaaaaaaa-0000-0000-0000-000000001292','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000c129','Nobody','approved','campaign',null),
  -- given a different manager on purpose: keeps them
  ('aaaaaaaa-0000-0000-0000-000000001293','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000c129','Special','approved','campaign','00000000-0000-0000-0000-00000000a082'),
  -- closed: keeps its record
  ('aaaaaaaa-0000-0000-0000-000000001294','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000c129','Closed','closed','campaign','00000000-0000-0000-0000-00000000a080'),
  -- another client's: untouched
  ('aaaaaaaa-0000-0000-0000-000000001295','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000c130','Elsewhere','approved','campaign','00000000-0000-0000-0000-00000000a080');

-- The Power Admin changes the client's manager on the client record (clients:manage).
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select lives_ok($$
  update clients set account_manager_id = '00000000-0000-0000-0000-00000000a081' where id = 'aaaaaaaa-0000-0000-0000-00000000c129'
$$, 'the client''s account manager is changed');
reset role;

select is((select account_manager_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-000000001291'),
  '00000000-0000-0000-0000-00000000a081', 'a campaign that named the OLD manager follows');
select is((select account_manager_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-000000001292'),
  '00000000-0000-0000-0000-00000000a081', 'a campaign that named NOBODY follows');
select is((select account_manager_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-000000001293'),
  '00000000-0000-0000-0000-00000000a082', 'a campaign given a DIFFERENT manager on purpose keeps them');
select is((select account_manager_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-000000001294'),
  '00000000-0000-0000-0000-00000000a080', 'a CLOSED campaign keeps its record');
select is((select account_manager_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-000000001295'),
  '00000000-0000-0000-0000-00000000a080', 'another client''s campaign is untouched');

-- The point: the new manager may approve what followed.
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a081'),true);
select lives_ok($$ select public.approve_campaign('aaaaaaaa-0000-0000-0000-000000001291') $$,
  'and the new manager approves the campaign that followed');

select * from finish();
rollback;
