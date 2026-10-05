-- I59.20 (ADR-0106 d.1–d.3) — an untimed round records the task's allocated hours.
--
-- A round is UNTIMED when it was never started, or sent less than the tenant's
-- untimed_threshold_minutes (default 15) after Start. It is refused unless the maker accepts
-- (p_accept_untimed); accepted, it records the allocation (sla_hours, else committed_hours) marked
-- `untimed`, and the deliverable's owner is told. A round sent after the threshold records the timer.
--
-- Subjects: a003 = the maker (team_member), L = the deliverable's owner (department_lead), a002 =
-- someone else in tenant A, b001 = tenant B.
begin;
select plan(34);
\ir helpers/seed.sql

create or replace function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare h text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return h;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a160', 'lead160@a.test'),
  ('00000000-0000-0000-0000-00000000a161', 'am160@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid
from (values
  ('00000000-0000-0000-0000-00000000a160','Lead 160','department_lead','aaaaaaaa-0000-0000-0000-0000000de0ff'),
  ('00000000-0000-0000-0000-00000000a161','AM 160',  'account_manager', null)
) as v(id, name, role_key, dept);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id in ('00000000-0000-0000-0000-00000000a160','00000000-0000-0000-0000-00000000a161');

insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id, approved_at) values
  ('aaaaaaaa-0000-0000-0000-000000001600','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000c001',
   'Season 160','approved','campaign','00000000-0000-0000-0000-00000000a161', now());
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f160','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001600','S160');
insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id, department_id, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d1600','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f160',
   'Draft 160','draft','00000000-0000-0000-0000-00000000a160','aaaaaaaa-0000-0000-0000-0000000de0ff','00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-0000000d1601','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f160',
   'Running 160','in_progress','00000000-0000-0000-0000-00000000a160','aaaaaaaa-0000-0000-0000-0000000de0ff','00000000-0000-0000-0000-00000000a001');
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-000000001600');

-- T1 never started (4h) · T2 sent a minute after Start (2h) · T3 sent 40 min after Start (5h) ·
-- T4 40 min under a 60-min tenant threshold · T5 no sla_hours, committed 3h · T6 no allocation.
insert into sub_tasks (id, tenant_id, deliverable_id, title, assignee_id, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000016a1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1600','Never started','00000000-0000-0000-0000-00000000a003','todo', 4),
  ('aaaaaaaa-0000-0000-0000-0000000016a2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1601','Too quick','00000000-0000-0000-0000-00000000a003','todo', 2),
  ('aaaaaaaa-0000-0000-0000-0000000016a3','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1601','Timed','00000000-0000-0000-0000-00000000a003','todo', 5),
  ('aaaaaaaa-0000-0000-0000-0000000016a4','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1601','Under 60','00000000-0000-0000-0000-00000000a003','todo', 1),
  ('aaaaaaaa-0000-0000-0000-0000000016a5','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1601','Committed only','00000000-0000-0000-0000-00000000a003','todo', 3);
-- T6: a task assigned before E11 (26 Sep) made hours mandatory — the only way one with no allocation
-- exists now. Assigned with its hours, as every route must; then the allocation and the commitment
-- stamped from it are taken away again, standing in for that history.
insert into sub_tasks (id, tenant_id, deliverable_id, title, assignee_id, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000016a6','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1601','No allocation','00000000-0000-0000-0000-00000000a003','todo', 8);
update sub_tasks set sla_hours = null, committed_hours = null where id = 'aaaaaaaa-0000-0000-0000-0000000016a6';
-- T5: the allocation survives only as the commitment (stamped from sla_hours at assignment).
update sub_tasks set sla_hours = null where id = 'aaaaaaaa-0000-0000-0000-0000000016a5';
insert into media_records (tenant_id, deliverable_id, sub_task_id, object_key, content_type)
select 'aaaaaaaa-0000-0000-0000-000000000001', st.deliverable_id, st.id, 'k/' || st.id || '.png', 'image/png'
  from sub_tasks st where st.id::text like 'aaaaaaaa-0000-0000-0000-0000000016a%';

select is((select committed_hours from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000016a5'), 3.00::numeric(6,2),
  'fixture: T5 keeps a committed 3h with no sla_hours');

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);

-- ============================================== never started (d.1, d.2, d.3) ====
select throws_ok($$ select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000016a1') $$,
  '22023', null, 'a never-started round is refused without the maker accepting it untimed');
select is(pg_temp.hint_of($$ select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000016a1') $$), 'untimed',
  'the refusal carries HINT untimed — the screen''s cue to warn');
select throws_ok($$ select public.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000016a1', 90) $$,
  '22023', null, 'typed manual minutes no longer send an unstarted round');
select is((select status from sub_tasks where id='aaaaaaaa-0000-0000-0000-0000000016a1'), 'todo',
  'refused: the task is still todo');
select lives_ok($$ select public.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000016a1', null, true) $$,
  'accepted untimed, it is sent');
select is((select status from sub_tasks where id='aaaaaaaa-0000-0000-0000-0000000016a1'), 'review',
  'the task is in review');
select is((select count(*)::int from task_time_entries where sub_task_id='aaaaaaaa-0000-0000-0000-0000000016a1'), 1,
  'one entry, opened and closed in the one call');
select is((select minutes from task_time_entries where sub_task_id='aaaaaaaa-0000-0000-0000-0000000016a1'), 240.0::numeric(7,1),
  'it records the allocation: 4h = 240 minutes');
select ok((select untimed and mode = 'manual' and started_at = submitted_at and submitted_at is not null
             from task_time_entries where sub_task_id='aaaaaaaa-0000-0000-0000-0000000016a1'),
  'marked untimed, mode manual, started and submitted at the same moment');
select is((select state::text from deliverables where id='aaaaaaaa-0000-0000-0000-0000000d1600'), 'in_progress',
  'the draft container started, as a Start would have started it');

-- ============================================ sent a minute after Start (d.1) ====
select lives_ok($$ select app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000016a2') $$, 'T2 started');
select throws_ok($$ select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000016a2') $$,
  '22023', null, 'sent under the threshold after Start: untimed, refused without the flag');
select lives_ok($$ select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000016a2', null, true) $$,
  'accepted, it is sent');
select ok((select untimed and mode = 'timer' and minutes = 120.0
             from task_time_entries where sub_task_id='aaaaaaaa-0000-0000-0000-0000000016a2'),
  'the timer''s own entry, marked untimed, with the allocation (2h = 120) not the timer');

-- ============================================== sent 40 minutes after Start ====
select lives_ok($$ select app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000016a3') $$, 'T3 started');
select lives_ok($$ select app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000016a4') $$, 'T4 started');
reset role;
update task_time_entries set started_at = now() - interval '40 minutes'
 where sub_task_id in ('aaaaaaaa-0000-0000-0000-0000000016a3','aaaaaaaa-0000-0000-0000-0000000016a4');
set local role authenticated;

select lives_ok($$ select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000016a3') $$,
  'over the threshold, the round is sent with no flag');
select ok((select not untimed and mode = 'timer' and minutes = 40.0 and blocked_minutes = 0
             from task_time_entries where sub_task_id='aaaaaaaa-0000-0000-0000-0000000016a3'),
  'timed: the timer''s 40 minutes, not the 5h allocation; nothing blocked');

-- ====================================== the threshold is the tenant's setting ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select lives_ok($$ insert into tenant_reminder_settings (tenant_id, untimed_threshold_minutes)
                   values ('aaaaaaaa-0000-0000-0000-000000000001', 60)
                   on conflict (tenant_id) do update set untimed_threshold_minutes = 60 $$,
  'an admin (organization:manage) sets the threshold to 60 minutes');
select throws_ok($$ update tenant_reminder_settings set untimed_threshold_minutes = 0
                    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '23514', null, 'the threshold must be above zero');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
-- The maker tries to lower it: RLS filters the row out of the UPDATE (no organization:manage).
update tenant_reminder_settings set untimed_threshold_minutes = 1
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is((select untimed_threshold_minutes from tenant_reminder_settings
            where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 60,
  'the maker reads the setting (the screen needs it) and could not lower it: still 60');

select throws_ok($$ select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000016a4') $$,
  '22023', null, '40 minutes is untimed under a 60-minute threshold');
select ok((select is_untimed and threshold_minutes = 60 and elapsed_minutes = 40.0 and allocated_hours = 1
             from public.task_round_timing('aaaaaaaa-0000-0000-0000-0000000016a4')),
  'task_round_timing tells the screen: started 40 min ago, threshold 60, untimed, 1h allocated');

-- ================================================ where the allocation comes from ====
select lives_ok($$ select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000016a5', null, true) $$,
  'T5 (no sla_hours) is sent untimed');
select is((select minutes from task_time_entries where sub_task_id='aaaaaaaa-0000-0000-0000-0000000016a5'), 180.0::numeric(7,1),
  'with no sla_hours the allocation is the committed hours: 3h = 180');
select lives_ok($$ select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000016a6', null, true) $$,
  'T6 (no allocation at all) is sent untimed');
select ok((select untimed and minutes is null from task_time_entries where sub_task_id='aaaaaaaa-0000-0000-0000-0000000016a6'),
  'no allocation: marked untimed, minutes left empty — nothing invented');

-- ========================================================== who may, who reads ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select throws_ok($$ select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000016a4', null, true) $$,
  '42501', null, 'the flag does not let anyone but the assignee send');
select is((select count(*)::int from public.task_round_timing('aaaaaaaa-0000-0000-0000-0000000016a4')), 1,
  'another person in the tenant reads the task''s timing');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b001'),true);
select is((select count(*)::int from public.task_round_timing('aaaaaaaa-0000-0000-0000-0000000016a4')), 0,
  'tenant B reads nothing');

-- ======================================================= the owner is told (d.3) ====
reset role;
select is((select count(*)::int from notifications
            where type = 'untimed_round' and user_id = '00000000-0000-0000-0000-00000000a160'), 4,
  'the owner is told of each untimed round (T1, T2, T5, T6) — not of the timed one');
select ok((select (detail->>'allocated_hours')::numeric = 4 and (detail->>'started')::boolean = false
             and entity_type = 'sub_task'
             from notifications where type = 'untimed_round' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000016a1'),
  'the notice names the task, its allocation and that it was never started');
select is((select count(*)::int from notifications
            where type = 'untimed_round' and user_id = '00000000-0000-0000-0000-00000000a003'), 0,
  'the maker is not told about their own send');

select * from finish();
rollback;
