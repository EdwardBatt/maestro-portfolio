-- ADR-0140 (3 Oct) — every task has an Edit; an approved task list is assigned on the campaign page too.
--
--   d.2  the piece's owner edits every task on it (sub_tasks policies, reviewers); a change to the DAYS of a task held
--        by another team is a request to that team's lead, and every other field saves.
--   d.3  a started task's days or person move only with p_confirm_started (hint task_started); it is never removed.
--   d.4  the owner assigns from the campaign page through update_task_assignment and places the task's bookings.
--   d.5  unassign_task: the person off, the bookings freed, back to To book; the assignee and their lead are told,
--        not the account manager.
--
-- Fixtures (tenant A): Production with two teams. The piece is owned by the Edit team's lead.
--   a191 Edit TL (owner)   team_lead, Production / Edit — owns Film 219
--   a192 Studio TL         team_lead, Production / Studio
--   a193 Studio Maker      team_member, Studio (resource)
--   a194 Edit Maker        team_member, Edit (resource)
--   a195 AM 219            account_manager — the campaign's AM
begin;
select plan(32);
\ir helpers/seed.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000191', 'edit-tl219@a.test'),
  ('00000000-0000-0000-0000-000000000192', 'studio-tl219@a.test'),
  ('00000000-0000-0000-0000-000000000193', 'studio-maker219@a.test'),
  ('00000000-0000-0000-0000-000000000194', 'edit-maker219@a.test'),
  ('00000000-0000-0000-0000-000000000195', 'am219@a.test');
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000de19', 'aaaaaaaa-0000-0000-0000-000000000001', 'Production 219');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000e2191', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000de19', 'Studio 219'),
  ('aaaaaaaa-0000-0000-0000-0000000e2192', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000de19', 'Edit 219');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid, v.team::uuid
from (values
  ('00000000-0000-0000-0000-000000000191','Edit TL 219',     'team_lead',      'aaaaaaaa-0000-0000-0000-00000000de19','aaaaaaaa-0000-0000-0000-0000000e2192'),
  ('00000000-0000-0000-0000-000000000192','Studio TL 219',   'team_lead',      'aaaaaaaa-0000-0000-0000-00000000de19','aaaaaaaa-0000-0000-0000-0000000e2191'),
  ('00000000-0000-0000-0000-000000000193','Studio Maker 219','team_member',    'aaaaaaaa-0000-0000-0000-00000000de19','aaaaaaaa-0000-0000-0000-0000000e2191'),
  ('00000000-0000-0000-0000-000000000194','Edit Maker 219',  'team_member',    'aaaaaaaa-0000-0000-0000-00000000de19','aaaaaaaa-0000-0000-0000-0000000e2192'),
  ('00000000-0000-0000-0000-000000000195','AM 219',          'account_manager', null, null)
) as v(id, name, role_key, dept, team);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id::text like '00000000-0000-0000-0000-00000000019%';
insert into resources (id, tenant_id, kind, name, capacity_model, load_ceiling_pct, warn_at_pct, user_id, department_id, team_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d2193','aaaaaaaa-0000-0000-0000-000000000001','human','Studio Maker 219','load_based',120.0,100.0,
   '00000000-0000-0000-0000-000000000193','aaaaaaaa-0000-0000-0000-00000000de19','aaaaaaaa-0000-0000-0000-0000000e2191'),
  ('aaaaaaaa-0000-0000-0000-0000000d2194','aaaaaaaa-0000-0000-0000-000000000001','human','Edit Maker 219','load_based',120.0,100.0,
   '00000000-0000-0000-0000-000000000194','aaaaaaaa-0000-0000-0000-00000000de19','aaaaaaaa-0000-0000-0000-0000000e2192');

update campaigns set account_manager_id = '00000000-0000-0000-0000-000000000195'
 where id = 'aaaaaaaa-0000-0000-0000-00000000e001';
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000f2190','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S219');
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id, department_id, due_at, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000e2190','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000f2190',
   'Film 219','in_progress','00000000-0000-0000-0000-00000000a001','aaaaaaaa-0000-0000-0000-00000000de19',
   '2026-12-20 15:00+00','00000000-0000-0000-0000-000000000191');
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-00000000e001');
-- t1: the Studio maker's, to do.  t2: the Studio maker's, in progress.  t3/t5: plans.  t4: the Edit maker's.
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, department_id, team_id, assignee_id, sla_hours, starts_at, due_at) values
  ('aaaaaaaa-0000-0000-0000-0000000a2191','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000e2190','Shoot 219','todo',
   'aaaaaaaa-0000-0000-0000-00000000de19','aaaaaaaa-0000-0000-0000-0000000e2191','00000000-0000-0000-0000-000000000193', 8,
   '2026-12-01 06:00+00','2026-12-02 14:00+00'),
  ('aaaaaaaa-0000-0000-0000-0000000a2192','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000e2190','Grade 219','in_progress',
   'aaaaaaaa-0000-0000-0000-00000000de19','aaaaaaaa-0000-0000-0000-0000000e2191','00000000-0000-0000-0000-000000000193', 8,
   '2026-12-03 06:00+00','2026-12-04 14:00+00'),
  ('aaaaaaaa-0000-0000-0000-0000000a2193','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000e2190','Cut 219','todo',
   'aaaaaaaa-0000-0000-0000-00000000de19', null, null, 4, null, null),
  ('aaaaaaaa-0000-0000-0000-0000000a2194','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000e2190','Mix 219','todo',
   'aaaaaaaa-0000-0000-0000-00000000de19','aaaaaaaa-0000-0000-0000-0000000e2192','00000000-0000-0000-0000-000000000194', 4,
   '2026-12-05 06:00+00','2026-12-05 14:00+00'),
  ('aaaaaaaa-0000-0000-0000-0000000a2195','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000e2190','Spare 219','todo',
   'aaaaaaaa-0000-0000-0000-00000000de19', null, null, 2, null, null);

-- ============================================================ d.2: the owner edits every task ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000191'),true);
select ok(not app.in_write_scope('aaaaaaaa-0000-0000-0000-00000000de19', 'aaaaaaaa-0000-0000-0000-0000000e2191', null),
  'fixture: the owner (Edit''s lead) does not reach the Studio''s task by scope');
select lives_ok($q$
  select public.save_sub_task('aaaaaaaa-0000-0000-0000-0000000a2191', 'aaaaaaaa-0000-0000-0000-0000000e2190',
                              'Shoot 219 — exteriors', null, 'Both locations')
$q$, 'd.2: the owner edits a task held by another team (save_sub_task, the owner branch of sub_tasks_manage_update)');
reset role;
select results_eq($q$ select title, description from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a2191' $q$,
  $q$ values ('Shoot 219 — exteriors', 'Both locations') $q$, 'and the edit is saved');
set local role authenticated;
select lives_ok($q$
  insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000a2191', '00000000-0000-0000-0000-000000000192', false)
$q$, 'd.2: the owner appoints a reviewer on it (can_manage_sub_task)');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000194'),true);
select throws_ok($q$
  select public.save_sub_task('aaaaaaaa-0000-0000-0000-0000000a2191', 'aaaaaaaa-0000-0000-0000-0000000e2190', 'Hijacked', null)
$q$, '42501', null, 'a team member who does not own the piece cannot edit it');

-- ============================================================ d.2: days of another team's task are asked ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000191'),true);
select throws_ok($q$
  select public.save_sub_task('aaaaaaaa-0000-0000-0000-0000000a2191', 'aaaaaaaa-0000-0000-0000-0000000e2190',
                              'Shoot 219 — exteriors', null, p_starts_at => '2026-12-08 06:00+00', p_due_at => '2026-12-09 14:00+00')
$q$, '42501', null,
  'd.2: the task editor is no back door — the owner moving another team''s days through save_sub_task is refused (hint use_update_task_assignment)');
select throws_ok($q$
  select public.save_sub_task('aaaaaaaa-0000-0000-0000-0000000a2191', 'aaaaaaaa-0000-0000-0000-0000000e2190',
                              'Shoot 219 — exteriors', null, p_assignee => '00000000-0000-0000-0000-000000000194')
$q$, '42501', null, 'd.2: nor giving it to someone else there');
select results_eq($q$
  select outcome, request_id is not null from public.update_task_assignment(
    'aaaaaaaa-0000-0000-0000-0000000a2191', 'Shoot 219 — both locations', '00000000-0000-0000-0000-000000000193',
    null, '2026-12-08 06:00+00', '2026-12-09 14:00+00', 10)
$q$, $q$ values ('requested', true) $q$,
  'd.2: the owner moving the Studio maker''s days sends a request');
reset role;
select results_eq($q$ select title, starts_at, sla_hours from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a2191' $q$,
  $q$ values ('Shoot 219 — both locations', '2026-12-01 06:00+00'::timestamptz, 10::numeric) $q$,
  'd.2: the days wait for the lead; the name and the hours save now');
select results_eq($q$
  select q.assignee_id, q.team_id, q.starts_at from sub_task_assignment_requests q
   where q.sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a2191' and q.status = 'pending'
$q$, $q$ values ('00000000-0000-0000-0000-000000000193'::uuid, 'aaaaaaaa-0000-0000-0000-0000000e2191'::uuid,
                 '2026-12-08 06:00+00'::timestamptz) $q$,
  'the request keeps the person and carries the new days to the Studio');
select is((select count(*)::int from notifications where type = 'assignment_requested'
            and user_id = '00000000-0000-0000-0000-000000000192' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000a2191'), 1,
  'the Studio''s team lead is asked');

-- ============================================================ d.4: the owner assigns and books ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000191'),true);
select results_eq($q$
  select outcome, reschedule_needed from public.update_task_assignment(
    'aaaaaaaa-0000-0000-0000-0000000a2193', 'Cut 219', '00000000-0000-0000-0000-000000000194',
    '[{"user_id":"00000000-0000-0000-0000-00000000a001","is_mandatory":true}]'::jsonb,
    '2026-12-10 06:00+00', '2026-12-10 14:00+00')
$q$, $q$ values ('assigned', true) $q$, 'd.4: the owner assigns a task to her own team from the campaign page');
select lives_ok($q$
  insert into bookings (tenant_id, resource_id, sub_task_id, deliverable_id, starts_at, ends_at, state, load_pct)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d2193','aaaaaaaa-0000-0000-0000-0000000a2191',
          'aaaaaaaa-0000-0000-0000-0000000e2190','2026-12-01 06:00+00','2026-12-01 10:00+00','confirmed',50)
$q$, 'd.4: the owner places the bookings of a task on her piece, on its person, within its days');
select throws_ok($q$
  insert into bookings (tenant_id, resource_id, sub_task_id, deliverable_id, starts_at, ends_at, state, load_pct)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d2193','aaaaaaaa-0000-0000-0000-0000000a2191',
          'aaaaaaaa-0000-0000-0000-0000000e2190','2026-12-20 06:00+00','2026-12-20 10:00+00','confirmed',50)
$q$, '42501', null, 'but not on other days — those are asked');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000195'),true);
select throws_ok($q$
  insert into bookings (tenant_id, resource_id, sub_task_id, deliverable_id, starts_at, ends_at, state, load_pct)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d2193','aaaaaaaa-0000-0000-0000-0000000a2191',
          'aaaaaaaa-0000-0000-0000-0000000e2190','2026-12-01 10:00+00','2026-12-01 12:00+00','confirmed',25)
$q$, '42501', null, 'the account manager, who does not own the piece, books nothing on that calendar');

-- ============================================================ d.3: a started task ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000192'),true);
select throws_ok($q$
  select public.update_task_assignment('aaaaaaaa-0000-0000-0000-0000000a2192', 'Grade 219', '00000000-0000-0000-0000-000000000193',
                                       null, '2026-12-10 06:00+00', '2026-12-11 14:00+00')
$q$, '22023', 'Studio Maker 219 has started this — move it anyway?',
  'd.3: moving a started task''s days asks first (hint task_started)');
select results_eq($q$
  select outcome from public.update_task_assignment('aaaaaaaa-0000-0000-0000-0000000a2192', 'Grade 219', '00000000-0000-0000-0000-000000000193',
                                       null, '2026-12-10 06:00+00', '2026-12-11 14:00+00', null, null, true)
$q$, $q$ values ('assigned') $q$, 'd.3: confirmed, it moves');
select results_eq($q$
  select outcome from public.update_task_assignment('aaaaaaaa-0000-0000-0000-0000000a2192', 'Grade 219 — final', '00000000-0000-0000-0000-000000000193',
                                       null, null, null, 6)
$q$, $q$ values ('assigned') $q$, 'd.3: its name and hours save without asking');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000191'),true);
select throws_ok($q$ select public.remove_sub_task('aaaaaaaa-0000-0000-0000-0000000a2192') $q$,
  '22023', null, 'd.3: a started task is not removed, even by the owner');
select is(public.remove_sub_task('aaaaaaaa-0000-0000-0000-0000000a2195'), 'deleted',
  'd.2: the owner removes a plan nobody was given');

-- ============================================================ d.5: cancelling a booking ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000195'),true);
select throws_ok($q$ select public.unassign_task('aaaaaaaa-0000-0000-0000-0000000a2194') $q$,
  '42501', null, 'd.5: the account manager — not the owner, not the person''s lead — cannot cancel the booking');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000191'),true);
select throws_ok($q$ select public.unassign_task('aaaaaaaa-0000-0000-0000-0000000a2192') $q$,
  '22023', null, 'd.3/d.5: taking a started task''s person off asks first (hint task_started)');
select is((public.unassign_task('aaaaaaaa-0000-0000-0000-0000000a2191') ->> 'bookings_freed')::int, 1,
  'd.5: the owner cancels the Studio maker''s booking — its booking is freed');
reset role;
select results_eq($q$
  select assignee_id, starts_at, sla_hours, committed_due_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a2191'
$q$, $q$ values (null::uuid, '2026-12-01 06:00+00'::timestamptz, 10::numeric, null::timestamptz) $q$,
  'd.5: back to To book — nobody on it, its days and hours kept, its commitment cleared');
select results_eq($q$
  select user_id from notifications where type = 'task_unassigned' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000a2191' order by user_id
$q$, $q$ values ('00000000-0000-0000-0000-000000000192'::uuid), ('00000000-0000-0000-0000-000000000193'::uuid) $q$,
  'd.5: the assignee and their team lead are told');
select is((select count(*)::int from notifications where type = 'task_unassigned'
            and user_id = '00000000-0000-0000-0000-000000000195'), 0, 'd.5: the account manager is not');
select is((select status from sub_task_assignment_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a2191'),
  'pending', 'the open request for its days is left for the lead to answer or the asker to withdraw');

-- The person's own lead cancels too, and a started task goes with the confirmation.
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000192'),true);
select lives_ok($q$ select public.unassign_task('aaaaaaaa-0000-0000-0000-0000000a2192', true) $q$,
  'd.5: the Studio''s lead takes her own person off a started task, confirmed');
reset role;
select is((select assignee_id from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a2192'), null::uuid,
  'and it is To book');
select is((select count(*)::int from notifications where type = 'task_unassigned'
            and entity_id = 'aaaaaaaa-0000-0000-0000-0000000a2192'), 1,
  'the assignee is told; the lead who did it is not told about her own act');

-- A person outside the caller's reach is refused, owner aside.
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000192'),true);
select throws_ok($q$ select public.unassign_task('aaaaaaaa-0000-0000-0000-0000000a2193') $q$,
  '42501', null, 'd.5: the Studio''s lead cannot take the Edit maker off');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b001'),true);
select throws_ok($q$ select public.unassign_task('aaaaaaaa-0000-0000-0000-0000000a2193') $q$,
  'P0002', null, 'a tenant-B admin finds no tenant-A task');

select * from finish();
rollback;
