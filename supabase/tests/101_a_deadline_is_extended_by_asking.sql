-- ADR-0088 / I46 — a deadline is extended by asking, and the account manager answers (11 Sep).
--
-- The ADR's own testing list, in its order: the assignee may request on their own task and nobody
-- else's; a department lead may request and may not decide; the account manager decides on their
-- own campaign's task and not on another's; Traffic decides on any; an ad-hoc task's request
-- resolves to `assigned_by`; a second request supersedes the first and both rows survive; approval
-- moves `committed_due_at` and leaves `due_at`, the bookings and `deliverables.due_at` untouched;
-- refusal moves nothing; a cancelled task's request is not pending; every path writes its
-- sla_events row with the actor and none can be updated or deleted. Then d.7a: the promise moves
-- only through the evidenced RPC, and the fence refuses every other route.
--
-- `notifications` is recipient-scoped: every count over it is read after `reset role` (traps.md).
begin;
select plan(55);
\ir helpers/seed.sql
-- ADR-0141 d.5: the request is retired; a pending one (raised before 3 Oct) is raised here as it was then.
\ir helpers/legacy_extension_request.sql

-- ---------------------------------------------------------------- fixtures ----
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a010', 'dept-lead@a.test'),
  ('00000000-0000-0000-0000-00000000a012', 'other-maker@a.test'),
  ('00000000-0000-0000-0000-00000000a014', 'account-mgr@a.test'),
  ('00000000-0000-0000-0000-00000000a015', 'other-am@a.test');

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000de099','aaaaaaaa-0000-0000-0000-000000000001','Creative 99');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000f0099','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000de099','Art 99');

-- a003 (the maker) sits in Creative 99 / Art 99, so the department lead's scope covers their work.
update user_profiles
   set department_id = 'aaaaaaaa-0000-0000-0000-0000000de099', team_id = 'aaaaaaaa-0000-0000-0000-0000000f0099'
 where id = '00000000-0000-0000-0000-00000000a003';

insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid, v.team::uuid
from (values
  ('00000000-0000-0000-0000-00000000a010','Dept Lead',   'department_lead', 'aaaaaaaa-0000-0000-0000-0000000de099', null),
  ('00000000-0000-0000-0000-00000000a012','Other Maker', 'team_member',     'aaaaaaaa-0000-0000-0000-0000000de099', 'aaaaaaaa-0000-0000-0000-0000000f0099'),
  ('00000000-0000-0000-0000-00000000a014','Account Mgr', 'account_manager', null, null),
  ('00000000-0000-0000-0000-00000000a015','Other AM',    'account_manager', null, null)
) as v(id, name, role_key, dept, team);

insert into test_claims
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id in ('00000000-0000-0000-0000-00000000a010','00000000-0000-0000-0000-00000000a012',
                 '00000000-0000-0000-0000-00000000a014','00000000-0000-0000-0000-00000000a015');

-- Campaign e001 (approved) is a014's; goes live 1 Oct. A second campaign is a015's.
update campaigns set account_manager_id = '00000000-0000-0000-0000-00000000a014', go_live_at = '2026-10-01 15:00:00+00'
 where id = 'aaaaaaaa-0000-0000-0000-00000000e001';
insert into campaigns (id, tenant_id, client_id, name, status, account_manager_id, go_live_at) values
  ('aaaaaaaa-0000-0000-0000-00000000e099','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001','Other campaign','approved','00000000-0000-0000-0000-00000000a015',
   '2026-10-15 15:00:00+00');

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000099d1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S99'),
  ('aaaaaaaa-0000-0000-0000-0000000099d2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e099','S99b');
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id, due_at) values
  ('aaaaaaaa-0000-0000-0000-0000000099e1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000099d1',
   'KV 99','in_progress','00000000-0000-0000-0000-00000000a001','2026-09-25 15:00:00+00'),
  ('aaaaaaaa-0000-0000-0000-0000000099e2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000099d2',
   'KV 99b','in_progress','00000000-0000-0000-0000-00000000a001','2026-10-10 15:00:00+00');

-- Three tasks, all a003's. t1 on a014's campaign, t3 on a015's, t2 ad-hoc under the seed's job —
-- whose client has no account manager, so the request must fall to whoever assigned it. Inserted
-- with a002's claims so `assigned_by` is stamped a002 (Traffic gave the work).
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, department_id, team_id, title, status, starts_at, due_at, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000099a1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000099e1',
   '00000000-0000-0000-0000-00000000a003','aaaaaaaa-0000-0000-0000-0000000de099','aaaaaaaa-0000-0000-0000-0000000f0099',
   'Design 99','todo','2026-09-14 06:00:00+00','2026-09-16 15:00:00+00', 8),
  ('aaaaaaaa-0000-0000-0000-0000000099a2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f101',
   '00000000-0000-0000-0000-00000000a003','aaaaaaaa-0000-0000-0000-0000000de099','aaaaaaaa-0000-0000-0000-0000000f0099',
   'Logo tweak 99','todo','2026-09-14 06:00:00+00','2026-09-15 15:00:00+00', 4),
  ('aaaaaaaa-0000-0000-0000-0000000099a3','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000099e2',
   '00000000-0000-0000-0000-00000000a003','aaaaaaaa-0000-0000-0000-0000000de099','aaaaaaaa-0000-0000-0000-0000000f0099',
   'Design 99b','todo','2026-09-20 06:00:00+00','2026-09-22 15:00:00+00', 8);
insert into bookings (id, tenant_id, resource_id, sub_task_id, starts_at, ends_at, state, booked_by)
values ('aaaaaaaa-0000-0000-0000-0000000099b1','aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-00000000d0a3','aaaaaaaa-0000-0000-0000-0000000099a1',
        '2026-09-14 06:00:00+00','2026-09-16 15:00:00+00','confirmed','00000000-0000-0000-0000-00000000a002');

select is(
  (select assigned_by from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000099a2'),
  '00000000-0000-0000-0000-00000000a002', 'fixture: the ad-hoc task was given by a002');
select is(
  (select app.sub_task_extension_approver('aaaaaaaa-0000-0000-0000-0000000099a1')),
  '00000000-0000-0000-0000-00000000a014', 'd.3: a campaign task''s request goes to the campaign''s account manager');
select is(
  (select app.sub_task_extension_approver('aaaaaaaa-0000-0000-0000-0000000099a2')),
  '00000000-0000-0000-0000-00000000a002', 'd.3: an ad-hoc task''s request goes to whoever gave the work');

-- ------------------------------------------------------------------------------------------
-- Asking. The assignee, on their own task and nobody else's; a request is a date, a reason and an
-- attribution, and each is required.
-- ------------------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);

select throws_ok(
  $$ select test_extension_request('aaaaaaaa-0000-0000-0000-0000000099a1', '2026-09-18', '   ', 'assignee') $$,
  '22023', null, 'd.4: a request without a reason is refused — the approver cannot decide on nothing');
select throws_ok(
  $$ select test_extension_request('aaaaaaaa-0000-0000-0000-0000000099a1', '2026-09-18', 'More work than planned', 'approver') $$,
  '22023', null, 'd.4: the attribution is one of assignee, client, dependency');
select throws_ok(
  $$ select test_extension_request('aaaaaaaa-0000-0000-0000-0000000099a1', '2026-09-15', 'More work than planned', 'assignee') $$,
  '22023', null, 'an "extension" to an earlier date than the commitment is refused');

select lives_ok(
  $$ select test_extension_request('aaaaaaaa-0000-0000-0000-0000000099a1', '2026-09-18', 'More work than planned', 'assignee') $$,
  'd.2: the assignee asks on their own task');

select is(
  (select array[to_at::text, reason, attributed_to::text, actor_id::text, approver_id::text, is_pending::text]
     from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000099a1'),
  array['2026-09-18 15:00:00+00', 'More work than planned', 'assignee',
        '00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-00000000a014', 'true'],
  'd.4/d.5: the request lands at 18:00 Iraq on its day, with its reason, attribution, requester and approver, and is pending');

select ok(
  not (select viewer_can_decide from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000099a1'),
  'the assignee sees that they cannot answer their own request');

-- Somebody who is neither the assignee nor in authority.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a012'),true);
select throws_ok(
  $$ select test_extension_request('aaaaaaaa-0000-0000-0000-0000000099a1', '2026-09-19', 'Please', 'assignee') $$,
  '42501', null, 'd.2: another maker cannot ask on somebody else''s task');

-- Found by review: the same maker could WRITE the request instead of asking — sla_events_tenant_insert
-- accepts any actor and any payload, and "pending" is derived from the log (d.5). A forged
-- extension_requested reached the account manager's queue past every check in the RPC; a forged
-- extension_approved made a real request vanish. The deadline record is fenced (20260911130600):
-- the six event types are written by the triggers and the four RPCs, and by nobody's hand.
select throws_ok(
  $$ insert into sla_events (tenant_id, deliverable_id, sub_task_id, event_type, actor_user_id, payload)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000099e1',
             'aaaaaaaa-0000-0000-0000-0000000099a1', 'extension_requested',
             '00000000-0000-0000-0000-00000000a012',
             jsonb_build_object('to', '2026-12-24 15:00:00+00', 'reason', 'forged')) $$,
  '42501', null, '… nor write the request into the log by hand');
select throws_ok(
  $$ insert into sla_events (tenant_id, deliverable_id, sub_task_id, event_type, actor_user_id, payload)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000099e1',
             'aaaaaaaa-0000-0000-0000-0000000099a1', 'extension_approved',
             '00000000-0000-0000-0000-00000000a012', '{}') $$,
  '42501', null, '… nor an approval');
select throws_ok(
  $$ insert into sla_events (tenant_id, deliverable_id, sub_task_id, event_type, actor_user_id, payload)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000099e1',
             'aaaaaaaa-0000-0000-0000-0000000099a1', 'deadline_changed',
             '00000000-0000-0000-0000-00000000a012', '{}') $$,
  '42501', null, '… nor a move in the breach record (ADR-0075 d.3)');

-- The department lead may ask (they could reschedule it), and a second request SUPERSEDES the first.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a010'),true);
select lives_ok(
  $$ select test_extension_request('aaaaaaaa-0000-0000-0000-0000000099a1', '2026-09-21', 'Input arrived late', 'dependency') $$,
  'd.2: the reschedule authority may ask on the maker''s behalf');
select is(
  (select count(*)::int from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000099a1'),
  1, 'd.5: one pending request per task — the new one superseded the old');
select is(
  (select actor_id from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000099a1'),
  '00000000-0000-0000-0000-00000000a010', 'and the pending one is the lead''s');
select is(
  (select array_agg(event_type order by created_at, event_type) from sla_events
     where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000099a1' and event_type like 'extension_%'),
  array['extension_requested', 'extension_requested', 'extension_withdrawn'],
  'd.5: both requests and the withdrawal survive in the log — nothing was edited');

-- ------------------------------------------------------------------------------------------
-- Answering. The lead may not; another campaign's account manager may not; this one's may.
-- ------------------------------------------------------------------------------------------
select throws_ok(
  $$ select public.sub_task_extension_decide(
       (select request_id from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000099a1'),
       true) $$,
  '42501', null, 'd.3: a department lead cannot answer — they are the ones asking');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a015'),true);
select throws_ok(
  $$ select public.sub_task_extension_decide(
       (select request_id from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000099a1'),
       true) $$,
  '42501', null, 'd.3: another campaign''s account manager cannot answer this one''s');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a014'),true);
select ok(
  (select viewer_can_decide from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000099a1'),
  'the campaign''s account manager sees that they can answer');
select lives_ok(
  $$ select public.sub_task_extension_decide(
       (select request_id from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000099a1'),
       true, 'Agreed with the client on the phone') $$,
  'd.3: the account manager approves');

select is(
  (select committed_due_at::text from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000099a1'),
  '2026-09-21 15:00:00+00', 'd.6: approval moves committed_due_at to the requested date');
select is(
  (select array[starts_at::text, due_at::text] from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000099a1'),
  array['2026-09-14 06:00:00+00', '2026-09-16 15:00:00+00'], 'd.6: and nothing else — the plan is untouched');
select is(
  (select array[starts_at::text, ends_at::text] from bookings where id = 'aaaaaaaa-0000-0000-0000-0000000099b1'),
  array['2026-09-14 06:00:00+00', '2026-09-16 15:00:00+00'], 'd.6: the booking is untouched');
select is(
  (select due_at::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000099e1'),
  '2026-09-25 15:00:00+00', 'd.7: the deliverable''s due date does not move');
select is(
  (select count(*)::int from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000099a1'),
  0, 'd.5: an answered request is no longer pending');
select is(
  (select array[(payload ->> 'from')::timestamptz::text, (payload ->> 'to')::timestamptz::text,
                (payload ->> 'note'), actor_user_id::text] from sla_events
     where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000099a1' and event_type = 'extension_approved'),
  array['2026-09-16 15:00:00+00', '2026-09-21 15:00:00+00', 'Agreed with the client on the phone',
        '00000000-0000-0000-0000-00000000a014'],
  'd.6: the approval row keeps the original commitment in its from, the note, and the actor');

-- Approval never fires `rescheduled` — no booking moved (d.9).
reset role;
select is(
  (select count(*)::int from notifications where type = 'rescheduled' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000099a1'),
  0, 'd.9: approval moves no booking, so nobody is told they were rescheduled');

-- ------------------------------------------------------------------------------------------
-- Who was told (d.9). The account manager got both requests; the failsafe roles got none; the
-- answer went to the requester and the assignee, not to the actor.
-- ------------------------------------------------------------------------------------------
select is(
  (select count(*)::int from notifications
    where type = 'extension_requested' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000099a1'
      and user_id = '00000000-0000-0000-0000-00000000a014'),
  2, 'd.9: each request reached the resolved account manager');
select is(
  (select count(*)::int from notifications
    where type = 'extension_requested' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000099a1'
      and user_id <> '00000000-0000-0000-0000-00000000a014'),
  0, 'd.9: and nobody else — not Traffic, not a Power Admin, who could answer anything');
select is(
  (select array_agg(user_id::text order by user_id) from notifications
    where type = 'extension_approved' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000099a1'),
  array['00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-00000000a010'],
  'd.9: the approval went to the assignee and the requester, and not to the account manager who gave it');

-- ------------------------------------------------------------------------------------------
-- The ad-hoc bridge: the request goes to whoever gave the work, and the reschedule authority
-- answers. Traffic answers any.
-- ------------------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select lives_ok(
  $$ select test_extension_request('aaaaaaaa-0000-0000-0000-0000000099a2', '2026-09-17', 'Client sent new copy', 'client') $$,
  'the assignee asks on their ad-hoc task');
reset role;
select is(
  (select count(*)::int from notifications
    where type = 'extension_requested' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000099a2'
      and user_id = '00000000-0000-0000-0000-00000000a002'),
  1, 'd.3: with no account manager, the request reached the person who gave the work');

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a010'),true);
select lives_ok(
  $$ select public.sub_task_extension_decide(
       (select request_id from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000099a2'),
       true) $$,
  'd.3: on ad-hoc work the reschedule authority (here the department lead) answers');
select is(
  (select committed_due_at::text from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000099a2'),
  '2026-09-17 15:00:00+00', 'and the commitment moved');

-- Refusal, by Traffic, on the other campaign's task: nothing moves.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select lives_ok(
  $$ select test_extension_request('aaaaaaaa-0000-0000-0000-0000000099a3', '2026-09-24', 'Underestimated', 'assignee') $$,
  'a request on the other campaign''s task');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select lives_ok(
  $$ select public.sub_task_extension_decide(
       (select request_id from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000099a3'),
       false, 'No — the client will not move') $$,
  'd.3: Traffic (tenant scope) answers any request; this one is refused');
select is(
  (select committed_due_at::text from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000099a3'),
  '2026-09-22 15:00:00+00', 'd.6: refusal changes nothing on the task');
select is(
  (select count(*)::int from sla_events
     where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000099a3' and event_type = 'extension_refused'
       and actor_user_id = '00000000-0000-0000-0000-00000000a002'),
  1, 'and is logged with its actor');
reset role;
select is(
  (select count(*)::int from notifications
    where type = 'extension_refused' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000099a3'),
  1, 'd.9: requester and assignee are the same person here, told once');

-- A request on a task that is then cancelled stops being pending, with no write.
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select lives_ok(
  $$ select test_extension_request('aaaaaaaa-0000-0000-0000-0000000099a3', '2026-09-26', 'Trying again', 'assignee') $$,
  'a new request after a refusal');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select lives_ok($$ select public.sub_task_cancel('aaaaaaaa-0000-0000-0000-0000000099a3') $$, 'the task is called off');
select is(
  (select count(*)::int from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000099a3'),
  0, 'd.5/d.8: a cancelled task''s request is not pending, by definition');

-- Append-only, for the new rows too.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a014'),true);
select throws_ok(
  $$ update sla_events set payload = '{}' where event_type = 'extension_approved' $$,
  '42501', null, 'an extension event cannot be edited, even by the account manager who wrote it');
select throws_ok(
  $$ delete from sla_events where event_type = 'extension_approved' $$,
  '42501', null, 'nor deleted');

-- ------------------------------------------------------------------------------------------
-- d.7a — the promise moves only on the client's agreement, evidenced.
-- ------------------------------------------------------------------------------------------
reset role;
insert into asset_folders (id, tenant_id, client_id, campaign_id, name, kind) values
  ('aaaaaaaa-0000-0000-0000-0000000099f1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000c001',
   'aaaaaaaa-0000-0000-0000-00000000e001','References','asset_type'),
  ('aaaaaaaa-0000-0000-0000-0000000099f2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000c001',
   'aaaaaaaa-0000-0000-0000-00000000e099','References','asset_type');
insert into assets (id, tenant_id, folder_id, name, provider, object_key, content_type) values
  ('aaaaaaaa-0000-0000-0000-00000000991a','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000099f1',
   'client-agrees.png','b2','k/99/client-agrees.png','image/png'),
  ('aaaaaaaa-0000-0000-0000-00000000992a','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000099f2',
   'wrong-campaign.png','b2','k/99/wrong.png','image/png');

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a014'),true);

select throws_ok(
  $$ update deliverables set due_at = '2026-09-28 15:00:00+00' where id = 'aaaaaaaa-0000-0000-0000-0000000099e1' $$,
  '42501', null, 'd.7a: a live deliverable''s promised date cannot be edited directly, even by its account manager');
-- I59 E5 (25 Sep) relaxed d.7a: the evidence is ASKED for, never required — and the log says it
-- was missing.
select lives_ok(
  $$ select public.deliverable_due_at_change('aaaaaaaa-0000-0000-0000-0000000099e1', '2026-09-27', null) $$,
  'E5: with no attachment the account manager still moves the promise');
select is(
  (select array[(payload ->> 'to')::timestamptz::text, payload ->> 'evidence_attached', coalesce(payload ->> 'evidence_asset_id', '-')]
     from sla_events
    where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000099e1' and event_type = 'deadline_changed'
      and sub_task_id is null and payload ->> 'evidence_attached' = 'false'),
  array['2026-09-27 15:00:00+00', 'false', '-'],
  'E5: and the change is logged as made WITHOUT evidence');
select throws_ok(
  $$ select public.deliverable_due_at_change('aaaaaaaa-0000-0000-0000-0000000099e1', '2026-09-28',
       'aaaaaaaa-0000-0000-0000-00000000992a') $$,
  '22023', null, 'd.7a: evidence filed under another campaign does not count');
select lives_ok(
  $$ select public.deliverable_due_at_change('aaaaaaaa-0000-0000-0000-0000000099e1', '2026-09-28',
       'aaaaaaaa-0000-0000-0000-00000000991a', 'Client agreed by email') $$,
  'd.7a: with the client''s agreement filed in the campaign''s References, the account manager moves the promise');
select is(
  (select due_at::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000099e1'),
  '2026-09-28 15:00:00+00', 'the promise now reads 28 Sep, 18:00 Iraq');
select is(
  (select array[attributed_to::text, (payload ->> 'from')::timestamptz::text, payload ->> 'evidence_asset_id', actor_user_id::text,
                payload ->> 'evidence_attached'] from sla_events
     where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000099e1' and event_type = 'deadline_changed' and sub_task_id is null
       and payload ->> 'evidence_attached' = 'true'),
  array['client', '2026-09-27 15:00:00+00', 'aaaaaaaa-0000-0000-0000-00000000991a', '00000000-0000-0000-0000-00000000a014', 'true'],
  'd.7a: logged as deadline_changed on the deliverable, attributed to the client, with the asset and the actor');

-- Not the account manager: refused even with evidence.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a010'),true);
select throws_ok(
  $$ select public.deliverable_due_at_change('aaaaaaaa-0000-0000-0000-0000000099e1', '2026-09-29',
       'aaaaaaaa-0000-0000-0000-00000000991a') $$,
  '42501', null, 'd.7a: a department lead cannot change the promise, evidence or not');

-- ADR-0093 (was d.7's two refusals): a date after the campaign's go-live is ASKED FOR like any
-- other, and the promise may MOVE past it on the same evidence — the screen warns, the person
-- proceeds, the override row is the record. Last, so the rows they leave affect nothing above.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a014'),true);
select lives_ok(
  $$ select test_extension_request('aaaaaaaa-0000-0000-0000-0000000099a1', '2026-10-05', 'The client moved the launch', 'client') $$,
  'ADR-0093: a date after go-live is asked for like any other; the account manager decides');
select lives_ok(
  $$ select public.deliverable_due_at_change('aaaaaaaa-0000-0000-0000-0000000099e1', '2026-10-03',
       'aaaaaaaa-0000-0000-0000-00000000991a') $$,
  'ADR-0093: the promise may move past go-live, on evidence; the screen warned and the override records it');

select * from finish();
rollback;
