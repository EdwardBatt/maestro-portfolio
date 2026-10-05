-- ADR-0110 (25 Sep) / I59.23 — a change to started work is a request the owner answers.
--
--   * GUARD   — started (a task in progress, or only a time entry) refuses type and quantity through
--               the Edit's own RPC and a bare PATCH; the name still saves; unstarted work saves.
--   * ASK     — whoever may edit may ask (another department's lead and a team member may not); only
--               on started work; the four fields only; from is the server's; one open at a time.
--   * ANSWER  — only the current owner; decline needs a reason, push-back needs words; accept applies
--               the fields (due at 18:00 Iraq, on the record) and a client-asked change spends a round.
--   * RESOLVE — accept her version (her date replaces the due) or withdraw (nothing changes); only the
--               requester or the campaign's account manager; a declined one is closed by them.
--   * NEEDS YOU and TOLD — the owner has pending ones, the requester pushed-back and declined ones.
--   * I59 E7 (26 Sep) amended ADR-0052 d.6 for this route: accepting a type change over live tasks now
--     applies (the list is regenerated — pgTAP 176 checks how).
--
-- `notifications` is recipient-scoped: every count over it is read after `reset role` (traps.md).
begin;
select plan(52);
\ir helpers/seed.sql

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de1660', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 166'),
  ('aaaaaaaa-0000-0000-0000-000000de1661', 'aaaaaaaa-0000-0000-0000-000000000001', 'Content 166');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000007e166', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000de1660', 'Design 166');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a660', 'am166@a.test'),
  ('00000000-0000-0000-0000-00000000a661', 'owner166@a.test'),
  ('00000000-0000-0000-0000-00000000a662', 'maker166@a.test'),
  ('00000000-0000-0000-0000-00000000a663', 'otherlead166@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid, v.team::uuid
from (values
  ('00000000-0000-0000-0000-00000000a660','AM 166',         'account_manager', null, null),
  ('00000000-0000-0000-0000-00000000a661','Owner 166',      'department_lead','aaaaaaaa-0000-0000-0000-000000de1660', null),
  ('00000000-0000-0000-0000-00000000a662','Maker 166',      'team_member',    'aaaaaaaa-0000-0000-0000-000000de1660', 'aaaaaaaa-0000-0000-0000-00000007e166'),
  ('00000000-0000-0000-0000-00000000a663','Other lead 166', 'department_lead','aaaaaaaa-0000-0000-0000-000000de1661', null)
) as v(id, name, role_key, dept, team);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id in ('00000000-0000-0000-0000-00000000a660','00000000-0000-0000-0000-00000000a661',
                 '00000000-0000-0000-0000-00000000a662','00000000-0000-0000-0000-00000000a663');

insert into deliverable_categories (tenant_id, code, name_en)
values ('aaaaaaaa-0000-0000-0000-000000000001','CR166','Category 166');
insert into deliverable_types (id, tenant_id, code, category_code, name_en) values
  ('aaaaaaaa-0000-0000-0000-0000000c1661','aaaaaaaa-0000-0000-0000-000000000001','CR166-1','CR166','Banner'),
  ('aaaaaaaa-0000-0000-0000-0000000c1662','aaaaaaaa-0000-0000-0000-000000000001','CR166-2','CR166','Carousel');

insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-000000001660','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Season 166','approved','campaign','00000000-0000-0000-0000-00000000a660');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f166','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001660','S166');
-- D1 started (a task in progress), D2 not started (a task to do), D3 started by a time entry alone.
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id, department_id, deliverable_type_id, quantity) values
  ('aaaaaaaa-0000-0000-0000-0000000d1661','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f166',
   'Banner 166','in_progress','2026-10-20 15:00:00+00','00000000-0000-0000-0000-00000000a661','aaaaaaaa-0000-0000-0000-000000de1660',
   'aaaaaaaa-0000-0000-0000-0000000c1661', 1),
  ('aaaaaaaa-0000-0000-0000-0000000d1662','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f166',
   'Poster 166','in_progress','2026-10-20 15:00:00+00','00000000-0000-0000-0000-00000000a661','aaaaaaaa-0000-0000-0000-000000de1660',
   'aaaaaaaa-0000-0000-0000-0000000c1661', 1),
  ('aaaaaaaa-0000-0000-0000-0000000d1663','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f166',
   'Flyer 166','in_progress','2026-10-20 15:00:00+00','00000000-0000-0000-0000-00000000a661','aaaaaaaa-0000-0000-0000-000000de1660',
   'aaaaaaaa-0000-0000-0000-0000000c1661', 1);
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-000000001660');

set local app.system_op = 'on';
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, department_id, team_id, title, status, starts_at, due_at, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000a1661','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1661',
   '00000000-0000-0000-0000-00000000a662','aaaaaaaa-0000-0000-0000-000000de1660','aaaaaaaa-0000-0000-0000-00000007e166',
   'Artwork 166','in_progress','2026-10-01 06:00:00+00','2026-10-05 15:00:00+00', 8),
  ('aaaaaaaa-0000-0000-0000-0000000a1662','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1662',
   '00000000-0000-0000-0000-00000000a662','aaaaaaaa-0000-0000-0000-000000de1660','aaaaaaaa-0000-0000-0000-00000007e166',
   'Poster art 166','todo','2026-10-01 06:00:00+00','2026-10-05 15:00:00+00', 8),
  ('aaaaaaaa-0000-0000-0000-0000000a1663','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1663',
   '00000000-0000-0000-0000-00000000a662','aaaaaaaa-0000-0000-0000-000000de1660','aaaaaaaa-0000-0000-0000-00000007e166',
   'Flyer art 166','todo','2026-10-01 06:00:00+00','2026-10-05 15:00:00+00', 8);
insert into task_time_entries (tenant_id, sub_task_id, user_id, mode, minutes, submitted_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000a1663','00000000-0000-0000-0000-00000000a662','manual', 30, now());
set local app.system_op = 'off';

-- ================================================================ GUARD ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a661'),true);
select ok(public.deliverable_is_started('aaaaaaaa-0000-0000-0000-0000000d1661'), '"started": a task in progress');
select ok(not public.deliverable_is_started('aaaaaaaa-0000-0000-0000-0000000d1662'), '"started": a task to do and no time is not started');
select ok(public.deliverable_is_started('aaaaaaaa-0000-0000-0000-0000000d1663'), '"started": a time entry alone starts it');

-- ADR-0141 d.1 (3 Oct): only the account manager's side edits a live piece at all, so the started guard is proven on
-- her — the owner is refused before it is reached (suite 220).
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a660'),true);
select throws_ok(
  $$ select public.update_campaign_deliverable('aaaaaaaa-0000-0000-0000-0000000d1661', 'Banner 166',
       'aaaaaaaa-0000-0000-0000-0000000c1661', 3) $$,
  '55000', null, 'd.1: the Edit''s own write refuses a quantity change on started work — even for the account manager');
select throws_ok(
  $$ update deliverables set quantity = 5 where id = 'aaaaaaaa-0000-0000-0000-0000000d1661' $$,
  '55000', null, 'd.1: and so does a bare PATCH');
select throws_ok(
  $$ update deliverables set quantity = 2 where id = 'aaaaaaaa-0000-0000-0000-0000000d1663' $$,
  '55000', null, 'd.1: a quantity change on work started only by a time entry is refused');
select lives_ok(
  $$ select public.update_campaign_deliverable('aaaaaaaa-0000-0000-0000-0000000d1661', 'Banner 166 — hero',
       'aaaaaaaa-0000-0000-0000-0000000c1661', 1) $$,
  'd.1: the name still saves on started work');
select is((select name from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1661'), 'Banner 166 — hero',
  'd.1: and it is saved');
select lives_ok(
  $$ select public.update_campaign_deliverable('aaaaaaaa-0000-0000-0000-0000000d1662', 'Poster 166',
       'aaaaaaaa-0000-0000-0000-0000000c1661', 2) $$,
  'd.1: unstarted work saves a quantity change as today');

-- ================================================================ ASK ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a663'),true);
select throws_ok(
  $$ select public.request_deliverable_change('aaaaaaaa-0000-0000-0000-0000000d1661', '{"quantity":{"to":3}}', 'client') $$,
  '42501', null, 'd.1: another department''s lead may not ask — it is outside their reach');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a662'),true);
select throws_ok(
  $$ select public.request_deliverable_change('aaaaaaaa-0000-0000-0000-0000000d1661', '{"quantity":{"to":3}}', 'client') $$,
  '42501', null, 'd.1: a team member may not ask either');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a660'),true);
select throws_ok(
  $$ select public.request_deliverable_change('aaaaaaaa-0000-0000-0000-0000000d1662', '{"quantity":{"to":3}}', 'client') $$,
  '22023', null, 'd.1: unstarted work is edited directly, not asked');
select throws_ok(
  $$ select public.request_deliverable_change('aaaaaaaa-0000-0000-0000-0000000d1661', '{"name":{"to":"X"}}', 'client') $$,
  '22023', null, 'd.1: the name is not a change request');
select throws_ok(
  $$ select public.request_deliverable_change('aaaaaaaa-0000-0000-0000-0000000d1661', '{"quantity":{"to":3}}', 'boss') $$,
  '22023', null, 'd.1: who asked is the client or us');
select throws_ok(
  $$ select public.request_deliverable_change('aaaaaaaa-0000-0000-0000-0000000d1661', '{"quantity":{"to":1}}', 'client') $$,
  '22023', null, 'd.1: a change to what it already is is refused');
select throws_ok(
  $$ select public.request_deliverable_change('aaaaaaaa-0000-0000-0000-0000000d1661',
       jsonb_build_object('department', jsonb_build_object('to', 'aaaaaaaa-0000-0000-0000-000000de1661')), 'us') $$,
  '22023', null, 'ADR-0102: a department that the owner stamp would undo is refused, with the reason');
select lives_ok(
  $$ select public.request_deliverable_change('aaaaaaaa-0000-0000-0000-0000000d1661',
       '{"quantity":{"from":99,"to":3},"due":{"to":"2026-10-25"}}', 'client',
       '{"hours_lost":4,"lands":"2026-10-25"}') $$,
  'd.1: the account manager asks for 3 instead of 1, due 25 Oct, because the client asked');
select is(
  (select array[changes -> 'quantity' ->> 'from', changes -> 'quantity' ->> 'to', changes -> 'due' ->> 'to',
                status, asked_by, owner_user_id::text, cost ->> 'hours_lost']
     from deliverable_change_requests where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d1661'),
  array['1', '3', '2026-10-25', 'pending', 'client', '00000000-0000-0000-0000-00000000a661', '4'],
  'd.1: before is read by the server (the 99 sent is ignored), after and cost as asked, to the owner');
select throws_ok(
  $$ select public.request_deliverable_change('aaaaaaaa-0000-0000-0000-0000000d1661', '{"quantity":{"to":4}}', 'client') $$,
  '55000', null, 'one open request per deliverable');
select is((select count(*)::int from public.needs_me_change_requests()), 0,
  'needs_me_change_requests: nothing waits on the requester while it is pending');

-- ================================================================ ANSWER ====
select throws_ok(
  $$ select public.answer_change_request((select id from deliverable_change_requests where status = 'pending'), 'accept') $$,
  '42501', null, 'd.2: the account manager does not answer her own request — the owner does');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a662'),true);
select throws_ok(
  $$ select public.answer_change_request((select id from deliverable_change_requests where status = 'pending'), 'accept') $$,
  '42501', null, 'd.2: nor does the maker');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a661'),true);
select is((select array_agg(my_part || ':' || status) from public.needs_me_change_requests()), array['owner:pending'],
  'needs_me_change_requests: the owner has it to answer');
select throws_ok(
  $$ select public.answer_change_request((select id from deliverable_change_requests where status = 'pending'), 'decline', ' ') $$,
  '22023', null, 'd.2: a decline needs a reason');
select throws_ok(
  $$ select public.answer_change_request((select id from deliverable_change_requests where status = 'pending'), 'push_back') $$,
  '22023', null, 'd.2: a push-back needs words');
select lives_ok(
  $$ select public.answer_change_request((select id from deliverable_change_requests where status = 'pending'), 'accept') $$,
  'd.2: the owner accepts');
select is(
  (select array[quantity::text, due_at::text] from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1661'),
  array['3', '2026-10-25 15:00:00+00'], 'd.2: the change applies — quantity 3, due at 18:00 Iraq on 25 Oct');
select is(
  (select array[status, round_spent::text, (answered_by is not null)::text]
     from deliverable_change_requests where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d1661'),
  array['accepted', 'true', 'true'], 'd.1: accepted, answered, and a client-asked change spends a round');
select is(
  (select count(*)::int from sla_events
    where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d1661' and event_type = 'deadline_changed'
      and payload ->> 'change_request_id' is not null and attributed_to = 'client'),
  1, 'the promise that moved is on the record, attributed to the client, naming the request');
select throws_ok(
  $$ select public.answer_change_request((select id from deliverable_change_requests where status = 'accepted'), 'decline', 'no') $$,
  '55000', null, 'an answered request is not answered twice');

-- ================================================================ RESOLVE ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a660'),true);
select lives_ok(
  $$ select public.request_deliverable_change('aaaaaaaa-0000-0000-0000-0000000d1661', '{"quantity":{"to":5}}', 'us') $$,
  'the account manager asks for 5 — our mistake this time');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a661'),true);
select lives_ok(
  $$ select public.answer_change_request((select id from deliverable_change_requests where status = 'pending'),
       'push_back', 'Five by the 30th, not the 25th', '2026-10-30') $$,
  'd.2: the owner pushes back with words and a date');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a663'),true);
select throws_ok(
  $$ select public.resolve_change_request((select id from deliverable_change_requests where status = 'pushed_back'), 'accept_counter') $$,
  '42501', null, 'd.3: another department''s lead cannot resolve a push-back');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a660'),true);
select is((select array_agg(my_part || ':' || status || ':' || counter_text) from public.needs_me_change_requests()),
  array['requester:pushed_back:Five by the 30th, not the 25th'], 'needs_me_change_requests: the push-back is back with the requester');
select throws_ok(
  $$ select public.resolve_change_request((select id from deliverable_change_requests where status = 'pushed_back'), 'insist') $$,
  '22023', null, 'd.3: there is no insist');
select lives_ok(
  $$ select public.resolve_change_request((select id from deliverable_change_requests where status = 'pushed_back'), 'accept_counter') $$,
  'd.3: the account manager accepts her version');
select is(
  (select array[quantity::text, due_at::text] from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1661'),
  array['5', '2026-10-30 15:00:00+00'], 'd.3: the change applies with HER date');
select is(
  (select array[status, round_spent::text] from deliverable_change_requests where status = 'counter_accepted'),
  array['counter_accepted', 'false'], 'd.1: a change we asked for spends no round');

-- withdrawn: nothing changes
select lives_ok(
  $$ select public.request_deliverable_change('aaaaaaaa-0000-0000-0000-0000000d1661', '{"quantity":{"to":7}}', 'client') $$,
  'another request, for 7');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a661'),true);
select lives_ok(
  $$ select public.answer_change_request((select id from deliverable_change_requests where status = 'pending'), 'push_back', 'Six at most') $$,
  'pushed back without a date');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a660'),true);
select lives_ok(
  $$ select public.resolve_change_request((select id from deliverable_change_requests where status = 'pushed_back'), 'withdraw') $$,
  'd.3: the account manager withdraws');
select is(
  (select array[d.quantity::text, r.status, r.round_spent::text]
     from deliverables d join deliverable_change_requests r on r.deliverable_id = d.id
    where d.id = 'aaaaaaaa-0000-0000-0000-0000000d1661' and r.status = 'withdrawn'),
  array['5', 'withdrawn', 'false'], 'd.3: withdrawn — nothing changes, no round spent');

-- declined and closed
select lives_ok(
  $$ select public.request_deliverable_change('aaaaaaaa-0000-0000-0000-0000000d1661', '{"quantity":{"to":9}}', 'client') $$,
  'another request, for 9');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a661'),true);
select lives_ok(
  $$ select public.answer_change_request((select id from deliverable_change_requests where status = 'pending'), 'decline', 'The artwork is done') $$,
  'd.2: the owner declines with a reason');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a660'),true);
select is((select array_agg(my_part || ':' || status || ':' || decline_reason) from public.needs_me_change_requests()),
  array['requester:declined:The artwork is done'], 'D3: the declined request is in the requester''s Needs you, with the reason');
select throws_ok(
  $$ select public.resolve_change_request((select id from deliverable_change_requests where status = 'declined'), 'withdraw') $$,
  '55000', null, 'a declined request is closed, not resolved');
select lives_ok(
  $$ select public.close_change_request((select id from deliverable_change_requests where status = 'declined')) $$,
  'D3: Close');
select is((select count(*)::int from public.needs_me_change_requests()), 0, 'D3: closed, it leaves Needs you');
select is(app.deliverable_rounds_spent('aaaaaaaa-0000-0000-0000-0000000d1661'), 1,
  'the rounds spent on the deliverable: the one client change that applied');

-- ADR-0052 d.6 as amended by I59 E7: a type change over live tasks applies on accept (176 covers it).
select lives_ok(
  $$ select public.request_deliverable_change('aaaaaaaa-0000-0000-0000-0000000d1661',
       '{"type":{"to":"aaaaaaaa-0000-0000-0000-0000000c1662"}}', 'client') $$,
  'a type change is asked for');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a661'),true);
select lives_ok(
  $$ select public.answer_change_request((select id from deliverable_change_requests where status = 'pending'), 'accept') $$,
  'I59 E7: accepting a type change over live tasks applies — the list is regenerated');

-- ================================================================ TOLD ====
reset role;
select is(
  (select array_agg(distinct user_id::text || ':' || type order by user_id::text || ':' || type)
     from notifications where entity_id = 'aaaaaaaa-0000-0000-0000-0000000d1661' and type like 'change_request_%'),
  array['00000000-0000-0000-0000-00000000a660:change_request_answered',
        '00000000-0000-0000-0000-00000000a661:change_request_resolved',
        '00000000-0000-0000-0000-00000000a661:change_request_sent'],
  'told: the owner when asked and when resolved, the requester when answered');

select * from finish();
rollback;
