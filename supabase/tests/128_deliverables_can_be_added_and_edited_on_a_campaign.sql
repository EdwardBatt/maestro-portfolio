-- I52.20 / I52.21 (17 Sep) — a deliverable can be added to an existing campaign, and edited.
--
--   * ADD — MAY: the campaign's account manager (and tenant-wide reach). MAY NOT: a department lead
--     (42501, worded). The new row sits under the campaign's stream, the owner stamps its
--     department, and a TYPE materialises its task list at once.
--   * EDIT — setting a type on an untyped deliverable materialises its tasks (the production case:
--     deliverables born without a type, no task list ever). Changing the type again while tasks are
--     live is refused in words. A lead of another department is refused; a blank name is refused.
begin;
select plan(13);
\ir helpers/seed.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a070', 'am@a.test'),
  ('00000000-0000-0000-0000-00000000a071', 'creative-lead@a.test'),
  ('00000000-0000-0000-0000-00000000a072', 'media-lead@a.test');
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de1280','aaaaaaaa-0000-0000-0000-000000000001','Creative'),
  ('aaaaaaaa-0000-0000-0000-000000de1281','aaaaaaaa-0000-0000-0000-000000000001','Media');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid
from (values
  ('00000000-0000-0000-0000-00000000a070','The AM',        'account_manager', null),
  ('00000000-0000-0000-0000-00000000a071','Creative Lead', 'department_lead','aaaaaaaa-0000-0000-0000-000000de1280'),
  ('00000000-0000-0000-0000-00000000a072','Media Lead',    'department_lead','aaaaaaaa-0000-0000-0000-000000de1281')
) as v(id, name, role_key, dept);
insert into test_claims (id, jwt)
select up.id,
       json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id in ('00000000-0000-0000-0000-00000000a070','00000000-0000-0000-0000-00000000a071','00000000-0000-0000-0000-00000000a072');

-- An approved campaign the AM manages, with a stream and one UNTYPED deliverable (the production shape).
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-000000001280','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Campaign 128','approved','campaign','00000000-0000-0000-0000-00000000a070');
-- ADR-0116 d.3 (27 Sep): a campaign's pieces are added into a workstream.
insert into workstreams (tenant_id, campaign_id, name, department_id)
select tenant_id, id, 'Main work', 'aaaaaaaa-0000-0000-0000-0000000de0ff' from campaigns
 where id in ('aaaaaaaa-0000-0000-0000-000000001280');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000001281','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001280','Campaign 128');
insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-000000001282','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001281',
   'Untyped','draft','00000000-0000-0000-0000-00000000a071','00000000-0000-0000-0000-00000000a001');
-- The catalogue and the workflow templates, seeded as 065 seeds them; DIG-003 gets WF-01.
select app.seed_tenant_deliverable_taxonomy(id) from tenants;
select app.seed_tenant_workflow_templates(id) from tenants;
update deliverable_types set default_workflow_template_id =
  (select id from workflow_templates where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and code = 'WF-01')
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and code = 'DIG-003';

-- The catalogue is read as superuser and pinned here: RLS on deliverable_types would hide it from
-- the subselects below and quietly pass a NULL type.
create temp table t128 as
  select (select id from deliverable_types where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and code = 'DIG-003') as typed,
         (select id from deliverable_types where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and code = 'DIG-001') as other;
grant select on t128 to authenticated;

set local role authenticated;

-- ================================================================ ADD ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a071'),true);
select throws_ok($$
  select public.add_campaign_deliverable('aaaaaaaa-0000-0000-0000-000000001280', 'Key visual', '00000000-0000-0000-0000-00000000a071', null, 1, '2026-10-01 15:00+00')
$$, '42501', null, 'a department lead may not add a deliverable — the list is the campaign''s shape, the AM''s to decide');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a070'),true);
select throws_ok($$
  select public.add_campaign_deliverable('aaaaaaaa-0000-0000-0000-000000001280', '   ', '00000000-0000-0000-0000-00000000a071', null, 1, '2026-10-01 15:00+00')
$$, '22023', null, 'a blank name is refused');

select lives_ok($$
  select public.add_campaign_deliverable('aaaaaaaa-0000-0000-0000-000000001280', 'Key visual', '00000000-0000-0000-0000-00000000a071',
    (select typed from t128), 1, '2026-10-01 15:00+00', p_workstream => (select id from workstreams where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001280' limit 1))
$$, 'the account manager adds a typed deliverable');
reset role;
select results_eq($$
  select stream_id, department_id, owner_user_id, state::text from deliverables
   where name = 'Key visual' and tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
$$, $$ values ('aaaaaaaa-0000-0000-0000-000000001281'::uuid, 'aaaaaaaa-0000-0000-0000-000000de1280'::uuid,
              '00000000-0000-0000-0000-00000000a071'::uuid, 'draft') $$,
  'under the campaign''s stream, the department stamped from the owner, draft');
select cmp_ok((select count(*)::int from sub_tasks t join deliverables d on d.id = t.deliverable_id where d.name = 'Key visual'),
  '>', 0, 'and its type materialised a task list at once (ADR-0052)');

-- ================================================================ EDIT ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a072'),true);
select throws_ok($$
  select public.update_campaign_deliverable('aaaaaaaa-0000-0000-0000-000000001282', 'Sneaky', null, 1)
$$, '42501', null, 'a lead of ANOTHER department may not edit it');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a071'),true);
select is((select count(*)::int from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-000000001282'), 0,
  'the untyped deliverable has no tasks — the production case');
-- ADR-0141 d.1 (3 Oct): on a live campaign the owner asks; the account manager changes it.
select throws_ok($$
  select public.update_campaign_deliverable('aaaaaaaa-0000-0000-0000-000000001282', 'Social statics',
    (select typed from t128), 3)
$$, '42501', null, 'ADR-0141 d.1: its owner no longer edits a live piece — she asks the account manager');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a070'),true);
select lives_ok($$
  select public.update_campaign_deliverable('aaaaaaaa-0000-0000-0000-000000001282', 'Social statics',
    (select typed from t128), 3)
$$, 'the account manager names it, gives it a type and a quantity');
reset role;
select results_eq($$
  select name, quantity, deliverable_type_id is not null from deliverables where id = 'aaaaaaaa-0000-0000-0000-000000001282'
$$, $$ values ('Social statics', 3, true) $$, 'saved');
select cmp_ok((select count(*)::int from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-000000001282'),
  '>', 0, 'and setting the type materialised its task list — what was missing on production');

-- Changing the type again while tasks are live: refused in words (a second list would land on the first).
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a070'),true);
select throws_ok($$
  select public.update_campaign_deliverable('aaaaaaaa-0000-0000-0000-000000001282', 'Social statics',
    (select other from t128), 3)
$$, '22023', null, 'changing the type while its tasks are live is refused — cancel them first (ADR-0052 d.6)');
select throws_ok($$
  select public.update_campaign_deliverable('aaaaaaaa-0000-0000-0000-000000001282', '', null, 1)
$$, '22023', null, 'a blank name is refused');

select * from finish();
rollback;
