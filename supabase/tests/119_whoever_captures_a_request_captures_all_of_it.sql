-- ADR-0083 addendum d.13–d.15 (I48.38 / I48.40): whoever captures a request captures all of it;
-- the account manager approves, and the refusal names them.
--
-- The production failure, reproduced: an account manager who is NOT the client's opens a job. Before
-- this migration the receipt row was refused (the receipts policy was a stale copy of the campaign's
-- OLD account-scoped rule) and the approval refusal named nobody. Now: the receipt saves; the
-- approval is still refused, with the account manager's name in DETAIL; the real account manager
-- approves.
--
-- Subjects: a024 = Account Mgr (the client's — set on the campaign), a025 = Other Mgr (an account
-- manager who is not), a022 = a team member (project_tasks:manage only — never projects:manage),
-- b001 = tenant B's admin.

begin;
select plan(9);
\ir helpers/seed.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a022', 'copy-maker@a.test'),
  ('00000000-0000-0000-0000-00000000a024', 'account-mgr@a.test'),
  ('00000000-0000-0000-0000-00000000a025', 'other-mgr@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key)
from (values
  ('00000000-0000-0000-0000-00000000a022','Copy Maker',  'team_member'),
  ('00000000-0000-0000-0000-00000000a024','Account Mgr', 'account_manager'),
  ('00000000-0000-0000-0000-00000000a025','Other Mgr',   'account_manager')
) as v(id, name, role_key);
insert into test_claims
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id in ('00000000-0000-0000-0000-00000000a022','00000000-0000-0000-0000-00000000a024',
                 '00000000-0000-0000-0000-00000000a025');

-- A pending single job for the seed client, whose account manager is a024.
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-0000000119e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001','Programmers 119','pending_approval','single_job',
   '00000000-0000-0000-0000-00000000a024');

-- ======================================== 1-3. capture follows projects:manage (d.13) ====
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a025'), true);

select lives_ok(
  $$insert into campaign_brief_receipts (tenant_id, campaign_id, subject, received_at, received_tz, source)
    values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000119e1',
            'the WhatsApp', now() - interval '1 hour', 'Asia/Baghdad', 'manual')$$,
  'an account manager who is NOT the client''s records the arrival — capture is projects:manage, not account scope');

select lives_ok(
  $$update campaign_brief_receipts set subject = 'the WhatsApp, corrected'
     where campaign_id = 'aaaaaaaa-0000-0000-0000-0000000119e1'$$,
  'and corrects it on Back/Next, as the wizard does');

select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a022'), true);
select throws_ok(
  $$insert into campaign_brief_receipts (tenant_id, campaign_id, subject, source)
    values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000119e1',
            'sneaked in', 'manual')$$,
  '42501', null,
  'somebody without projects:manage still cannot — the rule widened to the campaign''s, not to everyone');

-- ================================================= 4. the tenant fence is untouched ====
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000b001'), true);
select is(
  (select count(*)::int from campaign_brief_receipts where campaign_id = 'aaaaaaaa-0000-0000-0000-0000000119e1'),
  0, 'tenant B sees nothing of it');

-- ======================================= 5-7. the approval is the account manager's (d.14–d.15) ====
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a025'), true);

select throws_ok(
  $$select app.approve_campaign('aaaaaaaa-0000-0000-0000-0000000119e1')$$,
  '42501', 'you cannot approve this campaign',
  'the capturer who is not the account manager is still refused at Approve');

-- The DETAIL is the part the screen reads; pgTAP's throws_ok cannot see it, so catch it by hand.
create temp table refusal (detail text, hint text);
do $$
begin
  perform app.approve_campaign('aaaaaaaa-0000-0000-0000-0000000119e1');
exception when insufficient_privilege then
  declare d text; h text;
  begin
    get stacked diagnostics d = pg_exception_detail, h = pg_exception_hint;
    insert into refusal values (d, h);
  end;
end $$;
select is((select detail from refusal), 'Account Mgr', 'the refusal NAMES the account manager, in DETAIL');
select is((select hint from refusal), 'account_manager', 'and says one is set');

select is(
  (select status from campaigns where id = 'aaaaaaaa-0000-0000-0000-0000000119e1'),
  'pending_approval', 'the job is left whole for them (d.16) — still pending, nothing lost');

-- ================================================= 8. the account manager approves ====
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a024'), true);
select lives_ok(
  $$select app.approve_campaign('aaaaaaaa-0000-0000-0000-0000000119e1')$$,
  'the client''s account manager approves the job the other manager captured');

select * from finish();
rollback;
