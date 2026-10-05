-- I25 (ADR-0058) — a deliverable is a container; the sub-task is the unit of work and of review.
--
-- Assertion 2 is the defect this exists to close: **task A's version must not satisfy task B's
-- submit gate.** The old predicate asked only whether the DELIVERABLE held a version at this round,
-- so with six sub-tasks under one deliverable, one person uploaded one file and all six passed —
-- six approvals, five of them of something nobody looked at.
--
-- Assertions 5-7 are the other half: a campaign deliverable now approves ITSELF when its last task
-- is settled, which is what "container" means. Ad-hoc has behaved this way since ADR-0043; it was
-- fenced off from campaign work by one condition.

begin;
select plan(11);
\ir helpers/seed.sql

reset role;

-- A CAMPAIGN deliverable, hung off a stream — and that detail is load-bearing. Mutation-testing
-- this suite caught it: with the deliverable job-backed instead, `v_stream is null` was TRUE, the
-- ad-hoc-only fence ADR-0058 d.6 removes never applied, and assertion 7 passed whether the fence
-- was there or not. It was proving nothing about campaign work, which is the only thing it exists
-- to prove.
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000066f1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','Ramadan 2027');

-- One deliverable, TWO tasks — the shape that was broken. Both assigned to a003 so either can be
-- submitted by the same person.
-- The fixture department (ADR-0099 d.2, 23 Sep): a deliverable's department is its own and is no
-- longer derived from the owner, so a fixture that names an owner with no department must say
-- which department the work belongs to. Created here rather than assumed.
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000de0ff', 'aaaaaaaa-0000-0000-0000-000000000001', 'Fixture dept')
on conflict (id) do nothing;

insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000066e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000066f1','Two reels','in_progress', '00000000-0000-0000-0000-00000000a001', 'aaaaaaaa-0000-0000-0000-0000000de0ff');

insert into sub_tasks (id, tenant_id, deliverable_id, title, assignee_id, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000066a1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000066e1','Reel 1','00000000-0000-0000-0000-00000000a003','in_progress', 8),
  ('aaaaaaaa-0000-0000-0000-0000000066a2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000066e1','Reel 2','00000000-0000-0000-0000-00000000a003','in_progress', 8);

insert into sub_task_reviewers (tenant_id, sub_task_id, user_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000066a1','00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000066a2','00000000-0000-0000-0000-00000000a001');

-- Reel 1 gets a version. Reel 2 gets nothing.
insert into media_records (tenant_id, deliverable_id, sub_task_id, round, object_key, content_type)
values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000066e1',
        'aaaaaaaa-0000-0000-0000-0000000066a1', 1, 'k/reel1-v1.mp4','video/mp4');

-- ==================================== 1-2. THE DEFECT, asserted closed ====
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);

-- ADR-0106 (I59.20): sent in the same transaction as its Start (or never started) — an UNTIMED round, accepted as one.
select lives_ok(
  $$select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000066a1', 30, true)$$,
  'the task WITH a version submits');

select throws_ok(
  $$select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000066a2', 30)$$,
  '55000', null,
  'the task WITHOUT one does NOT — task A''s file no longer satisfies task B''s gate');

-- ===================================== 3-4. versions number per task ====
reset role;
insert into media_records (tenant_id, deliverable_id, sub_task_id, round, object_key, content_type)
values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000066e1',
        'aaaaaaaa-0000-0000-0000-0000000066a2', 1, 'k/reel2-v1.mp4','video/mp4');

select is(
  (select count(distinct version)::int from media_records
    where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000066e1'), 1,
  'two tasks under one deliverable are BOTH on version 1 — numbering is per task, not per row');

select is(
  (select count(*)::int from media_records
    where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000066e1' and version = 1), 2,
  'and the old unique(deliverable_id, version) would have refused the second');

-- ============================ 5-7. the container approves itself ====
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
-- ADR-0106 (I59.20): sent in the same transaction as its Start (or never started) — an UNTIMED round, accepted as one.
select lives_ok(
  $$select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000066a2', 30, true)$$,
  'with its own version attached, the second task submits too');

reset role;
update deliverables set state = 'in_review' where id = 'aaaaaaaa-0000-0000-0000-0000000066e1';

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000066a1');
select is(
  (select state::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000066e1'),
  'in_review',
  'one approval does not carry a deliverable that holds two — ADR-0038''s rule, still enforced');

select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000066a2');
select is(
  (select state::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000066e1'),
  'approved',
  'the LAST approval carries it — a campaign deliverable approves itself, as ad-hoc already did');

-- ======================================== 8-9. cross-tenant ====
reset role;
select is(
  (select count(*)::int from media_records m
     join sub_tasks st on st.id = m.sub_task_id
    where m.tenant_id is distinct from st.tenant_id),
  0, 'no version is attached to a sub-task in another tenant');

-- `on delete set null`, never cascade: deleting a task must not destroy the artefact somebody made.
delete from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000066a1';
select is(
  (select count(*)::int from media_records
    where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000066e1' and object_key = 'k/reel1-v1.mp4'),
  1, 'deleting a task orphans its version rather than destroying it');

-- ============ 10-11. EXISTING WORK IS NOT STRANDED (the migration's real risk) ====
-- The backfill attaches a version to its deliverable's task only where there is EXACTLY ONE. A
-- deliverable that already held several keeps its versions unattached — there is no way to tell
-- which task a file belonged to, and guessing would put somebody's work under somebody else's name.
--
-- Those rows must still satisfy the submit gate, or this migration strands work that was legitimately
-- submitted under the old rule. That is the legacy arm of the predicate, and it is the difference
-- between a safe migration and a broken Monday.
reset role;
insert into deliverables (id, tenant_id, job_id, name, state, owner_user_id, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000066e2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001','Pre-existing work','in_progress', '00000000-0000-0000-0000-00000000a001', 'aaaaaaaa-0000-0000-0000-0000000de0ff');

insert into sub_tasks (id, tenant_id, deliverable_id, title, assignee_id, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000066b1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000066e2','Old task A','00000000-0000-0000-0000-00000000a003','in_progress', 8),
  ('aaaaaaaa-0000-0000-0000-0000000066b2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000066e2','Old task B','00000000-0000-0000-0000-00000000a003','in_progress', 8);

insert into sub_task_reviewers (tenant_id, sub_task_id, user_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000066b1','00000000-0000-0000-0000-00000000a001');

-- A version as it exists in production today: no sub_task_id, because nothing could set one.
insert into media_records (tenant_id, deliverable_id, round, object_key, content_type)
values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000066e2',
        1, 'k/legacy-v1.png','image/png');

select is(
  (select sub_task_id from media_records where object_key = 'k/legacy-v1.png'),
  null, 'a version the backfill could not attach stays unattached rather than guessed at');

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
-- ADR-0106 (I59.20): sent in the same transaction as its Start (or never started) — an UNTIMED round, accepted as one.
select lives_ok(
  $$select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000066b1', 30, true)$$,
  'and work already in flight can still be submitted against it — nothing is stranded');

select finish();
rollback;
