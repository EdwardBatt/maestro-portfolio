-- I59.24 / ADR-0108 — the sweep: real elapsed time (a weekend counts), once per cause, campaign pieces
-- from their task-list approval, the task list / brief rung, review remind then escalate, and the
-- weekly over-capacity check; the dry run sends nothing; Needs you shows only what is still stalled.
--
-- Cast (Tenant A): a002 Traffic Manager (scheduler) · a003 Creative A, owner of the work · a001 Admin A,
-- the reviewer · a181 AM 172 · a182 Team lead 172 · a183 Deputy 172 · a184 Dept lead 172.
begin;
select plan(41);
\ir helpers/seed.sql
select app.seed_tenant_reminder_settings(id) from tenants;
select app.seed_tenant_escalation_rules(id) from tenants;
-- Campaigns approved from 1 Sep onwards ask their owners for the task list (ADR-0100 d.7's cut-over).
update app_settings set value = '2026-09-01 00:00+03' where key = 'task_list_gate_from';

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de1720', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 172');
insert into teams (id, tenant_id, name, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000e1720', 'aaaaaaaa-0000-0000-0000-000000000001', 'Studio 172', 'aaaaaaaa-0000-0000-0000-000000de1720');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a181', 'am172@a.test'),
  ('00000000-0000-0000-0000-00000000a182', 'tl172@a.test'),
  ('00000000-0000-0000-0000-00000000a183', 'dep172@a.test'),
  ('00000000-0000-0000-0000-00000000a184', 'dl172@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid, v.team::uuid
from (values
  ('00000000-0000-0000-0000-00000000a181', 'AM 172',        'account_manager',  null, null),
  ('00000000-0000-0000-0000-00000000a182', 'Team lead 172', 'team_lead',        'aaaaaaaa-0000-0000-0000-000000de1720', 'aaaaaaaa-0000-0000-0000-0000000e1720'),
  ('00000000-0000-0000-0000-00000000a183', 'Deputy 172',    'deputy_team_lead', 'aaaaaaaa-0000-0000-0000-000000de1720', 'aaaaaaaa-0000-0000-0000-0000000e1720'),
  ('00000000-0000-0000-0000-00000000a184', 'Dept lead 172', 'department_lead',  'aaaaaaaa-0000-0000-0000-000000de1720', null)
) as v(id, name, role_key, dept, team);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id in ('00000000-0000-0000-0000-00000000a181', '00000000-0000-0000-0000-00000000a182');

-- A single job released Thursday 24 Sep 10:00 (Baghdad) with a task nobody holds; a campaign approved
-- 1 Sep whose piece's task list was approved Saturday 26 Sep 08:00, also with a task nobody holds.
-- I59 (settled 26 Sep): a single job's unassigned clock also starts at its task list's approval — the
-- job's Carousel was approved at release; its Static (d1724) has a task list nobody has approved yet,
-- which is the task_list rung's.
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id, approved_at) values
  ('aaaaaaaa-0000-0000-0000-0000000c1721', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'Job 172', 'approved', 'single_job', '00000000-0000-0000-0000-00000000a181', '2026-09-24 10:00+03'),
  ('aaaaaaaa-0000-0000-0000-0000000c1722', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'Season 172', 'approved', 'campaign', '00000000-0000-0000-0000-00000000a181', '2026-09-01 10:00+03');
insert into streams (id, tenant_id, campaign_id, name)
select c.id, c.tenant_id, c.id, c.name from campaigns c where c.id::text like '%0c172%';
insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d1721', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000c1721',
   'Carousel 172', 'in_progress', '00000000-0000-0000-0000-00000000a003'),
  ('aaaaaaaa-0000-0000-0000-0000000d1722', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000c1722',
   'Teaser 172', 'in_progress', '00000000-0000-0000-0000-00000000a003'),
  ('aaaaaaaa-0000-0000-0000-0000000d1724', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000c1721',
   'Static 172', 'in_progress', '00000000-0000-0000-0000-00000000a003');
select set_config('app.task_list_approval', 'on', true);
update deliverables set tasks_approved_at = '2026-09-26 08:00+03', tasks_approved_by = owner_user_id
 where id = 'aaaaaaaa-0000-0000-0000-0000000d1722';
update deliverables set tasks_approved_at = '2026-09-24 10:00+03', tasks_approved_by = owner_user_id
 where id = 'aaaaaaaa-0000-0000-0000-0000000d1721';
select set_config('app.task_list_approval', '', true);
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order, assignee_id, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000f1721', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1721', 'Design 172', 'todo', 1, null, null),
  ('aaaaaaaa-0000-0000-0000-0000000f1722', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1722', 'Edit 172', 'todo', 1, null, 8),
  ('aaaaaaaa-0000-0000-0000-0000000f1724', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1724', 'Static art 172', 'todo', 1, null, null),
  -- a task in review, sent Saturday 26 Sep 10:00, reviewer a001 not yet answered
  ('aaaaaaaa-0000-0000-0000-0000000f1723', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1722', 'Cut 172', 'review', 2,
   '00000000-0000-0000-0000-00000000a002', 8);
delete from sub_task_reviewers where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000f1723';
insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000f1723', '00000000-0000-0000-0000-00000000a001', true);
insert into task_time_entries (tenant_id, sub_task_id, user_id, round, started_at, submitted_at, minutes, mode) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000f1723', '00000000-0000-0000-0000-00000000a002', 0,
   '2026-09-26 09:00+03', '2026-09-26 10:00+03', 60, 'timer');

-- ---------------------------------------------------------------- real time, a weekend counts ----
select ok(app.working_hours_between('2026-09-24 10:00+03', '2026-09-25 11:00+03') < 24,
  'on the old working-hours clock, Thursday 10:00 to Friday 11:00 was under 24 hours');
select is(app.elapsed_hours('2026-09-24 10:00+03', '2026-09-25 11:00+03'), 25::numeric,
  'on the real clock it is 25 hours — Friday counts (ADR-0108 d.1)');

select is(app.escalate_unassigned_jobs('2026-09-25 09:00+03'), 0, '23 real hours after release: nothing yet');
select is(app.escalate_unassigned_jobs('2026-09-25 11:00+03'), 1, '25 real hours, across a Friday: the job escalates');
select results_eq($$
  select user_id, detail->>'kind', detail->'as' from notifications
   where type = 'escalated' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000d1721' order by user_id
$$, $$ values ('00000000-0000-0000-0000-00000000a002'::uuid, 'unassigned', '["role"]'::jsonb),
              ('00000000-0000-0000-0000-00000000a003'::uuid, 'unassigned', '["owner"]'::jsonb) $$,
  '`escalated`, kind unassigned, to the Traffic Manager and the owner — each told why');
select is((select (detail->>'hours')::int from notifications
            where type = 'escalated' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000d1721' limit 1),
  25, 'the notification carries the real hours');
select ok((select assignment_escalated_at is not null from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1721'),
  'the single-job stamp keeps its meaning');
select is(app.escalate_unassigned_jobs('2026-09-25 12:00+03'), 0, 'an hour later nothing is sent again (once per cause)');
select is((select count(*)::int from escalation_log where kind = 'unassigned' and subject_id = 'aaaaaaaa-0000-0000-0000-0000000d1721'),
  1, 'the log holds the cause once');

-- ---------------------------------------------------------------- campaigns, from the task list ----
select is(app.escalate_unassigned_jobs('2026-09-27 07:00+03'), 0,
  'a campaign piece: 23 hours after its task list was approved (weeks after the campaign was) — nothing');
select is(app.escalate_unassigned_jobs('2026-09-27 09:00+03'), 1, '25 hours after the task-list approval: it escalates (d.4)');
select is((select count(*)::int from notifications where type = 'escalated' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000d1722'),
  2, 'to the Traffic Manager and the owner');

-- ---------------------------------------------------------------- task list / brief not approved ----
-- 20260926170000 (the walk escalates only its own piece): a run limited to ANOTHER deliverable sends
-- nothing, and leaves the Static's cause for the unlimited run below; a dry run limited to the Static lists
-- only the Static.
select is((app.run_escalation_sweep('2026-09-25 11:00+03', false, 'task_list', 'aaaaaaaa-0000-0000-0000-0000000d1722') ->> 'sent')::int, 0,
  'limited to another deliverable: the Static''s overdue task list is not escalated');
select is((select count(*)::int from jsonb_array_elements(app.run_escalation_sweep('2026-09-25 11:00+03', true, null, 'aaaaaaaa-0000-0000-0000-0000000d1724') -> 'items') i
            where i ->> 'entity_id' <> 'aaaaaaaa-0000-0000-0000-0000000d1724'), 0,
  'a dry run limited to the Static lists the Static only');
select is((app.run_escalation_sweep('2026-09-25 09:00+03', false, 'task_list') ->> 'sent')::int, 0,
  'the job''s task list, 23 hours on: nothing');
select is((app.run_escalation_sweep('2026-09-25 11:00+03', false, 'task_list') ->> 'sent')::int, 1,
  'its task list, still not approved 25 hours after release: escalated');
select results_eq($$
  select user_id, detail->>'waiting_on' from notifications
   where type = 'escalated' and detail->>'kind' = 'task_list' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000d1724' order by user_id
$$, $$ values ('00000000-0000-0000-0000-00000000a002'::uuid, 'task_list'),
              ('00000000-0000-0000-0000-00000000a181'::uuid, 'task_list') $$,
  'to the Traffic Manager and the account manager');
select is((select count(*)::int from notifications where detail->>'kind' = 'task_list' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000d1722'),
  0, 'the campaign piece''s approved list is not chased');

-- ---------------------------------------------------------------- review: remind, then escalate ----
select is((app.run_escalation_sweep('2026-09-27 09:00+03', false, 'review_remind') ->> 'sent')::int, 0, 'review sent 23 hours ago: no reminder yet');
select is((app.run_escalation_sweep('2026-09-27 11:00+03', false, 'review_remind') ->> 'sent')::int, 1, '25 hours: the reminder goes');
select results_eq($$
  select user_id, type, (detail->>'round')::int from notifications where entity_id = 'aaaaaaaa-0000-0000-0000-0000000f1723' and type = 'review_reminder'
$$, $$ values ('00000000-0000-0000-0000-00000000a001'::uuid, 'review_reminder', 1) $$,
  '`review_reminder` to the reviewer who has not answered, round 1');
select is((app.run_escalation_sweep('2026-09-28 09:00+03', false, 'review_escalate') ->> 'sent')::int, 0, '47 hours: not escalated yet');
select is((app.run_escalation_sweep('2026-09-28 11:00+03', false, 'review_escalate') ->> 'sent')::int, 1, '49 hours: escalated');
select results_eq($$
  select user_id from notifications where entity_id = 'aaaaaaaa-0000-0000-0000-0000000f1723' and type = 'escalated' order by user_id
$$, $$ values ('00000000-0000-0000-0000-00000000a003'::uuid), ('00000000-0000-0000-0000-00000000a181'::uuid) $$,
  'to the owner and the account manager');
select is((app.run_escalation_sweep('2026-09-29 11:00+03', false, null) ->> 'sent')::int, 0,
  'a full sweep a day later sends nothing already sent (and the rest is not due)');

-- A campaign sent for approval: its clock starts when it is submitted, not when the draft began.
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id, created_at) values
  ('aaaaaaaa-0000-0000-0000-0000000c1723', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'Draft 172', 'draft', 'campaign', '00000000-0000-0000-0000-00000000a181', now() - interval '10 days');
-- ADR-0117 addendum (Q19): a campaign leaves draft with a language.
update campaigns set status = 'pending_approval', languages = array['en'] where id = 'aaaaaaaa-0000-0000-0000-0000000c1723';
select ok((select submitted_at >= now() - interval '1 minute' from campaigns where id = 'aaaaaaaa-0000-0000-0000-0000000c1723'),
  'going to pending approval stamps submitted_at');
select is((select count(*)::int from app.escalation_due(now() + interval '23 hours') e where e.subject_id = 'aaaaaaaa-0000-0000-0000-0000000c1723'),
  0, 'a draft begun ten days ago, submitted now: not due at 23 hours');
select is((select count(*)::int from app.escalation_due(now() + interval '25 hours') e
            where e.subject_id = 'aaaaaaaa-0000-0000-0000-0000000c1723' and e.kind = 'campaign_brief' and e.extra->>'waiting_on' = 'campaign_brief'),
  1, 'due at 25 hours, as the brief not approved — its own kind since I59 E8');

-- ---------------------------------------------------------------- the dry run ----
update tenant_escalation_rules set hours = 1 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'campaign_brief';
-- I59 E8: the brief's recipients are the Traffic Manager and the Account Director role — nobody holds
-- the latter in this fixture, so one person.
select is((select count(*)::int from jsonb_array_elements(app.run_escalation_sweep(now() + interval '2 hours', true, 'campaign_brief') -> 'items') i
            where i->>'entity_id' = 'aaaaaaaa-0000-0000-0000-0000000c1723' and jsonb_array_length(i->'recipients') = 1),
  1, 'a dry run lists the due brief with its recipient');
select is((select count(*)::int from escalation_log where subject_id = 'aaaaaaaa-0000-0000-0000-0000000c1723'),
  0, 'and sends and logs nothing');

-- ---------------------------------------------------------------- over capacity ----
-- A003's resource joins Studio 172 (Creative 172). This week (Sunday–Saturday, Baghdad): three 15-hour
-- bookings, plus one that starts on the Saturday before and runs into Sunday (counted WHOLE, as the
-- screen counts it): 51 hours of a 40-hour week = 128%.
update resources set team_id = 'aaaaaaaa-0000-0000-0000-0000000e1720' where id = 'aaaaaaaa-0000-0000-0000-00000000d0a3';
create temp table wk as
select ((now() at time zone 'Asia/Baghdad')::date - extract(dow from (now() at time zone 'Asia/Baghdad'))::int) as sun;
insert into bookings (tenant_id, resource_id, starts_at, ends_at, state)
select 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d0a3',
       ((wk.sun + d)::timestamp + interval '8 hours') at time zone 'Asia/Baghdad',
       ((wk.sun + d)::timestamp + interval '23 hours') at time zone 'Asia/Baghdad', 'tentative'
  from wk, generate_series(0, 2) d;
insert into bookings (tenant_id, resource_id, starts_at, ends_at, state)
select 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d0a3',
       (wk.sun::timestamp - interval '4 hours') at time zone 'Asia/Baghdad',
       (wk.sun::timestamp + interval '2 hours') at time zone 'Asia/Baghdad', 'confirmed'
  from wk;
-- A cancelled booking does not count.
insert into bookings (tenant_id, resource_id, starts_at, ends_at, state)
select 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d0a3',
       ((wk.sun + 3)::timestamp + interval '8 hours') at time zone 'Asia/Baghdad',
       ((wk.sun + 3)::timestamp + interval '20 hours') at time zone 'Asia/Baghdad', 'cancelled'
  from wk;

select results_eq($$
  select booked_hours, nominal_hours, util_pct from app.week_load(now()) where resource_id = 'aaaaaaaa-0000-0000-0000-00000000d0a3'
$$, $$ values (51.0::numeric, 40::numeric, 128) $$,
  'the week''s load: 51h booked of 40h nominal, 128% — useTeamLoad''s arithmetic');

select is((app.run_escalation_sweep(now(), false, 'over_capacity') ->> 'sent')::int, 1, 'over 110%: raised');
select results_eq($$
  select user_id, entity_type, (detail->>'util_pct')::int from notifications where type = 'over_capacity' order by user_id
$$, $$ values ('00000000-0000-0000-0000-00000000a182'::uuid, 'resource', 128),
              ('00000000-0000-0000-0000-00000000a183'::uuid, 'resource', 128),
              ('00000000-0000-0000-0000-00000000a184'::uuid, 'resource', 128) $$,
  'to the team lead, the deputy and the department lead — nobody else, not Tenant B');
select is((app.run_escalation_sweep(now() + interval '1 hour', false, 'over_capacity') ->> 'sent')::int, 0,
  'once per person per week');

-- Next week, booked over again: a new week is a new cause.
insert into bookings (tenant_id, resource_id, starts_at, ends_at, state)
select 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d0a3',
       ((wk.sun + 7 + d)::timestamp + interval '8 hours') at time zone 'Asia/Baghdad',
       ((wk.sun + 7 + d)::timestamp + interval '23 hours') at time zone 'Asia/Baghdad', 'tentative'
  from wk, generate_series(0, 2) d;
select is((app.run_escalation_sweep(now() + interval '7 days', false, 'over_capacity') ->> 'sent')::int, 1,
  'the next week, over again: raised again');

-- ---------------------------------------------------------------- Needs you ----
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a182'), true);
select results_eq($$ select resource_id, util_pct from public.needs_me_overload() $$,
  $$ values ('aaaaaaaa-0000-0000-0000-00000000d0a3'::uuid, 128) $$,
  'the team lead''s Needs you lists the person over capacity this week');
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);
select is_empty($$ select 1 from public.needs_me_overload() $$, 'the Traffic Manager leads no team: nothing');

select results_eq($$ select kind, entity_id from public.needs_me_escalations() order by kind, entity_id $$,
  $$ values ('task_list', 'aaaaaaaa-0000-0000-0000-0000000d1724'::uuid),
            ('unassigned', 'aaaaaaaa-0000-0000-0000-0000000d1721'::uuid),
            ('unassigned', 'aaaaaaaa-0000-0000-0000-0000000d1722'::uuid) $$,
  'the Traffic Manager''s escalations, while each stall is still there');
reset role;
update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a003' where id = 'aaaaaaaa-0000-0000-0000-0000000f1722';
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);
select results_eq($$ select kind, entity_id from public.needs_me_escalations() order by kind, entity_id $$,
  $$ values ('task_list', 'aaaaaaaa-0000-0000-0000-0000000d1724'::uuid),
            ('unassigned', 'aaaaaaaa-0000-0000-0000-0000000d1721'::uuid) $$,
  'once the piece''s task is assigned, its escalation leaves Needs you');

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000b001'), true);
select ok((select count(*) from public.needs_me_escalations()) = 0 and (select count(*) from public.needs_me_overload()) = 0,
  'Tenant B''s admin sees none of Tenant A''s escalations or overload');
select throws_ok($$ select app.run_escalation_sweep(now(), true, null) $$, '42501', null,
  'a signed-in user cannot run the sweep, not even a dry run');
reset role;

select * from finish();
rollback;
