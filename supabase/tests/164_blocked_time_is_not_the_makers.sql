-- I59.21 (ADR-0107 d.3, d.2) — blocked time comes off the round, overlapping blocks counted once;
-- and the owner's "Needs you" lists every open block on the tasks of the deliverables they own.
--
-- The round: Started 120 minutes ago. The task's own blocks (minutes before now):
--   I1  [-100, -60]   ─┐ overlap: the union is [-100, -40] = 60, not 40 + 40 = 80
--   I2  [-80,  -40]   ─┘
--   I3  [-200, -110]  raised before the round began: only its last 10 minutes are inside it
--   I4  [-20,  open]  still open when sent: 20
-- Blocked = 10 + 60 + 20 = 90; minutes = 120 − 90 = 30. Another task's own block is NOT counted. A
-- deliverable-level input DOES count since I59 E12 (26 Sep) — the one here was cleared before the round
-- began, so it adds nothing; pgTAP 178 counts one that overlaps.
begin;
select plan(19);
\ir helpers/seed.sql

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000a167', 'lead164@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select '00000000-0000-0000-0000-00000000a167', 'aaaaaaaa-0000-0000-0000-000000000001', 'Lead 164',
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = 'department_lead'),
       'aaaaaaaa-0000-0000-0000-0000000de0ff';
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id = '00000000-0000-0000-0000-00000000a167';

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f164','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S164');
insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id, department_id, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d1640','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f164',
   'Film 164','in_progress','00000000-0000-0000-0000-00000000a167','aaaaaaaa-0000-0000-0000-0000000de0ff','00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-0000000d1641','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f164',
   'Not mine 164','in_progress','00000000-0000-0000-0000-00000000a001','aaaaaaaa-0000-0000-0000-0000000de0ff','00000000-0000-0000-0000-00000000a002');
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-00000000e001');
insert into sub_tasks (id, tenant_id, deliverable_id, title, assignee_id, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-000000001a01','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1640','Edit','00000000-0000-0000-0000-00000000a003','todo', 8),
  ('aaaaaaaa-0000-0000-0000-000000001a02','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1640','Grade','00000000-0000-0000-0000-00000000a003','todo', 1),
  ('aaaaaaaa-0000-0000-0000-000000001a03','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1640','Sound','00000000-0000-0000-0000-00000000a002','todo', 2),
  ('aaaaaaaa-0000-0000-0000-000000001a04','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1641','Other','00000000-0000-0000-0000-00000000a003','todo', 2);
insert into media_records (tenant_id, deliverable_id, sub_task_id, object_key, content_type)
select 'aaaaaaaa-0000-0000-0000-000000000001', st.deliverable_id, st.id, 'k/' || st.id || '.png', 'image/png'
  from sub_tasks st where st.id::text like 'aaaaaaaa-0000-0000-0000-000000001a0%';

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select lives_ok($$ select app.sub_task_start('aaaaaaaa-0000-0000-0000-000000001a01') $$, 'Edit started');
select lives_ok($$ select app.sub_task_start('aaaaaaaa-0000-0000-0000-000000001a02') $$, 'Grade started');
reset role;
update task_time_entries set started_at = now() - interval '120 minutes' where sub_task_id = 'aaaaaaaa-0000-0000-0000-000000001a01';
update task_time_entries set started_at = now() - interval '10 minutes'  where sub_task_id = 'aaaaaaaa-0000-0000-0000-000000001a02';

-- The past cannot be written through the product (the stamps are the server's, 162), so the
-- intervals are laid down as the fixture.
insert into deliverable_pending_inputs (id, tenant_id, deliverable_id, sub_task_id, kind, description, awaited_from, requested_at, satisfied_at) values
  ('aaaaaaaa-0000-0000-0000-000000001b01','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1640','aaaaaaaa-0000-0000-0000-000000001a01',
   'client','Rushes','Kite Card', now() - interval '100 minutes', now() - interval '60 minutes'),
  ('aaaaaaaa-0000-0000-0000-000000001b02','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1640','aaaaaaaa-0000-0000-0000-000000001a01',
   'copy','Voice-over script','Copy team', now() - interval '80 minutes', now() - interval '40 minutes'),
  ('aaaaaaaa-0000-0000-0000-000000001b03','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1640','aaaaaaaa-0000-0000-0000-000000001a01',
   'decision','Which cut','Lead 164', now() - interval '200 minutes', now() - interval '110 minutes'),
  ('aaaaaaaa-0000-0000-0000-000000001b04','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1640','aaaaaaaa-0000-0000-0000-000000001a01',
   'file','Music licence','Legal', now() - interval '20 minutes', null),
  -- the deliverable's own, cleared 10 minutes before the round began (E12: it would count inside it),
  -- and Sound's own, which is not this task's
  ('aaaaaaaa-0000-0000-0000-000000001b05','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1640', null,
   null,'Logo pack','Kite Card', now() - interval '300 minutes', now() - interval '130 minutes'),
  ('aaaaaaaa-0000-0000-0000-000000001b06','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1640','aaaaaaaa-0000-0000-0000-000000001a03',
   'other','Studio booking','Booker A', now() - interval '300 minutes', null),
  -- Grade: blocked for the last 5 of its 10 minutes
  ('aaaaaaaa-0000-0000-0000-000000001b07','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1640','aaaaaaaa-0000-0000-0000-000000001a02',
   'file','LUT','Colourist', now() - interval '5 minutes', null),
  -- on a deliverable Lead 164 does not own
  ('aaaaaaaa-0000-0000-0000-000000001b08','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1641','aaaaaaaa-0000-0000-0000-000000001a04',
   'copy','Headline','Copy team', now() - interval '30 minutes', null);

-- ======================================================= the union, counted once ====
select is(app.task_blocked_minutes('aaaaaaaa-0000-0000-0000-000000001a01', now() - interval '120 minutes', now()), 90.0,
  'blocked = 90: overlapping blocks once, a block begun before the round clipped to it, an open one to now');
select is(app.task_blocked_minutes('aaaaaaaa-0000-0000-0000-000000001a01', now(), now()), 0::numeric,
  'an empty window is 0, not an error');

set local role authenticated;
select ok((select elapsed_minutes = 120 and blocked_minutes_so_far = 90 and not is_untimed
             from public.task_round_timing('aaaaaaaa-0000-0000-0000-000000001a01')),
  'the screen reads it before sending: 120 elapsed, 90 blocked, timed');
select lives_ok($$ select app.sub_task_submit('aaaaaaaa-0000-0000-0000-000000001a01') $$, 'Edit is sent');
select ok((select minutes = 30.0 and blocked_minutes = 90.0 and not untimed
             from task_time_entries where sub_task_id = 'aaaaaaaa-0000-0000-0000-000000001a01'),
  'the round records 30 minutes of the maker''s time and 90 blocked');

-- ========================================== an untimed round keeps the allocation ====
select throws_ok($$ select app.sub_task_submit('aaaaaaaa-0000-0000-0000-000000001a02') $$,
  '22023', null, 'Grade, 10 minutes after Start, is untimed');
select lives_ok($$ select app.sub_task_submit('aaaaaaaa-0000-0000-0000-000000001a02', null, true) $$, 'sent untimed');
select ok((select minutes = 60.0 and untimed and blocked_minutes = 5.0
             from task_time_entries where sub_task_id = 'aaaaaaaa-0000-0000-0000-000000001a02'),
  'the allocation (1h) is recorded, the 5 blocked minutes beside it — blocks do not shrink an untimed round');

-- ============================================================== Needs you (d.2) ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a167'),true);
select is((select array_agg(input_id::text order by input_id) from public.needs_me_blocks()),
  array['aaaaaaaa-0000-0000-0000-000000001b04','aaaaaaaa-0000-0000-0000-000000001b06','aaaaaaaa-0000-0000-0000-000000001b07'],
  'the owner sees the OPEN task-level blocks on their deliverable — not the cleared, not the deliverable''s own, not another owner''s');
select ok((select task_title = 'Edit' and maker_name = 'Creative A' and kind = 'file'
             and description = 'Music licence' and awaited_from = 'Legal'
             and requested_at = now() - interval '20 minutes' and deliverable_name = 'Film 164'
             from public.needs_me_blocks() where input_id = 'aaaaaaaa-0000-0000-0000-000000001b04'),
  'each names the task, the maker, what, from whom and since when');
select is((select input_id from public.needs_me_blocks() limit 1), 'aaaaaaaa-0000-0000-0000-000000001b06'::uuid,
  'oldest first');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select is((select count(*)::int from public.needs_me_blocks()), 0, 'the maker owns nothing: none');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select is((select array_agg(input_id::text) from public.needs_me_blocks()),
  array['aaaaaaaa-0000-0000-0000-000000001b08'], 'the other owner sees only their own');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b001'),true);
select is((select count(*)::int from public.needs_me_blocks()), 0, 'tenant B: none');

-- ================================================================ grants ====
reset role;
select ok(not has_function_privilege('anon', 'public.needs_me_blocks()', 'execute'),
  'anon cannot call needs_me_blocks');
select ok(not has_function_privilege('anon', 'public.task_round_timing(uuid)', 'execute'),
  'anon cannot call task_round_timing');
select ok(not has_function_privilege('anon', 'public.sub_task_submit(uuid, numeric, boolean)', 'execute'),
  'anon cannot call sub_task_submit');

select * from finish();
rollback;
