-- ADR-0043 (I14.1): a task may have several reviewers, some of them mandatory.
--
-- What these assertions protect:
--   * the composite (tenant_id, user_id) FK, the only thing stopping a task naming ANOTHER tenant's
--     user as its reviewer — a plain `references user_profiles(id)` would accept it happily,
--     because foreign keys ignore RLS;
--   * the two rules that used to be CHECK constraints on sub_tasks.reviewer_id and are now a
--     deferred constraint trigger: a live assigned task has at least one reviewer, and no reviewer
--     is its assignee. The move to a trigger is a real loss of strength (ADR-0043 Consequences), so
--     both directions are pinned here;
--   * the completion rule itself, which is the whole point of the ADR — every MANDATORY reviewer
--     must approve. ADR-0089 retires the pool rule ("with none mandatory the FIRST approval
--     completes it"): a lone reviewer is marked required at commit (d.2) and several with none
--     marked are refused (d.3), so the pool is unreachable; those two assertions replace it here.
--     An OPTIONAL reviewer no longer approves at all — they answer (d.5; suite 097);
--   * that an approval belongs to a VERSION: requesting changes clears every approved_at on the
--     task, including a mandatory one already given, and an OPTIONAL reviewer can do that.
--
-- `set constraints all immediate` appears wherever the deferred rule is the subject: without it the
-- check would happen at a COMMIT this suite never reaches (every pgTAP file rolls back). Each such
-- block puts the mode back to deferred, because "insert the task, then appoint its reviewers in the
-- same transaction" is exactly what the deferral exists to allow.
--
-- Subjects: a001 power_admin (moderator + tenant-scope manage), a002 scheduler (manage, but NOT a
-- moderator — the "cannot be named a reviewer" case), a003 team_member (the assignee),
-- a004/a005 team_lead (moderators, added here because the ADR needs TWO reviewers on one task),
-- b001 power_admin of tenant B (the cross-tenant case).

begin;
select plan(29);
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
-- A CAMPAIGN (stream-backed) deliverable on purpose: approving a task must never move it, so the
-- completion assertions below are about the TASK and nothing else. It names no reviewer, so nothing
-- is inherited and every appointment in this file is explicit.
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000056d1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','S56');
insert into deliverables (id, tenant_id, stream_id, name, state) values
  ('aaaaaaaa-0000-0000-0000-0000000056e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000056d1','KV56','in_progress');

-- T1 one mandatory + two optional (the appointment cases) · T2 two mandatory · T3 one mandatory +
-- one optional · T4 the request-changes case · T5 the add/remove case · T6 the lone reviewer (d.2).
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000056a1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000056e1','00000000-0000-0000-0000-00000000a003','Pool56','review', 8),
  ('aaaaaaaa-0000-0000-0000-0000000056a2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000056e1','00000000-0000-0000-0000-00000000a003','TwoMand56','review', 8),
  ('aaaaaaaa-0000-0000-0000-0000000056a3','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000056e1','00000000-0000-0000-0000-00000000a003','Mixed56','review', 8),
  ('aaaaaaaa-0000-0000-0000-0000000056a4','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000056e1','00000000-0000-0000-0000-00000000a003','Reopen56','review', 8),
  ('aaaaaaaa-0000-0000-0000-0000000056a5','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000056e1','00000000-0000-0000-0000-00000000a003','Removal56','todo', 8),
  ('aaaaaaaa-0000-0000-0000-0000000056a6','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000056e1','00000000-0000-0000-0000-00000000a003','Lone56','todo', 8);

insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory) values
  -- T1: one required, one optional. (This was a POOL — nobody marked — until ADR-0089 d.3 made
  -- ending a transaction that way impossible.)
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000056a1','00000000-0000-0000-0000-00000000a001', true),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000056a1','00000000-0000-0000-0000-00000000a004', false),
  -- T2: brand and legal, both required.
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000056a2','00000000-0000-0000-0000-00000000a001', true),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000056a2','00000000-0000-0000-0000-00000000a004', true),
  -- T3: one required sign-off, one second pair of eyes.
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000056a3','00000000-0000-0000-0000-00000000a001', true),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000056a3','00000000-0000-0000-0000-00000000a004', false),
  -- T4: TWO mandatory plus one optional. Two, because the case the ADR describes only exists while
  -- the task is still in review with a mandatory approval already given — with a single mandatory
  -- reviewer that approval completes the task and there is nothing left to reopen.
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000056a4','00000000-0000-0000-0000-00000000a001', true),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000056a4','00000000-0000-0000-0000-00000000a005', true),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000056a4','00000000-0000-0000-0000-00000000a004', false),
  -- T5: two appointments so one of them can be removed.
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000056a5','00000000-0000-0000-0000-00000000a001', true),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000056a5','00000000-0000-0000-0000-00000000a004', false),
  -- T6: one reviewer, deliberately unmarked — ADR-0089 d.2 says the database marks them.
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000056a6','00000000-0000-0000-0000-00000000a004', false);

-- A version and an unresolved comment: sub_task_request_changes refuses to reopen anything without
-- a change description (ADR-0030, settled 19 Aug).
insert into media_records (id, tenant_id, deliverable_id, object_key, content_type) values
  ('aaaaaaaa-0000-0000-0000-0000000056f1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000056e1','k/v1.png','image/png');
insert into review_feedback (id, tenant_id, media_record_id, body, author_user_id, pos_x, pos_y) values
  ('aaaaaaaa-0000-0000-0000-0000000056b1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000056f1','the logo is the wrong blue',
   '00000000-0000-0000-0000-00000000a004', 0.4, 0.4);

set local role authenticated;

-- ============================================================== who may be appointed ====
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

-- THE TENANT FENCE. `references user_profiles(id)` would accept tenant B's admin without
-- complaint: the row would be legal and merely invisible. The composite (tenant_id, user_id) FK is
-- what refuses it, for every writer, without RLS having to go looking (traps.md).
select throws_ok(
  $$insert into sub_task_reviewers (tenant_id, sub_task_id, user_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000056a1',
            '00000000-0000-0000-0000-00000000b001')$$,
  '23503', null,
  'a task cannot name another tenant''s user as a reviewer');

-- ADR-0043 d.3: every named reviewer must hold reviews:moderate. a002 runs the schedule and holds
-- project_tasks:manage, but naming somebody who cannot act was how tasks used to get stuck with a
-- reviewer who could neither approve nor send back.
select throws_ok(
  $$insert into sub_task_reviewers (tenant_id, sub_task_id, user_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000056a1',
            '00000000-0000-0000-0000-00000000a002')$$,
  '22023', null,
  'somebody who cannot moderate reviews cannot be appointed a reviewer');

select throws_ok(
  $$insert into sub_task_reviewers (tenant_id, sub_task_id, user_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000056a1',
            '00000000-0000-0000-0000-00000000a003')$$,
  '22023', null,
  'and neither can the assignee — no self-review, per appointment (ADR-0043 d.3)');

select lives_ok(
  $$insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory)
    values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000056a1',
            '00000000-0000-0000-0000-00000000a005', false)$$,
  'somebody who manages the task may appoint a third reviewer (RLS allow)');

-- approved_at is not client-writable (ADR-0043 d.1). This caller MAY manage the row, which is
-- exactly the danger: without the guard they could forge a mandatory colleague's sign-off. The
-- is_mandatory half of the same statement is what proves the write REACHED the row — otherwise a
-- null approved_at would only be telling us RLS refused the update.
update sub_task_reviewers set approved_at = now(), is_mandatory = true
 where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000056a5'
   and user_id = '00000000-0000-0000-0000-00000000a004';
select is((select is_mandatory from sub_task_reviewers
           where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000056a5'
             and user_id = '00000000-0000-0000-0000-00000000a004'),
  true,
  'a manager may change an appointment — mandatory-ness is theirs to set');
select is((select approved_at from sub_task_reviewers
           where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000056a5'
             and user_id = '00000000-0000-0000-0000-00000000a004'),
  null,
  'but not stamp somebody else''s approval — the verdict is server-written only');

-- ------------------------------------------------------------------- RLS: the deny ----
-- a003 is the assignee AND holds project_tasks:manage from the seed, so a refusal here proves the
-- SCOPE axis decided it (reach 'self'), not the grant.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select throws_ok(
  $$insert into sub_task_reviewers (tenant_id, sub_task_id, user_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000056a1',
            '00000000-0000-0000-0000-00000000a004')$$,
  '42501', null,
  'being the assignee does not let you choose who reviews your own work');

-- ------------------------------------------------------------------- cross-tenant ----
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000b001'), true);
select is((select count(*)::int from sub_task_reviewers), 0,
  'tenant B''s power admin sees none of tenant A''s appointments');
delete from sub_task_reviewers where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000056a1';
-- Counted back as tenant A: from tenant B the rows are invisible either way, so asking there could
-- not tell "the delete was refused" apart from "the delete worked".
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select is((select count(*)::int from sub_task_reviewers
           where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000056a1'), 3,
  'and cannot delete one either — the delete matched no visible row');

-- ================================================= a live task keeps a reviewer ====
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

-- Removing a NON-last reviewer is ordinary work: cover for leave, a change of mind.
select lives_ok(
  $$delete from sub_task_reviewers
     where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000056a5'
       and user_id = '00000000-0000-0000-0000-00000000a004';
    set constraints all immediate$$,
  'a non-last reviewer can be removed');
set constraints all deferred;

-- Removing the LAST one is not: that is the rule chk_sub_tasks_reviewer_required used to hold, and
-- ADR-0043 d.4 keeps it, only as a trigger.
select throws_ok(
  $$delete from sub_task_reviewers
     where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000056a5'
       and user_id = '00000000-0000-0000-0000-00000000a001';
    set constraints all immediate$$,
  '23514', null,
  'removing the LAST reviewer from a live assigned task is refused');
set constraints all deferred;

-- ================================== one reviewer is the required one (ADR-0089 d.2, d.3) ====
-- This block replaces the pool assertion ("with nobody mandatory, one is enough"). A task with
-- exactly one reviewer has exactly one possible answer, so the database gives it at commit; a task
-- with several and none marked would need the system to choose among people, so it is refused.
select lives_ok($$set constraints all immediate$$,
  'a task with ONE unmarked reviewer ends its transaction without complaint');
set constraints all deferred;
select is((select is_mandatory from sub_task_reviewers
           where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000056a6'), true,
  '… and that reviewer is now REQUIRED — the lone reviewer is the required one by definition (d.2)');

select throws_ok(
  $$insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory) values
      ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000056a6','00000000-0000-0000-0000-00000000a005', false);
    update sub_task_reviewers set is_mandatory = false
     where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000056a6';
    set constraints all immediate$$,
  '23514', null,
  'several reviewers with none marked are refused at commit — the system may not choose among people (d.3)');
set constraints all deferred;

-- =================================== with two mandatory, the first does NOT complete ====
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select lives_ok($$select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000056a2')$$,
  'the first mandatory reviewer approves');
select is((select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000056a2'),
  'review',
  'and the task is STILL in review — the work owes a sign-off somebody marked as required');
select isnt((select approved_at from sub_task_reviewers
             where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000056a2'
               and user_id = '00000000-0000-0000-0000-00000000a001'), null,
  'their own verdict is recorded all the same — an approval is not lost for being early');

-- A reviewer who has approved drops out of their OWN inbox; one who has not still sees the task.
-- This is the query the "Awaiting my review" panel runs (ADR-0043 d.7).
select is((select count(*)::int from sub_task_reviewers r
           join sub_tasks st on st.id = r.sub_task_id
           where r.user_id = '00000000-0000-0000-0000-00000000a001'
             and r.approved_at is null and st.status = 'review'
             and st.id = 'aaaaaaaa-0000-0000-0000-0000000056a2'), 0,
  'the reviewer who approved drops out of their own inbox …');
select is((select count(*)::int from sub_task_reviewers r
           join sub_tasks st on st.id = r.sub_task_id
           where r.user_id = '00000000-0000-0000-0000-00000000a004'
             and r.approved_at is null and st.status = 'review'
             and st.id = 'aaaaaaaa-0000-0000-0000-0000000056a2'), 1,
  '… while the one who has not still sees it — the thing that gates the task must not vanish');

select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a004'), true);
select lives_ok($$select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000056a2')$$,
  'the second mandatory reviewer approves');
select is((select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000056a2'),
  'done', 'and NOW the task completes — the last of them decided it');
select is((select approved_by from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000056a2'),
  '00000000-0000-0000-0000-00000000a004'::uuid,
  'approved_by names the reviewer who completed it, which is the moment the work was accepted');

-- ================================ an optional reviewer answers; only a required one approves ====
-- ADR-0043 d.5 let an optional reviewer approve, recorded but never completing; ADR-0089 d.5
-- withdraws Approve from them altogether — their contribution is an ANSWER.
select throws_ok($$select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000056a3')$$,
  '42501', null,
  'the OPTIONAL reviewer on the mixed task cannot approve it (ADR-0089 d.5)');
select lives_ok($$select public.sub_task_respond('aaaaaaaa-0000-0000-0000-0000000056a3')$$,
  '… they answer instead');
select is((select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000056a3'),
  'review',
  'the task does not complete — a second pair of eyes is not the required sign-off');

-- ============================================== an approval belongs to a VERSION ====
-- One of the two mandatory reviewers agrees; the task stays in review, owing the other. Then the
-- OPTIONAL reviewer spots a problem and sends it back, and every approval on the task goes,
-- including the mandatory one already given (ADR-0043 d.6).
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000056a4');
select isnt((select approved_at from sub_task_reviewers
             where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000056a4'
               and user_id = '00000000-0000-0000-0000-00000000a001'), null,
  'the mandatory reviewer''s approval is on the record …');

select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a004'), true);
select lives_ok($$select app.sub_task_request_changes('aaaaaaaa-0000-0000-0000-0000000056a4')$$,
  'an OPTIONAL reviewer can stop the job — anyone appointed may request changes');
select is((select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000056a4'),
  'todo', 'the task reopens for a fresh timed round (ADR-0030)');
select is((select count(*)::int from sub_task_reviewers
           where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000056a4'
             and approved_at is not null), 0,
  '… and EVERY approval on it is cleared, the mandatory one included — the work is different now');

select * from finish();
rollback;
