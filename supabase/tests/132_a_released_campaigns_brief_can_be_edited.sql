-- I53.4 (20 Sep) — a released campaign's master brief can be edited on its page by the campaign's
-- approval authority; a department lead is refused, in words; the denormalised columns follow.
begin;
select plan(7);
\ir helpers/seed.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a0a0', 'am132@a.test'),
  ('00000000-0000-0000-0000-00000000a0a1', 'lead132@a.test');
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de1320','aaaaaaaa-0000-0000-0000-000000000001','Creative 132');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid
from (values
  ('00000000-0000-0000-0000-00000000a0a0','AM 132',   'account_manager', null),
  ('00000000-0000-0000-0000-00000000a0a1','Lead 132', 'department_lead','aaaaaaaa-0000-0000-0000-000000de1320')
) as v(id, name, role_key, dept);
insert into test_claims (id, jwt)
select up.id,
       json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id in ('00000000-0000-0000-0000-00000000a0a0','00000000-0000-0000-0000-00000000a0a1');

-- A promoted job: approved, kind campaign, a one-line brief.
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id, brief) values
  ('aaaaaaaa-0000-0000-0000-000000001340','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Promoted 132','approved','campaign','00000000-0000-0000-0000-00000000a0a0',
   '{"proposition":"One poster","audiencePrimary":"Shoppers"}'::jsonb),
  ('aaaaaaaa-0000-0000-0000-000000001341','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Closed 132','closed','campaign','00000000-0000-0000-0000-00000000a0a0',
   '{"proposition":"Done"}'::jsonb);

set local role authenticated;

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a0a1'),true);
select throws_ok($$
  select public.update_campaign_brief('aaaaaaaa-0000-0000-0000-000000001340', '{"proposition":"Sneaky"}'::jsonb)
$$, '42501', null, 'a department lead may not rewrite a released campaign''s brief — refused, worded');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a0a0'),true);
select lives_ok($$
  select public.update_campaign_brief('aaaaaaaa-0000-0000-0000-000000001340',
    '{"proposition":"A season, not a poster","audiencePrimary":"Everyone in Baghdad","insight":"They love a draw"}'::jsonb)
$$, 'the account manager rewrites it');
select throws_ok($$
  select public.update_campaign_brief('aaaaaaaa-0000-0000-0000-000000001340', '"not a document"'::jsonb)
$$, '22023', null, 'a brief that is not a document is refused');
select throws_ok($$
  select public.update_campaign_brief('aaaaaaaa-0000-0000-0000-000000001341', '{"proposition":"Again"}'::jsonb)
$$, '22023', null, 'a closed campaign''s brief is not edited — reopen it first');
-- The direct PATCH is governed identically (ADR-0037): the lead is refused by the guard.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a0a1'),true);
select throws_ok($$
  update campaigns set brief = '{"proposition":"Sneaky"}'::jsonb where id = 'aaaaaaaa-0000-0000-0000-000000001340'
$$, '42501', null, 'nor by a direct PATCH');

reset role;
select results_eq($$
  select brief ->> 'proposition', audience, insight, proposition from campaigns where id = 'aaaaaaaa-0000-0000-0000-000000001340'
$$, $$ values ('A season, not a poster', 'Everyone in Baghdad', 'They love a draw', 'A season, not a poster') $$,
  'saved, and the denormalised columns follow the document');
select is((select brief ->> 'proposition' from campaigns where id = 'aaaaaaaa-0000-0000-0000-000000001341'), 'Done',
  'the closed campaign is untouched');

select * from finish();
rollback;
