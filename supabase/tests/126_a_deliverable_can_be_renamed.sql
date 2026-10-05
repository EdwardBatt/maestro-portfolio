-- I52.13 (17 Sep) — a deliverable can be renamed, by the people whose work it is.
--
--   * ADR-0141 d.1 (3 Oct): on a LIVE campaign only the account manager's side renames (the account manager, the
--     account director, Traffic, the Power Admin). The department lead and the owner, who could since 17 Sep, now ask.
--   * MAY: the Power Admin (the account manager's cover).
--   * MAY NOT: a lead of another department, the department's own lead, the owner (42501, hint ask_account_manager);
--     a blank name (22023).
--   * A plain PATCH is governed exactly as the RPC — the rule is the trigger, not the function.
--   * Task titles composed from the old name FOLLOW the rename (ADR-0071 addendum d.10a, 20 Sep);
--     a hand-edited title, and a unit-numbered one, are handled as the addendum says.
begin;
select plan(11);
\ir helpers/seed.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a050', 'creative-lead@a.test'),
  ('00000000-0000-0000-0000-00000000a051', 'media-lead@a.test'),
  ('00000000-0000-0000-0000-00000000a052', 'copy-lead@a.test');
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de1260','aaaaaaaa-0000-0000-0000-000000000001','Creative'),
  ('aaaaaaaa-0000-0000-0000-000000de1261','aaaaaaaa-0000-0000-0000-000000000001','Media');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid
from (values
  ('00000000-0000-0000-0000-00000000a050','Creative Lead','department_lead','aaaaaaaa-0000-0000-0000-000000de1260'),
  ('00000000-0000-0000-0000-00000000a051','Media Lead',   'department_lead','aaaaaaaa-0000-0000-0000-000000de1261'),
  -- a team lead in Creative who OWNS the deliverable but is not its department lead.
  ('00000000-0000-0000-0000-00000000a052','Copy Lead',    'team_lead',      'aaaaaaaa-0000-0000-0000-000000de1260')
) as v(id, name, role_key, dept);
insert into test_claims (id, jwt)
select up.id,
       json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id in ('00000000-0000-0000-0000-00000000a050','00000000-0000-0000-0000-00000000a051','00000000-0000-0000-0000-00000000a052');

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000001260','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S126');
insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id, department_id, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-000000001262','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001260',
   'Social Advertisement','in_progress','00000000-0000-0000-0000-00000000a052','aaaaaaaa-0000-0000-0000-000000de1260',
   '00000000-0000-0000-0000-00000000a001');
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order, unit_index) values
  ('aaaaaaaa-0000-0000-0000-000000001263','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001262',
   'Creative Direction — Social Advertisement','todo', 1, null),
  ('aaaaaaaa-0000-0000-0000-000000001264','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001262',
   'Create Artwork — Social Advertisement 2','todo', 2, 2),
  ('aaaaaaaa-0000-0000-0000-000000001265','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001262',
   'Chase the client for the logo','todo', 3, null);

set local role authenticated;

-- MAY NOT: the Media lead, out of reach.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a051'),true);
select throws_ok($$
  select public.rename_deliverable('aaaaaaaa-0000-0000-0000-000000001262', 'Hero film')
$$, '42501', null, 'a lead of ANOTHER department may not rename it — refused, worded');

-- MAY NOT, since ADR-0141: the Creative lead, though in reach.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a050'),true);
select throws_ok($$
  select public.rename_deliverable('aaaaaaaa-0000-0000-0000-000000001262', '  Hero film  ')
$$, '42501', null, 'ADR-0141 d.1: the department lead in reach no longer renames a live piece — she asks');

-- MAY: the Power Admin, covering for the account manager.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select lives_ok($$
  select public.rename_deliverable('aaaaaaaa-0000-0000-0000-000000001262', '  Hero film  ')
$$, 'ADR-0141 d.1: the account manager''s side renames it (here the Power Admin)');
select is((select name from deliverables where id = 'aaaaaaaa-0000-0000-0000-000000001262'), 'Hero film',
  'the name is trimmed and saved');
select is((select title from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-000000001263'),
  'Creative Direction — Social Advertisement',
  'ADR-0071 addendum (4 Oct): a rename changes no task title — titles name the campaign and type, not the deliverable');
select is((select title from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-000000001264'),
  'Create Artwork — Social Advertisement 2',
  'nor a unit-numbered one');
select is((select title from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-000000001265'),
  'Chase the client for the logo',
  'a hand-written title that never carried the name is left alone');

-- A blank name is refused.
select throws_ok($$
  select public.rename_deliverable('aaaaaaaa-0000-0000-0000-000000001262', '   ')
$$, '22023', null, 'a blank name is refused');

-- MAY NOT, since ADR-0141: the owner, a team lead who is not the department lead.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a052'),true);
select throws_ok($$
  select public.rename_deliverable('aaaaaaaa-0000-0000-0000-000000001262', 'Hero film v2')
$$, '42501', null, 'ADR-0141 d.1: the deliverable''s OWNER no longer renames a live piece — she asks');

-- A plain PATCH is governed the same way: the Media lead is refused on the column itself.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a051'),true);
select throws_ok($$
  update deliverables set name = 'Sneaky' where id = 'aaaaaaaa-0000-0000-0000-000000001262'
$$, '42501', null, 'a direct UPDATE of the name is refused identically — the trigger is the rule (ADR-0037)');
reset role;
select is((select name from deliverables where id = 'aaaaaaaa-0000-0000-0000-000000001262'), 'Hero film',
  'and the name stands');

select * from finish();
rollback;
