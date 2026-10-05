-- ADR-0141 (3 Oct) — only the account manager changes a deliverable; everyone else asks through one form.
--
--   d.1  who changes: the account manager, with the account director, Traffic and the Power Admin as cover; the owner
--        and the department's leads are refused (hint ask_account_manager) — the RPCs and a bare PATCH alike. A draft
--        campaign's piece keeps the old rule.
--   d.2  the one form: ask (kinds, new due day and hours, why, the task that opened it); one pending per piece.
--   d.3  withdraw while it waits; unanswered after 4 working hours it goes to the account director.
--   d.4  accept (the asked day applies, the hours are recorded), change (her values), keep (with her reason); the asker
--        and the piece's assignees are told; the first answer settles it.
--   d.5  ADR-0088's extension is retired; a maker asks her own lead for more time, and a yes moves the task as the lead.
--
-- Fixtures (tenant A): Creative 220 with its Design team.
--   a201 AM 220          account_manager — the campaign's AM
--   a202 Owner 220       department_lead, Creative — owns the pieces
--   a203 Design TL 220   team_lead, Creative / Design
--   a204 Maker 220       team_member, Creative / Design (resource) — on the piece's task
--   a205 AD 220          account_director
--   a002 Booker A        scheduler (Traffic), from the seed
begin;
select plan(46);
\ir helpers/seed.sql
select app.seed_account_director(id) from tenants;
select app.seed_tenant_escalation_rules(id) from tenants;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000201', 'am220@a.test'),
  ('00000000-0000-0000-0000-000000000202', 'owner220@a.test'),
  ('00000000-0000-0000-0000-000000000203', 'tl220@a.test'),
  ('00000000-0000-0000-0000-000000000204', 'maker220@a.test'),
  ('00000000-0000-0000-0000-000000000205', 'ad220@a.test');
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000de20', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 220');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000e2201', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000de20', 'Design 220');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid, v.team::uuid
from (values
  ('00000000-0000-0000-0000-000000000201','AM 220',       'account_manager',  null, null),
  ('00000000-0000-0000-0000-000000000202','Owner 220',    'department_lead',  'aaaaaaaa-0000-0000-0000-00000000de20', null),
  ('00000000-0000-0000-0000-000000000203','Design TL 220','team_lead',        'aaaaaaaa-0000-0000-0000-00000000de20','aaaaaaaa-0000-0000-0000-0000000e2201'),
  ('00000000-0000-0000-0000-000000000204','Maker 220',    'team_member',      'aaaaaaaa-0000-0000-0000-00000000de20','aaaaaaaa-0000-0000-0000-0000000e2201'),
  ('00000000-0000-0000-0000-000000000205','AD 220',       'account_director', null, null)
) as v(id, name, role_key, dept, team);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id::text like '00000000-0000-0000-0000-00000000020%';
insert into resources (id, tenant_id, kind, name, capacity_model, load_ceiling_pct, warn_at_pct, user_id, department_id, team_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d2204','aaaaaaaa-0000-0000-0000-000000000001','human','Maker 220','load_based',120.0,100.0,
   '00000000-0000-0000-0000-000000000204','aaaaaaaa-0000-0000-0000-00000000de20','aaaaaaaa-0000-0000-0000-0000000e2201');

update campaigns set account_manager_id = '00000000-0000-0000-0000-000000000201'
 where id = 'aaaaaaaa-0000-0000-0000-00000000e001';
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-0000000c2209','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000c001',
   'Draft 220','draft','campaign','00000000-0000-0000-0000-000000000201');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000f2200','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S220'),
  ('aaaaaaaa-0000-0000-0000-0000000f2209','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000c2209','S220 draft');
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id, department_id, due_at, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000e2201','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000f2200',
   'Poster 220','in_progress','00000000-0000-0000-0000-00000000a001','aaaaaaaa-0000-0000-0000-00000000de20',
   '2026-11-20 15:00+00','00000000-0000-0000-0000-000000000202'),
  ('aaaaaaaa-0000-0000-0000-0000000e2202','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000f2200',
   'Banner 220','in_progress','00000000-0000-0000-0000-00000000a001','aaaaaaaa-0000-0000-0000-00000000de20',
   '2026-11-20 15:00+00','00000000-0000-0000-0000-000000000202'),
  ('aaaaaaaa-0000-0000-0000-0000000e2209','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000f2209',
   'Draft piece 220','draft','00000000-0000-0000-0000-00000000a001','aaaaaaaa-0000-0000-0000-00000000de20',
   '2026-11-25 15:00+00','00000000-0000-0000-0000-000000000202');
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-00000000e001');
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, department_id, team_id, assignee_id, sla_hours, starts_at, due_at) values
  ('aaaaaaaa-0000-0000-0000-0000000a2201','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000e2201','Layout 220','in_progress',
   'aaaaaaaa-0000-0000-0000-00000000de20','aaaaaaaa-0000-0000-0000-0000000e2201','00000000-0000-0000-0000-000000000204', 6,
   '2026-11-10 06:00+00','2026-11-12 15:00+00');

-- ============================================================ d.1: who changes ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000201'),true);
select ok(app.may_change_deliverable('aaaaaaaa-0000-0000-0000-0000000e2201'), 'd.1: the account manager changes the piece');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000205'),true);
select ok(app.may_change_deliverable('aaaaaaaa-0000-0000-0000-0000000e2201'), 'd.1: the account director, as cover');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select ok(app.may_change_deliverable('aaaaaaaa-0000-0000-0000-0000000e2201'), 'd.1: Traffic, as cover');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000202'),true);
select ok(not app.may_change_deliverable('aaaaaaaa-0000-0000-0000-0000000e2201'), 'd.1: not the owner, though she leads the department');
select throws_ok($q$ select public.update_piece_details('aaaaaaaa-0000-0000-0000-0000000e2201', 'Instagram', null, null) $q$,
  '42501', 'only the account manager changes a deliverable — ask AM 220 to change it',
  'd.1: the owner''s channel edit is refused in the account manager''s name (hint ask_account_manager)');
select throws_ok($q$ update deliverables set notes = 'more words' where id = 'aaaaaaaa-0000-0000-0000-0000000e2201' $q$,
  '42501', null, 'd.1: and a bare PATCH of the brief lines is refused the same way — the guard is the rule');
select throws_ok($q$ select public.edit_piece_directly('aaaaaaaa-0000-0000-0000-0000000e2201', null, '2026-11-27') $q$,
  '42501', null, 'd.1: the owner does not move the due date directly');
select lives_ok($q$ update deliverables set name = 'Draft piece 220 — v2' where id = 'aaaaaaaa-0000-0000-0000-0000000e2209' $q$,
  'd.1: a DRAFT campaign''s piece keeps the old rule — its owner still renames it');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000201'),true);
select lives_ok($q$ select public.update_piece_details('aaaaaaaa-0000-0000-0000-0000000e2201', 'Instagram', null, 'Bold') $q$,
  'd.1: the account manager edits it');

-- ============================================================ d.2: the one form ====
select throws_ok($q$
  select public.ask_deliverable_change('aaaaaaaa-0000-0000-0000-0000000e2201', array['due_date'], 'x')
$q$, '22023', 'you change this deliverable yourself — there is nobody to ask', 'd.2: the account manager does not ask herself (change_directly)');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000202'),true);
select throws_ok($q$
  select public.ask_deliverable_change('aaaaaaaa-0000-0000-0000-0000000e2201', array['due_date'], '  ')
$q$, '22023', null, 'd.2: a reason is required');
select throws_ok($q$
  select public.ask_deliverable_change('aaaaaaaa-0000-0000-0000-0000000e2201', array['colour'], 'why')
$q$, '22023', null, 'd.2: only the form''s kinds');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000204'),true);
select throws_ok($q$
  select public.ask_deliverable_change('aaaaaaaa-0000-0000-0000-0000000e2201', array['due_date'], 'I need longer', '2026-11-30')
$q$, '42501', null, 'd.5: the maker on the piece''s task does not ask the account manager — she asks her lead (hint ask_your_lead)');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000202'),true);
select ok(public.ask_deliverable_change('aaaaaaaa-0000-0000-0000-0000000e2201', array['due_date', 'hours'],
            'The client added two sizes', '2026-11-27', 10, 'aaaaaaaa-0000-0000-0000-0000000a2201') is not null,
  'd.2: the owner asks for a later date and more hours, from the task whose move opened the form');
select throws_ok($q$
  select public.ask_deliverable_change('aaaaaaaa-0000-0000-0000-0000000e2201', array['other'], 'again')
$q$, '22023', 'a change to this deliverable is already waiting on the account manager', 'd.2: one pending per piece');
reset role;
select results_eq($q$
  select status, kinds, requested_due_day, requested_hours, from_sub_task_id, asked_by from deliverable_change_asks
   where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000e2201'
$q$, $q$ values ('pending', array['due_date', 'hours'], '2026-11-27'::date, 10::numeric,
                 'aaaaaaaa-0000-0000-0000-0000000a2201'::uuid, '00000000-0000-0000-0000-000000000202'::uuid) $q$,
  'd.2: the ask is on the record as asked');
select is((select count(*)::int from notifications where type = 'deliverable_change_asked'
            and user_id = '00000000-0000-0000-0000-000000000201'), 1, 'd.2: the account manager is asked');
select is((select due_at from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000e2201'), '2026-11-20 15:00+00'::timestamptz,
  'd.3: while it waits nothing moves');

-- ============================================================ d.4: the answers ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000202'),true);
select throws_ok($q$
  select public.answer_deliverable_change((select id from deliverable_change_asks where status = 'pending'), 'accept')
$q$, '42501', null, 'd.4: the asker does not answer — the account manager does');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000201'),true);
select throws_ok($q$
  select public.answer_deliverable_change((select id from deliverable_change_asks where status = 'pending'), 'keep')
$q$, '22023', null, 'd.4: keeping it as it is needs her reason');
select is((public.answer_deliverable_change((select id from deliverable_change_asks where status = 'pending'), 'accept')
           ->> 'due_moved')::boolean, true, 'd.4: she accepts — the due date moves');
reset role;
select is((select due_at from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000e2201'), app.close_of_day('2026-11-27'),
  'd.4: to the asked day, at close of business');
select results_eq($q$
  select status, applied_due_day, applied_hours, answered_by from deliverable_change_asks
   where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000e2201'
$q$, $q$ values ('accepted', '2026-11-27'::date, 10::numeric, '00000000-0000-0000-0000-000000000201'::uuid) $q$,
  'd.4: the hours are recorded with the answer (a deliverable has no hours of its own)');
select is((select count(*)::int from notifications where type = 'deliverable_change_answered'
            and user_id = '00000000-0000-0000-0000-000000000202' and detail ->> 'answer' = 'accept'), 1, 'd.4: the asker hears it');
select is((select count(*)::int from notifications where type = 'deliverable_edited'
            and user_id = '00000000-0000-0000-0000-000000000204'), 1, 'd.4: the assignee is told of the change (CP-08)');
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000205'),true);
select throws_ok($q$
  select public.answer_deliverable_change((select id from deliverable_change_asks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000e2201'), 'keep', null, null, 'no')
$q$, '22023', null, 'd.4: the first answer settles it (request_settled)');

-- change, and keep
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000203'),true);
select lives_ok($q$
  select public.ask_deliverable_change('aaaaaaaa-0000-0000-0000-0000000e2202', array['due_date'], 'Shoot moved', '2026-12-04')
$q$, 'd.2: a team lead asks on another piece');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000201'),true);
select is((public.answer_deliverable_change((select id from deliverable_change_asks where status = 'pending'), 'change',
                                            '2026-12-01', null, 'The client can give us till the 1st') ->> 'due_day'),
  '2026-12-01', 'd.4: she changes it — her date applies');
reset role;
select is((select due_at from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000e2202'), app.close_of_day('2026-12-01'),
  'd.4: her version, not the asked one');
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000203'),true);
select lives_ok($q$
  select public.ask_deliverable_change('aaaaaaaa-0000-0000-0000-0000000e2202', array['quantity'], 'Six sizes, not four')
$q$, 'd.2: and asks again');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000202'),true);
select throws_ok($q$ select public.withdraw_deliverable_change((select id from deliverable_change_asks where status = 'pending')) $q$,
  '42501', null, 'd.3: only the asker withdraws');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000203'),true);
select lives_ok($q$ select public.withdraw_deliverable_change((select id from deliverable_change_asks where status = 'pending')) $q$,
  'd.3: the asker withdraws while it waits');
reset role;
select is((select count(*)::int from notifications where type = 'deliverable_change_withdrawn'
            and user_id = '00000000-0000-0000-0000-000000000201'), 1, 'd.3: the account manager is told');

-- ============================================================ d.3: unanswered → the account director ====
set local role authenticated;
select lives_ok($q$
  select public.ask_deliverable_change('aaaaaaaa-0000-0000-0000-0000000e2202', array['brief'], 'The brief has no copy')
$q$, 'a third ask, and nobody answers');
reset role;
select is((select count(*)::int from app.escalation_due(now() + interval '1 hour') where kind = 'deliverable_change'), 0,
  'd.3: an hour later it has not escalated');
select is((select (app.run_escalation_sweep(now() + interval '7 days', false, 'deliverable_change') ->> 'sent')::int), 1,
  'd.3: after 4 working hours it escalates');
select results_eq($q$ select user_id from notifications where type = 'escalated' and detail ->> 'kind' = 'deliverable_change' $q$,
  $q$ values ('00000000-0000-0000-0000-000000000205'::uuid) $q$, 'd.3: to the account director');
select isnt((select escalated_at from deliverable_change_asks where status = 'pending'), null::timestamptz,
  'd.3: and the ask is stamped escalated');

-- ============================================================ d.5: ADR-0088 retired; more time from the lead ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000204'),true);
select throws_ok($q$
  select public.sub_task_extension_request('aaaaaaaa-0000-0000-0000-0000000a2201', '2026-11-30', 'need time', 'assignee')
$q$, '22023', null, 'd.5: no new extension request is raised (hint extension_retired)');
select ok(public.ask_more_time('aaaaaaaa-0000-0000-0000-0000000a2201', '2026-11-30', 'Wednesday too') is not null,
  'd.5: the maker asks her lead for more time');
select throws_ok($q$ select public.ask_more_time('aaaaaaaa-0000-0000-0000-0000000a2201', '2026-12-01') $q$,
  '22023', null, 'd.5: one ask at a time');
reset role;
select is((select count(*)::int from notifications where type = 'time_asked'
            and user_id = '00000000-0000-0000-0000-000000000203'), 1, 'd.5: her team lead is asked');
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000201'),true);
select throws_ok($q$ select public.answer_more_time((select id from sub_task_time_asks where status = 'pending'), true) $q$,
  '42501', null, 'd.5: the account manager is not the maker''s lead');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-000000000203'),true);
select results_eq($q$
  select outcome, past_piece_due from public.answer_more_time((select id from sub_task_time_asks where status = 'pending'), true)
$q$, $q$ values ('given', true) $q$,
  'd.5: the lead gives it — and is told it now runs past the piece''s due date, so the change form opens');
reset role;
select is((select due_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a2201'), app.close_of_day('2026-11-30'),
  'd.5: the task''s due day moved, through the assignment path');
select is((select count(*)::int from notifications where type = 'time_answered'
            and user_id = '00000000-0000-0000-0000-000000000204' and (detail ->> 'given')::boolean), 1, 'd.5: the maker hears yes');

select * from finish();
rollback;
