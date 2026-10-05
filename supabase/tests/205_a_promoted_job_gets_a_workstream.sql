-- I68.16 (Edward, 30 Sep, A): promoting a single job puts its pieces into a workstream per department, named after the
-- department and owned by the piece's owner (a lead), so the campaign it becomes can take "Propose more" at once
-- (ADR-0116 d.3: every campaign piece is in a workstream). The piece's code is kept. A second promotion is still
-- refused. And the backfill's function groups an already-promoted campaign's ungrouped pieces the same way.
begin;
select plan(11);
\ir helpers/seed.sql

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de2051', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 205'),
  ('aaaaaaaa-0000-0000-0000-000000de2052', 'aaaaaaaa-0000-0000-0000-000000000001', 'Content 205');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a2a0', 'am205@a.test'),
  ('00000000-0000-0000-0000-00000000a2a1', 'lead205@a.test'),
  ('00000000-0000-0000-0000-00000000a2a2', 'copylead205@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid
from (values
  ('00000000-0000-0000-0000-00000000a2a0','AM 205',        'account_manager', null),
  ('00000000-0000-0000-0000-00000000a2a1','Lead 205',      'department_lead', 'aaaaaaaa-0000-0000-0000-000000de2051'),
  ('00000000-0000-0000-0000-00000000a2a2','Copy lead 205', 'team_lead',       'aaaaaaaa-0000-0000-0000-000000de2052')
) as v(id, name, role_key, dept);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id = '00000000-0000-0000-0000-00000000a2a0';

-- A released single job with two pieces in two departments (a piece's department follows its owner, ADR-0102).
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id, brief) values
  ('aaaaaaaa-0000-0000-0000-000000002050','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Posts 205','approved','single_job','00000000-0000-0000-0000-00000000a2a0',
   '{"kind":"single_job","request":{"askedBy":"Client 205","source":"email","words":"Three posts"}}'::jsonb);
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f205','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000002050','Posts 205');
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d2051','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f205',
   'Static Post','draft', now() + interval '10 days', '00000000-0000-0000-0000-00000000a2a1'),
  ('aaaaaaaa-0000-0000-0000-0000000d2052','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f205',
   'Caption copy','draft', now() + interval '10 days', '00000000-0000-0000-0000-00000000a2a2');

create temp table codes_before as select id, code from deliverables where stream_id = 'aaaaaaaa-0000-0000-0000-00000000f205';
grant select on codes_before to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a2a0'),true);

select is((select count(*)::int from workstreams where campaign_id = 'aaaaaaaa-0000-0000-0000-000000002050'), 0,
  'a single job has no workstream');
select lives_ok($$ select public.promote_single_job('aaaaaaaa-0000-0000-0000-000000002050') $$, 'the account manager promotes the job');

select is((select count(*)::int from workstreams where campaign_id = 'aaaaaaaa-0000-0000-0000-000000002050'), 2,
  'one workstream per department its pieces are in');
select results_eq($$
  select w.name, w.department_id, w.owner_user_id from workstreams w
   where w.campaign_id = 'aaaaaaaa-0000-0000-0000-000000002050' order by w.name
$$, $$ values
  ('Content 205'::text,  'aaaaaaaa-0000-0000-0000-000000de2052'::uuid, '00000000-0000-0000-0000-00000000a2a2'::uuid),
  ('Creative 205'::text, 'aaaaaaaa-0000-0000-0000-000000de2051'::uuid, '00000000-0000-0000-0000-00000000a2a1'::uuid) $$,
  'each is named after its department and owned by its piece''s owner (a lead)');
select is(
  (select count(*)::int from deliverables d join workstreams w on w.id = d.workstream_id
    where d.stream_id = 'aaaaaaaa-0000-0000-0000-00000000f205' and w.department_id = d.department_id), 2,
  'every piece is in its own department''s workstream');
select is(
  (select count(*)::int from deliverables d join codes_before b on b.id = d.id where d.code is distinct from b.code), 0,
  'the pieces keep their codes');
select ok(
  (select bool_and(coalesce(code_letters, '') <> '') from workstreams where campaign_id = 'aaaaaaaa-0000-0000-0000-000000002050'),
  'the workstreams have their letters from the existing rule');
select throws_ok($$ select public.promote_single_job('aaaaaaaa-0000-0000-0000-000000002050') $$, '22023', null,
  'a second press is still refused — it is a campaign now');

-- The backfill's function, on a campaign promoted before this existed: ungrouped, with the request still on its brief.
reset role;
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id, brief) values
  ('aaaaaaaa-0000-0000-0000-000000002059','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Old promotion 205','approved','campaign','00000000-0000-0000-0000-00000000a2a0',
   '{"request":{"askedBy":"Client 205","source":"email","words":"One banner"}}'::jsonb);
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f259','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000002059','Old promotion 205');
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d2059','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f259',
   'Banner','draft', now() + interval '10 days', '00000000-0000-0000-0000-00000000a2a1');

select is(app.group_promoted_job('aaaaaaaa-0000-0000-0000-000000002059', 'aaaaaaaa-0000-0000-0000-000000000001'), 1,
  'the backfill makes one workstream for an old promotion''s ungrouped piece');
select isnt((select workstream_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d2059'), null,
  'and puts the piece in it');
select is(app.group_promoted_job('aaaaaaaa-0000-0000-0000-000000002059', 'aaaaaaaa-0000-0000-0000-000000000001'), 0,
  'run again, it makes nothing — nothing is left ungrouped');

select * from finish();
rollback;
