-- ADR-0030 (I8.4) as amended by ADR-0069 d.2/d.4: sub-task-grain notifications.
-- Proves: APPROVING a prerequisite pings the downstream owner (dependency_ready) and SUBMITTING it
-- does not; requesting changes on a sub-task notifies its assignee (changes_requested, entity_type
-- sub_task).
--
-- The first assertion was inverted on 3 Sep. It read "submitting the prerequisite pings the
-- downstream owner", which was correct while ADR-0030 §1b made submission the moment a dependency
-- was satisfied. ADR-0069 d.2 moved that to APPROVAL, because a hand-off released by an unreviewed
-- submission is exactly the case where the next person builds on work about to be sent back. The
-- test now proves both halves of the new rule — silence at submit, one ping at approve — because a
-- test that only checked the ping would pass on an implementation that sent it at both moments.
begin;
select plan(6);
\ir helpers/seed.sql

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000060d1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S');
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000060e1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000060d1','D1','in_progress', '00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-0000000060e2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000060d1','D2','in_progress', '00000000-0000-0000-0000-00000000a001');
-- D1: A (assignee a002), B (assignee a003) depends on A
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000060a1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000060e1','00000000-0000-0000-0000-00000000a002','A','todo', 8),
  ('aaaaaaaa-0000-0000-0000-0000000060a2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000060e1','00000000-0000-0000-0000-00000000a003','B','todo', 8),
  -- D2: a sub-task by a003 for the changes scenario
  ('aaaaaaaa-0000-0000-0000-0000000060a3','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000060e2','00000000-0000-0000-0000-00000000a003','Retouch','todo', 8);
insert into sub_task_dependencies (tenant_id, sub_task_id, depends_on_sub_task_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000060a2','aaaaaaaa-0000-0000-0000-0000000060a1');
-- I11.9: submitting for review now requires a version stamped with THIS round, so the fixture
-- attaches one. (A round-1 upload is stamped round 1 by media_record_stamp_round.)
insert into media_records (id, tenant_id, deliverable_id, object_key, content_type) values
  ('aaaaaaaa-0000-0000-0000-0000000060f1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000060e2','k/v1.png','image/png'),
  ('aaaaaaaa-0000-0000-0000-0000000060f2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000060e1','k/d1-v1.png','image/png');

set local role authenticated;

-- a002 submits A. Under ADR-0069 d.2 that is NOT the moment B is released, so nobody is pinged.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
-- I52.15: a task is submitted only after it was started; start it (a no-op if it already is).
do $s$ begin perform app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000060a1'); exception when others then null; end $s$;
-- ADR-0106 (I59.20): sent in the same transaction as its Start (or never started) — an UNTIMED round, accepted as one.
select lives_ok($$ select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000060a1', 30, true) $$, 'a002 submits the prerequisite A');
select is((select count(*)::int from notifications where type='dependency_ready'), 0,
  'SUBMITTING the prerequisite pings nobody — the work has not been accepted yet (ADR-0069 d.2)');

-- Approval is the moment, and the trigger hangs off the status REACHING `done` precisely so every
-- route to it behaves the same way — which is what these assertions are about, rather than about
-- `sub_task_approve` (suite 076 covers that).
--
-- Driven as superuser, deliberately. `app.tg_sub_task_completion_guard` refuses a signed-in user
-- who marks a task done without a reviewer's approval — correct, and not worked around here: the
-- guard's OWN escape is `auth.uid() is null`, on the stated grounds that "a migration or a seeder
-- is not a signed-in user". That is exactly what this fixture is.
--
-- The CLAIMS have to be cleared too, not just the role: `auth.uid()` reads
-- `request.jwt.claims`, which `reset role` does not touch — so a superuser still carrying an
-- earlier test's claims is, as far as every guard is concerned, still that signed-in user.
reset role;
select set_config('request.jwt.claims', '', true);
update sub_tasks set status = 'done' where id = 'aaaaaaaa-0000-0000-0000-0000000060a1';
select is((select count(*)::int from notifications where type='dependency_ready'), 1,
  'APPROVING it pings the downstream owner exactly once (d.4)');

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);

-- a003 submits their D2 sub-task; a001 requests changes → a003 gets changes_requested (sub_task grain)
-- I52.15: a task is submitted only after it was started; start it (a no-op if it already is).
do $s$ begin perform app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000060a3'); exception when others then null; end $s$;
-- ADR-0106 (I59.20): sent in the same transaction as its Start (or never started) — an UNTIMED round, accepted as one.
select lives_ok($$ select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000060a3', 20, true) $$, 'a003 submits their sub-task');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
insert into review_feedback (id, tenant_id, media_record_id, body, author_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000060b1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000060f1','tighten','00000000-0000-0000-0000-00000000a001');
select lives_ok($$ select app.sub_task_request_changes('aaaaaaaa-0000-0000-0000-0000000060a3') $$, 'a001 requests changes on the sub-task');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select is((select count(*)::int from notifications where type='changes_requested' and entity_type='sub_task'), 1,
  'the assignee is notified of changes requested on their task');

select * from finish();
rollback;
