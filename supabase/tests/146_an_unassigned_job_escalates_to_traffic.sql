-- SJ-v3-04 / ADR-0045 (22 Sep) — an opened single job whose task nobody has been given escalates
-- to the traffic managers and its owner after the tenant's hours, once, on the working week.
--
-- Seed: a002 holds `scheduler` (Traffic); a003 is the Creative lead who owns the job.
--
-- 26 Sep (ADR-0108, I59.24): the rung now reads its hours and recipients from the tenant's
-- `tenant_escalation_rules` (seeded below, as provisioning does), counts REAL hours, and raises
-- `escalated` (detail.kind 'unassigned', detail.as the reason) instead of `assignment_overdue`.
-- The working-hours function is still asserted: it exists, it is simply no longer on this path.
begin;
select plan(9);
\ir helpers/seed.sql
select app.seed_tenant_escalation_rules(id) from tenants;

-- Working hours: Friday and Saturday do not count.
select is(app.working_hours_between('2026-09-23 10:00+03'::timestamptz, '2026-09-24 10:00+03'::timestamptz), 24::numeric, 'a weekday to the next: 24 working hours');
select is(app.working_hours_between('2026-09-24 10:00+03'::timestamptz, '2026-09-27 10:00+03'::timestamptz), 24::numeric, 'Thursday to Sunday: Friday and Saturday are not counted');
select is(app.working_hours_between('2026-09-24 10:00+03'::timestamptz, '2026-09-24 09:00+03'::timestamptz), 0::numeric, 'nothing before the start');

-- Two opened jobs: one with an unassigned task (waiting), one fully assigned (fine).
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id, approved_at) values
  ('aaaaaaaa-0000-0000-0000-0000000e9461', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Waiting job 146', 'approved', 'single_job',
   '00000000-0000-0000-0000-00000000a001', '2026-09-21 10:00+03'),
  ('aaaaaaaa-0000-0000-0000-0000000e9462', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Assigned job 146', 'approved', 'single_job',
   '00000000-0000-0000-0000-00000000a001', '2026-09-21 10:00+03');
insert into streams (id, tenant_id, campaign_id, name)
select c.id, c.tenant_id, c.id, c.name from campaigns c where c.id::text like '%e946%';
insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d9461', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000e9461', 'Carousel 146', 'in_progress', '00000000-0000-0000-0000-00000000a003'),
  ('aaaaaaaa-0000-0000-0000-0000000d9462', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000e9462', 'Static 146', 'in_progress', '00000000-0000-0000-0000-00000000a003');
-- I59 (settled 25 Sep): a single job's clock starts when its owner approved the task list, like a
-- campaign piece's — here at the job's release, as the owner approves it on opening. The stamp is
-- fenced; the fixture raises the RPC's flag as test_accept_campaign_work does.
select set_config('app.task_list_approval', 'on', true);
update deliverables set tasks_approved_at = '2026-09-21 10:00+03', tasks_approved_by = owner_user_id
 where id in ('aaaaaaaa-0000-0000-0000-0000000d9461', 'aaaaaaaa-0000-0000-0000-0000000d9462');
select set_config('app.task_list_approval', '', true);
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order, assignee_id, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000f9461', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000d9461', 'Design 146', 'todo', 1, null, null),
  ('aaaaaaaa-0000-0000-0000-0000000f9462', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000d9462', 'Design 146b', 'todo', 1, '00000000-0000-0000-0000-00000000a003', 8);

-- Too early: 12 hours on, nothing goes.
select is(app.escalate_unassigned_jobs('2026-09-21 22:00+03'::timestamptz), 0, 'nothing escalates before the tenant''s hours');

-- 26 hours on (a Tuesday): the waiting job goes to Traffic (a002) and the owner (a003); the assigned one does not.
select is(app.escalate_unassigned_jobs('2026-09-22 12:00+03'::timestamptz), 1, 'one job escalates once the hours have passed');
select results_eq($$
  select user_id from notifications where type = 'escalated' and detail->>'kind' = 'unassigned' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000d9461' order by user_id
$$, $$ values ('00000000-0000-0000-0000-00000000a002'::uuid), ('00000000-0000-0000-0000-00000000a003'::uuid) $$,
  'the traffic manager (scheduler) and the owner are both told — nobody behind their back (ADR-0045 d.2)');
select is(
  (select detail->'as' from notifications where type = 'escalated' and user_id = '00000000-0000-0000-0000-00000000a003'),
  '["owner"]'::jsonb, 'the owner''s row says it is the owner''s, so the words differ');
select is_empty($$
  select 1 from notifications where type = 'escalated' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000d9462'
$$, 'a fully assigned job is not escalated');

-- Idempotent: the sweep an hour later sends nothing more.
select is(app.escalate_unassigned_jobs('2026-09-22 13:00+03'::timestamptz), 0, 'a second sweep sends nothing again');

select * from finish();
rollback;
