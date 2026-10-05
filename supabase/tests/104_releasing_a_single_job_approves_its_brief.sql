-- I44 (ADR-0085 d.2, ADR-0084 d.4) — one press releases a single job: the job is approved, its
-- brief is stamped approved by the same person, and the owner is told once — never asked to
-- approve a brief the account manager wrote. A campaign's briefs are exactly as they were.
--
-- Notifications are recipient-scoped under RLS, so every assertion about them is made after
-- `reset role` (traps.md: "a pgTAP assertion about notifications finds nothing, or finds nothing
-- and passes"). The zero-assertions in particular would pass for the wrong reason otherwise.
begin;
select plan(11);
\ir helpers/seed.sql

-- ---------------------------------------------------------------- fixtures ----
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000de001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative');

-- a003: the Creative department lead, owner of both deliverables below.
update user_profiles
   set role_id = (select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                    and key = 'department_lead'),
       department_id = 'aaaaaaaa-0000-0000-0000-0000000de001'
 where id = '00000000-0000-0000-0000-00000000a003';

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000a010', 'am-one@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id)
values ('00000000-0000-0000-0000-00000000a010', 'aaaaaaaa-0000-0000-0000-000000000001', 'AM One',
        (select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'account_manager'));
insert into test_claims
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id = '00000000-0000-0000-0000-00000000a010';

-- The single job, as SJ-04 finds it: pending, its single-execution brief written by the AM and
-- not yet approved by anybody.
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-0000000e9101', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Ramadan teaser posts', 'pending_approval', 'single_job',
   '00000000-0000-0000-0000-00000000a010');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000c9101', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000e9101', 'Ramadan teaser posts');
insert into campaign_briefs (id, tenant_id, campaign_id, department_id, brief_type, values) values
  ('aaaaaaaa-0000-0000-0000-0000000cb911', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000e9101', 'aaaaaaaa-0000-0000-0000-0000000de001', 'single_execution',
   '{"task":"Three statics"}');
insert into deliverables (id, tenant_id, stream_id, name, owner_user_id, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d9101', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000c9101', 'Teaser statics x3', '00000000-0000-0000-0000-00000000a003',
   '00000000-0000-0000-0000-00000000a001');

-- A campaign beside it, same shape, same AM, same unapproved brief — the control.
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-0000000e9102', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Ramadan campaign', 'pending_approval', 'campaign',
   '00000000-0000-0000-0000-00000000a010');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000c9102', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000e9102', 'Ramadan campaign');
insert into campaign_briefs (id, tenant_id, campaign_id, department_id, brief_type, values) values
  ('aaaaaaaa-0000-0000-0000-0000000cb912', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000e9102', 'aaaaaaaa-0000-0000-0000-0000000de001', 'creative', '{}');
insert into deliverables (id, tenant_id, stream_id, name, owner_user_id, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d9102', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000c9102', 'Campaign KV', '00000000-0000-0000-0000-00000000a003',
   '00000000-0000-0000-0000-00000000a001');

-- ---------------------------------------------------------------- the press ----
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a010'), true);

select lives_ok($$ select public.approve_campaign('aaaaaaaa-0000-0000-0000-0000000e9101') $$,
  'the account manager releases the single job in one press (ADR-0085 d.2)');
select lives_ok($$ select public.approve_campaign('aaaaaaaa-0000-0000-0000-0000000e9102') $$,
  'and approves the campaign beside it');

reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------- the single job ----
select is(
  (select status from campaigns where id = 'aaaaaaaa-0000-0000-0000-0000000e9101'),
  'approved', 'the job is approved');
select isnt(
  (select approved_at from campaign_briefs where id = 'aaaaaaaa-0000-0000-0000-0000000cb911'),
  null, 'its brief is stamped approved by the SAME press (ADR-0084 d.4 — no second gate)');
select is(
  (select approved_by from campaign_briefs where id = 'aaaaaaaa-0000-0000-0000-0000000cb911'),
  '00000000-0000-0000-0000-00000000a010'::uuid,
  'and by the account manager who pressed it');

select is(
  (select count(*)::int from notifications
    where type = 'brief_awaiting_approval' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000e9101'),
  0, 'nobody is asked to approve a brief the account manager approved');
-- I48 / I53.19 (21 Sep): the owner is told once, on the JOB — one row per owner, carrying what
-- they own; the job's page points at its one deliverable.
select is(
  (select count(*)::int from notifications
    where type = 'campaign_approved'
      and entity_type = 'campaign'
      and entity_id = 'aaaaaaaa-0000-0000-0000-0000000e9101'
      and user_id = '00000000-0000-0000-0000-00000000a003'
      and (detail ->> 'deliverable_count')::int = 1),
  1, 'the owner is told once, on the job, owning one deliverable (ADR-0085 d.4 / I48 / I53.19)');

-- ---------------------------------------------------------------- the campaign, unchanged ----
select is(
  (select approved_at from campaign_briefs where id = 'aaaaaaaa-0000-0000-0000-0000000cb912'),
  null, 'a CAMPAIGN''s department brief is NOT stamped — its department approves it (ADR-0070)');
-- I52 Action 1 (17 Sep): the "your brief is waiting" notice is gone (it could only fire for a
-- brief that existed before approval); the deliverable's OWNER is told, once — I53.19: on the
-- campaign — that they must review the brief and tasks and approve.
select is(
  (select count(*)::int from notifications
    where type = 'campaign_approved' and entity_type = 'campaign'
      and entity_id = 'aaaaaaaa-0000-0000-0000-0000000e9102'
      and user_id = '00000000-0000-0000-0000-00000000a003'),
  1, 'its deliverable''s owner is told, on the campaign — the brief and tasks are theirs to approve (I52 Action 1, I53.19)');
select is(
  (select count(*)::int from notifications
    where entity_id = 'aaaaaaaa-0000-0000-0000-0000000d9102'
      and user_id = '00000000-0000-0000-0000-00000000a003'),
  0, 'and nothing on the deliverable row itself — one event, one notice');

-- Second press: still refused, still 22023, for both kinds.
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a010'), true);
select throws_ok($$ select public.approve_campaign('aaaaaaaa-0000-0000-0000-0000000e9101') $$,
  '22023', null, 'a released job cannot be released again');

select * from finish();
rollback;
