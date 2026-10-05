-- I59 / ADR-0105 d.2 — "New on you" is seen on the server (20260926150000):
--   * a new task is unseen, whatever its payload says;
--   * only its assignee is seen opening it (public.mark_task_seen), once; anybody else is refused;
--   * the column cannot be written, nor un-written, by a direct UPDATE — by anyone;
--   * handing the task to somebody else makes it new to them; the old assignee reaches nothing;
--   * another tenant finds no such task; anon cannot call it.
--
-- a001 Admin A · a003 Creative A — the assignee · a181 Other 180 and a182 Next 180 — team members.
begin;
select plan(14);
\ir helpers/seed.sql

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000a181', 'other180@a.test'),
                                          ('00000000-0000-0000-0000-00000000a182', 'next180@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'team_member')
  from (values ('00000000-0000-0000-0000-00000000a181', 'Other 180'), ('00000000-0000-0000-0000-00000000a182', 'Next 180')) as v(id, name);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id in ('00000000-0000-0000-0000-00000000a181', '00000000-0000-0000-0000-00000000a182');

insert into deliverables (id, tenant_id, job_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000d1801', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f001', 'Banner 180');
-- The payload claims it was seen already: an insert never carries that.
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order, assignee_id, sla_hours, assignee_seen_at) values
  ('aaaaaaaa-0000-0000-0000-0000000f1801', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1801',
   'Design 180', 'todo', 1, '00000000-0000-0000-0000-00000000a003', 8, now());

select is((select assignee_seen_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000f1801'), null::timestamptz,
  'a new task is unseen, whatever the insert said');

-- ---------------------------------------------------------------- who is seen ----
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a181'), true);
select throws_ok($$ select public.mark_task_seen('aaaaaaaa-0000-0000-0000-0000000f1801') $$,
  '42501', 'only the person the task is given to is seen opening it',
  'somebody not on the task cannot mark it seen');
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select throws_ok($$ select public.mark_task_seen('aaaaaaaa-0000-0000-0000-0000000f1801') $$,
  '42501', null, 'nor can an admin — seen is the assignee''s act');

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select lives_ok($$ select public.mark_task_seen('aaaaaaaa-0000-0000-0000-0000000f1801') $$,
  'the assignee opening the task marks it seen');
reset role;
select ok((select assignee_seen_at is not null from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000f1801'),
  'and the time is recorded');
update sub_tasks set title = 'Design 180 (renamed)' where id = 'aaaaaaaa-0000-0000-0000-0000000f1801';
select ok((select assignee_seen_at is not null from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000f1801'),
  'an unrelated edit leaves it seen');

create temp table seen180 as select assignee_seen_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000f1801';
grant select on seen180 to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select lives_ok($$ select public.mark_task_seen('aaaaaaaa-0000-0000-0000-0000000f1801') $$,
  'opening it again is not an error');
reset role;
select is((select assignee_seen_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000f1801'),
  (select assignee_seen_at from seen180), 'and the first time stays the one recorded');

-- ---------------------------------------------------------------- it cannot be faked ----
select throws_ok($$ update sub_tasks set assignee_seen_at = null where id = 'aaaaaaaa-0000-0000-0000-0000000f1801' $$,
  '42501', 'whether a task has been seen is recorded by opening it',
  'a direct UPDATE cannot un-see it — not even the table owner');
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select throws_ok($$ update sub_tasks set assignee_seen_at = now() - interval '1 day' where id = 'aaaaaaaa-0000-0000-0000-0000000f1801' $$,
  '42501', null, 'nor rewrite when — a client PATCH is refused');

-- ---------------------------------------------------------------- handed on ----
reset role;
update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a182' where id = 'aaaaaaaa-0000-0000-0000-0000000f1801';
select is((select assignee_seen_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000f1801'), null::timestamptz,
  'handed to somebody else, it is new to them');
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select throws_ok($$ select public.mark_task_seen('aaaaaaaa-0000-0000-0000-0000000f1801') $$,
  '42501', null, 'the former assignee is no longer the one seen');

-- ---------------------------------------------------------------- other tenants, anon ----
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000b001'), true);
select throws_ok($$ select public.mark_task_seen('aaaaaaaa-0000-0000-0000-0000000f1801') $$,
  'P0002', null, 'Tenant B finds no such task');
reset role;
select ok(not has_function_privilege('anon', 'public.mark_task_seen(uuid)', 'execute'),
  'anon cannot call it');

select * from finish();
rollback;
