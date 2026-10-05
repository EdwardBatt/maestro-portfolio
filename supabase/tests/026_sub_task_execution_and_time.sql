-- ADR-0030 (I8.1): sub-task Start/Submit lifecycle + time tracking.
-- Proves: only the assignee may act; Start opens a timed session (todo→in_progress); Submit closes
-- it (timer path) → review; submit-without-start (straight from todo) REQUIRES manual minutes and is
-- flagged mode='manual'.
begin;
select plan(13);
\ir helpers/seed.sql

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000056d1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S');
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000056e1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000056d1','KV','in_progress', '00000000-0000-0000-0000-00000000a001');
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000056a1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000056e1','00000000-0000-0000-0000-00000000a003','Retouch','todo', 8),
  ('aaaaaaaa-0000-0000-0000-0000000056a2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000056e1','00000000-0000-0000-0000-00000000a003','Copy','todo', 8);

-- I11.9: submitting for review now requires a version stamped with THIS round, so the fixture
-- attaches one. (A round-1 upload is stamped round 1 by media_record_stamp_round.)
insert into media_records (id, tenant_id, deliverable_id, object_key, content_type) values
  ('aaaaaaaa-0000-0000-0000-0000000056f1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000056e1','k/v1.png','image/png');

set local role authenticated;

-- non-assignee (a002) cannot start a003's task
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select throws_ok($$ select app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000056a1') $$,
  '42501', null, 'only the assignee may start a task');

-- assignee (a003) starts st1 → in_progress + one open timer entry
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select lives_ok($$ select app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000056a1') $$, 'assignee starts their task');
select is((select status from sub_tasks where id='aaaaaaaa-0000-0000-0000-0000000056a1'), 'in_progress', 'task moved to in_progress');
select is((select count(*)::int from task_time_entries where sub_task_id='aaaaaaaa-0000-0000-0000-0000000056a1' and submitted_at is null), 1, 'an open timer entry was created');

-- cannot start again from in_progress
select throws_ok($$ select app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000056a1') $$,
  '22023', null, 'cannot start a task that is not todo');

-- submit st1 (timer path) → review, entry closed with minutes
-- ADR-0106 (I59.20): a round sent under the tenant's threshold after Start is UNTIMED. This suite
-- tests the TIMER path, so the round is given an hour of work before it is sent.
reset role;
update task_time_entries set started_at = now() - interval '1 hour' where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000056a1' and submitted_at is null;
set local role authenticated;
select lives_ok($$ select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000056a1') $$, 'assignee submits (timer path)');
select is((select status from sub_tasks where id='aaaaaaaa-0000-0000-0000-0000000056a1'), 'review', 'task moved to review');
select is((select count(*)::int from task_time_entries where sub_task_id='aaaaaaaa-0000-0000-0000-0000000056a1' and submitted_at is not null and mode='timer'), 1, 'the timer entry was closed');

-- submit-without-start on st2 (still todo): REFUSED, with or without manual minutes (I52.15,
-- Edward 17 Sep — the button only ever offered Submit from in_progress; the function now agrees).
select throws_ok($$ select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000056a2') $$,
  '22023', null, 'submit-without-start is refused');
select throws_ok($$ select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000056a2', 90) $$,
  '22023', null, 'submit-without-start is refused even with manual minutes — start it first');
select lives_ok($$ select app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000056a2') $$, 'started');
-- ADR-0106 (I59.20): a round sent under the tenant's threshold after Start is UNTIMED. This suite
-- tests the TIMER path, so the round is given an hour of work before it is sent.
reset role;
update task_time_entries set started_at = now() - interval '1 hour' where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000056a2' and submitted_at is null;
set local role authenticated;
select lives_ok($$ select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000056a2', 90) $$,
  'once started it submits (the running timer is closed; manual minutes are not needed)');
select is((select mode from task_time_entries where sub_task_id='aaaaaaaa-0000-0000-0000-0000000056a2'), 'timer',
  'the entry is the TIMER''s — started, then closed on submit — never a manual one on an unstarted task');

select * from finish();
rollback;
