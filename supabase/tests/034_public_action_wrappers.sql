-- Frontend bridge: the public wrappers must forward to the app functions AND carry the caller's
-- identity so the app fn's auth.uid() checks still bite (the UI calls these via supabase.rpc()).
begin;
select plan(5);
\ir helpers/seed.sql

insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000034a1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f101','00000000-0000-0000-0000-00000000a003','W1','todo', 8),
  ('aaaaaaaa-0000-0000-0000-0000000034a2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f101','00000000-0000-0000-0000-00000000a003','W2','todo', 8);

set local role authenticated;

-- the assignee (a003) starts their task through the PUBLIC wrapper
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select lives_ok($$ select public.sub_task_start('aaaaaaaa-0000-0000-0000-0000000034a1') $$,
  'the assignee starts a task through the public wrapper');
select is((select status from sub_tasks where id='aaaaaaaa-0000-0000-0000-0000000034a1'), 'in_progress',
  'the wrapper forwarded to app.sub_task_start — the task is in_progress');

-- a non-assignee (a002) is refused by the underlying app fn, through the wrapper
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select throws_ok($$ select public.sub_task_start('aaaaaaaa-0000-0000-0000-0000000034a2') $$,
  '42501', null, 'a non-assignee is refused through the wrapper (auth.uid carries through)');

-- the attendance heartbeat wrapper checks the caller in for the day
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select lives_ok($$ select public.attendance_heartbeat() $$, 'the attendance heartbeat wrapper runs');
select is((select count(*)::int from attendance_days where user_id='00000000-0000-0000-0000-00000000a003' and work_date=current_date), 1,
  'the heartbeat created the caller''s attendance day');

select * from finish();
rollback;
