-- I56.4 / ADR-0101 d.8 (Edward, 24 Sep) — a workstream's owner is a department lead, a team lead or
-- a deputy team lead; reassignment is allowed; clearing is allowed; nobody else can be made owner —
-- through the workstream RPC or by a direct write.

begin;
select plan(8);
\ir helpers/seed.sql

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de1540', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 154');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000007e154', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000de1540', 'Design 154');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a540', 'am154@a.test'),
  ('00000000-0000-0000-0000-00000000a541', 'deptlead154@a.test'),
  ('00000000-0000-0000-0000-00000000a542', 'teamlead154@a.test'),
  ('00000000-0000-0000-0000-00000000a543', 'deputy154@a.test'),
  ('00000000-0000-0000-0000-00000000a544', 'maker154@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid, v.team::uuid
from (values
  ('00000000-0000-0000-0000-00000000a540','AM 154',        'account_manager',  null, null),
  ('00000000-0000-0000-0000-00000000a541','Dept lead 154', 'department_lead',  'aaaaaaaa-0000-0000-0000-000000de1540', null),
  ('00000000-0000-0000-0000-00000000a542','Team lead 154', 'team_lead',        'aaaaaaaa-0000-0000-0000-000000de1540', 'aaaaaaaa-0000-0000-0000-00000007e154'),
  ('00000000-0000-0000-0000-00000000a543','Deputy 154',    'deputy_team_lead', 'aaaaaaaa-0000-0000-0000-000000de1540', 'aaaaaaaa-0000-0000-0000-00000007e154'),
  ('00000000-0000-0000-0000-00000000a544','Maker 154',     'team_member',      'aaaaaaaa-0000-0000-0000-000000de1540', 'aaaaaaaa-0000-0000-0000-00000007e154')
) as v(id, name, role_key, dept, team);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id = '00000000-0000-0000-0000-00000000a540';

insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-000000001540','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Season 154','approved','campaign','00000000-0000-0000-0000-00000000a540');

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a540'),true);

select lives_ok($$
  select public.save_workstream('aaaaaaaa-0000-0000-0000-000000001540', 'Launch visuals',
    'aaaaaaaa-0000-0000-0000-000000de1540', '00000000-0000-0000-0000-00000000a541')
$$, 'a department lead can own a workstream');

select lives_ok($$
  select public.save_workstream('aaaaaaaa-0000-0000-0000-000000001540', 'Launch visuals',
    'aaaaaaaa-0000-0000-0000-000000de1540', '00000000-0000-0000-0000-00000000a542',
    (select id from workstreams where name = 'Launch visuals'))
$$, 'reassigned to a team lead — reassignment is allowed');

select lives_ok($$
  select public.save_workstream('aaaaaaaa-0000-0000-0000-000000001540', 'Launch visuals',
    'aaaaaaaa-0000-0000-0000-000000de1540', '00000000-0000-0000-0000-00000000a543',
    (select id from workstreams where name = 'Launch visuals'))
$$, 'and to a deputy team lead');

select throws_ok($$
  select public.save_workstream('aaaaaaaa-0000-0000-0000-000000001540', 'Launch visuals',
    'aaaaaaaa-0000-0000-0000-000000de1540', '00000000-0000-0000-0000-00000000a544',
    (select id from workstreams where name = 'Launch visuals'))
$$, '22023', 'A workstream''s owner must be a department lead, a team lead or a deputy team lead.',
  'a team member cannot be made owner, and is told who can');

select throws_ok($$
  select public.save_workstream('aaaaaaaa-0000-0000-0000-000000001540', 'Mine',
    'aaaaaaaa-0000-0000-0000-000000de1540', '00000000-0000-0000-0000-00000000a540')
$$, '22023', 'A workstream''s owner must be a department lead, a team lead or a deputy team lead.',
  'nor can the account manager — owning the campaign is not owning a workstream');

select lives_ok($$
  select public.save_workstream('aaaaaaaa-0000-0000-0000-000000001540', 'Launch visuals',
    'aaaaaaaa-0000-0000-0000-000000de1540', null,
    (select id from workstreams where name = 'Launch visuals'))
$$, 'clearing the owner is always allowed (ADR-0099 d.5)');

-- The rule lives on the table, not in the RPC: a direct write is refused too.
reset role;
select throws_ok($$
  update workstreams set owner_user_id = '00000000-0000-0000-0000-00000000a544' where name = 'Launch visuals'
$$, '22023', null, 'a direct write cannot make a team member owner either');

-- A workstream saved before the rule keeps its owner until somebody changes it.
alter table workstreams disable trigger workstream_owner_is_a_lead;
update workstreams set owner_user_id = '00000000-0000-0000-0000-00000000a544' where name = 'Launch visuals';
alter table workstreams enable trigger workstream_owner_is_a_lead;
select lives_ok($$
  update workstreams set name = 'Launch visuals, renamed' where name = 'Launch visuals'
$$, 'an older, ineligible owner survives a rename — the rule applies when an owner is set');

select * from finish();
rollback;
