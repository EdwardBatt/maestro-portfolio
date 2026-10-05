-- I48.42: a new task with no department named takes its deliverable's, so the deliverable's owner
-- can add to their own task list.
--
-- The production failure, reproduced: the owner (a department lead) adds an UNASSIGNED task through
-- `save_sub_task`, which used to write a null department; `sub_tasks_manage_insert` then asked
-- in_write_scope(null, null, AM) and the department branch cannot say yes to a null. Now the row
-- carries the deliverable's department and the owner passes — a department lead and a team lead of
-- that department alike. A lead of ANOTHER department is still refused (the fence is intact), and a
-- named department (the assignee's) still wins over the default.
--
-- Subjects: a020 = Creative Lead (department scope, the owner), a021 = Copy Lead (team scope, a team
-- in Creative), a023 = Production Lead (another department), a022 = Copy Maker (an assignee).

begin;
select plan(8);
\ir helpers/seed.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a020', 'creative-lead@a.test'),
  ('00000000-0000-0000-0000-00000000a021', 'copy-lead@a.test'),
  ('00000000-0000-0000-0000-00000000a022', 'copy-maker@a.test'),
  ('00000000-0000-0000-0000-00000000a023', 'production-lead@a.test');
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000de001','aaaaaaaa-0000-0000-0000-000000000001','Creative'),
  ('aaaaaaaa-0000-0000-0000-0000000de002','aaaaaaaa-0000-0000-0000-000000000001','Production');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f001','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000de001','Copy');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid, v.team::uuid
from (values
  ('00000000-0000-0000-0000-00000000a020','Creative Lead',   'department_lead','aaaaaaaa-0000-0000-0000-0000000de001', null),
  ('00000000-0000-0000-0000-00000000a021','Copy Lead',       'team_lead',      'aaaaaaaa-0000-0000-0000-0000000de001','aaaaaaaa-0000-0000-0000-00000000f001'),
  ('00000000-0000-0000-0000-00000000a022','Copy Maker',      'team_member',    'aaaaaaaa-0000-0000-0000-0000000de001','aaaaaaaa-0000-0000-0000-00000000f001'),
  ('00000000-0000-0000-0000-00000000a023','Production Lead', 'department_lead','aaaaaaaa-0000-0000-0000-0000000de002', null)
) as v(id, name, role_key, dept, team);
insert into test_claims
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id in ('00000000-0000-0000-0000-00000000a020','00000000-0000-0000-0000-00000000a021',
                 '00000000-0000-0000-0000-00000000a022','00000000-0000-0000-0000-00000000a023');

-- A Creative deliverable owned by the Creative lead; the department is stamped from the owner.
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000120f1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','S120');
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000120e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000120f1','Key visual 120','draft',
   '00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-00000000a020');
select is(
  (select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000120e1'),
  'aaaaaaaa-0000-0000-0000-0000000de001'::uuid, 'fixture: the deliverable sits in Creative');

-- ======================================= 1-3. the owner adds an unassigned task ====
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a020'), true);

select lives_ok(
  $$select public.save_sub_task(null, 'aaaaaaaa-0000-0000-0000-0000000120e1', 'Write the rationale', '[]'::jsonb)$$,
  'the owner (department lead) adds an unassigned task to their own list — the production refusal');

select is(
  (select department_id from sub_tasks
    where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000120e1' and title = 'Write the rationale'),
  'aaaaaaaa-0000-0000-0000-0000000de001'::uuid,
  'the task carries its deliverable''s department, as a materialised one would');

-- A team lead of a team IN that department is an owner too (ADR-0083 d.12) and passes the same way.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a021'), true);
select lives_ok(
  $$select public.save_sub_task(null, 'aaaaaaaa-0000-0000-0000-0000000120e1', 'Proof the copy', '[]'::jsonb)$$,
  'a team lead of that department adds one too');

-- ============================================= 4. the fence is intact ====
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a023'), true);
select throws_ok(
  $$select public.save_sub_task(null, 'aaaaaaaa-0000-0000-0000-0000000120e1', 'Not mine', '[]'::jsonb)$$,
  '42501', null,
  'a lead of ANOTHER department is still refused — the default widens nothing');

-- ============================ 5-6. a named department still wins over the default ====
reset role;
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000de003','aaaaaaaa-0000-0000-0000-000000000001','Strategy');
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select lives_ok(
  $$select public.save_sub_task(null, 'aaaaaaaa-0000-0000-0000-0000000120e1', 'Directed elsewhere', '[]'::jsonb,
                                null, null, 'aaaaaaaa-0000-0000-0000-0000000de003')$$,
  'a task added WITH a department keeps it (the admin, tenant scope)');
select is(
  (select department_id from sub_tasks
    where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000120e1' and title = 'Directed elsewhere'),
  'aaaaaaaa-0000-0000-0000-0000000de003'::uuid,
  'the named department is written, not the deliverable''s');

-- ================================================ 7. an UPDATE is untouched ====
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a020'), true);
select lives_ok(
  $$select public.save_sub_task(
      (select id from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000120e1' and title = 'Write the rationale'),
      'aaaaaaaa-0000-0000-0000-0000000120e1', 'Write the rationale (v2)', null)$$,
  'and the owner edits the task they added');

select * from finish();
rollback;
