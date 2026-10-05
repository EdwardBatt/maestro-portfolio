-- ADR-0113 (25 Sep) / I59.25, I59.26 — people ask, nudge and say "too much" by notification and
-- email, each recorded against the piece.
--
--   * QUESTION — anyone in the tenant asks the people they pick; only a recipient replies (the RPC and
--                a bare insert alike); the question records its first reply; each recipient keeps it in
--                Needs you until THEY reply.
--   * NUDGE    — one named person, never yourself.
--   * TOO MUCH — only the task's assignee raises it, once while open, to whoever assigned the task,
--                with the maker's week (the SQL twin of useMyLoad); only that assigner answers it,
--                once; the maker is told.
--   * RECORD   — nothing is edited or deleted after it is sent.
--
-- `notifications` is recipient-scoped: every count over it is read after `reset role` (traps.md).
begin;
select plan(38);
\ir helpers/seed.sql

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de1670', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 167');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a670', 'am167@a.test'),
  ('00000000-0000-0000-0000-00000000a671', 'lead167@a.test'),
  ('00000000-0000-0000-0000-00000000a672', 'maker167@a.test'),
  ('00000000-0000-0000-0000-00000000a673', 'othermaker167@a.test'),
  ('00000000-0000-0000-0000-00000000a674', 'asker167@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid
from (values
  ('00000000-0000-0000-0000-00000000a670','AM 167',          'account_manager', null),
  ('00000000-0000-0000-0000-00000000a671','Lead 167',        'department_lead','aaaaaaaa-0000-0000-0000-000000de1670'),
  ('00000000-0000-0000-0000-00000000a672','Maker 167',       'team_member',    'aaaaaaaa-0000-0000-0000-000000de1670'),
  ('00000000-0000-0000-0000-00000000a673','Other maker 167', 'team_member',    'aaaaaaaa-0000-0000-0000-000000de1670'),
  ('00000000-0000-0000-0000-00000000a674','Asker 167',       'team_member',    'aaaaaaaa-0000-0000-0000-000000de1670')
) as v(id, name, role_key, dept);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id::text like '00000000-0000-0000-0000-00000000a67_';

insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-000000001670','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Season 167','approved','campaign','00000000-0000-0000-0000-00000000a670');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f167','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001670','S167');
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d1671','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f167',
   'Banner 167','in_progress','2026-10-20 15:00:00+00','00000000-0000-0000-0000-00000000a671','aaaaaaaa-0000-0000-0000-000000de1670');
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-000000001670');

-- The lead gave the maker the task (assigned_by is stamped from the claims).
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a671'),true);
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, department_id, title, status, starts_at, due_at, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000a1671','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1671',
   '00000000-0000-0000-0000-00000000a672','aaaaaaaa-0000-0000-0000-000000de1670',
   'Artwork 167','todo', now(), now() + interval '2 days', 8);
-- The maker's week: one person-resource, no office (so 5 × 8 = 40 nominal hours), one 4-hour booking now.
insert into resources (id, tenant_id, kind, name, capacity_model, load_ceiling_pct, warn_at_pct, user_id) values
  ('aaaaaaaa-0000-0000-0000-00000000d672','aaaaaaaa-0000-0000-0000-000000000001','human','Maker 167','load_based',120.0,100.0,
   '00000000-0000-0000-0000-00000000a672');
set local app.system_op = 'on';
insert into bookings (id, tenant_id, resource_id, sub_task_id, starts_at, ends_at, state, booked_by) values
  ('aaaaaaaa-0000-0000-0000-00000000b167','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000d672',
   'aaaaaaaa-0000-0000-0000-0000000a1671', now(), now() + interval '4 hours','confirmed','00000000-0000-0000-0000-00000000a671');
set local app.system_op = 'off';

select is((select assigned_by from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a1671'),
  '00000000-0000-0000-0000-00000000a671', 'fixture: the lead assigned the maker''s task');
select is(
  (select array[(app.person_week_load('00000000-0000-0000-0000-00000000a672') ->> 'booked_hours')::numeric::text,
                app.person_week_load('00000000-0000-0000-0000-00000000a672') ->> 'nominal_hours',
                app.person_week_load('00000000-0000-0000-0000-00000000a672') ->> 'util_pct',
                app.person_week_load('00000000-0000-0000-0000-00000000a672') ->> 'level']),
  array['4.0', '40', '10', 'ok'], 'the maker''s week, as useMyLoad reads it: 4 of 40 hours, 10%, ok');

-- ================================================================ QUESTION ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a674'),true);
select throws_ok(
  $$ select public.ask_question('aaaaaaaa-0000-0000-0000-0000000d1671', null, '{}'::uuid[], 'Which size first?') $$,
  '22023', null, 'd.2: a question names who it goes to');
select throws_ok(
  $$ select public.ask_question('aaaaaaaa-0000-0000-0000-0000000d1671', null,
       array['00000000-0000-0000-0000-00000000b001']::uuid[], 'Which size first?') $$,
  '22023', null, 'd.2: nobody outside the organization can be picked');
select throws_ok(
  $$ select public.ask_question('aaaaaaaa-0000-0000-0000-0000000d1671', null,
       array['00000000-0000-0000-0000-00000000a671']::uuid[], '  ') $$,
  '22023', null, 'd.2: a question has words');
select lives_ok(
  $$ select public.ask_question('aaaaaaaa-0000-0000-0000-0000000d1671', null,
       array['00000000-0000-0000-0000-00000000a671','00000000-0000-0000-0000-00000000a673','00000000-0000-0000-0000-00000000a674']::uuid[],
       'Which size first?') $$,
  'd.2: anyone asks the people they pick (the asker is dropped from their own list)');
select is(
  (select array[kind, author_id::text, cardinality(recipients)::text]
     from piece_messages where kind = 'question'),
  array['question', '00000000-0000-0000-0000-00000000a674', '2'], 'd.2: recorded against the piece, to the two picked');
select throws_ok(
  $$ insert into piece_messages (tenant_id, deliverable_id, kind, author_id, body, recipients)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1671', 'question',
             '00000000-0000-0000-0000-00000000a671', 'Forged', array['00000000-0000-0000-0000-00000000a672']::uuid[]) $$,
  '42501', null, 'RLS: nobody writes a message in somebody else''s name');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a672'),true);
select throws_ok(
  $$ select public.reply_to_question((select id from piece_messages where kind = 'question'), 'The square one') $$,
  '42501', null, 'd.2: somebody the question was not sent to cannot reply (RPC)');
select throws_ok(
  $$ insert into piece_messages (tenant_id, deliverable_id, kind, parent_id, author_id, body, recipients)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1671', 'reply',
             (select id from piece_messages where kind = 'question'),
             '00000000-0000-0000-0000-00000000a672', 'The square one', array['00000000-0000-0000-0000-00000000a674']::uuid[]) $$,
  '42501', null, 'RLS: nor by writing the reply directly');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a671'),true);
select is((select array_agg(kind || ':' || body) from public.needs_me_messages()), array['question:Which size first?'],
  'needs_me_messages: the recipient has the question');
select lives_ok(
  $$ select public.reply_to_question((select id from piece_messages where kind = 'question'), 'The square one') $$,
  'd.2: a recipient replies');
select is(
  (select answered_by from piece_messages where kind = 'question'),
  '00000000-0000-0000-0000-00000000a671'::uuid, 'd.2: the question records its first reply');
select is((select count(*)::int from public.needs_me_messages()), 0, 'needs_me_messages: replied, it leaves the lead''s list');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a673'),true);
select is((select count(*)::int from public.needs_me_messages()), 1, 'needs_me_messages: the other recipient still has it');

-- the record is not edited: the asker's own update touches nothing (no policy), the words stand
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a674'),true);
update piece_messages set body = 'Rewritten' where kind = 'question';
select is((select body from piece_messages where kind = 'question'), 'Which size first?',
  'the record: a question is not edited after it is sent');
select throws_ok(
  $$ delete from piece_messages where kind = 'question' $$,
  '42501', null, 'the record: nor deleted');

-- ================================================================ NUDGE ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a670'),true);
select throws_ok(
  $$ select public.nudge(null, 'aaaaaaaa-0000-0000-0000-0000000a1671', '00000000-0000-0000-0000-00000000a670') $$,
  '22023', null, 'd.1: a nudge goes to somebody else');
select lives_ok(
  $$ select public.nudge(null, 'aaaaaaaa-0000-0000-0000-0000000a1671', '00000000-0000-0000-0000-00000000a672', 'Nearly there?') $$,
  'd.1: the account manager nudges the maker about the task');
select is(
  (select array[kind, deliverable_id::text, recipients[1]::text] from piece_messages where kind = 'nudge'),
  array['nudge', 'aaaaaaaa-0000-0000-0000-0000000d1671', '00000000-0000-0000-0000-00000000a672'],
  'd.1: recorded against the piece, to the one person');

-- ================================================================ TOO MUCH ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a673'),true);
select throws_ok(
  $$ select public.say_too_much('aaaaaaaa-0000-0000-0000-0000000a1671', 'Not mine') $$,
  '42501', null, 'd.3: only the task''s assignee says it is too much (RPC)');
select throws_ok(
  $$ insert into piece_messages (tenant_id, deliverable_id, sub_task_id, kind, author_id, recipients, status)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1671',
             'aaaaaaaa-0000-0000-0000-0000000a1671', 'too_much', '00000000-0000-0000-0000-00000000a673',
             array['00000000-0000-0000-0000-00000000a671']::uuid[], 'open') $$,
  '42501', null, 'RLS: nor by writing it directly');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a672'),true);
select lives_ok(
  $$ select public.say_too_much('aaaaaaaa-0000-0000-0000-0000000a1671', 'Three others due the same day') $$,
  'd.3: the maker says it is too much');
select throws_ok(
  $$ select public.say_too_much('aaaaaaaa-0000-0000-0000-0000000a1671', 'Again') $$,
  '55000', null, 'd.3: once while it is open');
select is((select assignee_id from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a1671'),
  '00000000-0000-0000-0000-00000000a672'::uuid, 'd.3: the task stays assigned');
select throws_ok(
  $$ select public.answer_too_much((select id from piece_messages where kind = 'too_much'), 'keep') $$,
  '42501', null, 'd.3: the maker does not answer their own');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a670'),true);
select throws_ok(
  $$ select public.answer_too_much((select id from piece_messages where kind = 'too_much'), 'keep') $$,
  '42501', null, 'd.3: nor does the account manager — only whoever assigned it');
update piece_messages set status = 'kept' where kind = 'too_much';
select is((select status from piece_messages where kind = 'too_much'), 'open',
  'RLS: the account manager cannot answer it by writing either');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a671'),true);
select is((select array_agg(kind || ':' || coalesce(body, '')) from public.needs_me_messages()),
  array['too_much:Three others due the same day'], 'needs_me_messages: the assigner has it to answer');
select throws_ok(
  $$ update piece_messages set body = 'Edited' where kind = 'too_much' $$,
  '42501', null, 'the record: the assigner may answer it, never reword it');
select throws_ok(
  $$ select public.answer_too_much((select id from piece_messages where kind = 'too_much'), 'maybe') $$,
  '22023', null, 'd.3: Rebalance or Keep it with her');
select lives_ok(
  $$ select public.answer_too_much((select id from piece_messages where kind = 'too_much'), 'rebalance') $$,
  'd.3: the assigner answers Rebalance');
select is(
  (select array[status, answered_by::text, (answered_at is not null)::text] from piece_messages where kind = 'too_much'),
  array['rebalanced', '00000000-0000-0000-0000-00000000a671', 'true'], 'd.3: answered, stamped by the server');
select throws_ok(
  $$ select public.answer_too_much((select id from piece_messages where kind = 'too_much'), 'keep') $$,
  '55000', null, 'd.3: answered once');
select is((select count(*)::int from public.needs_me_messages()), 0, 'needs_me_messages: answered, it leaves the list');

-- ================================================================ TOLD ====
reset role;
select is(
  (select array_agg(user_id::text || ':' || type order by user_id::text || ':' || type)
     from notifications
    where type in ('question_asked', 'question_replied', 'nudged', 'too_much', 'too_much_answered')),
  array['00000000-0000-0000-0000-00000000a671:question_asked',
        '00000000-0000-0000-0000-00000000a671:too_much',
        '00000000-0000-0000-0000-00000000a672:nudged',
        '00000000-0000-0000-0000-00000000a672:too_much_answered',
        '00000000-0000-0000-0000-00000000a673:question_asked',
        '00000000-0000-0000-0000-00000000a674:question_replied'],
  'told: each recipient asked, the asker replied, the maker nudged, the assigner too-much, the maker answered');
select is(
  (select array[detail -> 'week' ->> 'util_pct', detail -> 'week' ->> 'has_resource', detail ->> 'note', entity_type]
     from notifications where type = 'too_much'),
  array['10', 'true', 'Three others due the same day', 'sub_task'], 'd.3: the assigner is shown the maker''s week and note');
select is((select detail ->> 'answer' from notifications where type = 'too_much_answered'), 'rebalance',
  'd.3: the maker is told the answer');

select * from finish();
rollback;
