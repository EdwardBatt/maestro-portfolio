-- ADR-0070 d.5 — the new gate must not touch work it was never about.
--
-- This suite exists because the gate added by `20260903130000` sits in front of EVERY sub-task
-- assignment in the product. If it reached further than intended, the symptom would be that
-- assigning anything stopped working — and the two kinds of work most likely to be caught are the
-- two with no department brief to approve:
--
--   * AD-HOC work, which hangs off a JOB and therefore has no stream and no campaign. It is 131 of
--     this tenant's deliverables, and it is created and assigned from the schedule constantly.
--   * CAMPAIGN work whose department has not written its brief — which, since 20 Sep, is HELD.
--
-- 20 Sep (ADR-0072 d.6, `20260920150000`): d.5 is closed. A department that has not GENERATED its
-- brief has not approved it, and a deliverable with no department (a state no door produces — the
-- owner is required, the department follows) is held too. Ad-hoc work alone stays outside the
-- gate: it has no campaign to have a brief. The brief cases are pgTAP 133; this suite keeps the
-- ad-hoc assertion and the "campaign, no brief" fixture as the held case.
begin;
select plan(4);
\ir helpers/seed.sql

-- The shared seed's ad-hoc deliverable (`f101`) hangs off the Ad-hoc job and has no stream.
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000ad002','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f101','Retouch','todo', 9, 8);

select ok(app.sub_task_brief_is_approved('aaaaaaaa-0000-0000-0000-0000000ad002'),
  'AD-HOC work is not gated by the department-brief rule — it has no campaign to have one');

-- Campaign work with no brief written — and, having no owner, no department. Held either way.
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000ad004','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','S');
insert into deliverables (id, tenant_id, stream_id, name, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000ad005','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000ad004','Campaign, no brief','00000000-0000-0000-0000-00000000a001');
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000ad003','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000ad005','No brief yet','todo', 1, 8);

select ok(not app.sub_task_brief_is_approved('aaaaaaaa-0000-0000-0000-0000000ad003'),
  'the department brief is still unapproved — the machinery is retired, not deleted (ADR-0100 d.6)');
-- ADR-0100 d.2: the refusal's words moved with the gate. It used to name the DEPARTMENT's brief;
-- it now names the deliverable's OWNER, because they are the person who can unblock it.
select matches(app.sub_task_work_acceptance_refusal('aaaaaaaa-0000-0000-0000-0000000ad003'),
  'task list.*has not been approved',
  'and the work is held by the OWNER''s task list now, not the department''s brief');

-- End to end, through the real trigger and RLS, as a real caller.
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select lives_ok($$
  update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a003'
   where id = 'aaaaaaaa-0000-0000-0000-0000000ad002'
$$, 'and ad-hoc work can still be assigned, through the gate itself');

select * from finish();
rollback;
