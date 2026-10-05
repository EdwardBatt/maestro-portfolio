-- ADR-0139 (3 Oct) — a booking outside your own team is a request to that team's lead.
--
--   d.1  who books directly: a team lead her team, a department lead his department, Traffic everyone; the account
--        manager and the account director nobody (they ask).
--   d.2  a request names a team; the person is optional (`request_task_booking`).
--   d.3  who answers: the Team Leader; the Deputy only when the Team Leader is on leave that day; no team, no leader →
--        the department lead.
--   d.4  book / offer another day / refuse with a reason; the asker takes an offer or withdraws; first answer settles.
--        The asker of a taken offer places that task's bookings (and only those, only on its days).
--   d.5  after 4 working hours Traffic and the department lead are told and may answer too.
--
-- Fixtures (tenant A): Production department with two teams — Studio (a Team Leader and a Deputy) and Edit (no
-- leader). The campaign's account manager asks.
--   a181 AM 218            account_manager — the campaign's AM, the asker
--   a182 Studio TL         team_lead, Production / Studio
--   a183 Studio Deputy     deputy_team_lead, Production / Studio
--   a184 Studio Maker      team_member, Production / Studio (resource)
--   a185 Production DL     department_lead, Production
--   a186 Edit Maker        team_member, Production / Edit (resource) — Edit has no leader
--   a187 Account Director  account_director
--   a002 Booker A          scheduler (Traffic), from the seed
begin;
select plan(51);
\ir helpers/seed.sql
-- The fixture's tenants are made after the migrations ran: give them the account director role and the escalation rules.
select app.seed_account_director(id) from tenants;
select app.seed_tenant_escalation_rules(id) from tenants;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000181', 'am218@a.test'),
  ('00000000-0000-0000-0000-000000000182', 'studio-tl218@a.test'),
  ('00000000-0000-0000-0000-000000000183', 'studio-deputy218@a.test'),
  ('00000000-0000-0000-0000-000000000184', 'studio-maker218@a.test'),
  ('00000000-0000-0000-0000-000000000185', 'production-dl218@a.test'),
  ('00000000-0000-0000-0000-000000000186', 'edit-maker218@a.test'),
  ('00000000-0000-0000-0000-000000000187', 'ad218@a.test');
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000de18', 'aaaaaaaa-0000-0000-0000-000000000001', 'Production 218');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000e2181', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000de18', 'Studio 218'),
  ('aaaaaaaa-0000-0000-0000-0000000e2182', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000de18', 'Edit 218');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid, v.team::uuid
from (values
  ('00000000-0000-0000-0000-000000000181','AM 218',          'account_manager',  null, null),
  ('00000000-0000-0000-0000-000000000182','Studio TL 218',   'team_lead',        'aaaaaaaa-0000-0000-0000-00000000de18','aaaaaaaa-0000-0000-0000-0000000e2181'),
  ('00000000-0000-0000-0000-000000000183','Studio Deputy 218','deputy_team_lead','aaaaaaaa-0000-0000-0000-00000000de18','aaaaaaaa-0000-0000-0000-0000000e2181'),
  ('00000000-0000-0000-0000-000000000184','Studio Maker 218','team_member',      'aaaaaaaa-0000-0000-0000-00000000de18','aaaaaaaa-0000-0000-0000-0000000e2181'),
  ('00000000-0000-0000-0000-000000000185','Production DL 218','department_lead', 'aaaaaaaa-0000-0000-0000-00000000de18', null),
  ('00000000-0000-0000-0000-000000000186','Edit Maker 218',  'team_member',      'aaaaaaaa-0000-0000-0000-00000000de18','aaaaaaaa-0000-0000-0000-0000000e2182'),
  ('00000000-0000-0000-0000-000000000187','AD 218',          'account_director', null, null)
) as v(id, name, role_key, dept, team);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id::text like '00000000-0000-0000-0000-00000000018%';

insert into resources (id, tenant_id, kind, name, capacity_model, load_ceiling_pct, warn_at_pct, user_id, department_id, team_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d2184','aaaaaaaa-0000-0000-0000-000000000001','human','Studio Maker 218','load_based',120.0,100.0,
   '00000000-0000-0000-0000-000000000184','aaaaaaaa-0000-0000-0000-00000000de18','aaaaaaaa-0000-0000-0000-0000000e2181'),
  ('aaaaaaaa-0000-0000-0000-0000000d2182','aaaaaaaa-0000-0000-0000-000000000001','human','Studio TL 218','load_based',120.0,100.0,
   '00000000-0000-0000-0000-000000000182','aaaaaaaa-0000-0000-0000-00000000de18','aaaaaaaa-0000-0000-0000-0000000e2181'),
  ('aaaaaaaa-0000-0000-0000-0000000d2186','aaaaaaaa-0000-0000-0000-000000000001','human','Edit Maker 218','load_based',120.0,100.0,
   '00000000-0000-0000-0000-000000000186','aaaaaaaa-0000-0000-0000-00000000de18','aaaaaaaa-0000-0000-0000-0000000e2182');

update campaigns set account_manager_id = '00000000-0000-0000-0000-000000000181'
 where id = 'aaaaaaaa-0000-0000-0000-00000000e001';
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000f2180','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S218');
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id, department_id, due_at, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000e2180','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000f2180',
   'Film 218','in_progress','00000000-0000-0000-0000-00000000a001','aaaaaaaa-0000-0000-0000-00000000de18',
   '2026-12-20 15:00+00','00000000-0000-0000-0000-000000000185');
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-00000000e001');
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, department_id, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000a2181','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000e2180','Shoot 218','todo','aaaaaaaa-0000-0000-0000-00000000de18', 8),
  ('aaaaaaaa-0000-0000-0000-0000000a2182','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000e2180','Grade 218','todo','aaaaaaaa-0000-0000-0000-00000000de18', 8),
  ('aaaaaaaa-0000-0000-0000-0000000a2183','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000e2180','Cut 218','todo','aaaaaaaa-0000-0000-0000-00000000de18', 8),
  ('aaaaaaaa-0000-0000-0000-0000000a2184','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000e2180','Mix 218','todo','aaaaaaaa-0000-0000-0000-00000000de18', 8),
  ('aaaaaaaa-0000-0000-0000-0000000a2185','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000e2180','Light 218','todo','aaaaaaaa-0000-0000-0000-00000000de18', 8);
-- An ask names who checks the task first (20261003180000): the four asked tasks carry a reviewer; Light 218 has none.
insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory)
select 'aaaaaaaa-0000-0000-0000-000000000001', t, '00000000-0000-0000-0000-000000000185', true
  from unnest(array['aaaaaaaa-0000-0000-0000-0000000a2181','aaaaaaaa-0000-0000-0000-0000000a2182',
                    'aaaaaaaa-0000-0000-0000-0000000a2183','aaaaaaaa-0000-0000-0000-0000000a2184']::uuid[]) t;

-- ============================================================ d.1: who books directly ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000182'),true);
select ok(app.resource_in_scheduling_scope('aaaaaaaa-0000-0000-0000-0000000d2184')
          and not app.resource_in_scheduling_scope('aaaaaaaa-0000-0000-0000-0000000d2186'),
  'd.1: a team lead reaches her own team''s calendar and not a sibling team''s in her own department');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000183'),true);
select ok(app.resource_in_scheduling_scope('aaaaaaaa-0000-0000-0000-0000000d2184'),
  'd.1: the deputy reaches her own team too');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000185'),true);
select ok(app.resource_in_scheduling_scope('aaaaaaaa-0000-0000-0000-0000000d2184')
          and app.resource_in_scheduling_scope('aaaaaaaa-0000-0000-0000-0000000d2186'),
  'd.1: a department lead reaches every team of his department');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000187'),true);
select ok(not app.resource_in_scheduling_scope('aaaaaaaa-0000-0000-0000-0000000d2184'),
  'd.1: the account director reaches no calendar — she asks');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select ok(app.resource_in_scheduling_scope('aaaaaaaa-0000-0000-0000-0000000d2184')
          and app.resource_in_scheduling_scope('aaaaaaaa-0000-0000-0000-0000000d2186'),
  'd.1: Traffic reaches everyone');

-- ============================================================ d.3: who answers ====
select results_eq($q$ select user_id, reason from app.task_request_answerers('aaaaaaaa-0000-0000-0000-0000000e2181', null) $q$,
  $q$ values ('00000000-0000-0000-0000-000000000182'::uuid, 'team_lead') $q$,
  'd.3: a team with its Team Leader in is answered by her alone — not the deputy');
select results_eq($q$ select user_id, reason from app.task_request_answerers('aaaaaaaa-0000-0000-0000-0000000e2182', null) $q$,
  $q$ values ('00000000-0000-0000-0000-000000000185'::uuid, 'department_lead') $q$,
  'd.3: a team with no leader goes to the department lead');
select results_eq($q$ select user_id, reason from app.task_request_answerers(null, 'aaaaaaaa-0000-0000-0000-00000000de18') $q$,
  $q$ values ('00000000-0000-0000-0000-000000000185'::uuid, 'department_lead') $q$,
  'd.3: no team at all goes to the department lead');
reset role;
insert into resource_unavailability (tenant_id, resource_id, kind, starts_at, ends_at)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d2182', 'leave',
        now() - interval '2 days', now() + interval '2 days');
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select results_eq($q$ select user_id, reason from app.task_request_answerers('aaaaaaaa-0000-0000-0000-0000000e2181', null) $q$,
  $q$ values ('00000000-0000-0000-0000-000000000183'::uuid, 'deputy_team_lead') $q$,
  'd.3: the Team Leader on leave today — the Deputy answers instead');
reset role;
update user_profiles set is_active = false where id = '00000000-0000-0000-0000-000000000183';
set local role authenticated;
select results_eq($q$ select user_id, reason from app.task_request_answerers('aaaaaaaa-0000-0000-0000-0000000e2181', null) $q$,
  $q$ values ('00000000-0000-0000-0000-000000000185'::uuid, 'department_lead') $q$,
  'd.3: the leader away and nobody to stand in — the department lead');
reset role;
update user_profiles set is_active = true where id = '00000000-0000-0000-0000-000000000183';
delete from resource_unavailability where resource_id = 'aaaaaaaa-0000-0000-0000-0000000d2182';

-- ============================================================ d.2: asking a team ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000181'),true);
select ok(public.request_task_booking('aaaaaaaa-0000-0000-0000-0000000a2181', 'aaaaaaaa-0000-0000-0000-0000000e2181',
            null, 6, '2026-12-10', null, null, 'Needs the RED kit') is not null,
  'd.2: the account manager asks the Studio for a task, leaving the person to its lead');
select throws_ok($q$ select public.request_task_booking('aaaaaaaa-0000-0000-0000-0000000a2185', 'aaaaaaaa-0000-0000-0000-0000000e2181') $q$,
  '22023', null, 'an ask for a task nobody is named to check is refused — the asker chooses the reviewers first');
reset role;
select results_eq($q$
  select status, team_id, assignee_id, resource_id, hours, needed_by, note, requested_by
    from sub_task_assignment_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a2181'
$q$, $q$ values ('pending', 'aaaaaaaa-0000-0000-0000-0000000e2181'::uuid, null::uuid, null::uuid, 6::numeric,
                 '2026-12-10'::date, 'Needs the RED kit', '00000000-0000-0000-0000-000000000181'::uuid) $q$,
  'd.2: the request names the team, no person, the hours, the needed-by date and the note');
select results_eq($q$
  select user_id from notifications where type = 'assignment_requested'
     and entity_id = 'aaaaaaaa-0000-0000-0000-0000000a2181'
$q$, $q$ values ('00000000-0000-0000-0000-000000000182'::uuid) $q$,
  'd.3: the Studio''s Team Leader is told — not the deputy, not the department lead');
select is((select assignee_id from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a2181'), null::uuid,
  'd.2: nothing is booked until it is answered');

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000181'),true);
select throws_ok($q$
  select public.request_task_booking('aaaaaaaa-0000-0000-0000-0000000a2181', 'aaaaaaaa-0000-0000-0000-0000000e2181')
$q$, '22023', null, 'd.2: a second open request on the same task is refused (request_pending)');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000182'),true);
select throws_ok($q$
  select public.request_task_booking('aaaaaaaa-0000-0000-0000-0000000a2182', 'aaaaaaaa-0000-0000-0000-0000000e2181',
                                     '00000000-0000-0000-0000-000000000184')
$q$, '22023', 'this person is within your own reach — book them directly',
  'd.1: a team lead asking her own team is told to book directly (book_directly)');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select throws_ok($q$
  select public.request_task_booking('aaaaaaaa-0000-0000-0000-0000000a2182', 'aaaaaaaa-0000-0000-0000-0000000e2181')
$q$, '42501', null, 'a team member holds no booking grant — refused, not queued');

-- ============================================================ d.4: offer, then take ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000185'),true);
select throws_ok($q$
  select public.answer_task_request((select id from sub_task_assignment_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a2181'),
                                    'book', '00000000-0000-0000-0000-000000000184', '2026-12-07 06:00+00', '2026-12-08 14:00+00')
$q$, '42501', null, 'd.5: the department lead does not answer before the request has waited (not_the_answerer)');
select ok(not exists (select 1 from public.my_pending_approvals() where kind = 'booking_request'),
  'and it is not on his Needs-you list');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000182'),true);
select ok(exists (select 1 from public.my_pending_approvals() where kind = 'booking_request'
                   and target_id = 'aaaaaaaa-0000-0000-0000-0000000a2181'),
  'the Team Leader has it on her Needs-you list');
select throws_ok($q$
  select public.answer_task_request((select id from sub_task_assignment_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a2181'),
                                    'refuse')
$q$, '22023', null, 'd.4: saying no needs a reason (reason_required)');
select results_eq($q$
  select outcome from public.answer_task_request(
    (select id from sub_task_assignment_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a2181'),
    'offer', '00000000-0000-0000-0000-000000000184', '2026-12-07 06:00+00', '2026-12-08 14:00+00', null, 'Monday instead')
$q$, $q$ values ('offered') $q$, 'd.4: the Team Leader offers other days, with a person');
reset role;
select results_eq($q$
  select status, assignee_id, offered_starts_at, answered_by, decided_at is null
    from sub_task_assignment_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a2181'
$q$, $q$ values ('offered', '00000000-0000-0000-0000-000000000184'::uuid, '2026-12-07 06:00+00'::timestamptz,
                 '00000000-0000-0000-0000-000000000182'::uuid, true) $q$,
  'the offer is open: its days, its person, who offered');
select is((select count(*)::int from notifications where type = 'assignment_offered'
            and user_id = '00000000-0000-0000-0000-000000000181'), 1, 'd.4: the asker is told of the offer');

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000182'),true);
select throws_ok($q$
  select public.take_task_offer((select id from sub_task_assignment_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a2181'))
$q$, '42501', null, 'only the asker takes an offer');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000181'),true);
select results_eq($q$
  select outcome, reschedule_needed from public.take_task_offer(
    (select id from sub_task_assignment_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a2181'))
$q$, $q$ values ('booked', true) $q$, 'd.4: the asker takes the offer — the task is booked on its days');
reset role;
select results_eq($q$
  select assignee_id, starts_at, due_at, sla_hours from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a2181'
$q$, $q$ values ('00000000-0000-0000-0000-000000000184'::uuid, '2026-12-07 06:00+00'::timestamptz,
                 '2026-12-08 14:00+00'::timestamptz, 6::numeric) $q$,
  'the task is the person''s, on the offered days, with the hours asked for');
select is((select count(*)::int from notifications where type = 'assignment_offer_taken'
            and user_id = '00000000-0000-0000-0000-000000000182'), 1, 'the Team Leader is told the offer was taken');

-- The asker places that task's bookings — on its person, within its days — and nothing else.
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000181'),true);
select lives_ok($q$
  insert into bookings (tenant_id, resource_id, sub_task_id, deliverable_id, starts_at, ends_at, state, load_pct)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d2184','aaaaaaaa-0000-0000-0000-0000000a2181',
          'aaaaaaaa-0000-0000-0000-0000000e2180','2026-12-07 06:00+00','2026-12-07 09:00+00','confirmed',37.5)
$q$, 'd.4: the asker''s subtask-schedule may book the taken offer on its person''s calendar');
select throws_ok($q$
  insert into bookings (tenant_id, resource_id, sub_task_id, deliverable_id, starts_at, ends_at, state, load_pct)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d2184','aaaaaaaa-0000-0000-0000-0000000a2181',
          'aaaaaaaa-0000-0000-0000-0000000e2180','2026-12-15 06:00+00','2026-12-15 09:00+00','confirmed',37.5)
$q$, '42501', null, 'but not outside the task''s days — moving it is the lead''s');
select throws_ok($q$
  insert into bookings (tenant_id, resource_id, sub_task_id, deliverable_id, starts_at, ends_at, state, load_pct)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d2186','aaaaaaaa-0000-0000-0000-0000000a2181',
          'aaaaaaaa-0000-0000-0000-0000000e2180','2026-12-07 06:00+00','2026-12-07 09:00+00','confirmed',37.5)
$q$, '42501', null, 'and not on anybody else''s calendar');
select throws_ok($q$
  insert into bookings (tenant_id, resource_id, sub_task_id, deliverable_id, starts_at, ends_at, state, load_pct)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d2184','aaaaaaaa-0000-0000-0000-0000000a2182',
          'aaaaaaaa-0000-0000-0000-0000000e2180','2026-12-07 06:00+00','2026-12-07 09:00+00','confirmed',37.5)
$q$, '42501', null, 'and not for another task on the same person');

-- ============================================================ d.4: book, and the first answer settles ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000181'),true);
select lives_ok($q$
  select public.request_task_booking('aaaaaaaa-0000-0000-0000-0000000a2182', 'aaaaaaaa-0000-0000-0000-0000000e2181',
                                     '00000000-0000-0000-0000-000000000184', 4, '2026-12-12')
$q$, 'd.2: the asker names a person in the team this time');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000182'),true);
select results_eq($q$
  select outcome, reschedule_needed from public.answer_task_request(
    (select id from sub_task_assignment_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a2182'),
    'book', null, '2026-12-09 06:00+00', '2026-12-09 14:00+00')
$q$, $q$ values ('booked', true) $q$, 'd.4: the Team Leader books it — the assignment is made as her');
select throws_ok($q$
  select public.answer_task_request(
    (select id from sub_task_assignment_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a2182'), 'refuse', null, null, null, null, 'late')
$q$, '22023', null, 'd.5: a later answer is refused — the first settled it (request_settled)');
reset role;
select results_eq($q$
  select st.assignee_id, q.status, q.decided_by from sub_tasks st
    join sub_task_assignment_requests q on q.sub_task_id = st.id
   where st.id = 'aaaaaaaa-0000-0000-0000-0000000a2182'
$q$, $q$ values ('00000000-0000-0000-0000-000000000184'::uuid, 'approved', '00000000-0000-0000-0000-000000000182'::uuid) $q$,
  'the task is the person''s and the record says who booked it');
select is((select count(*)::int from notifications where type = 'assignment_approved'
            and user_id = '00000000-0000-0000-0000-000000000181' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000a2182'), 1,
  'the asker is told it was booked');

-- ============================================================ d.4: refuse, and withdraw ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000181'),true);
select lives_ok($q$ select public.request_task_booking('aaaaaaaa-0000-0000-0000-0000000a2183', 'aaaaaaaa-0000-0000-0000-0000000e2181') $q$,
  'a third task is asked of the Studio');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000182'),true);
select results_eq($q$
  select outcome from public.answer_task_request(
    (select id from sub_task_assignment_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a2183'),
    'refuse', null, null, null, null, 'Fully booked until January')
$q$, $q$ values ('refused') $q$, 'd.4: the Team Leader says no, with a reason');
reset role;
select is((select detail ->> 'reason' from notifications where type = 'assignment_refused'
            and user_id = '00000000-0000-0000-0000-000000000181' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000a2183'),
  'Fully booked until January', 'the asker hears no, and why');

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000181'),true);
select lives_ok($q$ select public.request_task_booking('aaaaaaaa-0000-0000-0000-0000000a2183', 'aaaaaaaa-0000-0000-0000-0000000e2182') $q$,
  'd.4: after a no the asker asks another team — Edit, which has no leader');
select lives_ok($q$ select public.withdraw_assignment_request(
  (select id from sub_task_assignment_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a2183' and status = 'pending')) $q$,
  'and withdraws it while it waits');
reset role;
select is((select count(*)::int from notifications where type = 'assignment_withdrawn'
            and user_id = '00000000-0000-0000-0000-000000000185'), 1,
  'the department lead it was waiting on (Edit has no leader) is told it was withdrawn');

-- ============================================================ d.5: unanswered after 4 working hours ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000181'),true);
select lives_ok($q$ select public.request_task_booking('aaaaaaaa-0000-0000-0000-0000000a2184', 'aaaaaaaa-0000-0000-0000-0000000e2181') $q$,
  'a fourth task is asked of the Studio, and nobody answers');
reset role;
select is((select count(*)::int from app.escalation_due(now() + interval '1 hour') where kind = 'task_request'), 0,
  'd.5: an hour later it has not escalated');
select is((select (app.run_escalation_sweep(now() + interval '7 days', false, 'task_request') ->> 'sent')::int), 1,
  'd.5: after 4 working hours the sweep escalates it');
select results_eq($q$
  select user_id from notifications where type = 'escalated' and detail ->> 'kind' = 'task_request' order by user_id
$q$, $q$ values ('00000000-0000-0000-0000-000000000185'::uuid), ('00000000-0000-0000-0000-00000000a002'::uuid) $q$,
  'd.5: Traffic and the department lead are both told — not the asker');
select isnt((select escalated_at from sub_task_assignment_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a2184'),
  null::timestamptz, 'and the request is stamped escalated');
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000185'),true);
select results_eq($q$
  select outcome from public.answer_task_request(
    (select id from sub_task_assignment_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a2184'),
    'book', '00000000-0000-0000-0000-000000000186', '2026-12-14 06:00+00', '2026-12-14 14:00+00')
$q$, $q$ values ('booked') $q$, 'd.5: once escalated the department lead answers — the first to act settles it');

-- ============================================================ isolation ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b001'),true);
select throws_ok($q$
  select public.answer_task_request('aaaaaaaa-0000-0000-0000-000000000000', 'refuse', null, null, null, null, 'x')
$q$, 'P0002', null, 'a tenant-B admin answers nothing in tenant A');

select * from finish();
rollback;
