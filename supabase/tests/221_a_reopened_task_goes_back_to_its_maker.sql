-- ADR-0142 (3 Oct) — a re-opened task goes back to the person who made it; a client amendment is counted.
--
--   d.1  a re-open carries a kind: client_amendment | own_fix (default own_fix); anything else is refused.
--   d.2  the maker and the reviewers stay; new due date, a fresh commitment, the old plan's bookings released; the
--        answer lists the tasks to place, and the re-opener may place them on the maker's calendar (only in its days);
--        the maker is told too.
--   d.3  every re-open is recorded; amendment_summary counts client amendments per piece, campaign and client, with
--        hours, for a month or all time — inside the tenant only.
--   d.4  block time: kind internal with hours; leave carries no hours.
--
-- Fixtures (tenant A): Creative 221 with its Design team; a delivered piece on an approved campaign.
--   a211 AM 221        account_manager — the campaign's AM; re-opens
--   a212 Design TL 221 team_lead, Creative / Design
--   a213 Maker 221     team_member, Creative / Design (resource) — made both tasks
--   a001 Admin A       power_admin — the tasks' reviewer (seed)
begin;
select plan(25);
\ir helpers/seed.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000211', 'am221@a.test'),
  ('00000000-0000-0000-0000-000000000212', 'tl221@a.test'),
  ('00000000-0000-0000-0000-000000000213', 'maker221@a.test');
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000de21', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 221');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000e2211', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000de21', 'Design 221');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid, v.team::uuid
from (values
  ('00000000-0000-0000-0000-000000000211','AM 221',       'account_manager', null, null),
  ('00000000-0000-0000-0000-000000000212','Design TL 221','team_lead',       'aaaaaaaa-0000-0000-0000-00000000de21','aaaaaaaa-0000-0000-0000-0000000e2211'),
  ('00000000-0000-0000-0000-000000000213','Maker 221',    'team_member',     'aaaaaaaa-0000-0000-0000-00000000de21','aaaaaaaa-0000-0000-0000-0000000e2211')
) as v(id, name, role_key, dept, team);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id::text like '00000000-0000-0000-0000-00000000021%';
insert into resources (id, tenant_id, kind, name, capacity_model, load_ceiling_pct, warn_at_pct, user_id, department_id, team_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d2213','aaaaaaaa-0000-0000-0000-000000000001','human','Maker 221','load_based',120.0,100.0,
   '00000000-0000-0000-0000-000000000213','aaaaaaaa-0000-0000-0000-00000000de21','aaaaaaaa-0000-0000-0000-0000000e2211');

update campaigns set account_manager_id = '00000000-0000-0000-0000-000000000211'
 where id = 'aaaaaaaa-0000-0000-0000-00000000e001';
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000f2210','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S221');
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id, department_id, due_at, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000e2210','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000f2210',
   'Banner 221','delivered','00000000-0000-0000-0000-00000000a001','aaaaaaaa-0000-0000-0000-00000000de21',
   '2026-09-20 15:00+00','00000000-0000-0000-0000-000000000212');
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-00000000e001');
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, department_id, team_id, assignee_id, sla_hours, starts_at, due_at) values
  ('aaaaaaaa-0000-0000-0000-0000000a2211','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000e2210','Artwork 221','todo',
   'aaaaaaaa-0000-0000-0000-00000000de21','aaaaaaaa-0000-0000-0000-0000000e2211','00000000-0000-0000-0000-000000000213', 6,
   '2026-09-14 06:00+00','2026-09-16 15:00+00'),
  ('aaaaaaaa-0000-0000-0000-0000000a2212','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000e2210','Resize 221','todo',
   'aaaaaaaa-0000-0000-0000-00000000de21','aaaaaaaa-0000-0000-0000-0000000e2211','00000000-0000-0000-0000-000000000213', 2,
   '2026-09-17 06:00+00','2026-09-17 15:00+00');
-- Both finished, approved, the piece delivered; the old round's booking still on the maker's calendar.
set local app.system_op = 'on';
update sub_tasks set status = 'done', approved_at = '2026-09-18 10:00+00', approved_by = '00000000-0000-0000-0000-00000000a001'
 where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000e2210';
insert into bookings (tenant_id, resource_id, sub_task_id, deliverable_id, starts_at, ends_at, state, load_pct) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d2213','aaaaaaaa-0000-0000-0000-0000000a2211',
   'aaaaaaaa-0000-0000-0000-0000000e2210','2026-09-14 06:00+00','2026-09-14 12:00+00','confirmed',75);
set local app.system_op = 'off';

-- ============================================================ d.1: the kind ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000211'),true);
select throws_ok($q$
  select public.reopen_task('aaaaaaaa-0000-0000-0000-0000000a2211', 'Headline', now() + interval '6 days', 'whim')
$q$, '22023', null, 'd.1: a re-open is a client amendment or our own fix — nothing else');
select ok(not app.resource_in_scheduling_scope('aaaaaaaa-0000-0000-0000-0000000d2213'),
  'fixture: the account manager does not reach the maker''s calendar (ADR-0139)');

-- ============================================================ d.2: back to its maker ====
create temp table r221 (k text, v jsonb);
grant all on r221 to authenticated;
insert into r221 select 'amend', public.reopen_task('aaaaaaaa-0000-0000-0000-0000000a2211', 'The client changed the headline',
                                                    date_trunc('day', now()) + interval '6 days 15 hours', 'client_amendment', 3);
select is((select v -> 'reschedule' from r221 where k = 'amend'), '["aaaaaaaa-0000-0000-0000-0000000a2211"]'::jsonb,
  'd.2: the answer lists the task to place on the maker''s week (subtask-schedule)');
select is((select v ->> 'kind' from r221 where k = 'amend'), 'client_amendment', 'd.1: and says what kind of re-open it was');
reset role;
select results_eq($q$
  select status, assignee_id, sla_hours, schedule_overridden from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a2211'
$q$, $q$ values ('todo', '00000000-0000-0000-0000-000000000213'::uuid, 3::numeric, false) $q$,
  'd.2: To do, with its MAKER on it, for the round''s hours');
select ok((select starts_at <= now() + interval '1 minute' and due_at = date_trunc('day', now()) + interval '6 days 15 hours'
             and committed_due_at = app.commitment_instant(due_at) and committed_hours = 3
             from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a2211'),
  'd.2: it starts now, is due on the new date, and is committed to it afresh');
select is((select count(*)::int from sub_task_reviewers where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a2211'
            and user_id = '00000000-0000-0000-0000-00000000a001'), 1, 'd.2: the same reviewer');
select is((select count(*)::int from bookings where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a2211'), 0,
  'd.2: the old round''s booking is released for the new one to be placed');
select results_eq($q$
  select user_id, detail ->> 'kind' from notifications where type = 'task_reopened'
     and entity_id = 'aaaaaaaa-0000-0000-0000-0000000a2211' order by user_id
$q$, $q$ values ('00000000-0000-0000-0000-000000000213'::uuid, 'client_amendment'),
                ('00000000-0000-0000-0000-00000000a001'::uuid, 'client_amendment') $q$,
  'd.2: the maker and the reviewer are told, with the kind');
select is((select state::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000e2210'), 'in_progress',
  'd.1: the piece goes back to in progress');

-- The re-opener places the round on the maker's calendar — within its days only.
set local role authenticated;
select lives_ok($q$
  insert into bookings (tenant_id, resource_id, sub_task_id, deliverable_id, starts_at, ends_at, state, load_pct)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d2213','aaaaaaaa-0000-0000-0000-0000000a2211',
          'aaaaaaaa-0000-0000-0000-0000000e2210', date_trunc('day', now()) + interval '2 days 6 hours',
          date_trunc('day', now()) + interval '2 days 9 hours', 'confirmed', 37.5)
$q$, 'd.2: the account manager who re-opened it places the new round on the maker''s calendar');
select throws_ok($q$
  insert into bookings (tenant_id, resource_id, sub_task_id, deliverable_id, starts_at, ends_at, state, load_pct)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d2213','aaaaaaaa-0000-0000-0000-0000000a2211',
          'aaaaaaaa-0000-0000-0000-0000000e2210', date_trunc('day', now()) + interval '20 days 6 hours',
          date_trunc('day', now()) + interval '20 days 9 hours', 'confirmed', 37.5)
$q$, '42501', null, 'd.2: but not outside the task''s days');
select throws_ok($q$
  insert into bookings (tenant_id, resource_id, sub_task_id, deliverable_id, starts_at, ends_at, state, load_pct)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d2213','aaaaaaaa-0000-0000-0000-0000000a2212',
          'aaaaaaaa-0000-0000-0000-0000000e2210', date_trunc('day', now()) + interval '2 days 6 hours',
          date_trunc('day', now()) + interval '2 days 9 hours', 'confirmed', 37.5)
$q$, '42501', null, 'd.2: and not for a task she did not re-open');

-- The second task: our own fix, with the default kind.
select is(public.reopen_task('aaaaaaaa-0000-0000-0000-0000000a2212', 'We missed a size', now() + interval '4 days') ->> 'kind',
  'own_fix', 'd.1: a re-open with no kind is our own fix');

-- ============================================================ d.3: counted ====
reset role;
select results_eq($q$
  select kind, hours, assignee_id, reopened_by, campaign_id, client_id from sub_task_reopenings
   where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a2211'
$q$, $q$ values ('client_amendment', 3::numeric, '00000000-0000-0000-0000-000000000213'::uuid,
                 '00000000-0000-0000-0000-000000000211'::uuid, 'aaaaaaaa-0000-0000-0000-00000000e001'::uuid,
                 'aaaaaaaa-0000-0000-0000-00000000c001'::uuid) $q$,
  'd.3: the re-open is on the record — kind, hours, maker, who, campaign, client');
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000211'),true);
select throws_ok($q$
  insert into sub_task_reopenings (tenant_id, sub_task_id, deliverable_id, kind, reason, due_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000a2211','aaaaaaaa-0000-0000-0000-0000000e2210',
          'client_amendment','sneaky', now())
$q$, '42501', null, 'd.3: an amendment is counted only by re-opening — nobody writes the record by hand');
select results_eq($q$
  select level, name, amendments, hours from public.amendment_summary(now()::date) order by level
$q$, $q$ values ('campaign', 'Ramadan 2027', 1::bigint, 3::numeric),
                ('client', 'Kite Card', 1::bigint, 3::numeric),
                ('deliverable', 'Banner 221', 1::bigint, 3::numeric) $q$,
  'd.3: this month, one client amendment of 3 hours — on the piece, the campaign and the client; our own fix is not one');
select is((select count(*)::int from public.amendment_summary(null)), 3, 'd.3: all time reads the same here');
select is((select count(*)::int from public.amendment_summary((now() - interval '2 months')::date)), 0,
  'd.3: another month has none');
select throws_ok($q$
  update sub_task_reopenings set kind = 'own_fix' where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a2211'
$q$, '42501', null, 'd.3: the record is not rewritten by a user');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b001'),true);
select is((select count(*)::int from public.amendment_summary(null)), 0, 'd.3: tenant B counts none of tenant A''s amendments');
select is((select count(*)::int from sub_task_reopenings), 0, 'sub_task_reopenings_tenant_select: tenant B reads none');

-- ============================================================ d.4: block time ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select lives_ok($q$
  insert into resource_unavailability (tenant_id, resource_id, kind, starts_at, ends_at, hours, reason)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d2213','internal',
          '2026-10-20 06:00+00','2026-10-20 15:00+00', 2, 'Team training')
$q$, 'd.4: internal work is blocked with its hours');
select throws_ok($q$
  insert into resource_unavailability (tenant_id, resource_id, kind, starts_at, ends_at, hours)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d2213','leave',
          '2026-10-21 00:00+00','2026-10-21 23:00+00', 4)
$q$, '23514', null, 'd.4: leave carries no hours — it is unchanged');
select lives_ok($q$
  insert into resource_unavailability (tenant_id, resource_id, kind, starts_at, ends_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d2213','internal',
          '2026-10-22 06:00+00','2026-10-22 15:00+00')
$q$, 'd.4: an internal block may leave its hours open');

select * from finish();
rollback;
