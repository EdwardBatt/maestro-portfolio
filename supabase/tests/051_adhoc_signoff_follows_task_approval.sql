-- 20260825120000: approving the task signs off an AD-HOC deliverable.
--
-- The regression this pins: ADR-0038 moved approval to the task, and the reviewer inbox stopped
-- moving the deliverable. Nothing else ever advances it — every automatic write to
-- deliverables.state in the migration history moves it BACKWARDS — so approved ad-hoc work sat in
-- in_review forever and never reached the /deliverables Ad-hoc tab, which lists state='approved'.
--
-- Subjects: a001 power_admin is the reviewer (holds reviews:moderate, which the transition guard
-- requires for sign-off); a003 team_member is the assignee. Ad-hoc = stream_id null, job-backed.

begin;
select plan(7);
\ir helpers/seed.sql

-- An ad-hoc deliverable mid-review with one submitted task, exactly as the reviewer inbox sees it.
insert into deliverables (id, tenant_id, job_id, name, state, reviewer_id) values
  ('dddd0000-0000-0000-0000-00000000510a', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001', 'adhoc-signoff', 'in_review',
   '00000000-0000-0000-0000-00000000a001');
-- ADR-0043: the reviewer lives in sub_task_reviewers now, and the seed trigger appoints the
-- deliverable's reviewer (a001) as this task's, so the fixtures no longer name one per task.
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, status, sla_hours) values
  ('57570000-0000-0000-0000-00000000510a', 'aaaaaaaa-0000-0000-0000-000000000001',
   'dddd0000-0000-0000-0000-00000000510a', '00000000-0000-0000-0000-00000000a003',
   'adhoc-task', 'review', 8);

-- A CAMPAIGN deliverable (stream-backed) in the same state, to prove it is NOT moved.
-- Its own work type + stream, the same shape 045 uses (the seed carries no stream of its own).
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000051d1', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001', 'S51');
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id) values
  ('dddd0000-0000-0000-0000-00000000510b', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000051d1', 'campaign-signoff', 'in_review',
   '00000000-0000-0000-0000-00000000a001');
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, status, sla_hours) values
  ('57570000-0000-0000-0000-00000000510b', 'aaaaaaaa-0000-0000-0000-000000000001',
   'dddd0000-0000-0000-0000-00000000510b', '00000000-0000-0000-0000-00000000a003',
   'campaign-task', 'review', 8);

-- A job-backed deliverable holding TWO tasks, for the last assertion. Fixtures are inserted as
-- superuser (before the role switch) so RLS and ADR-0040's assignment trigger stay out of a test
-- that is about sign-off.
insert into deliverables (id, tenant_id, job_id, name, state, reviewer_id) values
  ('dddd0000-0000-0000-0000-00000000510c', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001', 'adhoc-two-tasks', 'in_review',
   '00000000-0000-0000-0000-00000000a001');
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, status, sla_hours) values
  ('57570000-0000-0000-0000-00000000510c', 'aaaaaaaa-0000-0000-0000-000000000001',
   'dddd0000-0000-0000-0000-00000000510c', '00000000-0000-0000-0000-00000000a003',
   'first', 'review', 8),
  ('57570000-0000-0000-0000-00000000510d', 'aaaaaaaa-0000-0000-0000-000000000001',
   'dddd0000-0000-0000-0000-00000000510c', '00000000-0000-0000-0000-00000000a003',
   'second', 'in_progress', 8);

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

-- ------------------------------------------------ the regression, directly ----
select lives_ok(
  $$select public.sub_task_approve('57570000-0000-0000-0000-00000000510a')$$,
  'the appointed reviewer approves the ad-hoc task');

select is((select status from sub_tasks where id = '57570000-0000-0000-0000-00000000510a'),
  'done', 'the task is done (ADR-0038 — unchanged)');

select is((select state::text from deliverables where id = 'dddd0000-0000-0000-0000-00000000510a'),
  'approved',
  'AND the ad-hoc deliverable is signed off — the half that went missing, and the reason approved '
  'ad-hoc work never reached the Ad-hoc tab');

select isnt((select approved_by from sub_tasks where id = '57570000-0000-0000-0000-00000000510a'),
  null, 'the reviewer decision is stamped on the task, which is what the repair keys on');

-- ----------------------------- a campaign deliverable IS moved (ADR-0058) ----
-- UPDATED 28 Aug, and this is a real change of behaviour, not a test bent to fit.
--
-- This block used to assert the opposite: that a campaign deliverable stayed `in_review` because
-- `app.maybe_complete_sub_task` was fenced by `v_stream is null` to ad-hoc work only. ADR-0058 d.6
-- removes that fence. Edward, 28 Aug: *"if all sub-tasks are approved, then the deliverable by
-- default is approved"* — a deliverable is a container, and it is approved as a CONSEQUENCE of the
-- work beneath it rather than as a separate act performed on it.
--
-- **ADR-0038's actual concern survives untouched.** Its rule was "one task must never carry a
-- deliverable that holds several", and that was never what the stream fence protected — the
-- `not exists (… status not in ('done','cancelled'))` check is, and it still runs. The section
-- immediately below proves it: an unfinished sibling still holds the deliverable, and only the LAST
-- approval carries it. That assertion is unchanged and still passes.
select lives_ok(
  $$select public.sub_task_approve('57570000-0000-0000-0000-00000000510b')$$,
  'the same reviewer approves the campaign task');
select is((select state::text from deliverables where id = 'dddd0000-0000-0000-0000-00000000510b'),
  'approved',
  'the CAMPAIGN deliverable is signed off too — its only task is settled, so the container is done');

-- ----------------------------------------- an unfinished sibling holds it ----
-- Belt-and-braces for a job-backed deliverable holding more than one task: the LAST approval carries
-- it, an earlier one does not.
select public.sub_task_approve('57570000-0000-0000-0000-00000000510c');
select is((select state::text from deliverables where id = 'dddd0000-0000-0000-0000-00000000510c'),
  'in_review',
  'an unapproved sibling holds sign-off shut');

select * from finish();
rollback;
