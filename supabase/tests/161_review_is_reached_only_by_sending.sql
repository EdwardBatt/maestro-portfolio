-- I59.20 (ADR-0106 d.4) — review is reached only through app.sub_task_submit.
--
-- The door this closes: `sub_tasks_manage_update` lets the assignee UPDATE their own row, status
-- included, so a direct PATCH put an unstarted task in review. The guard refuses every write INTO
-- review that app.sub_task_submit did not open, for every caller; every way OUT of review (approve,
-- send back, cancel) and every other status move is untouched.
begin;
select plan(14);
\ir helpers/seed.sql

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f161','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S161');
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d1610','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f161',
   'Door 161','in_progress','00000000-0000-0000-0000-00000000a001');
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-00000000e001');
insert into sub_tasks (id, tenant_id, deliverable_id, title, assignee_id, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000016b1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1610','Back door','00000000-0000-0000-0000-00000000a003','todo', 2),
  ('aaaaaaaa-0000-0000-0000-0000000016b2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1610','Front door','00000000-0000-0000-0000-00000000a003','todo', 2),
  ('aaaaaaaa-0000-0000-0000-0000000016b3','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1610','Sent back','00000000-0000-0000-0000-00000000a003','todo', 2);
insert into media_records (id, tenant_id, deliverable_id, sub_task_id, object_key, content_type)
select ('aaaaaaaa-0000-0000-0000-0000000016c' || right(st.id::text, 1))::uuid,
       'aaaaaaaa-0000-0000-0000-000000000001', st.deliverable_id, st.id, 'k/' || st.id || '.png', 'image/png'
  from sub_tasks st where st.id::text like 'aaaaaaaa-0000-0000-0000-0000000016b%';

set local role authenticated;

-- ================================================ the door, for every caller ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select throws_ok($$ update sub_tasks set status = 'review' where id = 'aaaaaaaa-0000-0000-0000-0000000016b1' $$,
  '42501', null, 'the assignee cannot PATCH their todo task into review');
select lives_ok($$ select app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000016b1') $$, 'started');
select throws_ok($$ update sub_tasks set status = 'review' where id = 'aaaaaaaa-0000-0000-0000-0000000016b1' $$,
  '42501', null, '…nor their in-progress task');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select throws_ok($$ update sub_tasks set status = 'review' where id = 'aaaaaaaa-0000-0000-0000-0000000016b1' $$,
  '42501', null, 'a power admin (project_tasks:manage) cannot either');

reset role;
select throws_ok($$ update sub_tasks set status = 'review' where id = 'aaaaaaaa-0000-0000-0000-0000000016b1' $$,
  '42501', null, 'nor a session with no user at all');
set local role authenticated;

-- ========================================================== the front door ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select lives_ok($$ select app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000016b2') $$, 'the other task started');
reset role;
update task_time_entries set started_at = now() - interval '1 hour'
 where sub_task_id in ('aaaaaaaa-0000-0000-0000-0000000016b1','aaaaaaaa-0000-0000-0000-0000000016b2');
set local role authenticated;
select lives_ok($$ select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000016b2') $$,
  'sending it through app.sub_task_submit reaches review');
select is(coalesce(current_setting('app.submitting', true), ''), '',
  'and the flag is lowered again the moment it has been used');
select throws_ok($$ update sub_tasks set status = 'review' where id = 'aaaaaaaa-0000-0000-0000-0000000016b1' $$,
  '42501', null, 'so a PATCH later in the same transaction is still refused');
select lives_ok($$ select public.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000016b1') $$,
  'the public wrapper is the same door');

-- ============================================== the ways out are untouched ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select lives_ok($$ select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000016b2') $$,
  'the reviewer approves: review → done');
insert into review_feedback (tenant_id, media_record_id, source, body, author_user_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000016c1','internal',
   'The headline is cut off.','00000000-0000-0000-0000-00000000a001');
select lives_ok($$ select app.sub_task_request_changes('aaaaaaaa-0000-0000-0000-0000000016b1') $$,
  'the reviewer sends one back: review → todo');
select is((select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000016b1'), 'todo',
  'the sent-back task is todo, round 2');
select lives_ok($$ update sub_tasks set status = 'cancelled' where id = 'aaaaaaaa-0000-0000-0000-0000000016b3' $$,
  'other status writes a manager may make are not the guard''s business');

select * from finish();
rollback;
