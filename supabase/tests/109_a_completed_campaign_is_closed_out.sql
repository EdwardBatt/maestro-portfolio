-- ADR-0091 / I48.9 — a completed campaign is closed out.
--
-- Properties:
--   * close_out_campaign is REFUSED while a deliverable under the campaign is still open
--     (in_progress), and the message names the count (d.3);
--   * once every deliverable is settled (approved), a manager in scope closes it — status 'closed',
--     closed_by stamped from auth.uid();
--   * a team member (no projects:manage) cannot close it (d.2);
--   * reopen_campaign returns it to 'approved' and clears the stamp (d.4);
--   * it is not reachable across tenants.
--
-- Runs as `authenticated` with each caller's own claims; the RPC reads app.has_permission and
-- app.in_write_scope, so a superuser run proves nothing.
begin;
select plan(10);
\ir helpers/seed.sql

-- ---------------------------------------------------------------- shape ----
select has_column('public', 'campaigns', 'closed_at', 'a campaign records when it was closed out (d.1)');
select has_column('public', 'campaigns', 'closed_by', 'and by whom (d.1)');

-- ---------------------------------------------------------------- fixtures ----
-- A team member who holds no projects:manage.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000a091', 'member91@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id)
values ('00000000-0000-0000-0000-00000000a091', 'aaaaaaaa-0000-0000-0000-000000000001', 'Member 91',
        (select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'team_member'));
insert into test_claims
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id = '00000000-0000-0000-0000-00000000a091';

-- An approved campaign with one deliverable still in progress.
insert into campaigns (id, tenant_id, client_id, name, status) values
  ('aaaaaaaa-0000-0000-0000-0000000e9109', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Close-out 109', 'approved');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000c9109', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000e9109', 'S109');
insert into deliverables (id, tenant_id, stream_id, name, state) values
  ('aaaaaaaa-0000-0000-0000-0000000d9109', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000c9109', 'Panels 109', 'in_progress');

set local role authenticated;

-- ---------------------------------------------------------------- refused while open ----
-- a002 is the scheduler: tenant scope and projects:manage — every grant to close it, but work is open.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select throws_ok($$
  select public.close_out_campaign('aaaaaaaa-0000-0000-0000-0000000e9109')
$$, '23514',
  'this campaign has 1 deliverable(s) still in progress — finish or archive them before closing it out',
  'a campaign with open work cannot be closed, and the message names the count (d.3)');
select is(
  (select status from campaigns where id = 'aaaaaaaa-0000-0000-0000-0000000e9109'),
  'approved', 'it stays approved');

-- ---------------------------------------------------------------- the work settles ----
-- Settle the deliverable to a terminal state (archived). Done as the superuser fixture path, where
-- the deliverable transition guard escapes (auth.uid() null) — not a user action under test.
reset role;
update deliverables set state = 'archived' where id = 'aaaaaaaa-0000-0000-0000-0000000d9109';
set local role authenticated;

-- A team member cannot close it (no projects:manage).
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a091'),true);
select throws_ok($$
  select public.close_out_campaign('aaaaaaaa-0000-0000-0000-0000000e9109')
$$, '42501', null, 'a team member cannot close out a campaign (d.2)');

-- The scheduler, in scope, closes it.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select lives_ok($$
  select public.close_out_campaign('aaaaaaaa-0000-0000-0000-0000000e9109')
$$, 'a manager in scope closes a finished campaign (d.2/d.3)');
select is(
  (select status from campaigns where id = 'aaaaaaaa-0000-0000-0000-0000000e9109'),
  'closed', 'it is now closed');
select is(
  (select closed_by from campaigns where id = 'aaaaaaaa-0000-0000-0000-0000000e9109'),
  '00000000-0000-0000-0000-00000000a002'::uuid, 'and it records who did (d.1)');

-- ---------------------------------------------------------------- reopen ----
select lives_ok($$
  select public.reopen_campaign('aaaaaaaa-0000-0000-0000-0000000e9109')
$$, 'a closed campaign reopens (d.4)');
select is(
  (select status from campaigns where id = 'aaaaaaaa-0000-0000-0000-0000000e9109'),
  'approved', 'and it is approved again, the stamp cleared');

select * from finish();
rollback;
