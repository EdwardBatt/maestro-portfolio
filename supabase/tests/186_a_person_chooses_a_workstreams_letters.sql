-- 20260927120000 (I59.54) — the person making a workstream may type its letters. Typed letters are
-- stored in capitals, must be two to four Latin letters, and are what its pieces are coded with;
-- left empty, the rule gives them. Both doors carry them — the wizard's (`write_campaign_content`,
-- `codeLetters` per workstream) and the campaign page's (`save_workstream`) — and a rename through
-- `save_workstream` cannot change them.
begin;
select plan(11);
\ir helpers/seed.sql

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000a186', 'am186@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id)
select '00000000-0000-0000-0000-00000000a186', 'aaaaaaaa-0000-0000-0000-000000000001', 'AM 186',
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = 'account_manager');
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id = '00000000-0000-0000-0000-00000000a186';

insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-000000001860','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Season 186','approved','campaign','00000000-0000-0000-0000-00000000a186'),
  ('aaaaaaaa-0000-0000-0000-000000001861','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Wizard 186','draft','campaign','00000000-0000-0000-0000-00000000a186');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000186d1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001860','S186');

-- ======================================================= the trigger ====
insert into workstreams (id, tenant_id, campaign_id, name, department_id, code_letters) values
  ('aaaaaaaa-0000-0000-0000-0000000186a1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001860',
   'Influencers','aaaaaaaa-0000-0000-0000-0000000de0ff',' ia ');
select is((select code_letters from workstreams where id = 'aaaaaaaa-0000-0000-0000-0000000186a1'), 'IA',
  'typed letters are kept, trimmed and in capitals (" ia " -> IA), not the rule''s INF');

insert into workstreams (id, tenant_id, campaign_id, name, department_id, code_letters) values
  ('aaaaaaaa-0000-0000-0000-0000000186a2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001860',
   'Design & Animation','aaaaaaaa-0000-0000-0000-0000000de0ff','');
select is((select code_letters from workstreams where id = 'aaaaaaaa-0000-0000-0000-0000000186a2'), 'DA',
  'left empty, the rule gives them (Design & Animation -> DA)');

select throws_ok($$
  insert into workstreams (tenant_id, campaign_id, name, department_id, code_letters) values
    ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001860','Digits','aaaaaaaa-0000-0000-0000-0000000de0ff','I1')
$$, '22023', 'A workstream''s letters are two to four Latin letters, like DA or INF.',
  'a digit is refused, in words');

select throws_ok($$
  insert into workstreams (tenant_id, campaign_id, name, department_id, code_letters) values
    ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001860','Too long','aaaaaaaa-0000-0000-0000-0000000de0ff','ABCDE')
$$, '22023', 'A workstream''s letters are two to four Latin letters, like DA or INF.',
  'five letters are refused');

insert into deliverables (id, tenant_id, stream_id, workstream_id, name, state, owner_user_id, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000186e1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000186d1',
   'aaaaaaaa-0000-0000-0000-0000000186a1','Reel','draft','00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-00000000a001');
select matches((select code from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000186e1'), '^IA-[0-9]{3}$',
  'a piece made in it is coded with the typed letters');

-- ============================================== the wizard's door ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a186'),true);
select app.write_campaign_content(
  'aaaaaaaa-0000-0000-0000-000000001861', '{}'::jsonb, now() + interval '30 days', '[]'::jsonb, null,
  '[{"key":"w1","name":"Television","departmentId":"aaaaaaaa-0000-0000-0000-0000000de0ff","codeLetters":"tv"},
    {"key":"w2","name":"Media Toolkit","departmentId":"aaaaaaaa-0000-0000-0000-0000000de0ff"}]'::jsonb);
select is((select code_letters from workstreams where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001861' and name = 'Television'), 'TV',
  'the wizard: a workstream''s codeLetters are written (tv -> TV, not the rule''s TEL)');
select is((select code_letters from workstreams where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001861' and name = 'Media Toolkit'), 'MT',
  'the wizard: one without codeLetters takes the rule''s (Media Toolkit -> MT)');

-- ======================================== the campaign page's door ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a186'),true);

select lives_ok($$
  select public.save_workstream('aaaaaaaa-0000-0000-0000-000000001860', 'Paid social',
    'aaaaaaaa-0000-0000-0000-0000000de0ff', null, null, 'psm')
$$, 'the campaign page: a workstream is made with typed letters');
select is((select code_letters from workstreams where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001860' and name = 'Paid social'), 'PSM',
  'and they are kept, in capitals');

select lives_ok($$
  select public.save_workstream('aaaaaaaa-0000-0000-0000-000000001860', 'Paid social media',
    'aaaaaaaa-0000-0000-0000-0000000de0ff', null,
    (select id from workstreams where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001860' and name = 'Paid social'), 'ZZ')
$$, 'a rename that also passes letters goes through');
select is((select code_letters from workstreams where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001860' and name = 'Paid social media'), 'PSM',
  'and the letters stay PSM — fixed when the workstream was made');

select * from finish();
rollback;
