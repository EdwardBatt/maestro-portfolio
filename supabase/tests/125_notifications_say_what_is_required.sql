-- I52 (17 Sep, Edward) — every notification says who it is for and what is required of them.
--
-- The words live in notify-email; this proves the ROWS the words rest on (migration
-- 20260917110000). One case per emitter that changed:
--
--   * Action 2 — an owner change tells the NEW owner what is theirs and the OLD owner who has it.
--   * Action 3 — a reassignment tells the person the task was taken FROM, naming who has it now.
--   * Action 4 — submitting names the TASK; a required reviewer gets review_requested, an optional
--                one feedback_requested.
--   * Action 6b — "you can start" names what was approved; a waiting task with no assignee tells
--                 the deliverable's owner instead of nobody.
--   * Action 8 — a moved booking records the days it moved FROM and TO.
--   * Action 13 — a required person's booking records its days and who is doing the task.
--   * `blocked` and `brief_awaiting_approval` cannot be written any more.
--
-- Suites 076, 097, 104 and 106 were re-pointed at the new rules for approval and attachment.
begin;
select plan(18);
\ir helpers/seed.sql

-- ---------------------------------------------------------------- fixtures ----
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a040', 'lead-a@a.test'),
  ('00000000-0000-0000-0000-00000000a041', 'lead-b@a.test'),
  ('00000000-0000-0000-0000-00000000a042', 'maker-b@a.test'),
  ('00000000-0000-0000-0000-00000000a043', 'lead-c@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key)
from (values
  ('00000000-0000-0000-0000-00000000a040','Lead A', 'department_lead'),
  ('00000000-0000-0000-0000-00000000a041','Lead B', 'department_lead'),
  ('00000000-0000-0000-0000-00000000a042','Maker B','team_member'),
  -- a team lead may moderate reviews (suite 097's shape): the optional reviewer.
  ('00000000-0000-0000-0000-00000000a043','Lead C', 'team_lead')
) as v(id, name, role_key);

insert into test_claims (id, jwt)
select up.id,
       json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id = '00000000-0000-0000-0000-00000000a043';

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000001250','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S125');
insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-000000001251','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001250',
   'Social Advertisement','in_progress','00000000-0000-0000-0000-00000000a040','00000000-0000-0000-0000-00000000a001');
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, assignee_id, sort_order, sla_hours) values
  -- P: the prerequisite, done by a003.
  ('aaaaaaaa-0000-0000-0000-000000001261','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001251','Creative Direction','todo','00000000-0000-0000-0000-00000000a003', 1, 8),
  -- W: waits on P, and has NO assignee.
  ('aaaaaaaa-0000-0000-0000-000000001262','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001251','Animation','todo', null, 2, null),
  -- R: a task to reassign, booked for two days.
  ('aaaaaaaa-0000-0000-0000-000000001263','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001251','Retouch','todo','00000000-0000-0000-0000-00000000a003', 3, 8);
insert into sub_task_dependencies (tenant_id, sub_task_id, depends_on_sub_task_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001262','aaaaaaaa-0000-0000-0000-000000001261');
insert into media_records (id, tenant_id, deliverable_id, object_key, content_type) values
  ('aaaaaaaa-0000-0000-0000-000000001271','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001251','k/p-v1.png','image/png');
-- P's reviewers: a001 (seeded from the deliverable's reviewer, ADR-0038) made required; a043 optional.
update sub_task_reviewers set is_mandatory = true
 where sub_task_id = 'aaaaaaaa-0000-0000-0000-000000001261' and user_id = '00000000-0000-0000-0000-00000000a001';
insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001261','00000000-0000-0000-0000-00000000a043', false);
-- R's booking, on a003's calendar.
insert into bookings (id, tenant_id, resource_id, sub_task_id, starts_at, ends_at, load_pct, state) values
  ('aaaaaaaa-0000-0000-0000-000000001281','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000d0a3','aaaaaaaa-0000-0000-0000-000000001263',
   '2026-09-23 06:00+00','2026-09-24 10:00+00', 50, 'confirmed');
delete from notifications;

-- ================================================================ the type list ====
select is((select count(*) from notifications where type in ('blocked', 'brief_awaiting_approval'))::int, 0,
  'no row of a retired type survives the migration (production had some; an empty database never did — I48.31)');
select throws_ok($$
  insert into notifications (tenant_id, user_id, type, label) values
    ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000a003','blocked','x')
$$, '23514', null, '`blocked` cannot be written — nothing ever raised it');
select throws_ok($$
  insert into notifications (tenant_id, user_id, type, label) values
    ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000a003','brief_awaiting_approval','x')
$$, '23514', null, '`brief_awaiting_approval` cannot be written — folded into Action 1');

-- ================================================================ Action 4: submit ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
-- I52.15: a task is submitted only after it was started; start it (a no-op if it already is).
do $s$ begin perform app.sub_task_start('aaaaaaaa-0000-0000-0000-000000001261'); exception when others then null; end $s$;
-- ADR-0106 (I59.20): sent in the same transaction as its Start (or never started) — an UNTIMED round, accepted as one.
select lives_ok($$ select app.sub_task_submit('aaaaaaaa-0000-0000-0000-000000001261', 30, true) $$, 'a003 submits P for review');
reset role;
select results_eq($$
  select type, entity_type, entity_id, label from notifications
   where user_id = '00000000-0000-0000-0000-00000000a001' and entity_id = 'aaaaaaaa-0000-0000-0000-000000001261'
$$, $$ values ('review_requested', 'sub_task', 'aaaaaaaa-0000-0000-0000-000000001261'::uuid, 'Creative Direction') $$,
  'the REQUIRED reviewer gets review_requested, on the TASK, named by its title (Action 4)');
select results_eq($$
  select type, entity_type, label from notifications
   where user_id = '00000000-0000-0000-0000-00000000a043' and entity_id = 'aaaaaaaa-0000-0000-0000-000000001261'
$$, $$ values ('feedback_requested', 'sub_task', 'Creative Direction') $$,
  'the OPTIONAL reviewer gets feedback_requested — asked for an answer, not an approval (Action 4)');

-- ================================================================ Action 11: last answer ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a043'),true);
select lives_ok($$ select public.sub_task_respond('aaaaaaaa-0000-0000-0000-000000001261') $$, 'the optional reviewer answers');
reset role;
select results_eq($$
  select type, entity_type, entity_id, label from notifications
   where user_id = '00000000-0000-0000-0000-00000000a001' and type = 'feedback_collected'
$$, $$ values ('feedback_collected', 'sub_task', 'aaaaaaaa-0000-0000-0000-000000001261'::uuid, 'Creative Direction') $$,
  'the required reviewer is told everyone has answered — on the TASK, by its title (Action 11)');

-- ================================================================ Action 6b: release ====
-- Approval drives P to done as a seeder would (the guard's own escape; see suite 030).
select set_config('request.jwt.claims', '', true);
update sub_tasks set status = 'done' where id = 'aaaaaaaa-0000-0000-0000-000000001261';
select results_eq($$
  select user_id, label, detail ->> 'approved_task', (detail ->> 'unassigned')::boolean from notifications
   where type = 'dependency_ready' and entity_id = 'aaaaaaaa-0000-0000-0000-000000001262'
$$, $$ values ('00000000-0000-0000-0000-00000000a040'::uuid, 'Animation', 'Creative Direction', true) $$,
  'W has no assignee, so its DELIVERABLE OWNER is told — naming the task that was approved (Action 6b)');

-- ================================================================ Action 2: owner change ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
update deliverables set owner_user_id = '00000000-0000-0000-0000-00000000a041'
 where id = 'aaaaaaaa-0000-0000-0000-000000001251';
reset role;
select results_eq($$
  select type, entity_type from notifications
   where user_id = '00000000-0000-0000-0000-00000000a041' and entity_id = 'aaaaaaaa-0000-0000-0000-000000001251'
$$, $$ values ('deliverable_reassigned', 'deliverable') $$,
  'the NEW owner is told the deliverable is theirs (Action 2)');
select results_eq($$
  select type, detail ->> 'new_owner' from notifications
   where user_id = '00000000-0000-0000-0000-00000000a040' and entity_id = 'aaaaaaaa-0000-0000-0000-000000001251'
     and type <> 'dependency_ready'
$$, $$ values ('deliverable_owner_removed', 'Lead B') $$,
  'the OLD owner is told who has it now (Action 2)');
select is((select count(*) from notifications where user_id = '00000000-0000-0000-0000-00000000a001'
            and entity_id = 'aaaaaaaa-0000-0000-0000-000000001251')::int, 0,
  'the person who changed it is not told');

-- ================================================================ Action 3: reassign ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select set_config('app.system_op','on',true);   -- past the assignment gate: the ROW is under test, not the gate
update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a042'
 where id = 'aaaaaaaa-0000-0000-0000-000000001263';
select set_config('app.system_op','off',true);
reset role;
select results_eq($$
  select type, detail ->> 'new_assignee' from notifications
   where user_id = '00000000-0000-0000-0000-00000000a003' and entity_id = 'aaaaaaaa-0000-0000-0000-000000001263'
$$, $$ values ('task_reassigned_away', 'Maker B') $$,
  'the person the task was taken FROM is told who has it now (Action 3)');
select is((select count(*) from notifications where type = 'assigned'
            and user_id = '00000000-0000-0000-0000-00000000a042'
            and entity_id = 'aaaaaaaa-0000-0000-0000-000000001263')::int, 1,
  'and the new assignee gets the ordinary assigned notification, as before');

-- ================================================================ Action 8: moved ====
-- R is back with a003 and its booking moves two days on.
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select set_config('app.system_op','on',true);
update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a003' where id = 'aaaaaaaa-0000-0000-0000-000000001263';
select set_config('app.system_op','off',true);
delete from notifications where type = 'rescheduled';
update bookings set starts_at = '2026-09-25 06:00+00', ends_at = '2026-09-26 10:00+00'
 where id = 'aaaaaaaa-0000-0000-0000-000000001281';
reset role;
select results_eq($$
  select user_id, (detail ->> 'from_start')::timestamptz, (detail ->> 'to_end')::timestamptz from notifications
   where type = 'rescheduled' and entity_id = 'aaaaaaaa-0000-0000-0000-000000001263'
$$, $$ values ('00000000-0000-0000-0000-00000000a003'::uuid, '2026-09-23 06:00+00'::timestamptz, '2026-09-26 10:00+00'::timestamptz) $$,
  'a moved booking tells the assignee, carrying the days it moved FROM and TO (Action 8)');

-- ================================================================ Action 13: required person ====
-- a002 is booked on R as a required person (not the assignee).
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
insert into bookings (id, tenant_id, resource_id, sub_task_id, starts_at, ends_at, load_pct, state) values
  ('aaaaaaaa-0000-0000-0000-000000001282','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000d0a2','aaaaaaaa-0000-0000-0000-000000001263',
   '2026-09-25 06:00+00','2026-09-25 10:00+00', 25, 'confirmed');
reset role;
select results_eq($$
  select type, label, detail ->> 'assignee', (detail ->> 'starts_at')::timestamptz from notifications
   where user_id = '00000000-0000-0000-0000-00000000a002' and entity_id = 'aaaaaaaa-0000-0000-0000-000000001263'
     and type = 'resource_required'
$$, $$ values ('resource_required', 'Retouch', 'Creative A', '2026-09-25 06:00+00'::timestamptz) $$,
  'a required person hears the task, the days and who is doing it (Action 13)');

-- ================================================================ the facts bag ====
select has_column('public', 'notifications', 'detail', 'notifications.detail exists');
select col_not_null('public', 'notifications', 'detail', 'and is never null — an empty bag, not a missing one');

select * from finish();
rollback;
