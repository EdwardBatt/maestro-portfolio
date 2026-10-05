-- ADR-0038 (I12.1): tasks are approved; deliverables are signed off.
--
-- Before this, NOTHING in the system ever set a task to `done` — every status-writing path was
-- enumerated and none produced it. So the first assertion here is the one that matters: a submitted
-- task can reach `done`, with a name and a time against it. The rest fence the authority: only the
-- APPOINTED reviewer, only from `review`, and a deliverable cannot be signed off until every task
-- inside it has been approved individually rather than merely submitted.
--
-- Subjects (helpers/seed.sql, tenant A): a001 = power_admin (seed deliverables name them reviewer),
-- a002 = scheduler, a003 = team_member.

begin;
select plan(15);
\ir helpers/seed.sql

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000045d1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','S45');
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000045e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000045d1','KV45','in_progress','00000000-0000-0000-0000-00000000a001');
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000045a1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000045e1','00000000-0000-0000-0000-00000000a003','Retouch45','todo', 8);
-- I11.9: submitting for review now requires a version stamped with THIS round, so the fixture
-- attaches one. (A round-1 upload is stamped round 1 by media_record_stamp_round.)
insert into media_records (id, tenant_id, deliverable_id, object_key, content_type) values
  ('aaaaaaaa-0000-0000-0000-0000000045f1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000045e1','k/v1.png','image/png');

-- ------------------------------------------------------------ seeding + constraints ----
-- ADR-0043: the reviewer is an APPOINTMENT in sub_task_reviewers, not a column, and the required /
-- no-self-review rules are a deferred constraint trigger rather than two CHECKs. `set constraints
-- all immediate` is what makes the deferred rule fire inside the assertion instead of at a COMMIT
-- this suite never reaches; each block puts it back to deferred, because creating a task and
-- appointing its reviewers in one transaction is exactly what the deferral is for.
select is(
  (select count(*)::int from sub_task_reviewers
    where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000045a1'
      and user_id = '00000000-0000-0000-0000-00000000a001'),
  1,
  'a task inherits its deliverable''s reviewer when none is named (ADR-0038 d.2, ADR-0043)');

-- "nothing to inherit from" is now a deliverable that names no reviewer — a task with NO
-- deliverable is impossible since the standalone shape was retired in this same change.
insert into deliverables (id, tenant_id, job_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000045e2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001','NoReviewer45');

select throws_ok(
  $$insert into sub_tasks (tenant_id, deliverable_id, assignee_id, title, sla_hours)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000045e2',
            '00000000-0000-0000-0000-00000000a003', 'orphan45', 8);
    set constraints all immediate$$,
  '23514', null,
  'an ASSIGNED task with no reviewer and nothing to inherit from is refused');
set constraints all deferred;

select lives_ok(
  $$insert into sub_tasks (tenant_id, deliverable_id, title)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000045e2', 'unassigned45');
    set constraints all immediate$$,
  'an UNASSIGNED task needs no reviewer yet — nobody''s work is waiting on one');
set constraints all deferred;

select throws_ok(
  $$insert into sub_task_reviewers (tenant_id, sub_task_id, user_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000045a1',
            '00000000-0000-0000-0000-00000000a003')$$,
  '22023', null,
  'nobody reviews their own work — the rule applies to EVERY appointment (ADR-0043 d.3)');

set local role authenticated;

-- ------------------------------------------------------------------- approval ----
-- Not from `todo`: only submitted work can be approved.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select throws_ok(
  $$select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000045a1')$$,
  '22023', null, 'a task cannot be approved before it is submitted');

select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
-- I52.15: a task is submitted only after it was started; start it (a no-op if it already is).
do $s$ begin perform app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000045a1'); exception when others then null; end $s$;
-- ADR-0106 (I59.20): sent in the same transaction as its Start (or never started) — an UNTIMED round, accepted as one.
select lives_ok($$select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000045a1', 30, true)$$,
  'the assignee submits');

-- The maker cannot approve their own submission, and neither can a bystander.
select throws_ok(
  $$select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000045a1')$$,
  '42501', null, 'the assignee cannot approve their own task');
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);
select throws_ok(
  $$select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000045a1')$$,
  '42501', null, 'someone who is not the appointed reviewer cannot approve it');

-- The appointed reviewer can, and it leaves a record.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select lives_ok($$select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000045a1')$$,
  'the appointed reviewer approves the task');
select is((select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000045a1'),
  'done', 'the task is DONE — the state nothing in the system could previously reach');
select is((select approved_by from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000045a1'),
  '00000000-0000-0000-0000-00000000a001'::uuid,
  'and it records WHO approved it — the answer to "who finished this?"');
select ok((select approved_at is not null from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000045a1'),
  'and WHEN');

-- ---------------------------------------------------- the deliverable gate tightens ----
-- A second task, submitted but not approved, must hold sign-off shut. Previously "submitted"
-- satisfied the gate, so a deliverable could be approved with every task inside it unread.
set local role postgres;
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000045a2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000045e1','00000000-0000-0000-0000-00000000a003','Second45','review', 8);
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
-- ADR-0077 d.2: approving the first task CLOSED this deliverable, because nothing was outstanding
-- at that moment. Adding a second task is work arriving after sign-off, so reopen it — the same
-- move a revision makes, and legal from `approved`. It used to be pushed into `in_review` here,
-- which a container no longer needs to pass through to be approved.
-- ADR-0103 (25 Sep) fenced the BARE approved → in_progress move: a person re-opens a finished
-- deliverable through `reopen_deliverable`, by the tasks that need doing again. Here the arrival of
-- a second task is the reason, which that door does not model, so the fixture makes the move under
-- the same flag the door raises. What is under test is the sign-off gate below, not the re-open.
select set_config('app.reopen', 'on', true);
update deliverables set state = 'in_progress' where id = 'aaaaaaaa-0000-0000-0000-0000000045e1';
select set_config('app.reopen', 'off', true);
select throws_ok(
  $$update deliverables set state='approved' where id='aaaaaaaa-0000-0000-0000-0000000045e1'$$,
  '55000', null,
  'sign-off is refused while a task is merely SUBMITTED — every task must be approved first');

select lives_ok($$select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000045a2')$$,
  'the reviewer approves the remaining task');
select lives_ok(
  $$update deliverables set state='approved' where id='aaaaaaaa-0000-0000-0000-0000000045e1'$$,
  'with every task approved, the deliverable can be signed off');

select * from finish();
rollback;
