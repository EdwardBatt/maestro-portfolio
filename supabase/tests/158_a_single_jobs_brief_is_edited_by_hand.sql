-- ADR-0104 d.3 (25 Sep) / I57.40 — a released single job's brief is edited by hand.
--
-- The dead Re-open is gone; in its place `update_single_job_brief`, for the campaign's approval
-- authority (the same test as a released campaign's brief, I53.4). It merges the fields sent,
-- keeps the approval stamp (the words changed, not the decision), and never touches the work.
begin;
select plan(7);
\ir helpers/seed.sql

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de1580', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 158');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a180', 'am158@a.test'),
  ('00000000-0000-0000-0000-00000000a181', 'lead158@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid
from (values
  ('00000000-0000-0000-0000-00000000a180','AM 158',   'account_manager', null),
  ('00000000-0000-0000-0000-00000000a181','Lead 158', 'department_lead','aaaaaaaa-0000-0000-0000-000000de1580')
) as v(id, name, role_key, dept);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id in ('00000000-0000-0000-0000-00000000a180','00000000-0000-0000-0000-00000000a181');

insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id, brief) values
  ('aaaaaaaa-0000-0000-0000-000000001580','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Teaser 158','approved','single_job','00000000-0000-0000-0000-00000000a180',
   '{"kind":"single_job","request":{"words":"One teaser"}}'::jsonb),
  ('aaaaaaaa-0000-0000-0000-000000001581','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Season 158','approved','campaign','00000000-0000-0000-0000-00000000a180', '{}'::jsonb);
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f158','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001580','Teaser 158');
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d1580','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f158',
   'Teaser 158','draft', now() + interval '10 days', '00000000-0000-0000-0000-00000000a181');
insert into campaign_briefs (id, tenant_id, campaign_id, department_id, brief_type, "values", approved_at, approved_by) values
  ('aaaaaaaa-0000-0000-0000-0000000cb158','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001580',
   'aaaaaaaa-0000-0000-0000-000000de1580','single_execution','{"task":"Design one teaser","tone":"Warm"}',
   now() - interval '1 day', '00000000-0000-0000-0000-00000000a180');

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a181'),true);
select throws_ok($$ select public.update_single_job_brief('aaaaaaaa-0000-0000-0000-000000001580', '{"task":"x"}') $$,
  '42501', null, 'a department lead is not the job''s approval authority — refused in words');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a180'),true);
select lives_ok($$ select public.update_single_job_brief('aaaaaaaa-0000-0000-0000-000000001580',
                    '{"task":"Design one teaser, Arabic first"}') $$,
  'the account manager edits the released job''s brief by hand (d.3)');
select throws_ok($$ select public.update_single_job_brief('aaaaaaaa-0000-0000-0000-000000001581', '{"task":"x"}') $$,
  '22023', null, 'a campaign''s brief is not edited through the single job''s door');
select throws_ok($$ select public.update_single_job_brief('aaaaaaaa-0000-0000-0000-000000001580', '"not a document"') $$,
  '22023', null, 'a brief is a set of fields');
reset role;

select results_eq($$
  select "values" ->> 'task', "values" ->> 'tone' from campaign_briefs where id = 'aaaaaaaa-0000-0000-0000-0000000cb158'
$$, $$ values ('Design one teaser, Arabic first', 'Warm') $$,
  'the field sent is replaced and the rest kept — a merge (d.3)');
select ok((select approved_at is not null and approved_by = '00000000-0000-0000-0000-00000000a180'
             from campaign_briefs where id = 'aaaaaaaa-0000-0000-0000-0000000cb158'),
  'the approval stamp stays — the words changed, not the decision (d.3)');
select is((select state::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1580'), 'draft',
  'the work is untouched (d.3)');

select * from finish();
rollback;
