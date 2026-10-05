-- I59 (ADR-0109, 0110, 0113) — the new records stay in their tenant.
--
-- Tenant A holds a change request, a question, a "too much" and an extension request at its owner's
-- step. Tenant B's power admin — every permission, in the wrong tenant — reads none of them, finds
-- nothing on either Needs-you list, and every door refuses: the change-request RPCs, the message
-- RPCs, the extension owner's step, and a bare insert naming tenant A. Anonymous callers read nothing.
-- Tenant A's own people read them (the allow half).
begin;
select plan(27);
\ir helpers/seed.sql

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de1680', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 168');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000a681', 'owner168@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select '00000000-0000-0000-0000-00000000a681', 'aaaaaaaa-0000-0000-0000-000000000001', 'Owner 168',
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = 'department_lead'),
       'aaaaaaaa-0000-0000-0000-000000de1680';
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id = '00000000-0000-0000-0000-00000000a681';

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f168','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S168');
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d1681','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f168',
   'Banner 168','in_progress','2026-10-20 15:00:00+00','00000000-0000-0000-0000-00000000a681','aaaaaaaa-0000-0000-0000-000000de1680');

set local app.system_op = 'on';
-- assigned_by is stamped from the claims (tg_stamp_subtask_assignment): the owner gave the work.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a681'),true);
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, department_id, title, status, due_at, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000a1681','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1681',
   '00000000-0000-0000-0000-00000000a003','aaaaaaaa-0000-0000-0000-000000de1680',
   'Artwork 168','in_progress','2026-10-05 15:00:00+00', 8);
select set_config('request.jwt.claims', '', true);
insert into deliverable_change_requests (id, tenant_id, deliverable_id, requested_by, owner_user_id, changes, asked_by) values
  ('aaaaaaaa-0000-0000-0000-0000000cc168','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1681',
   '00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-00000000a681',
   '{"quantity":{"from":"1","to":"2"}}','client');
insert into piece_messages (id, tenant_id, deliverable_id, kind, author_id, body, recipients) values
  ('aaaaaaaa-0000-0000-0000-0000000aa168','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1681',
   'question','00000000-0000-0000-0000-00000000a001','Which size?', array['00000000-0000-0000-0000-00000000a681']::uuid[]);
insert into piece_messages (id, tenant_id, deliverable_id, sub_task_id, kind, author_id, recipients, status) values
  ('aaaaaaaa-0000-0000-0000-0000000ab168','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1681',
   'aaaaaaaa-0000-0000-0000-0000000a1681','too_much','00000000-0000-0000-0000-00000000a003',
   array['00000000-0000-0000-0000-00000000a681']::uuid[], 'open');
insert into sla_events (id, tenant_id, deliverable_id, sub_task_id, event_type, attributed_to, actor_user_id, payload) values
  ('aaaaaaaa-0000-0000-0000-0000000ee168','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1681',
   'aaaaaaaa-0000-0000-0000-0000000a1681','extension_requested','assignee','00000000-0000-0000-0000-00000000a003',
   jsonb_build_object('from', '2026-10-05 15:00:00+00', 'to', '2026-10-09 15:00:00+00', 'reason', 'Behind',
                      'owner_user_id', '00000000-0000-0000-0000-00000000a681', 'owner_step', true));
set local app.system_op = 'off';

-- ================================================================ tenant A reads its own ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a681'),true);
select is((select count(*)::int from deliverable_change_requests), 1, 'allow: tenant A reads its change request');
select is((select count(*)::int from piece_messages), 2, 'allow: tenant A reads its messages');
select is((select count(*)::int from public.needs_me_change_requests()), 1, 'allow: the owner has the change request to answer');
select is((select count(*)::int from public.needs_me_messages()), 2, 'allow: the owner has the question and the too-much');
select is((select count(*)::int from public.needs_me_extensions()), 1, 'allow: the owner has the extension at their step');

-- ================================================================ tenant B reads nothing ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b001'),true);
select is((select count(*)::int from deliverable_change_requests), 0, 'deny: tenant B reads none of A''s change requests');
select is((select count(*)::int from piece_messages), 0, 'deny: tenant B reads none of A''s messages');
select is((select count(*)::int from public.needs_me_change_requests()), 0, 'deny: nothing of A''s in B''s Needs you (changes)');
select is((select count(*)::int from public.needs_me_messages()), 0, 'deny: nothing of A''s in B''s Needs you (messages)');
select is((select count(*)::int from public.needs_me_extensions()), 0, 'deny: nothing of A''s in B''s Needs you (extensions)');
select ok(not public.deliverable_is_started('aaaaaaaa-0000-0000-0000-0000000d1681'),
  'deny: tenant B learns nothing about A''s deliverable, not even that it started');

-- ================================================================ and every door refuses ====
select throws_ok($$ select public.request_deliverable_change('aaaaaaaa-0000-0000-0000-0000000d1681', '{"quantity":{"to":3}}', 'client') $$,
  'P0002', null, 'deny: B cannot ask for a change to A''s deliverable');
select throws_ok($$ select public.answer_change_request('aaaaaaaa-0000-0000-0000-0000000cc168', 'accept') $$,
  'P0002', null, 'deny: B cannot answer A''s change request');
select throws_ok($$ select public.resolve_change_request('aaaaaaaa-0000-0000-0000-0000000cc168', 'withdraw') $$,
  'P0002', null, 'deny: B cannot resolve it');
select throws_ok($$ select public.close_change_request('aaaaaaaa-0000-0000-0000-0000000cc168') $$,
  'P0002', null, 'deny: B cannot close it');
select throws_ok($$ select public.ask_question('aaaaaaaa-0000-0000-0000-0000000d1681', null,
                      array['00000000-0000-0000-0000-00000000b002']::uuid[], 'Hello?') $$,
  '42501', null, 'deny: B cannot ask about A''s piece');
select throws_ok($$ select public.reply_to_question('aaaaaaaa-0000-0000-0000-0000000aa168', 'Big') $$,
  'P0002', null, 'deny: B cannot reply to A''s question');
select throws_ok($$ select public.nudge('aaaaaaaa-0000-0000-0000-0000000d1681', null, '00000000-0000-0000-0000-00000000b002') $$,
  '42501', null, 'deny: B cannot nudge about A''s piece');
select throws_ok($$ select public.say_too_much('aaaaaaaa-0000-0000-0000-0000000a1681') $$,
  'P0002', null, 'deny: B cannot say A''s task is too much');
select throws_ok($$ select public.answer_too_much('aaaaaaaa-0000-0000-0000-0000000ab168', 'keep') $$,
  'P0002', null, 'deny: B cannot answer A''s too-much');
select throws_ok($$ select public.forward_extension('aaaaaaaa-0000-0000-0000-0000000ee168', 'ok') $$,
  'P0002', null, 'deny: B cannot forward A''s extension request');
select throws_ok($$ select public.owner_decline_extension('aaaaaaaa-0000-0000-0000-0000000ee168', 'no') $$,
  'P0002', null, 'deny: B cannot decline it');
select throws_ok($$ select public.sub_task_extension_decide('aaaaaaaa-0000-0000-0000-0000000ee168', true) $$,
  'P0002', null, 'deny: B cannot answer it');
select throws_ok(
  $$ insert into piece_messages (tenant_id, deliverable_id, kind, author_id, body, recipients)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1681', 'nudge',
             '00000000-0000-0000-0000-00000000b001', 'x', array['00000000-0000-0000-0000-00000000a681']::uuid[]) $$,
  '42501', null, 'deny: B cannot write a message into A''s tenant');
select throws_ok(
  $$ insert into deliverable_change_requests (tenant_id, deliverable_id, requested_by, changes, asked_by)
     values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1681',
             '00000000-0000-0000-0000-00000000b001', '{"quantity":{"to":"2"}}', 'us') $$,
  '42501', null, 'deny: nobody writes a change request except through the RPCs');

-- ================================================================ anonymous ====
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select count(*) from piece_messages $$, '42501', null, 'deny: anon cannot read messages');
select throws_ok($$ select count(*) from deliverable_change_requests $$, '42501', null, 'deny: anon cannot read change requests');

select * from finish();
rollback;
