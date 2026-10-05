-- ADR-0058 addendum d.13–d.15 (I48.33): the review round of a task is the task's own counter.
--
-- The trap this proves. A task under a deliverable is sent back for changes. The task's
-- revision_number becomes 1, but the DELIVERABLE's revision_round does not move — it only moves
-- on the container's own in_review → in_progress transition, and the container was never in
-- review. Before this change the media stamp and the submit gate read the deliverable's round, so
-- the next upload was stamped round 1 and, worse, round 1's file satisfied the round-2 submit
-- gate: the maker could resubmit without uploading anything. 047 could not catch this because it
-- drives the container through in_review, which happens to move both counters together.
--
-- Subjects (helpers/seed.sql, tenant A): a001 = power_admin (reviews:moderate), a003 = team_member.

begin;
select plan(13);
\ir helpers/seed.sql

reset role;

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000115f1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','S115');
insert into deliverables (id, tenant_id, stream_id, name, state) values
  ('aaaaaaaa-0000-0000-0000-0000000115e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000115f1','Launch copy','in_progress');
insert into sub_tasks (id, tenant_id, deliverable_id, title, assignee_id, status, review_mode, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000115a1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000115e1','Develop concept','00000000-0000-0000-0000-00000000a003','in_progress','digital', 8);
insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000115a1','00000000-0000-0000-0000-00000000a001', true);

-- ================================================== 1-3. round one, the task's own ====
insert into media_records (id, tenant_id, deliverable_id, sub_task_id, object_key, content_type) values
  ('aaaaaaaa-0000-0000-0000-0000000115c1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000115e1','aaaaaaaa-0000-0000-0000-0000000115a1','k/v1.png','image/png');

select is((select app.task_review_round('aaaaaaaa-0000-0000-0000-0000000115a1')), 1,
  'a task never sent back is on round 1');
select is((select round from media_records where id = 'aaaaaaaa-0000-0000-0000-0000000115c1'), 1,
  'its first upload is stamped round 1');

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
-- I52.15: a task is submitted only after it was started; start it (a no-op if it already is).
do $s$ begin perform app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000115a1'); exception when others then null; end $s$;
-- ADR-0106 (I59.20): sent in the same transaction as its Start (or never started) — an UNTIMED round, accepted as one.
select lives_ok($$select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000115a1', 30, true)$$,
  'with round 1''s version the task submits');

-- ============================ 4-8. the send-back moves the TASK, not the container ====
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
insert into review_feedback (tenant_id, media_record_id, source, body, author_user_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000115c1',
   'internal','The hero line is too long for the format.','00000000-0000-0000-0000-00000000a001');
select is((select round from review_feedback where media_record_id = 'aaaaaaaa-0000-0000-0000-0000000115c1'), 1,
  'a comment on the round-1 version is stamped round 1');
select lives_ok($$select app.sub_task_request_changes('aaaaaaaa-0000-0000-0000-0000000115a1')$$,
  'the reviewer sends the task back');

reset role;
select is((select revision_number from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000115a1'), 1,
  'the task counts the round');
select is((select revision_round from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000115e1'), 0,
  '…and the deliverable''s own counter does NOT move — the container was never in review');
select is((select app.task_review_round('aaaaaaaa-0000-0000-0000-0000000115a1')), 2,
  'so the task''s review round is 2, read from the task itself (d.13)');

-- ============================================ 9. THE assertion: last round's file ====
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
-- I52.15: a task is submitted only after it was started; start it (a no-op if it already is).
do $s$ begin perform app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000115a1'); exception when others then null; end $s$;
select throws_ok(
  $$select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000115a1', 30)$$,
  '55000', null,
  'round 1''s file does not submit round 2 — the maker must upload this round''s version (d.15)');

-- ============================================== 10-13. round two, stamped from the task ====
reset role;
insert into media_records (id, tenant_id, deliverable_id, sub_task_id, object_key, content_type) values
  ('aaaaaaaa-0000-0000-0000-0000000115c2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000115e1','aaaaaaaa-0000-0000-0000-0000000115a1','k/v2.png','image/png');
select is((select round from media_records where id = 'aaaaaaaa-0000-0000-0000-0000000115c2'), 2,
  'the upload after the send-back is stamped round 2 from the TASK (d.14)');

insert into review_feedback (tenant_id, media_record_id, source, body, author_user_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000115c2',
   'internal','Better.','00000000-0000-0000-0000-00000000a001');
select is((select round from review_feedback where media_record_id = 'aaaaaaaa-0000-0000-0000-0000000115c2'), 2,
  'a comment on the round-2 version follows the version''s round (d.14)');

-- A legacy version with no task keeps the deliverable's arithmetic: revision_round 0 → round 1.
insert into media_records (id, tenant_id, deliverable_id, object_key, content_type) values
  ('aaaaaaaa-0000-0000-0000-0000000115c9','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000115e1','k/legacy.png','image/png');
select is((select round from media_records where id = 'aaaaaaaa-0000-0000-0000-0000000115c9'), 1,
  'a version with no task is still stamped from the deliverable — its history stays as recorded');

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
-- I52.15: a task is submitted only after it was started; start it (a no-op if it already is).
do $s$ begin perform app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000115a1'); exception when others then null; end $s$;
-- ADR-0106 (I59.20): sent in the same transaction as its Start (or never started) — an UNTIMED round, accepted as one.
select lives_ok($$select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000115a1', 30, true)$$,
  'with round 2''s own version, the task submits again');

select * from finish();
rollback;
