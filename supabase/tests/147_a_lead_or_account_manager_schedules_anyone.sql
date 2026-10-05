-- ADR-0098 (22 Sep) let a department lead, team lead or account manager schedule anyone. ADR-0139 d.1 (3 Oct) reverses
-- it: a team lead books her own team, a department lead his own department, Traffic and the Power Admin anyone; the
-- account manager and everyone else ASK — the request goes to the person's team lead. Leave stays with the person's own
-- lead (ADR-0098 d.3, unchanged). A team member is still out.
--
-- Fixtures (tenant A): Creative and Production departments, Studio team under Production.
--   a020 Creative Lead     department_lead, Creative            — asks for the Production maker
--   a022 Studio Lead       team_lead, Production / Studio       — the maker's own lead: books, answers, leave
--   a023 Studio Maker      team_member, Production / Studio     — the person (resource d147)
--   a027 Account Mgr       account_manager, the campaign's AM   — asks too
--   a003 Creative A        team_member (self, no grant)         — refused
-- The department_lead role is given leave:manage HERE so the leave boundary can be proven for a
-- lead: in her department yes, outside it no — the reach, not the grant, is what refuses.
begin;
select plan(17);
\ir helpers/seed.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a020', 'creative-lead@a.test'),
  ('00000000-0000-0000-0000-00000000a022', 'studio-lead@a.test'),
  ('00000000-0000-0000-0000-00000000a023', 'studio-maker@a.test'),
  ('00000000-0000-0000-0000-00000000a027', 'account-mgr@a.test');
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000de001','aaaaaaaa-0000-0000-0000-000000000001','Creative'),
  ('aaaaaaaa-0000-0000-0000-0000000de002','aaaaaaaa-0000-0000-0000-000000000001','Production');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f002','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000de002','Studio');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid, v.team::uuid
from (values
  ('00000000-0000-0000-0000-00000000a020','Creative Lead',   'department_lead','aaaaaaaa-0000-0000-0000-0000000de001', null),
  ('00000000-0000-0000-0000-00000000a022','Studio Lead',     'team_lead',      'aaaaaaaa-0000-0000-0000-0000000de002','aaaaaaaa-0000-0000-0000-00000000f002'),
  ('00000000-0000-0000-0000-00000000a023','Studio Maker',    'team_member',    'aaaaaaaa-0000-0000-0000-0000000de002','aaaaaaaa-0000-0000-0000-00000000f002'),
  ('00000000-0000-0000-0000-00000000a027','Account Mgr',     'account_manager', null, null)
) as v(id, name, role_key, dept, team);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id in ('00000000-0000-0000-0000-00000000a020','00000000-0000-0000-0000-00000000a022',
                 '00000000-0000-0000-0000-00000000a023','00000000-0000-0000-0000-00000000a027');
-- leave:manage on the lead roles, for the boundary proof only.
insert into role_grants (tenant_id, role_id, resource, action)
select r.tenant_id, r.id, 'leave', 'manage' from roles r
 where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key in ('department_lead', 'team_lead', 'account_manager')
on conflict do nothing;

-- The calendars: the Production maker, and a Creative person for the in-department leave case.
insert into resources (id, tenant_id, kind, name, capacity_model, load_ceiling_pct, warn_at_pct, user_id, department_id, team_id) values
  ('aaaaaaaa-0000-0000-0000-00000000d147','aaaaaaaa-0000-0000-0000-000000000001',
   'human','Studio Maker','load_based',120.0,100.0,'00000000-0000-0000-0000-00000000a023',
   'aaaaaaaa-0000-0000-0000-0000000de002','aaaaaaaa-0000-0000-0000-00000000f002'),
  ('aaaaaaaa-0000-0000-0000-00000000d148','aaaaaaaa-0000-0000-0000-000000000001',
   'human','Creative A','load_based',120.0,100.0,'00000000-0000-0000-0000-00000000a003',
   'aaaaaaaa-0000-0000-0000-0000000de001', null);

update campaigns set account_manager_id = '00000000-0000-0000-0000-00000000a027'
 where id = 'aaaaaaaa-0000-0000-0000-00000000e001';

-- A Creative deliverable on the approved seed campaign, its work accepted, three Creative tasks.
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f147','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','S147');
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id, department_id, due_at) values
  ('aaaaaaaa-0000-0000-0000-00000000e147','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f147','Shoot 147','in_progress',
   '00000000-0000-0000-0000-00000000a001','aaaaaaaa-0000-0000-0000-0000000de001','2026-10-01 15:00+00');
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-00000000e001');
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, department_id, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-00000000a147','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e147','Studio day','todo','aaaaaaaa-0000-0000-0000-0000000de001', 8),
  ('aaaaaaaa-0000-0000-0000-00000000a148','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e147','Second day','todo','aaaaaaaa-0000-0000-0000-0000000de001', 8),
  ('aaaaaaaa-0000-0000-0000-00000000a149','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e147','Third day','todo','aaaaaaaa-0000-0000-0000-0000000de001', 8);

-- ============================================================ 1. the predicate ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a020'),true);
select ok(not app.resource_in_scheduling_scope('aaaaaaaa-0000-0000-0000-00000000d147'),
  'ADR-0139 d.1: a department lead does not reach another department''s calendar');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a027'),true);
select ok(not app.resource_in_scheduling_scope('aaaaaaaa-0000-0000-0000-00000000d147'),
  'ADR-0139 d.1: an account manager reaches no calendar — they ask');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select ok(not app.resource_in_scheduling_scope('aaaaaaaa-0000-0000-0000-00000000d147'),
  'd.1: a self-scoped person reaches nobody (ADR-0014)');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a022'),true);
select ok(app.resource_in_scheduling_scope('aaaaaaaa-0000-0000-0000-00000000d147'),
  'ADR-0139 d.1: the maker''s own team lead reaches the calendar');

-- ============================================ 2. a campaign task, across departments, is asked ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a020'),true);
select results_eq($q$
  select outcome from public.update_task_assignment(
      'aaaaaaaa-0000-0000-0000-00000000a147', 'Studio day', '00000000-0000-0000-0000-00000000a023',
      '[{"user_id":"00000000-0000-0000-0000-00000000a001","is_mandatory":true}]'::jsonb)
$q$, $q$ values ('requested') $q$,
  'ADR-0139 d.1: a Creative lead picking a Production person sends a request');
reset role;
select results_eq($q$
  select st.assignee_id, q.team_id, q.assignee_id from sub_tasks st
    join sub_task_assignment_requests q on q.sub_task_id = st.id
   where st.id = 'aaaaaaaa-0000-0000-0000-00000000a147'
$q$, $q$ values (null::uuid, 'aaaaaaaa-0000-0000-0000-00000000f002'::uuid, '00000000-0000-0000-0000-00000000a023'::uuid) $q$,
  'nothing is assigned; the request names the Studio team and the person (ADR-0139 d.2)');
select results_eq($q$
  select user_id from notifications
   where type = 'assignment_requested' and entity_id = 'aaaaaaaa-0000-0000-0000-00000000a147'
$q$, $q$ values ('00000000-0000-0000-0000-00000000a022'::uuid) $q$,
  'the Studio''s team lead is asked — and nobody else (ADR-0139 d.3)');

-- The account manager asks the same way.
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a027'),true);
select results_eq($q$
  select outcome from public.update_task_assignment(
      'aaaaaaaa-0000-0000-0000-00000000a148', 'Second day', '00000000-0000-0000-0000-00000000a023',
      '[{"user_id":"00000000-0000-0000-0000-00000000a001","is_mandatory":true}]'::jsonb)
$q$, $q$ values ('requested') $q$,
  'ADR-0139 d.1: the campaign''s account manager asks rather than books');

-- ===================================== 3. an ad-hoc task and a booking, across departments ====
-- save_sub_task is security invoker; ADR-0040's trigger refuses the person, and the bookings policy the calendar.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a020'),true);
select throws_ok($q$
  select public.save_sub_task(null, 'aaaaaaaa-0000-0000-0000-00000000e147', 'Ad hoc for the Studio',
      '[{"user_id":"00000000-0000-0000-0000-00000000a001","is_mandatory":true}]'::jsonb,
      null, '00000000-0000-0000-0000-00000000a023', 'aaaaaaaa-0000-0000-0000-0000000de002', 'aaaaaaaa-0000-0000-0000-00000000f002', 4)
$q$, '42501', null, 'ADR-0139 d.1: a Creative lead cannot put a Production person on a new task directly');
select throws_ok($q$
  insert into bookings (tenant_id, resource_id, starts_at, ends_at, state)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d147',
          '2026-09-27 06:00+00', '2026-09-27 10:00+00', 'confirmed')
$q$, '42501', null, 'ADR-0139 d.1: nor book the Production calendar (bookings_scheduler_insert)');

-- The maker's own team lead books and moves her own person's calendar.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a022'),true);
select lives_ok($q$
  insert into bookings (tenant_id, resource_id, starts_at, ends_at, state)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d147',
          '2026-09-27 06:00+00', '2026-09-27 10:00+00', 'confirmed')
$q$, 'ADR-0139 d.1: the team lead books her own team''s calendar');
select lives_ok($q$
  update bookings set ends_at = '2026-09-27 11:00+00' where resource_id = 'aaaaaaaa-0000-0000-0000-00000000d147'
$q$, 'and moves it (bookings_scheduler_update)');
-- The Creative lead's delete reaches no row of it.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a020'),true);
delete from bookings where resource_id = 'aaaaaaaa-0000-0000-0000-00000000d147';
reset role;
select is((select count(*)::int from bookings where resource_id = 'aaaaaaaa-0000-0000-0000-00000000d147'), 1,
  'ADR-0139 d.1: a lead outside the team frees nothing on that calendar (bookings_scheduler_delete)');
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a020'),true);

-- ======================================================= 4. leave stays with the lead ====
select throws_ok($q$
  insert into resource_unavailability (tenant_id, resource_id, kind, starts_at, ends_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d147',
          'leave', '2026-10-05 00:00+00', '2026-10-05 23:59+00')
$q$, '42501', null, 'd.3: the Creative lead may schedule the Production maker but may NOT record their leave');
select lives_ok($q$
  insert into resource_unavailability (tenant_id, resource_id, kind, starts_at, ends_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d148',
          'leave', '2026-10-05 00:00+00', '2026-10-05 23:59+00')
$q$, 'd.3: her own department''s leave she records as before');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a027'),true);
select throws_ok($q$
  insert into resource_unavailability (tenant_id, resource_id, kind, starts_at, ends_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d147',
          'leave', '2026-10-06 00:00+00', '2026-10-06 23:59+00')
$q$, '42501', null, 'd.3: the account manager, who may schedule anyone, may record nobody''s leave');

-- ============================================================ 5. a team member is out ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a023'),true);
select throws_ok($q$
  select public.update_task_assignment(
      'aaaaaaaa-0000-0000-0000-00000000a149', 'Third day', '00000000-0000-0000-0000-00000000a023',
      '[{"user_id":"00000000-0000-0000-0000-00000000a001","is_mandatory":true}]'::jsonb)
$q$, '42501', null, 'a team member holds no booking grant — refused, the grant not the reach');

select * from finish();
rollback;
