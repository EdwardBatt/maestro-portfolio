-- I49.66: editing a task outside the caller's reach is refused as one, naming the deliverable's
-- owner — never reported as "not found" to a person who can see the row.
--
-- Subjects: a020 = Creative Lead (owns the deliverable), a023 = Production Lead (another
-- department: can SEE the task, may not change it).

begin;
select plan(6);
\ir helpers/seed.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a020', 'creative-lead@a.test'),
  ('00000000-0000-0000-0000-00000000a023', 'production-lead@a.test');
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000de001','aaaaaaaa-0000-0000-0000-000000000001','Creative'),
  ('aaaaaaaa-0000-0000-0000-0000000de002','aaaaaaaa-0000-0000-0000-000000000001','Production');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = 'department_lead'),
       v.dept::uuid
from (values
  ('00000000-0000-0000-0000-00000000a020','Creative Lead',   'aaaaaaaa-0000-0000-0000-0000000de001'),
  ('00000000-0000-0000-0000-00000000a023','Production Lead', 'aaaaaaaa-0000-0000-0000-0000000de002')
) as v(id, name, dept);
insert into test_claims
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id in ('00000000-0000-0000-0000-00000000a020','00000000-0000-0000-0000-00000000a023');

-- A Creative deliverable owned by the Creative lead, with one task; a second deliverable with
-- no owner, with one task.
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000122f1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','S122');
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000122e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000122f1','Key visual 122','draft',
   '00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-00000000a020'),
  ('aaaaaaaa-0000-0000-0000-0000000122e2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000122f1','Unowned 122','draft',
   '00000000-0000-0000-0000-00000000a001', null);
update deliverables set department_id = 'aaaaaaaa-0000-0000-0000-0000000de001'
 where id = 'aaaaaaaa-0000-0000-0000-0000000122e2';
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000122a1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000122e1','Owned task','todo','aaaaaaaa-0000-0000-0000-0000000de001'),
  ('aaaaaaaa-0000-0000-0000-0000000122a2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000122e2','Unowned task','todo','aaaaaaaa-0000-0000-0000-0000000de001');

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a023'), true);

-- The outsider can see the task — which is what made "not found" a lie.
select is(
  (select count(*)::int from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000122a1'),
  1, 'the Production lead can see the Creative task');

-- THE assertion: a refusal, in words, with the owner's name — not P0002.
select throws_ok(
  $$select public.save_sub_task('aaaaaaaa-0000-0000-0000-0000000122a1',
      'aaaaaaaa-0000-0000-0000-0000000122e1', 'Renamed by an outsider', null)$$,
  '42501', 'you do not have the rights to edit this task',
  'editing it is refused as a refusal, not "not found"');

-- The DETAIL carries the owner and the HINT says there is one (read via a savepoint, the way
-- 119 reads approve_campaign's).
do $$
declare v_detail text; v_hint text;
begin
  begin
    perform public.save_sub_task('aaaaaaaa-0000-0000-0000-0000000122a1',
      'aaaaaaaa-0000-0000-0000-0000000122e1', 'Renamed by an outsider', null);
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail, v_hint = pg_exception_hint;
    perform set_config('test.detail', v_detail, true);
    perform set_config('test.hint', v_hint, true);
  end;
end $$;
select is(current_setting('test.detail', true), 'Creative Lead', 'the refusal names the deliverable''s owner');
select is(current_setting('test.hint', true), 'deliverable_owner', 'and says there is one');

-- No owner: still a refusal, and the hint says so.
do $$
declare v_hint text;
begin
  begin
    perform public.save_sub_task('aaaaaaaa-0000-0000-0000-0000000122a2',
      'aaaaaaaa-0000-0000-0000-0000000122e2', 'Renamed by an outsider', null);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    perform set_config('test.hint2', v_hint, true);
  end;
end $$;
select is(current_setting('test.hint2', true), 'no_owner', 'a deliverable with no owner is refused with the hint saying so');

-- A task that is not there at all is still "not found".
select throws_ok(
  $$select public.save_sub_task('aaaaaaaa-0000-0000-0000-000000012299',
      'aaaaaaaa-0000-0000-0000-0000000122e1', 'Ghost', null)$$,
  'P0002', null, 'a task that does not exist is still not found');

select finish();
rollback;
