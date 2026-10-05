-- ADR-0109 (25 Sep) / I59.22 — the deliverable's owner judges an extension request first, and the
-- account manager may give less time than asked.
--
--   * ORDER   — a request on an owned deliverable is at the OWNER's step: the account manager cannot
--               answer it (view flag, the RPC, my_pending_approvals); only the owner forwards or
--               declines; once forwarded it is the account manager's, and the owner's step is over.
--   * SKIP    — owner = account manager: straight to the account manager, no owner step.
--   * DECLINE — the owner's decline needs a reason, ends the request (not pending, not answerable),
--               is recorded as extension_refused stage 'owner', and tells the maker.
--   * SHORTER — strictly after the commitment and strictly before the ask; only with an approval;
--               the commitment moves to 18:00 Iraq on the day given; the maker and the owner are told.
--   * FENCE   — the forward is part of the deadline record: nobody writes it by hand.
--
-- `notifications` is recipient-scoped: every count over it is read after `reset role` (traps.md).
begin;
select plan(44);
\ir helpers/seed.sql
-- ADR-0141 d.5: the request is retired; a pending one (raised before 3 Oct) is raised here as it was then.
\ir helpers/legacy_extension_request.sql

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de1650', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 165'),
  ('aaaaaaaa-0000-0000-0000-000000de1651', 'aaaaaaaa-0000-0000-0000-000000000001', 'Content 165');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000007e165', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000de1650', 'Design 165');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a650', 'am165@a.test'),
  ('00000000-0000-0000-0000-00000000a651', 'owner165@a.test'),
  ('00000000-0000-0000-0000-00000000a652', 'maker165@a.test'),
  ('00000000-0000-0000-0000-00000000a653', 'otherlead165@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid, v.team::uuid
from (values
  ('00000000-0000-0000-0000-00000000a650','AM 165',         'account_manager', null, null),
  ('00000000-0000-0000-0000-00000000a651','Owner 165',      'department_lead','aaaaaaaa-0000-0000-0000-000000de1650', null),
  ('00000000-0000-0000-0000-00000000a652','Maker 165',      'team_member',    'aaaaaaaa-0000-0000-0000-000000de1650', 'aaaaaaaa-0000-0000-0000-00000007e165'),
  ('00000000-0000-0000-0000-00000000a653','Other lead 165', 'department_lead','aaaaaaaa-0000-0000-0000-000000de1651', null)
) as v(id, name, role_key, dept, team);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id in ('00000000-0000-0000-0000-00000000a650','00000000-0000-0000-0000-00000000a651',
                 '00000000-0000-0000-0000-00000000a652','00000000-0000-0000-0000-00000000a653');

insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-000000001650','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Season 165','approved','campaign','00000000-0000-0000-0000-00000000a650');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f165','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001650','S165');
-- D1 is owned by Creative's lead (the owner step applies); D2 by the account manager herself (skipped).
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d1651','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f165',
   'Banner 165','in_progress','2026-10-20 15:00:00+00','00000000-0000-0000-0000-00000000a651','aaaaaaaa-0000-0000-0000-000000de1650'),
  ('aaaaaaaa-0000-0000-0000-0000000d1652','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f165',
   'Poster 165','in_progress','2026-10-20 15:00:00+00','00000000-0000-0000-0000-00000000a650','aaaaaaaa-0000-0000-0000-000000de1650');
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-000000001650');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, department_id, team_id, title, status, starts_at, due_at, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000a1651','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1651',
   '00000000-0000-0000-0000-00000000a652','aaaaaaaa-0000-0000-0000-000000de1650','aaaaaaaa-0000-0000-0000-00000007e165',
   'Artwork 165','todo','2026-10-01 06:00:00+00','2026-10-05 15:00:00+00', 8),
  ('aaaaaaaa-0000-0000-0000-0000000a1652','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1651',
   '00000000-0000-0000-0000-00000000a652','aaaaaaaa-0000-0000-0000-000000de1650','aaaaaaaa-0000-0000-0000-00000007e165',
   'Resize 165','todo','2026-10-01 06:00:00+00','2026-10-05 15:00:00+00', 4),
  ('aaaaaaaa-0000-0000-0000-0000000a1653','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1652',
   '00000000-0000-0000-0000-00000000a652','aaaaaaaa-0000-0000-0000-000000de1650','aaaaaaaa-0000-0000-0000-00000007e165',
   'Poster art 165','todo','2026-10-01 06:00:00+00','2026-10-05 15:00:00+00', 4);

select is((select committed_due_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a1651'),
  '2026-10-05 15:00:00+00'::timestamptz, 'fixture: the task is committed to 18:00 Iraq on 5 Oct');

-- ================================================================ ORDER ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a652'),true);
select lives_ok(
  $$ select test_extension_request('aaaaaaaa-0000-0000-0000-0000000a1651', '2026-10-10', 'The client added two sizes', 'client') $$,
  'the maker asks for an extension on a task of an owned deliverable');
select is(
  (select array[stage, owner_step::text, owner_id::text, approver_id::text]
     from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1651'),
  array['owner', 'true', '00000000-0000-0000-0000-00000000a651', '00000000-0000-0000-0000-00000000a650'],
  'd.1: it is at the owner''s step — the account manager is still its approver');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a650'),true);
select ok(
  not (select viewer_can_decide from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1651'),
  'd.2: the account manager cannot answer it before the owner forwards it (view flag)');
select throws_ok(
  $$ select public.sub_task_extension_decide(
       (select request_id from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1651'),
       true, null) $$,
  '55000', null, 'd.2: and the RPC refuses the account manager too — the owner judges first');
select is(
  (select count(*)::int from public.my_pending_approvals() where kind = 'extension_request'),
  0, 'd.2: my_pending_approvals does not list it for the account manager yet');
select is((select count(*)::int from public.needs_me_extensions()), 0,
  'needs_me_extensions: nothing is at the account manager''s step');
select throws_ok(
  $$ select public.forward_extension(
       (select request_id from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1651'), 'ok') $$,
  '42501', null, 'd.1: the account manager is not the owner and cannot forward it');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a653'),true);
select throws_ok(
  $$ select public.forward_extension(
       (select request_id from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1651'), 'ok') $$,
  '42501', null, 'd.1: another department''s lead cannot forward it');
select throws_ok(
  $$ select public.owner_decline_extension(
       (select request_id from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1651'), 'no') $$,
  '42501', null, 'd.1: nor decline it');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a652'),true);
select throws_ok(
  $$ select public.forward_extension(
       (select request_id from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1651'), 'please') $$,
  '42501', null, 'd.1: the maker cannot forward their own request');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a651'),true);
select ok(
  (select viewer_can_forward from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1651'),
  'the owner sees that the forward is theirs to make');
select is(
  (select array_agg(stage || ':' || task_title) from public.needs_me_extensions()),
  array['owner:Artwork 165'], 'needs_me_extensions: the owner has it, at the owner''s step');
select ok(
  not (select viewer_can_decide from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1651'),
  'the owner is not the one who approves it');

-- the fence: the forward is part of the deadline record, written only by the RPC
select throws_ok(
  $$ insert into sla_events (tenant_id, deliverable_id, sub_task_id, event_type, actor_user_id, payload)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1651',
             'aaaaaaaa-0000-0000-0000-0000000a1651', 'extension_forwarded', '00000000-0000-0000-0000-00000000a651',
             jsonb_build_object('request_id',
               (select request_id from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1651'))) $$,
  '42501', null, 'the fence: a forward cannot be written by hand, even by the owner');

select lives_ok(
  $$ select public.forward_extension(
       (select request_id from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1651'),
       'Fair — the client did add two sizes') $$,
  'd.1: the owner forwards it with a note');
select is(
  (select array[stage, owner_note, is_pending::text]
     from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1651'),
  array['am', 'Fair — the client did add two sizes', 'true'],
  'd.2: it is now at the account manager''s step, with the owner''s note, still pending');
select throws_ok(
  $$ select public.forward_extension(
       (select request_id from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1651'), 'again') $$,
  '55000', null, 'the owner''s step is over — it cannot be forwarded twice');
select throws_ok(
  $$ select public.owner_decline_extension(
       (select request_id from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1651'), 'changed my mind') $$,
  '55000', null, 'nor declined by the owner once it is with the account manager');
select is((select count(*)::int from public.needs_me_extensions()), 0,
  'needs_me_extensions: it has left the owner''s list');

-- ================================================================ SHORTER ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a650'),true);
select ok(
  (select viewer_can_decide from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1651'),
  'd.2: the account manager can answer it now');
select is(
  (select array_agg(stage || ':' || task_title || ':' || coalesce(owner_note, '')) from public.needs_me_extensions()),
  array['am:Artwork 165:Fair — the client did add two sizes'],
  'needs_me_extensions: the account manager has it, with the owner''s note');
select is(
  (select count(*)::int from public.my_pending_approvals() where kind = 'extension_request'),
  1, 'my_pending_approvals lists it for the account manager once forwarded (unmodified function)');
select throws_ok(
  $$ select public.sub_task_extension_decide(
       (select request_id from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1651'),
       true, null, '2026-10-10') $$,
  '22023', null, 'd.3: a "shorter" date equal to the one asked is refused — approve it as asked');
select throws_ok(
  $$ select public.sub_task_extension_decide(
       (select request_id from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1651'),
       true, null, '2026-10-12') $$,
  '22023', null, 'd.3: a date after the one asked is refused');
select throws_ok(
  $$ select public.sub_task_extension_decide(
       (select request_id from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1651'),
       true, null, '2026-10-05') $$,
  '22023', null, 'd.3: a date on the current commitment is refused — it must move it later');
select throws_ok(
  $$ select public.sub_task_extension_decide(
       (select request_id from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1651'),
       false, null, '2026-10-07') $$,
  '22023', null, 'd.3: a shorter date comes only with an approval');
select lives_ok(
  $$ select public.sub_task_extension_decide(
       (select request_id from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1651'),
       true, 'Two days, not five', '2026-10-07') $$,
  'd.3: the account manager approves a shorter extension');
select is((select committed_due_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a1651'),
  '2026-10-07 15:00:00+00'::timestamptz, 'd.3: the commitment moves to 18:00 Iraq on the day given, not the day asked');
select is((select due_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a1651'),
  '2026-10-05 15:00:00+00'::timestamptz, 'ADR-0088 d.6 unchanged: the plan does not move');
select is(
  (select array[(payload ->> 'given')::timestamptz::text, payload ->> 'shorter', (payload ->> 'to')::timestamptz::text]
     from sla_events where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1651' and event_type = 'extension_approved'),
  array['2026-10-07 15:00:00+00', 'true', '2026-10-10 15:00:00+00'],
  'd.3: the record keeps the date given beside the date asked');

-- ================================================================ DECLINE ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a652'),true);
select lives_ok(
  $$ select test_extension_request('aaaaaaaa-0000-0000-0000-0000000a1652', '2026-10-09', 'I am behind', 'assignee') $$,
  'the maker asks again, on another task of the same deliverable');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a651'),true);
select throws_ok(
  $$ select public.owner_decline_extension(
       (select request_id from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1652'), '  ') $$,
  '22023', null, 'd.1: the owner''s decline needs a reason');
select lives_ok(
  $$ select public.owner_decline_extension(
       (select request_id from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1652'),
       'Resizes are an hour — keep the date') $$,
  'd.1: the owner declines it with a reason');
select is(
  (select count(*)::int from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1652'),
  0, 'd.1: the decline ends it — nothing is pending');
select is(
  (select array[payload ->> 'stage', payload ->> 'reason'] from sla_events
    where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1652' and event_type = 'extension_refused'),
  array['owner', 'Resizes are an hour — keep the date'], 'd.1: recorded as extension_refused at the owner''s stage');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a650'),true);
select throws_ok(
  $$ select public.sub_task_extension_decide(
       (select event_id from public.sub_task_extension_events
         where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1652' and event_type = 'extension_requested'),
       true, null) $$,
  'P0002', null, 'd.1: the account manager can no longer answer a request the owner declined');

-- ================================================================ SKIP ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a652'),true);
select lives_ok(
  $$ select test_extension_request('aaaaaaaa-0000-0000-0000-0000000a1653', '2026-10-08', 'Waiting on copy', 'dependency') $$,
  'the maker asks on a deliverable the account manager owns');
select is(
  (select array[stage, owner_step::text] from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1653'),
  array['am', 'false'], 'd.1: owner = account manager — the owner step is skipped');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a650'),true);
select lives_ok(
  $$ select public.sub_task_extension_decide(
       (select request_id from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1653'),
       true, null) $$,
  'and the account manager answers it at once, as ADR-0088 had it');

-- ================================================================ TOLD ====
reset role;
select is(
  (select array_agg(user_id::text || ':' || type || ':' || coalesce(detail ->> 'stage', '') order by user_id::text || ':' || type)
     from notifications
    where entity_id = 'aaaaaaaa-0000-0000-0000-0000000a1651' and type like 'extension_%'),
  array['00000000-0000-0000-0000-00000000a650:extension_forwarded:',
        '00000000-0000-0000-0000-00000000a651:extension_approved:am',
        '00000000-0000-0000-0000-00000000a651:extension_requested:owner',
        '00000000-0000-0000-0000-00000000a652:extension_approved:am'],
  'told: the owner on request, the account manager on forward, and on the shorter approval the maker AND the owner');
select is(
  (select array[detail ->> 'shorter', (detail ->> 'to')::timestamptz::text, (detail ->> 'requested_to')::timestamptz::text]
     from notifications where entity_id = 'aaaaaaaa-0000-0000-0000-0000000a1651' and type = 'extension_approved'
      and user_id = '00000000-0000-0000-0000-00000000a652'),
  array['true', '2026-10-07 15:00:00+00', '2026-10-10 15:00:00+00'], 'd.3: the maker is told the date given');
select is(
  (select array_agg(user_id::text || ':' || type || ':' || coalesce(detail ->> 'stage', '') order by user_id)
     from notifications where entity_id = 'aaaaaaaa-0000-0000-0000-0000000a1652' and type like 'extension_%'),
  array['00000000-0000-0000-0000-00000000a651:extension_requested:owner',
        '00000000-0000-0000-0000-00000000a652:extension_refused:owner'],
  'd.1: the owner''s decline tells the maker, with its stage — the account manager hears nothing');
select is(
  (select array_agg(user_id::text || ':' || type order by user_id::text || ':' || type)
     from notifications where entity_id = 'aaaaaaaa-0000-0000-0000-0000000a1653' and type like 'extension_%'),
  array['00000000-0000-0000-0000-00000000a650:extension_requested',
        '00000000-0000-0000-0000-00000000a652:extension_approved'],
  'skip: the account manager-owner is asked once, as the approver');

select * from finish();
rollback;
