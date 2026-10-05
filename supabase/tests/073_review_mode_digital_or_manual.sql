-- I19.15 (ADR-0059) — a task is reviewed digitally or manually.
--
-- The defect this closes is a DEAD END, not a wrong answer: a task whose output is a shoot day or a
-- print run could not be submitted, so it could not be approved, so its deliverable could never
-- reach `approved`.
--
-- **The suite walks one deliverable through a whole round-trip rather than asserting in pieces**,
-- because the two arms have to coexist under one deliverable and that is the shape that was broken.
-- An OOH billboard has an Artwork task somebody uploads and an Installation task somebody drives a
-- van to, and the deliverable cannot finish until both are settled.
--
-- The two assertions that matter most:
--
--   * **4** — a DIGITAL task is still refused without its own version. ADR-0058 d.5 must pass
--     unmodified; this ADR adds a branch beside it and softens nothing.
--   * **10** — a manual submission IS an unresolved comment on the task, so a naive send-back
--     predicate would let every manual task satisfy its own gate and let a reviewer reopen the work
--     without writing a word.
--
-- Subjects (helpers/seed.sql, tenant A): a001 = power_admin (reviews:moderate), a003 = team_member.

begin;
select plan(26);
\ir helpers/seed.sql

reset role;

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000073f1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','Production 2027');

-- The fixture department (ADR-0099 d.2, 23 Sep): a deliverable's department is its own and is no
-- longer derived from the owner, so a fixture that names an owner with no department must say
-- which department the work belongs to. Created here rather than assumed.
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000de0ff', 'aaaaaaaa-0000-0000-0000-000000000001', 'Fixture dept')
on conflict (id) do nothing;

insert into deliverables (id, tenant_id, stream_id, name, state, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000073e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000073f1','Billboard, Karrada','in_progress', 'aaaaaaaa-0000-0000-0000-0000000de0ff');

insert into sub_tasks (id, tenant_id, deliverable_id, title, assignee_id, status, review_mode, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000073a1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000073e1','Installation','00000000-0000-0000-0000-00000000a003','in_progress','manual', 8),
  ('aaaaaaaa-0000-0000-0000-0000000073a2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000073e1','Artwork','00000000-0000-0000-0000-00000000a003','in_progress','digital', 8);

insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000073a1','00000000-0000-0000-0000-00000000a001', true),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000073a2','00000000-0000-0000-0000-00000000a001', true);

-- A version somewhere else entirely, so the CHECK assertions have a real media_record to point at.
-- On its OWN deliverable deliberately: a version on 73e1 with a null sub_task_id satisfies the
-- LEGACY arm of the digital submit gate, which would quietly defeat assertion 4.
insert into deliverables (id, tenant_id, stream_id, name, state, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000073e9','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000073f1','Somewhere else','in_progress', 'aaaaaaaa-0000-0000-0000-0000000de0ff');
insert into media_records (id, tenant_id, deliverable_id, object_key, content_type) values
  ('aaaaaaaa-0000-0000-0000-0000000073c9','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000073e9','k/elsewhere.png','image/png');

-- ================================= 1-4. the dead end, and the gate that stays ====
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);

select is((select review_mode from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000073a1'),
  'manual', 'a task carries its review mode');

-- Nothing at all is refused in BOTH modes. Manual removes the file requirement; it does not remove
-- the requirement to submit something a reviewer can read.
-- I52.15: a task is submitted only after it was started; start it (a no-op if it already is).
do $s$ begin perform app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000073a1'); exception when others then null; end $s$;
select throws_ok(
  $$select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000073a1', 30)$$,
  '55000', null,
  'a manual task with no note is refused — a reviewer asked to approve nothing is rubber-stamping');

insert into review_feedback (tenant_id, sub_task_id, source, body, author_user_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000073a1',
   'internal','Installed on the Karrada site, client signed the sheet on site.',
   '00000000-0000-0000-0000-00000000a003');

-- I52.15: a task is submitted only after it was started; start it (a no-op if it already is).
do $s$ begin perform app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000073a1'); exception when others then null; end $s$;
-- ADR-0106 (I59.20): sent in the same transaction as its Start (or never started) — an UNTIMED round, accepted as one.
select lives_ok(
  $$select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000073a1', 30, true)$$,
  'with the assignee''s own note, a manual task submits — no file anywhere near it');

-- ADR-0058 d.5, unmodified. The assertion that proves the new branch sits BESIDE the old one.
-- I52.15: a task is submitted only after it was started; start it (a no-op if it already is).
do $s$ begin perform app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000073a2'); exception when others then null; end $s$;
select throws_ok(
  $$select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000073a2', 30)$$,
  '55000', null,
  'a DIGITAL task is still refused without its own version — nothing was softened');

-- ============================================= 5-7. exactly one parent ====
reset role;
select throws_ok(
  $$insert into review_feedback (tenant_id, source, body, author_user_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001','internal','orphan',
            '00000000-0000-0000-0000-00000000a003')$$,
  '23514', null,
  'a comment about nothing is refused: neither a version nor a task');

select throws_ok(
  $$insert into review_feedback (tenant_id, media_record_id, sub_task_id, source, body, author_user_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000073c9',
            'aaaaaaaa-0000-0000-0000-0000000073a1','internal','two parents',
            '00000000-0000-0000-0000-00000000a003')$$,
  '23514', null,
  'a comment on a version AND a task is refused — exactly one parent, not at most one');

select is(
  (select round from review_feedback where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000073a1'),
  1,
  'a task-anchored comment is stamped with the round, same arithmetic as a version''s');

-- ================================ 8-9. both arms settle the same deliverable ====
-- The digital sibling gets its file and submits. Only NOW can the deliverable reach review: the
-- ADR-0030 readiness gate holds it shut while any task is open, which is what made the manual dead
-- end fatal rather than merely annoying — one unsubmittable task strands the whole deliverable.
reset role;
insert into media_records (tenant_id, deliverable_id, sub_task_id, object_key, content_type) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000073e1',
   'aaaaaaaa-0000-0000-0000-0000000073a2','k/artwork-v1.pdf','application/pdf');

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
-- I52.15: a task is submitted only after it was started; start it (a no-op if it already is).
do $s$ begin perform app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000073a2'); exception when others then null; end $s$;
-- ADR-0106 (I59.20): sent in the same transaction as its Start (or never started) — an UNTIMED round, accepted as one.
select lives_ok(
  $$select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000073a2', 30, true)$$,
  'the digital sibling submits on its own version, as it always did');

reset role;
select lives_ok(
  $$update deliverables set state = 'in_review'
     where id = 'aaaaaaaa-0000-0000-0000-0000000073e1'$$,
  'with a manual task and a digital one both submitted, the deliverable reaches review');

-- ================================ 10-13. the send-back gate ====
-- **THE assertion.** The submission note is an unresolved comment on the task. If it counted here,
-- every manual task would arrive already satisfying its own send-back and a reviewer could reopen
-- the work without saying why.
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

select throws_ok(
  $$select app.sub_task_request_changes('aaaaaaaa-0000-0000-0000-0000000073a1')$$,
  '55000', null,
  'the maker''s own submission note does NOT satisfy the send-back gate — the reviewer must say why');

insert into review_feedback (tenant_id, sub_task_id, source, body, author_user_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000073a1',
   'internal','Wrong panel — that is the teaser creative, not the Ramadan one.',
   '00000000-0000-0000-0000-00000000a001');

select lives_ok(
  $$select app.sub_task_request_changes('aaaaaaaa-0000-0000-0000-0000000073a1')$$,
  'with the reviewer''s own comment it sends back, exactly as a digital task does');

reset role;
select is((select status::text from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000073a1'),
  'todo', 'a manual task reopens to todo for a fresh timed round');
select is(
  (select count(*)::int from sub_task_reviewers
    where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000073a1' and approved_at is not null),
  0, 'and every approval on it is cleared, as ADR-0043 d.6 requires');

-- ================================== 14-16. the round moves with the task ====
-- The round-two trap 047 proves for versions, proved again for notes: last round's account is not
-- an account of this round's work.
select is((select app.task_review_round('aaaaaaaa-0000-0000-0000-0000000073a1')), 2,
  'the send-back put the task on round 2');

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
-- I52.15: a task is submitted only after it was started; start it (a no-op if it already is).
do $s$ begin perform app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000073a1'); exception when others then null; end $s$;
select throws_ok(
  $$select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000073a1', 30)$$,
  '55000', null,
  'round 1''s note does not submit round 2 — the account has to be of the work just done');

insert into review_feedback (tenant_id, sub_task_id, source, body, author_user_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000073a1',
   'internal','Re-hung with the Ramadan panel, photographed on site.',
   '00000000-0000-0000-0000-00000000a003');
-- I52.15: a task is submitted only after it was started; start it (a no-op if it already is).
do $s$ begin perform app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000073a1'); exception when others then null; end $s$;
-- ADR-0106 (I59.20): sent in the same transaction as its Start (or never started) — an UNTIMED round, accepted as one.
select lives_ok(
  $$select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000073a1', 30, true)$$,
  'with round 2''s own note, the manual task submits again');

-- ==================================== 17. the container completes ====
reset role;
update deliverables set state = 'in_review' where id = 'aaaaaaaa-0000-0000-0000-0000000073e1';

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000073a2');
select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000073a1');
select is(
  (select state::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000073e1'),
  'approved',
  'approving the last task carries the deliverable — a manual task completes work like any other');

-- ============================= 18-25. the template proposes, the task decides ====
-- The pgTAP helper seeds roles, not the taxonomy, so this suite seeds what it asserts on.
reset role;
select app.seed_tenant_deliverable_taxonomy(id) from tenants;
select app.seed_tenant_workflow_templates(id) from tenants;
select app.seed_tenant_workflow_step_corrections(id) from tenants;
select app.seed_tenant_step_review_modes(id) from tenants;

select is(
  (select count(*)::int from workflow_steps ws
     join workflow_templates wt on wt.id = ws.template_id
    where wt.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and wt.code = 'WF-09' and ws.title_en = 'Installation' and ws.review_mode = 'manual'),
  1, 'the seed marks the physical steps: WF-09 Installation is manual');

-- Prepress is the judgement call most likely to be wrong, so it is asserted rather than assumed:
-- its output is a print-ready PDF and is genuinely reviewable as one. The print RUN is the physical
-- act, and that is the step that is manual.
select is(
  (select review_mode from workflow_steps ws
     join workflow_templates wt on wt.id = ws.template_id
    where wt.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and wt.code = 'WF-05' and ws.title_en = 'Prepress'),
  'digital', 'Prepress stays digital — the print run is the physical act, not the prepress');

select is(
  (select count(*)::int from workflow_steps ws
     join workflow_templates wt on wt.id = ws.template_id
    where wt.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and ws.review_mode = 'manual'),
  32, 'thirty-two of the ninety-seven seeded steps are manual');

-- Re-running the seed over a step somebody has decided must change nothing. This is the property
-- `not null default` makes hard to get right: the guard is `review_mode = 'digital'`, which is only
-- safe because the function runs at the two moments where every row IS still the default.
update workflow_steps ws set review_mode = 'digital'
  from workflow_templates wt
 where wt.id = ws.template_id and wt.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   and wt.code = 'WF-09' and ws.title_en = 'Installation';
select app.seed_tenant_step_review_modes('aaaaaaaa-0000-0000-0000-000000000001');
select is(
  (select review_mode from workflow_steps ws
     join workflow_templates wt on wt.id = ws.template_id
    where wt.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and wt.code = 'WF-09' and ws.title_en = 'Installation'),
  'manual', 'the seed re-marks a step that reads as unset');

-- ------------- the two-level assertion: the materialiser stamps, then lets go ----
-- A deliverable typed to WF-09 lays its steps down, and each task must arrive carrying its OWN
-- step's mode — otherwise the template is decoration and the toggle has to be set by hand on every
-- task, which is the complaint I19.14 came from.
update deliverable_types set default_workflow_template_id =
  (select id from workflow_templates
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and code = 'WF-09')
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and code = 'DIG-003';

insert into deliverables (id, tenant_id, job_id, name, state, owner_user_id, deliverable_type_id)
select 'aaaaaaaa-0000-0000-0000-0000000073e2','aaaaaaaa-0000-0000-0000-000000000001',
       'aaaaaaaa-0000-0000-0000-00000000f001','Karrada billboard','in_progress',
       '00000000-0000-0000-0000-00000000a003', dt.id
  from deliverable_types dt
 where dt.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and dt.code = 'DIG-003';

-- Amended 5 Sep (ADR-0071 d.10, I38.9). These three looked the task up by `st.title = 'Installation'`,
-- which stopped matching the moment the materialiser began COMPOSING titles from step, deliverable
-- and unit — the task is now "Installation — Karrada billboard". The assertions are about REVIEW
-- MODE and were never about the title, so they now find the task through `workflow_step_id`, which
-- is the fact they actually depend on and cannot be broken by a naming decision.
select is(
  (select st.review_mode from sub_tasks st
     join workflow_steps ws on ws.id = st.workflow_step_id
    where st.deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000073e2' and ws.title_en = 'Installation'),
  'manual', 'the materialiser stamps each task from its own step');
select is(
  (select st.review_mode from sub_tasks st
     join workflow_steps ws on ws.id = st.workflow_step_id
    where st.deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000073e2' and ws.title_en = 'Artwork'),
  'digital', 'and the digital steps under the SAME template stay digital');

-- The half that makes it a COPY rather than a reference: editing the template afterwards must not
-- reach a task somebody may already be doing (ADR-0052 d.14, applied to the mode).
update workflow_steps ws set review_mode = 'digital'
  from workflow_templates wt
 where wt.id = ws.template_id and wt.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   and wt.code = 'WF-09' and ws.title_en = 'Installation';
select is(
  (select st.review_mode from sub_tasks st
     join workflow_steps ws on ws.id = st.workflow_step_id
    where st.deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000073e2' and ws.title_en = 'Installation'),
  'manual', 'editing the template afterwards changes nothing about the task it already made');

-- A hand-added task — no workflow step at all (I19.3) — is digital, because the gate must read one
-- unambiguous value on every row.
insert into sub_tasks (id, tenant_id, deliverable_id, title, status) values
  ('aaaaaaaa-0000-0000-0000-0000000073a4','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000073e2','Hand-added','todo');
select is((select review_mode from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000073a4'),
  'digital', 'a hand-added task with no step is digital, not null');

-- ============================================ 26. tenant isolation ====
-- Feedback anchored to a task never crosses a tenant, the same assertion 066 makes for versions.
select is(
  (select count(*)::int from review_feedback rf
     join sub_tasks st on st.id = rf.sub_task_id
    where rf.tenant_id is distinct from st.tenant_id),
  0, 'no task-anchored comment belongs to a task in another tenant');

select * from finish();
rollback;
