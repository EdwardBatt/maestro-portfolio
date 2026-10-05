-- 20260927160000 (ADR-0116, ADR-0117; I60) — a campaign's languages, a language added by the person who
-- needs it, every campaign piece in a workstream, and ONE translation task after Write Copy.
begin;
select plan(14);
\ir helpers/seed.sql

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000a188', 'am188@a.test'),
                                          ('00000000-0000-0000-0000-00000000a189', 'maker188@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key)
  from (values ('00000000-0000-0000-0000-00000000a188', 'AM 188', 'account_manager'),
               ('00000000-0000-0000-0000-00000000a189', 'Maker 188', 'team_member')) v(id, name, role_key);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id in ('00000000-0000-0000-0000-00000000a188', '00000000-0000-0000-0000-00000000a189');

-- ---------------------------------------------------------------- the list ----
select app.seed_tenant_languages('aaaaaaaa-0000-0000-0000-000000000001');  -- as provisioning does
select is((select count(*)::int from deliverable_attribute_values
            where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and attribute = 'language' and code in ('en','ar','ku')),
  3, 'English, Arabic and Kurdish are on the list');

set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a188'), true);
select is(public.add_language('  Turkish '), 'turkish', 'the account manager adds Turkish; its code is made from the name');
select is(public.add_language('turkish'), 'turkish', 'adding it again, in any case, returns the one already there');
select is((select count(*)::int from deliverable_attribute_values where attribute = 'language' and lower(label_en) = 'turkish'),
  1, 'and there is still only one Turkish');

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a189'), true);
select throws_ok($$ select public.add_language('Persian') $$, '42501',
  'You cannot add a language: it needs the right to manage campaigns.',
  'a team member cannot add a language');
reset role;

-- ------------------------------------------------------- the content writer ----
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a188'), true);
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-000000001880','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Campaign 188','draft','campaign','00000000-0000-0000-0000-00000000a188'),
  ('aaaaaaaa-0000-0000-0000-000000001881','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Job 188','draft','single_job','00000000-0000-0000-0000-00000000a188');

select throws_ok($$
  select app.write_campaign_content('aaaaaaaa-0000-0000-0000-000000001880', '{"languages":["ar","en"]}'::jsonb,
    now() + interval '30 days', '[{"name":"Loose poster","ownerUserId":"00000000-0000-0000-0000-00000000a001","dueAt":"2027-03-11T15:00:00Z"}]'::jsonb)
$$, '22023', 'Every piece of a campaign goes in a workstream: "Loose poster" is in none.',
  'a campaign piece with no workstream is refused, by name');

select throws_ok($$
  select public.add_campaign_deliverable('aaaaaaaa-0000-0000-0000-000000001880', 'Loose 2',
    '00000000-0000-0000-0000-00000000a001', null, 1, '2027-03-11 15:00+00')
$$, '22023', 'Every piece of a campaign goes in a workstream: choose one for "Loose 2".',
  'a piece added on the campaign page with no workstream is refused too');

select lives_ok($$
  select app.write_campaign_content('aaaaaaaa-0000-0000-0000-000000001881', '{"kind":"single_job","languages":["ar","en","ku"]}'::jsonb,
    now() + interval '30 days', '[{"name":"Job piece","ownerUserId":"00000000-0000-0000-0000-00000000a001","dueAt":"2027-03-11T15:00:00Z"}]'::jsonb)
$$, 'a single job''s piece needs no workstream');
select is((select languages from campaigns where id = 'aaaaaaaa-0000-0000-0000-000000001881'), array['ar','en','ku'],
  'the languages are written, in the order chosen');

-- ------------------------------------------------------- the translation task ----
insert into workflow_templates (id, tenant_id, code, name_en, is_system) values
  ('aaaaaaaa-0000-0000-0000-000000188f01','aaaaaaaa-0000-0000-0000-000000000001', 'WF-188','Test 188', false);
insert into workflow_steps (id, tenant_id, template_id, sort_order, title_en, repeats_per_unit) values
  ('aaaaaaaa-0000-0000-0000-000000188a01','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000188f01', 1, 'Creative Direction', false),
  ('aaaaaaaa-0000-0000-0000-000000188a02','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000188f01', 2, 'Write Copy', false),
  ('aaaaaaaa-0000-0000-0000-000000188a03','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000188f01', 3, 'Create Artwork', false);

select app.materialise_deliverable_workflow(
  (select d.id from deliverables d join streams s on s.id = d.stream_id
    where s.campaign_id = 'aaaaaaaa-0000-0000-0000-000000001881'),
  'aaaaaaaa-0000-0000-0000-000000188f01');

select is((select count(*)::int from sub_tasks st join deliverables d on d.id = st.deliverable_id join streams s on s.id = d.stream_id
            where s.campaign_id = 'aaaaaaaa-0000-0000-0000-000000001881' and st.title like 'Translation — %'),
  1, 'one translation task, not one per language');
select is((select st.title from sub_tasks st join deliverables d on d.id = st.deliverable_id join streams s on s.id = d.stream_id
            where s.campaign_id = 'aaaaaaaa-0000-0000-0000-000000001881' and st.title like 'Translation — %'),
  'Translation — Job 188 (Arabic, English, Kurdish)', 'it names the single job (ADR-0071 addendum, 4 Oct) and every language, in the order chosen');
select is((select array_agg(split_part(st.title, ' — ', 1) order by st.sort_order)
             from sub_tasks st join deliverables d on d.id = st.deliverable_id join streams s on s.id = d.stream_id
            where s.campaign_id = 'aaaaaaaa-0000-0000-0000-000000001881'),
  array['Creative Direction','Write Copy','Translation','Create Artwork'],
  'it sits straight after Write Copy; the later steps moved down one');

select is(app.materialise_deliverable_workflow(
  (select d.id from deliverables d join streams s on s.id = d.stream_id
    where s.campaign_id = 'aaaaaaaa-0000-0000-0000-000000001881'),
  'aaaaaaaa-0000-0000-0000-000000188f01'), 0, 'run again: nothing more is made');
select is((select count(*)::int from sub_tasks st join deliverables d on d.id = st.deliverable_id join streams s on s.id = d.stream_id
            where s.campaign_id = 'aaaaaaaa-0000-0000-0000-000000001881' and st.title like 'Translation — %'),
  1, 'and there is still one translation task');

select * from finish();
rollback;
