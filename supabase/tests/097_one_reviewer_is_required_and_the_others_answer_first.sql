-- ADR-0089 (I47): one reviewer is required, and the others answer before they approve.
--
-- THE RULE (d.1–d.3, held by the deferred constraint trigger):
--   * ONE unmarked reviewer on an assigned task is marked required at commit;
--   * TWO unmarked are refused (23514), and marking one of them makes it pass;
--   * removing the only required reviewer from a THREE-reviewer task is refused; removing them while
--     marking another in the same transaction is allowed (the narrowed escape hatch). From a
--     TWO-reviewer task the removal leaves one, and d.2 marks that one — the ADR's own Testing
--     section says "refused" here, but d.2 is the decision and this is what it implies;
--   * an UNASSIGNED task with unmarked reviewers is untouched (d.4 scope);
--   * create_adhoc_deliverable and the seed trigger both write a REQUIRED reviewer.
--
-- THE RUN (d.5–d.10):
--   * a required reviewer's completing approval with an optional answer outstanding is refused
--     with 55089 and stamps nothing; there is no flag that lets it through;
--   * a required reviewer cannot answer; an optional reviewer cannot approve;
--   * sub_task_respond writes `feedback` when the caller commented since the last submission and
--     `no_comment` when not — on a digital task and on a manual one;
--   * the LAST answer writes feedback_collected to each required reviewer still owed, and to nobody
--     else (`reset role` before reading notifications — traps.md);
--   * the wait is held by Postgres too: a direct `status = 'done'` write is refused by the completion
--     guard while an optional answer is outstanding; responded_at/response reset on a client write;
--   * after every optional reviewer answers, the same approval completes; after the silent one is
--     REMOVED by somebody who manages the task, it completes and the removal is on the record;
--   * with two required reviewers the first approval is never gated;
--   * requesting changes clears every answer;
--   * somebody appointed to a task already in review gets review_requested.
--
-- `set constraints all immediate` fires the deferred rule inside the assertion instead of at a
-- COMMIT this suite never reaches. Because it fires EVERY pending event, the fixtures that are meant
-- to fail are written inside the throws_ok statement, where the subtransaction rolls them back.
--
-- Subjects: a001 power_admin (moderator + tenant-scope manage), a003 team_member (the assignee),
-- a004/a005 team_lead (moderators). pgTAP runs in ONE transaction, so `now()` is constant here;
-- the "this round" anchor is exercised with explicit timestamps.

begin;
select plan(55);
\ir helpers/seed.sql

-- ---------------------------------------------------------------- extra moderators ----
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

-- ------------------------------------------------------------------------ the work ----
-- A campaign (stream-backed) deliverable: approving a task must never move it, so every completion
-- assertion is about the TASK. It names no reviewer, so nothing is inherited.
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000097d1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','S97');
insert into deliverables (id, tenant_id, stream_id, name, state) values
  ('aaaaaaaa-0000-0000-0000-0000000097e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000097d1','KV97','in_progress');
-- 20 Sep: the department has accepted this work (ADR-0072 d.6) — see helpers/seed.sql.
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-00000000e001');

-- a1 lone reviewer · a4 unassigned with two unmarked · a5 the run · a6 removal · a7 manual ·
-- a8 the round anchor · a9 request-changes clears · b1 two required + one optional.
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, status, review_mode, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000097a1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000097e1','00000000-0000-0000-0000-00000000a003','Lone97','todo','digital', 8),
  ('aaaaaaaa-0000-0000-0000-0000000097a4','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000097e1',null,'Unassigned97','todo','digital', 8),
  ('aaaaaaaa-0000-0000-0000-0000000097a5','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000097e1','00000000-0000-0000-0000-00000000a003','Run97','review','digital', 8),
  ('aaaaaaaa-0000-0000-0000-0000000097a6','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000097e1','00000000-0000-0000-0000-00000000a003','Removal97','review','digital', 8),
  ('aaaaaaaa-0000-0000-0000-0000000097a7','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000097e1','00000000-0000-0000-0000-00000000a003','Manual97','review','manual', 8),
  ('aaaaaaaa-0000-0000-0000-0000000097a8','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000097e1','00000000-0000-0000-0000-00000000a003','Round97','review','manual', 8),
  ('aaaaaaaa-0000-0000-0000-0000000097a9','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000097e1','00000000-0000-0000-0000-00000000a003','Reopen97','review','digital', 8),
  ('aaaaaaaa-0000-0000-0000-0000000097b1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000097e1','00000000-0000-0000-0000-00000000a003','TwoReq97','review','digital', 8);

insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097a1','00000000-0000-0000-0000-00000000a001', false),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097a4','00000000-0000-0000-0000-00000000a001', false),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097a4','00000000-0000-0000-0000-00000000a004', false),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097a5','00000000-0000-0000-0000-00000000a001', true),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097a5','00000000-0000-0000-0000-00000000a004', false),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097a5','00000000-0000-0000-0000-00000000a005', false),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097a6','00000000-0000-0000-0000-00000000a001', true),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097a6','00000000-0000-0000-0000-00000000a004', false),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097a7','00000000-0000-0000-0000-00000000a001', true),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097a7','00000000-0000-0000-0000-00000000a004', false),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097a8','00000000-0000-0000-0000-00000000a001', true),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097a8','00000000-0000-0000-0000-00000000a004', false),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097a9','00000000-0000-0000-0000-00000000a001', true),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097a9','00000000-0000-0000-0000-00000000a004', false),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097b1','00000000-0000-0000-0000-00000000a001', true),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097b1','00000000-0000-0000-0000-00000000a004', true),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097b1','00000000-0000-0000-0000-00000000a005', false);

-- The run's version, anchored to its task (ADR-0058), so a comment on it is a comment on the task.
insert into media_records (id, tenant_id, deliverable_id, sub_task_id, object_key, content_type) values
  ('aaaaaaaa-0000-0000-0000-0000000097f5','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000097e1','aaaaaaaa-0000-0000-0000-0000000097a5','k/run.png','image/png'),
  ('aaaaaaaa-0000-0000-0000-0000000097f9','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000097e1','aaaaaaaa-0000-0000-0000-0000000097a9','k/reopen.png','image/png');

-- The round anchor: a comment from YESTERDAY's round on a8, and the maker's submission an hour ago.
insert into review_feedback (tenant_id, sub_task_id, body, author_user_id, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097a8',
   'last round: the plinth was crooked','00000000-0000-0000-0000-00000000a004', now() - interval '1 day');
insert into task_time_entries (tenant_id, sub_task_id, user_id, round, started_at, submitted_at, minutes, mode) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097a8',
   '00000000-0000-0000-0000-00000000a003', 0, now() - interval '2 hours', now() - interval '1 hour', 60, 'manual');

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

-- ============================================================ THE RULE (d.1–d.3) ====

-- d.2: one reviewer, nobody marked → that reviewer is the required one, decided at commit.
select lives_ok($$set constraints all immediate$$,
  'ending the transaction with ONE unmarked reviewer on an assigned task is allowed');
set constraints all deferred;
select is((select is_mandatory from sub_task_reviewers
           where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a1'), true,
  '… and that reviewer is now marked required — the only possible answer, so the database gives it (d.2)');

-- d.4 scope: unassigned work is nobody's wait, so nothing is decided for it.
select is((select count(*)::int from sub_task_reviewers
           where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a4' and is_mandatory), 0,
  'an UNASSIGNED task with two unmarked reviewers is left exactly as it was (d.4 scope)');

-- d.3: several, none marked → refused. The system may not choose among people.
select throws_ok(
  $$insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, status, sla_hours) values
      ('aaaaaaaa-0000-0000-0000-0000000097a2','aaaaaaaa-0000-0000-0000-000000000001',
       'aaaaaaaa-0000-0000-0000-0000000097e1','00000000-0000-0000-0000-00000000a003','Two97','todo', 8);
    insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory) values
      ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097a2','00000000-0000-0000-0000-00000000a001', false),
      ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097a2','00000000-0000-0000-0000-00000000a004', false);
    set constraints all immediate$$,
  '23514', null,
  'TWO unmarked reviewers on an assigned task are refused at commit (d.3)');
set constraints all deferred;

select lives_ok(
  $$insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, status, sla_hours) values
      ('aaaaaaaa-0000-0000-0000-0000000097a2','aaaaaaaa-0000-0000-0000-000000000001',
       'aaaaaaaa-0000-0000-0000-0000000097e1','00000000-0000-0000-0000-00000000a003','Two97','todo', 8);
    insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory) values
      ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097a2','00000000-0000-0000-0000-00000000a001', false),
      ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097a2','00000000-0000-0000-0000-00000000a004', true);
    set constraints all immediate$$,
  '… and marking one of them makes the same transaction pass');
set constraints all deferred;

-- The narrowed escape hatch. With THREE reviewers, the only required one cannot simply be removed —
-- two unmarked people would be left and the system may not choose between them …
insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097a2','00000000-0000-0000-0000-00000000a005', false);
select throws_ok(
  $$delete from sub_task_reviewers
     where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a2'
       and user_id = '00000000-0000-0000-0000-00000000a004';
    set constraints all immediate$$,
  '23514', null,
  'removing the only required reviewer from a three-reviewer task is refused');
set constraints all deferred;

-- … but can be REPLACED, in one save.
select lives_ok(
  $$update sub_task_reviewers set is_mandatory = true
     where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a2'
       and user_id = '00000000-0000-0000-0000-00000000a001';
    delete from sub_task_reviewers
     where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a2'
       and user_id = '00000000-0000-0000-0000-00000000a004';
    set constraints all immediate$$,
  'removing them while marking another in the same transaction is allowed — the hatch is one tick longer');
set constraints all deferred;

-- From a TWO-reviewer task, removing the required one leaves exactly one — and d.2 applies to
-- them. (The ADR's Testing section expects a refusal here; its own d.2 says otherwise, and d.2 is
-- the decision.)
select lives_ok(
  $$delete from sub_task_reviewers
     where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a2'
       and user_id = '00000000-0000-0000-0000-00000000a001';
    set constraints all immediate$$,
  'removing the required reviewer from a two-reviewer task is allowed …');
set constraints all deferred;
select is((select is_mandatory from sub_task_reviewers
           where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a2'), true,
  '… because the one left is the required one by definition (d.2)');

-- Adding an unmarked SECOND reviewer to a task whose only reviewer is unmarked was, before d.1,
-- a way to create the pool by accident. INSERT now fires the rule.
select throws_ok(
  $$insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory) values
      ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097a4','00000000-0000-0000-0000-00000000a005', false);
    update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a003'
     where id = 'aaaaaaaa-0000-0000-0000-0000000097a4';
    set constraints all immediate$$,
  '23514', null,
  'assigning a task that holds several unmarked reviewers is refused too — the rule is about the record, not the door');
set constraints all deferred;

-- create_adhoc_deliverable writes a REQUIRED reviewer (d.2, d.13): the ad-hoc dialog's single
-- select is one step, with no checkbox to come back for.
select lives_ok(
  $$select public.create_adhoc_deliverable('00000000-0000-0000-0000-00000000a003', 'Ad-hoc97', 2,
      '2027-03-01T09:00:00Z', '2027-03-01T17:00:00Z', '00000000-0000-0000-0000-00000000a004')$$,
  'an ad-hoc task is created with one reviewer');
select is((select bool_and(r.is_mandatory) from sub_task_reviewers r
           join sub_tasks st on st.id = r.sub_task_id
           where st.title = 'Ad-hoc97'), true,
  '… and that reviewer is REQUIRED, written by the RPC itself');

-- The seed trigger (a task inheriting its deliverable's reviewer) says the same.
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000097a3','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f101','00000000-0000-0000-0000-00000000a003','Seeded97','todo', 8);
select is((select is_mandatory from sub_task_reviewers
           where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a3'
             and user_id = '00000000-0000-0000-0000-00000000a001'), true,
  'a task inheriting its deliverable''s reviewer gets them as the REQUIRED reviewer');

-- ============================================================= THE RUN (d.5–d.9) ====
-- Run97: a001 required, a004 and a005 optional. Nobody has answered.

-- d.7: the completing approval waits. Refused, and nothing is stamped.
select throws_ok($$select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000097a5')$$,
  '55089', null,
  'the required reviewer''s completing approval is refused while an optional answer is outstanding (d.7)');
select is((select approved_at from sub_task_reviewers
           where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a5'
             and user_id = '00000000-0000-0000-0000-00000000a001'), null,
  '… and their own row is untouched — refused BEFORE anything is stamped');
select is((select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000097a5'), 'review',
  '… and the task is still in review');

-- There is no flag that lets it through. The only GUC the reviewer path knows is the verdict
-- guard, and it changes who may WRITE the stamp, not whether the wait applies.
select set_config('app.reviewer_verdict', 'on', true);
select throws_ok($$select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000097a5')$$,
  '55089', null,
  'there is no "approve anyway" — the same call is refused the same way with the verdict guard open');
select set_config('app.reviewer_verdict', 'off', true);

-- d.5: two verbs, two kinds of reviewer.
select throws_ok($$select public.sub_task_respond('aaaaaaaa-0000-0000-0000-0000000097a5')$$,
  '42501', null,
  'a REQUIRED reviewer cannot answer — their act is to approve or send back');

select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a004'), true);
select throws_ok($$select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000097a5')$$,
  '42501', null,
  'an OPTIONAL reviewer cannot approve — their act is to answer');

-- a004 comments on the version, then answers: the kind is derived from the record.
insert into review_feedback (tenant_id, media_record_id, body, author_user_id, pos_x, pos_y) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097f5',
   'tighten the kerning on the strapline','00000000-0000-0000-0000-00000000a004', 0.2, 0.8);
select lives_ok($$select public.sub_task_respond('aaaaaaaa-0000-0000-0000-0000000097a5')$$,
  'an optional reviewer who has commented presses Done');
select is((select response from sub_task_reviewers
           where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a5'
             and user_id = '00000000-0000-0000-0000-00000000a004'), 'feedback',
  '… and the record says FEEDBACK, because they wrote some — derived, not asked (d.5)');
select isnt((select responded_at from sub_task_reviewers
             where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a5'
               and user_id = '00000000-0000-0000-0000-00000000a004'), null,
  '… with the moment they said so');
select throws_ok($$select public.sub_task_respond('aaaaaaaa-0000-0000-0000-0000000097a5')$$,
  '22023', null,
  'answering twice on the same version is refused');

-- The required reviewer is still waiting on a005: nobody is told yet (reset role: notifications
-- are recipient-scoped, and a zero here would pass blind under the actor's claims — traps.md).
reset role;
select is((select count(*)::int from notifications
           where type = 'feedback_collected'
             and entity_id = 'aaaaaaaa-0000-0000-0000-0000000097e1'), 0,
  'one answer of two is not "feedback collected" — nobody is told yet');

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a005'), true);
select lives_ok($$select public.sub_task_respond('aaaaaaaa-0000-0000-0000-0000000097a5')$$,
  'the other optional reviewer presses Done without having written anything');
select is((select response from sub_task_reviewers
           where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a5'
             and user_id = '00000000-0000-0000-0000-00000000a005'), 'no_comment',
  '… and the record says NO COMMENT');
select is((select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000097a5'), 'review',
  'answers alone complete nothing — the task still owes its required approval');

-- d.9: the LAST answer tells the required reviewer, and only them.
reset role;
select is((select count(*)::int from notifications
           where type = 'feedback_collected'
             and entity_type = 'sub_task'
             and entity_id = 'aaaaaaaa-0000-0000-0000-0000000097a5'
             and user_id = '00000000-0000-0000-0000-00000000a001'), 1,
  'the last answer writes feedback_collected to the required reviewer still owed (d.9) — on the TASK (I52 Action 11)');
select is((select count(*)::int from notifications
           where type = 'feedback_collected'
             and user_id <> '00000000-0000-0000-0000-00000000a001'), 0,
  '… and to nobody else — the optional reviewers are not owed anything');
select is((select actor_id from notifications
           where type = 'feedback_collected' and user_id = '00000000-0000-0000-0000-00000000a001'),
  '00000000-0000-0000-0000-00000000a005'::uuid,
  '… naming the reviewer whose answer closed the round');

-- Now the same approval completes.
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select lives_ok($$select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000097a5')$$,
  'with every optional reviewer heard, the required reviewer''s approval is accepted');
select is((select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000097a5'), 'done',
  '… and the task completes (d.6)');
select is((select approved_by from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000097a5'),
  '00000000-0000-0000-0000-00000000a001'::uuid,
  'approved_by names the required reviewer who completed it');

-- ============================================== the escape hatch is removal, by name ====
-- Removal97: a001 required, a004 optional and silent.
select throws_ok($$select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000097a6')$$,
  '55089', null,
  'a silent optional reviewer holds the completing approval');
select lives_ok(
  $$delete from sub_task_reviewers
     where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a6'
       and user_id = '00000000-0000-0000-0000-00000000a004'$$,
  'somebody who manages the task removes the silent reviewer');
select lives_ok($$select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000097a6')$$,
  '… and the same approval now goes through');
select is((select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000097a6'), 'done',
  '… completing the task');
reset role;
select is((select count(*)::int from audit_events
           where entity = 'sub_task_reviewers' and action = 'delete'
             and payload ->> 'sub_task_id' = 'aaaaaaaa-0000-0000-0000-0000000097a6'
             and payload ->> 'user_id' = '00000000-0000-0000-0000-00000000a004'
             and actor_user_id = '00000000-0000-0000-0000-00000000a001'), 1,
  'and the removal is on the record — who removed whom, from which task (d.7)');

-- ============================================================ a manual task, and the round ====
-- Manual97: the reviewer writes in the task's own thread (ADR-0059 d.7).
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a004'), true);
insert into review_feedback (tenant_id, sub_task_id, body, author_user_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097a7',
   'the second setup was out of focus','00000000-0000-0000-0000-00000000a004');
select public.sub_task_respond('aaaaaaaa-0000-0000-0000-0000000097a7');
select is((select response from sub_task_reviewers
           where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a7'
             and user_id = '00000000-0000-0000-0000-00000000a004'), 'feedback',
  'on a MANUAL task, a comment in the task''s own thread counts as feedback');

-- Round97: a004's only comment is from yesterday's round; the maker resubmitted an hour ago.
select public.sub_task_respond('aaaaaaaa-0000-0000-0000-0000000097a8');
select is((select response from sub_task_reviewers
           where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a8'
             and user_id = '00000000-0000-0000-0000-00000000a004'), 'no_comment',
  'a comment from BEFORE the maker''s latest submission does not count — this round, not any round');

-- ================================================= an answer belongs to a version (d.8) ====
-- Reopen97: a004 answers, then a001 sends the work back. The answer goes with the approvals.
insert into review_feedback (tenant_id, media_record_id, body, author_user_id, pos_x, pos_y) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097f9',
   'the logo is the wrong blue','00000000-0000-0000-0000-00000000a004', 0.4, 0.4);
select public.sub_task_respond('aaaaaaaa-0000-0000-0000-0000000097a9');
select isnt((select responded_at from sub_task_reviewers
             where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a9'
               and user_id = '00000000-0000-0000-0000-00000000a004'), null,
  'the optional reviewer has answered on this version');

select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select lives_ok($$select app.sub_task_request_changes('aaaaaaaa-0000-0000-0000-0000000097a9')$$,
  'the required reviewer sends the work back — never gated (d.7)');
select is((select count(*)::int from sub_task_reviewers
           where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097a9'
             and (responded_at is not null or response is not null)), 0,
  '… and every answer on it is cleared: a "no comment" on a draft says nothing about the next (d.8)');

-- ============================================== two required: the first is never gated ====
-- TwoReq97: a001 and a004 required, a005 optional and silent.
select lives_ok($$select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000097b1')$$,
  'with two required reviewers, the first approval is accepted while the optional answer is outstanding');
select isnt((select approved_at from sub_task_reviewers
             where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097b1'
               and user_id = '00000000-0000-0000-0000-00000000a001'), null,
  '… and recorded — it completes nothing, so there is nothing to wait for');
select is((select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000097b1'), 'review',
  '… and the task stays in review');
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a004'), true);
select throws_ok($$select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000097b1')$$,
  '55089', null,
  'only the COMPLETING approval — the second required reviewer''s — is gated');

-- ============================================ the wait is held by Postgres, not only the RPC ====
-- Found by review: with a001's approval on the record, demote a004 to optional (a manager may) —
-- nothing completes, because the recheck runs maybe_complete_sub_task and d.6 holds it. Then the
-- direct route sub_tasks_manage_update leaves open: writing status = 'done' by hand. ADR-0043's
-- completion guard must know the same predicate, or the RPC's wait is decoration.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
update sub_task_reviewers set is_mandatory = false
 where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097b1'
   and user_id = '00000000-0000-0000-0000-00000000a004';
select throws_ok(
  $$update sub_tasks set status = 'done' where id = 'aaaaaaaa-0000-0000-0000-0000000097b1'$$,
  '42501', null,
  'the Postgres-held completion guard refuses `done` while an optional answer is outstanding (d.6)');
select is((select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000097b1'), 'review',
  '… and the task is still in review');

-- d.5: responded_at / response are server-written only. This caller MAY manage the row — the
-- is_mandatory half of the same statement proves the write REACHED it (the 056 pattern).
update sub_task_reviewers
   set responded_at = now(), response = 'no_comment', is_mandatory = true
 where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097b1'
   and user_id = '00000000-0000-0000-0000-00000000a004';
select is((select is_mandatory from sub_task_reviewers
           where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097b1'
             and user_id = '00000000-0000-0000-0000-00000000a004'), true,
  'a manager may change an appointment — mandatory-ness is theirs to set');
select is((select responded_at from sub_task_reviewers
           where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097b1'
             and user_id = '00000000-0000-0000-0000-00000000a004'), null,
  'but not answer on a colleague''s behalf — responded_at is server-written only (d.5)');
select is((select response from sub_task_reviewers
           where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097b1'
             and user_id = '00000000-0000-0000-0000-00000000a004'), null,
  '… and so is response');

-- ============================================ appointed to a task already in review (d.10) ====
-- a001 appoints a moderator to TwoReq97 after submit — the literal case in Edward's report (the
-- appointer's grant is irrelevant to d.10; what is asserted is who is told, and by whom).
reset role;
select is((select count(*)::int from notifications
           where type = 'review_requested'
             and user_id = '00000000-0000-0000-0000-00000000a005'
             and actor_id = '00000000-0000-0000-0000-00000000a001'), 0,
  'nothing from a001 to a005 yet (the fixture appointments, made as superuser, carry no actor)');
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
delete from sub_task_reviewers
 where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000097b1'
   and user_id = '00000000-0000-0000-0000-00000000a005';
insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000097b1',
   '00000000-0000-0000-0000-00000000a005', false);
reset role;
-- I52 Action 4 (17 Sep): an OPTIONAL reviewer is asked for feedback, not a review, and the row
-- names the TASK — it is the task being reviewed, not its container.
select is((select count(*)::int from notifications
           where type = 'feedback_requested'
             and user_id = '00000000-0000-0000-0000-00000000a005'
             and entity_type = 'sub_task'
             and entity_id = 'aaaaaaaa-0000-0000-0000-0000000097b1'
             and actor_id = '00000000-0000-0000-0000-00000000a001'), 1,
  'somebody appointed to a task ALREADY in review is told, by the person who appointed them (d.10) — as feedback_requested, on the task (I52)');
select is((select count(*)::int from notifications
           where type in ('review_requested', 'feedback_requested')
             and actor_id = '00000000-0000-0000-0000-00000000a001'
             and user_id <> '00000000-0000-0000-0000-00000000a005'), 0,
  '… and the reviewers already on the task are not told again');

select * from finish();
rollback;
