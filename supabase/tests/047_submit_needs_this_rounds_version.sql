-- I11.9: a task cannot be submitted for review with nothing to review.
--
-- The gate that mattered was missing entirely: app.sub_task_submit checked the assignee, the status
-- and a timer, but never that a file existed. A maker could submit an empty round and the reviewer
-- got a version chain with nothing new in it.
--
-- The interesting case is the SECOND round. Counting versions against revision_round satisfies
-- round 2 as soon as two files exist — so a maker who uploaded twice in round 1 (a mistake, then
-- the fix) could resubmit round 2 without touching anything. Stamping the round at upload closes
-- that, and this test is mostly about proving it: the last two assertions are the ones a counting
-- implementation would fail.
--
-- Subjects (helpers/seed.sql, tenant A): a001 = power_admin (the seeded reviewer), a003 = team_member.

begin;
select plan(9);
\ir helpers/seed.sql

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000047d1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','S47');
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000047e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000047d1','KV47','in_progress','00000000-0000-0000-0000-00000000a001');
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000047a1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000047e1','00000000-0000-0000-0000-00000000a003','Task47','in_progress', 8);

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);

-- ------------------------------------------------------------- nothing attached ----
select throws_ok(
  $$select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000047a1', 30)$$,
  '55000', null,
  'a task with no version cannot be submitted — the reviewer would receive nothing');

-- ------------------------------------------------------------------ round one ----
set local role postgres;
insert into media_records (id, tenant_id, deliverable_id, object_key, content_type) values
  ('aaaaaaaa-0000-0000-0000-0000000047f1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000047e1','k/v1.png','image/png');
set local role authenticated;

select is((select round from media_records where id = 'aaaaaaaa-0000-0000-0000-0000000047f1'), 1,
  'an upload is stamped with the round it was made in (revision_round 0 → round 1)');
-- ADR-0106 (I59.20): sent in the same transaction as its Start (or never started) — an UNTIMED round, accepted as one.
select lives_ok($$select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000047a1', 30, true)$$,
  'with this round''s version attached, the task submits');

-- --------------------------------------------------- the round-two trap ----
-- The reviewer sends it back. revision_round becomes 1, so the next submission needs a round-2
-- version — and round 1's file must NOT satisfy it.
set local role postgres;
insert into media_records (id, tenant_id, deliverable_id, object_key, content_type) values
  ('aaaaaaaa-0000-0000-0000-0000000047f2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000047e1','k/v1b.png','image/png');
update deliverables set state = 'in_review' where id = 'aaaaaaaa-0000-0000-0000-0000000047e1';
update deliverables set state = 'in_progress' where id = 'aaaaaaaa-0000-0000-0000-0000000047e1';
update sub_tasks set status = 'in_progress' where id = 'aaaaaaaa-0000-0000-0000-0000000047a1';
set local role authenticated;

select is((select revision_round from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000047e1'), 1,
  'the send-back counts a revision round');
select is((select count(*)::int from media_records where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000047e1'), 2,
  'two versions exist — enough to satisfy a COUNTING implementation for round 2');
select is((select count(*)::int from media_records
           where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000047e1' and round = 2), 0,
  '…but both belong to round 1, because both were uploaded before the send-back');
select throws_ok(
  $$select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000047a1', 30)$$,
  '55000', null,
  'round 2 is refused: two uploads in round 1 do not make a round-2 submission');

set local role postgres;
insert into media_records (id, tenant_id, deliverable_id, object_key, content_type) values
  ('aaaaaaaa-0000-0000-0000-0000000047f3','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000047e1','k/v2.png','image/png');
set local role authenticated;
select is((select round from media_records where id = 'aaaaaaaa-0000-0000-0000-0000000047f3'), 2,
  'an upload after the send-back is stamped round 2');
-- ADR-0106 (I59.20): sent in the same transaction as its Start (or never started) — an UNTIMED round, accepted as one.
select lives_ok($$select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000047a1', 30, true)$$,
  'with round 2''s own version, the task submits again');

select * from finish();
rollback;
