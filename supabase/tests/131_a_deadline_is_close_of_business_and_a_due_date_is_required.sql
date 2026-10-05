-- I52.14 / I53.6 (20 Sep) — a task's commitment is close of business on its last booked day, and a
-- deliverable is never created without a due date.
--
--   * STAMP (ADR-0075 addendum d.3a): a task assigned with a due_at at 13:00 Iraq (a placed
--     booking's end) is committed to 18:00 Iraq that day; a due_at at 09:00 UTC on the 17th (12:00
--     Iraq) likewise lands on the 17th at 18:00, never the 16th.
--   * DUE DATE (ADR-0093 addendum d.7): add_campaign_deliverable without one is refused in words;
--     a direct insert under a campaign without one is refused by the guard; a date once given
--     cannot be cleared; an existing dateless row can still be edited for something else (d.8);
--     ad-hoc work (a job with no campaign) is not covered.
begin;
select plan(9);
\ir helpers/seed.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a090', 'am131@a.test'),
  ('00000000-0000-0000-0000-00000000a091', 'lead131@a.test');
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de1310','aaaaaaaa-0000-0000-0000-000000000001','Creative 131');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid
from (values
  ('00000000-0000-0000-0000-00000000a090','AM 131',   'account_manager', null),
  ('00000000-0000-0000-0000-00000000a091','Lead 131', 'department_lead','aaaaaaaa-0000-0000-0000-000000de1310')
) as v(id, name, role_key, dept);
insert into test_claims (id, jwt)
select up.id,
       json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id in ('00000000-0000-0000-0000-00000000a090','00000000-0000-0000-0000-00000000a091');

insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-000000001330','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Campaign 131','approved','campaign','00000000-0000-0000-0000-00000000a090');
-- ADR-0116 d.3 (27 Sep): a campaign's pieces are added into a workstream.
insert into workstreams (tenant_id, campaign_id, name, department_id)
select tenant_id, id, 'Main work', 'aaaaaaaa-0000-0000-0000-0000000de0ff' from campaigns
 where id in ('aaaaaaaa-0000-0000-0000-000000001330');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000001331','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001330','Campaign 131');
-- One dated deliverable and one OLD dateless one (the production shape d.8 protects).
insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id, reviewer_id, due_at) values
  ('aaaaaaaa-0000-0000-0000-000000001332','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001331',
   'Dated','draft','00000000-0000-0000-0000-00000000a091','00000000-0000-0000-0000-00000000a001','2026-10-01 15:00+00'),
  ('aaaaaaaa-0000-0000-0000-000000001333','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001331',
   'Dateless','draft','00000000-0000-0000-0000-00000000a091','00000000-0000-0000-0000-00000000a001',null);

-- ================================================================ STAMP ====
-- Fixtures run as superuser (auth.uid() null), which is exactly how the schedule's writer lands the
-- row: the stamp is a BEFORE trigger on the row itself.
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order, assignee_id, starts_at, due_at, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-000000001334','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001332',
   'Design — Dated','todo',1,'00000000-0000-0000-0000-00000000a003','2026-09-17 06:00+00','2026-09-17 10:00+00',4),
  ('aaaaaaaa-0000-0000-0000-000000001335','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001332',
   'Review — Dated','todo',2,'00000000-0000-0000-0000-00000000a003','2026-09-17 06:00+00','2026-09-17 09:00+00',3);
select is((select committed_due_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-000000001334'),
  '2026-09-17 15:00+00'::timestamptz,
  'a task whose placed booking ends 13:00 Iraq is committed to 18:00 Iraq that day (d.3a)');
select is((select committed_due_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-000000001335'),
  '2026-09-17 15:00+00'::timestamptz,
  'and one ending 12:00 Iraq lands on the same day, never the day before');
select is((select due_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-000000001334'),
  '2026-09-17 10:00+00'::timestamptz,
  'the plan (due_at) is untouched — it still tracks the bookings');

-- ================================================================ DUE DATE ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a090'),true);
select throws_ok($$
  select public.add_campaign_deliverable('aaaaaaaa-0000-0000-0000-000000001330', 'No date', '00000000-0000-0000-0000-00000000a091')
$$, '22023', null, 'add_campaign_deliverable without a due date is refused in words (d.7)');
select lives_ok($$
  select public.add_campaign_deliverable('aaaaaaaa-0000-0000-0000-000000001330', 'With date', '00000000-0000-0000-0000-00000000a091',
    null, 1, '2026-10-05 15:00+00', p_workstream => (select id from workstreams where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001330' limit 1))
$$, 'with one it is added');

-- The lead (project_tasks:manage in reach) inserts directly: the guard, not the RPC, refuses.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a091'),true);
select throws_ok($$
  insert into deliverables (tenant_id, stream_id, name, state, owner_user_id, reviewer_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000001331',
          'Sneaked in', 'draft', '00000000-0000-0000-0000-00000000a091', '00000000-0000-0000-0000-00000000a001')
$$, '22023', null, 'a direct insert under a campaign without a due date is refused by the guard (ADR-0037)');
select throws_ok($$
  update deliverables set due_at = null where id = 'aaaaaaaa-0000-0000-0000-000000001332'
$$, '42501', null, 'a date once given cannot be cleared — the promise guard (ADR-0075 d.2) refuses before this one does');
-- ADR-0141 d.1 (3 Oct): renaming a live campaign's piece is the account manager's.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a090'),true);
select lives_ok($$
  update deliverables set name = 'Dateless, renamed' where id = 'aaaaaaaa-0000-0000-0000-000000001333'
$$, 'an OLD dateless row can still be edited for something else (d.8) — by the account manager (ADR-0141)');

-- Ad-hoc work: a job with no campaign is not covered.
reset role;
insert into jobs (id, tenant_id, client_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000001336','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'), 'Ad-hoc 131');
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a091'),true);
select lives_ok($$
  insert into deliverables (tenant_id, job_id, name, state, owner_user_id, reviewer_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000001336',
          'Ad-hoc piece', 'draft', '00000000-0000-0000-0000-00000000a091', '00000000-0000-0000-0000-00000000a001')
$$, 'ad-hoc work under a job with no campaign is not covered');

select * from finish();
rollback;
