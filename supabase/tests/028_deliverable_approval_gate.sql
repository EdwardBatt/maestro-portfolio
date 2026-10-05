-- ADR-0030 (I8.2): deliverable approval gate + sub-task Request Changes.
-- Proves: a deliverable can't enter review while a sub-task is unsubmitted; once submitted it can;
-- Request Changes needs a change description (an unresolved review comment); it reopens the specific
-- sub-task (revision_number++), sends the deliverable back, and the reopened task holds the gate shut.
begin;
select plan(9);
\ir helpers/seed.sql

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000058d1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S');
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000058e1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000058d1','KV','in_progress', '00000000-0000-0000-0000-00000000a001');
insert into media_records (id, tenant_id, deliverable_id, object_key, content_type) values
  ('aaaaaaaa-0000-0000-0000-0000000058f1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000058e1','k/v1.png','image/png');
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000058a1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000058e1','00000000-0000-0000-0000-00000000a003','Retouch','todo', 8);

set local role authenticated;

-- gate: cannot enter review while the sub-task is unsubmitted (todo)
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select throws_ok($$ update deliverables set state='in_review' where id='aaaaaaaa-0000-0000-0000-0000000058e1' $$,
  '55000', null, 'deliverable cannot enter review with an unsubmitted sub-task');

-- the assignee submits the sub-task (manual), then it can enter review
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
-- I52.15: a task is submitted only after it was started; start it (a no-op if it already is).
do $s$ begin perform app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000058a1'); exception when others then null; end $s$;
-- ADR-0106 (I59.20): sent in the same transaction as its Start (or never started) — an UNTIMED round, accepted as one.
select lives_ok($$ select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000058a1', 30, true) $$, 'assignee submits the sub-task');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select lives_ok($$ update deliverables set state='in_review' where id='aaaaaaaa-0000-0000-0000-0000000058e1' $$,
  'with every sub-task submitted, the deliverable enters review');

-- Request Changes needs a change description
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select throws_ok($$ select app.sub_task_request_changes('aaaaaaaa-0000-0000-0000-0000000058a1') $$,
  '55000', null, 'Request Changes requires a change description (a review comment)');

-- reviewer leaves an anchored change note, then requests changes
select lives_ok($$ insert into review_feedback (id, tenant_id, media_record_id, body, author_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000058b1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000058f1','tighten the crop','00000000-0000-0000-0000-00000000a001') $$,
  'reviewer leaves a change note');
select lives_ok($$ select app.sub_task_request_changes('aaaaaaaa-0000-0000-0000-0000000058a1') $$,
  'reviewer requests changes on the sub-task');
-- ADR-0035 (I11.4): reopened to TODO (not in_progress) so the maker Starts a fresh timed round.
select is((select status || ':' || revision_number::text from sub_tasks where id='aaaaaaaa-0000-0000-0000-0000000058a1'),
  'todo:1', 'the sub-task is reopened to todo at revision 1');
select is((select state::text from deliverables where id='aaaaaaaa-0000-0000-0000-0000000058e1'), 'in_progress',
  'the deliverable was sent back to in_progress');

-- the reopened sub-task holds the approval/review gate shut
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select throws_ok($$ update deliverables set state='in_review' where id='aaaaaaaa-0000-0000-0000-0000000058e1' $$,
  '55000', null, 'the reopened sub-task blocks the deliverable from re-entering review');

select * from finish();
rollback;
