-- ADR-0043 (I14.1) — the ways the reviewer table could be got around, and the states it could be
-- left stuck in. Every assertion here failed against the first cut of `20260827100000`.
--
-- Companion to 056, which covers the rule itself. This file covers the seams:
--   * an appointment is a person on a task, and neither half may be edited — otherwise a manager
--     re-points a row and somebody holds an approval they never gave;
--   * the completion question is re-asked whenever the appointment set changes, so ADR-0043's own
--     escape hatch ("remove the mandatory reviewer") actually moves the task. ADR-0089 narrows it:
--     an optional reviewer ANSWERS rather than approves, removing the last required reviewer makes
--     the remaining one required at commit (d.2), and demoting a required reviewer leaves them an
--     optional one whose answer is still owed (d.6) — the hatch is one tick longer, not gone;
--   * a task with every approval given but still sitting in review can be unstuck;
--   * `done` is something reviewers do, not a value the assignee can write;
--   * eligibility is asked when somebody is appointed, not on every later write — otherwise a
--     reviewer who loses reviews:moderate freezes the task they already approved;
--   * `save_sub_task` does not destroy the fields a caller did not mention;
--   * `sub_task_request_changes` is tenant-fenced.
--
-- Subjects: a001 power_admin (moderator + tenant-scope manage), a003 team_member (the assignee),
-- a004/a005 team_lead (moderators), b001 power admin of tenant B.

begin;
select plan(31);
\ir helpers/seed.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a004', 'lead-a@a.test'),
  ('00000000-0000-0000-0000-00000000a005', 'lead2-a@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, v.name,
       (select r.id from roles r
         where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = 'team_lead')
from (values
  ('00000000-0000-0000-0000-00000000a004', 'Lead A'),
  ('00000000-0000-0000-0000-00000000a005', 'Lead A2')
) as v(id, name);
insert into test_claims
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
from user_profiles up
where up.id in ('00000000-0000-0000-0000-00000000a004', '00000000-0000-0000-0000-00000000a005');

-- A campaign (stream-backed) deliverable, so approving a task never moves the container and every
-- assertion below is about the TASK.
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000057d1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','S57');
insert into deliverables (id, tenant_id, stream_id, name, state) values
  ('aaaaaaaa-0000-0000-0000-0000000057e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000057d1','KV57','in_progress');

-- T1 reattribution · T2 the escape hatch · T3 the raced end-state · T4 demotion · T5 the lost
-- permission · T6 save_sub_task partial update · T7 removal with nobody having approved.
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, description,
                       sla_hours, due_at, status) values
  ('aaaaaaaa-0000-0000-0000-0000000057a1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000057e1','00000000-0000-0000-0000-00000000a003','Reattribute57',null,8,null,'review'),
  ('aaaaaaaa-0000-0000-0000-0000000057a2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000057e1','00000000-0000-0000-0000-00000000a003','Hatch57',null,8,null,'review'),
  ('aaaaaaaa-0000-0000-0000-0000000057a3','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000057e1','00000000-0000-0000-0000-00000000a003','Raced57',null,8,null,'review'),
  ('aaaaaaaa-0000-0000-0000-0000000057a4','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000057e1','00000000-0000-0000-0000-00000000a003','Demote57',null,8,null,'review'),
  ('aaaaaaaa-0000-0000-0000-0000000057a5','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000057e1','00000000-0000-0000-0000-00000000a003','Frozen57',null,8,null,'review'),
  ('aaaaaaaa-0000-0000-0000-0000000057a6','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000057e1','00000000-0000-0000-0000-00000000a003','Partial57',
   'the brief', 8, '2026-09-01T00:00:00Z', 'review'),
  ('aaaaaaaa-0000-0000-0000-0000000057a7','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000057e1','00000000-0000-0000-0000-00000000a003','Untouched57',null,8,null,'review');

insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000057a1','00000000-0000-0000-0000-00000000a004', true),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000057a1','00000000-0000-0000-0000-00000000a005', true),
  -- T2: one mandatory (to be removed) and one optional (who approves).
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000057a2','00000000-0000-0000-0000-00000000a001', true),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000057a2','00000000-0000-0000-0000-00000000a004', false),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000057a3','00000000-0000-0000-0000-00000000a001', true),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000057a3','00000000-0000-0000-0000-00000000a004', true),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000057a4','00000000-0000-0000-0000-00000000a001', true),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000057a4','00000000-0000-0000-0000-00000000a005', true),
  -- T5: a005 approves, then loses reviews:moderate; a004 is still outstanding, so the task stays in
  -- review and a004 must still be able to send it back.
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000057a5','00000000-0000-0000-0000-00000000a005', true),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000057a5','00000000-0000-0000-0000-00000000a004', true),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000057a6','00000000-0000-0000-0000-00000000a001', true),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000057a7','00000000-0000-0000-0000-00000000a001', true),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000057a7','00000000-0000-0000-0000-00000000a004', false);

-- The change description sub_task_request_changes requires (ADR-0030).
insert into media_records (id, tenant_id, deliverable_id, object_key, content_type) values
  ('aaaaaaaa-0000-0000-0000-0000000057f1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000057e1','k/v1.png','image/png');
insert into review_feedback (id, tenant_id, media_record_id, body, author_user_id, pos_x, pos_y) values
  ('aaaaaaaa-0000-0000-0000-0000000057b1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000057f1','the logo is the wrong blue',
   '00000000-0000-0000-0000-00000000a004', 0.4, 0.4);

set local role authenticated;

-- ================================= 1. an appointment cannot change hands ====
-- a004 gives a real verdict. A manager then re-points that row at a001. Without the guard the row
-- reads `user_id = a001, approved = t` and a001 permanently holds an approval they never gave —
-- which walks around the approved_at guard instead of through it.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a004'), true);
select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000057a1');

select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select throws_ok(
  $$update sub_task_reviewers set user_id = '00000000-0000-0000-0000-00000000a001'
     where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000057a1'
       and user_id = '00000000-0000-0000-0000-00000000a004'$$,
  '22023', null,
  'a recorded approval cannot be reattributed to somebody who never gave it');

select throws_ok(
  $$update sub_task_reviewers set sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000057a2'
     where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000057a1'
       and user_id = '00000000-0000-0000-0000-00000000a004'$$,
  '22023', null,
  'nor carried onto a different task');

select is((select count(*)::int from sub_task_reviewers
           where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000057a1'
             and user_id = '00000000-0000-0000-0000-00000000a001'
             and approved_at is not null), 0,
  'so a001 holds no approval on a task they never looked at');

-- ================================= 2. the escape hatch ADR-0043 promises ====
-- "The manual escape hatch remains either way: remove the mandatory reviewer." ADR-0089 d.5 takes
-- Approve away from the optional reviewer — they answer — so the hatch is one tick longer: remove
-- the stalled required reviewer, the remaining one becomes required at commit (d.2), and THEY
-- approve. The work still moves, and every step of it is on the appointment record.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a004'), true);
select throws_ok($$select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000057a2')$$,
  '42501', null,
  'an optional reviewer cannot approve (ADR-0089 d.5) …');
select lives_ok($$select public.sub_task_respond('aaaaaaaa-0000-0000-0000-0000000057a2')$$,
  '… they answer');
select is((select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000057a2'),
  'review', 'an answer leaves the task owing its required approval');

select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select lives_ok(
  $$delete from sub_task_reviewers
     where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000057a2'
       and user_id = '00000000-0000-0000-0000-00000000a001';
    set constraints all immediate$$,
  'a manager removes the required reviewer the task is stalled on');
set constraints all deferred;
select is((select is_mandatory from sub_task_reviewers
           where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000057a2'
             and user_id = '00000000-0000-0000-0000-00000000a004'), true,
  '… and the reviewer left on it becomes the required one at commit (ADR-0089 d.2)');

select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a004'), true);
select lives_ok($$select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000057a2')$$,
  '… so they can now approve');
select is((select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000057a2'),
  'done',
  'and the task completes — the escape hatch moves the work, which is the whole point of it');
select is((select approved_by from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000057a2'),
  '00000000-0000-0000-0000-00000000a004'::uuid,
  'credited to the reviewer whose verdict completed it');

-- Demoting a mandatory reviewer to optional is the same act under another name.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a005'), true);
select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000057a4');
select is((select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000057a4'),
  'review', 'a task with a second mandatory reviewer outstanding stays in review');
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
update sub_task_reviewers set is_mandatory = false
 where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000057a4'
   and user_id = '00000000-0000-0000-0000-00000000a001';
-- ADR-0089 d.6: demotion used to complete the task by arithmetic. Now the demoted reviewer is an
-- OPTIONAL one who has not answered, and the round waits for them like any other.
select is((select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000057a4'),
  'review',
  'demoting the outstanding required reviewer no longer completes it — they now owe an ANSWER (ADR-0089 d.6)');
select lives_ok($$select public.sub_task_respond('aaaaaaaa-0000-0000-0000-0000000057a4')$$,
  'the demoted reviewer answers');
select is((select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000057a4'),
  'done', '… and their answer was the last thing the task was waiting for');

-- Removing a reviewer from a task NOBODY has approved must not complete it by arithmetic.
delete from sub_task_reviewers
 where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000057a7'
   and user_id = '00000000-0000-0000-0000-00000000a004';
select is((select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000057a7'),
  'review',
  'but removing a reviewer when nobody has approved leaves the task exactly where it was');

-- ================================= 3. the raced end-state is recoverable ====
-- Two mandatory reviewers approving at once each stamped their own row and then counted the other
-- as outstanding, leaving every approval given, status `review`, approved_by null — and neither
-- could approve again. A true interleaving cannot be written inside pgTAP: one session, one
-- transaction, and a second connection cannot see these uncommitted fixtures. It is proved instead
-- by `scripts/db/race-test-reviewers.sh`, two real sessions, the same shape as the M4.4 booking
-- race proof. Here the END STATE is built by hand (through the same GUC the RPCs use, since
-- approved_at is otherwise unwritable) and the assertion is that it is no longer terminal:
-- `for update` in app.maybe_complete_sub_task stops it arising, this stops it being permanent.
select set_config('app.reviewer_verdict', 'on', true);
update sub_task_reviewers set approved_at = now()
 where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000057a3';
select set_config('app.reviewer_verdict', 'off', true);
select is((select count(*)::int from sub_task_reviewers
           where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000057a3' and approved_at is null), 0,
  'every mandatory approval is in, and the task is still sitting in review');

select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a004'), true);
select lives_ok($$select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000057a3')$$,
  'a reviewer who has already approved can still unstick it');
select is((select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000057a3'),
  'done', 'and the task completes rather than being bricked for ever');

-- ================================= 4. done is not a value you can write ====
-- sub_tasks_manage_update carries `or assignee_id = auth.uid()` so a maker can progress their own
-- task, and nothing polices which status they progress it to.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select throws_ok(
  $$update sub_tasks set status = 'done' where id = 'aaaaaaaa-0000-0000-0000-0000000057a1'$$,
  '42501', null,
  'the assignee cannot mark their own task done past an outstanding mandatory approval');
select is((select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000057a1'),
  'review', 'the task is untouched');

-- ================================= 5. losing the permission does not freeze the task ====
-- a005 approves T5 and then loses reviews:moderate through the ADR-0036 overlay. Re-checking
-- eligibility on every write meant a004 could no longer send the task back — or cancel it — because
-- clearing approvals is an UPDATE of these rows and it raised from the write guard.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a005'), true);
select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000057a5');
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
insert into user_grants (tenant_id, user_id, resource, action, effect)
  values ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000a005',
          'reviews','moderate','deny');

select lives_ok(
  $$select app.sub_task_request_changes('aaaaaaaa-0000-0000-0000-0000000057a5')$$,
  'a reviewer losing reviews:moderate after approving does not freeze the task');
select is((select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000057a5'),
  'todo', 'it can still be sent back');

-- ================================= 6. save_sub_task keeps what it was not asked to change ====
select lives_ok(
  $$select public.save_sub_task(
      'aaaaaaaa-0000-0000-0000-0000000057a6'::uuid,
      'aaaaaaaa-0000-0000-0000-0000000057e1'::uuid,
      'Partial57 renamed', null)$$,
  'a caller renames a task and mentions nothing else');
select is((select title from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000057a6'),
  'Partial57 renamed', 'the rename lands');
select is((select description from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000057a6'),
  'the brief', 'and the description they did not mention survives');
select is((select sla_hours from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000057a6'),
  8::numeric, 'so do the hours');
select is((select assignee_id from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000057a6'),
  '00000000-0000-0000-0000-00000000a003'::uuid, 'so does the assignee');
select is((select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000057a6'),
  'review',
  'and so does the status, whose default silently reopened the task — which cleared every approval');

-- ================================= 7. request-changes is tenant-fenced ====
-- The original looked the task up by id alone, so a reviews:moderate holder in one tenant could
-- reopen another tenant's task. b001 is a power admin — of the wrong tenant.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000b001'), true);
select throws_ok(
  $$select app.sub_task_request_changes('aaaaaaaa-0000-0000-0000-0000000057a1')$$,
  'P0002', null,
  'another tenant''s moderator cannot reopen this task, by id or otherwise');
-- Read back as tenant A: from tenant B the row is invisible either way, so asking there could not
-- tell "the reopen was refused" apart from "the reopen worked".
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select is((select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000057a1'),
  'review', 'and the task is untouched');

select * from finish();
rollback;
