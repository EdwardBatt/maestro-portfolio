-- I40.21 — the campaigns list row, and the fence around it (8 Sep).
--
-- `campaign_list_rows` exists so the list can be read in ONE query instead of one RPC per campaign.
-- That convenience is exactly the shape that leaks a tenant's campaigns to another, so the
-- assertions here are about the fence as much as the counts: SECURITY INVOKER is the claim, and a
-- `security definer` view would pass the counting tests and fail the last one silently.
begin;
select plan(7);
\ir helpers/seed.sql

-- The seed carries no departments, so this fixture makes its own two.
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000b001','aaaaaaaa-0000-0000-0000-000000000001','Creative'),
  ('aaaaaaaa-0000-0000-0000-00000000b002','aaaaaaaa-0000-0000-0000-000000000001','Production');

-- Two departments' worth of work on the seeded campaign, one brief approved and one not.
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000094d1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S');
insert into deliverables (id, tenant_id, stream_id, name, owner_user_id, department_id, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000094e1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000094d1',
   'KV','00000000-0000-0000-0000-00000000a002','aaaaaaaa-0000-0000-0000-00000000b001','00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-0000000094e2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000094d1',
   'Film','00000000-0000-0000-0000-00000000a003','aaaaaaaa-0000-0000-0000-00000000b001','00000000-0000-0000-0000-00000000a001');

insert into campaign_briefs (id, tenant_id, campaign_id, department_id, brief_type, values, approved_at) values
  ('aaaaaaaa-0000-0000-0000-0000000094c1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001',
   'aaaaaaaa-0000-0000-0000-00000000b001','creative','{}', now()),
  ('aaaaaaaa-0000-0000-0000-0000000094c2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001',
   'aaaaaaaa-0000-0000-0000-00000000b002','creative','{}', null);

update campaigns set account_manager_id = '00000000-0000-0000-0000-00000000a002'
 where id = 'aaaaaaaa-0000-0000-0000-00000000e001';

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);

select is(
  (select status from campaign_list_rows where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
  'approved',
  'the row carries the campaign brief status, which is the first thing the list has to answer');

select is(
  (select account_manager_name from campaign_list_rows where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
  (select display_name from user_profiles where id = '00000000-0000-0000-0000-00000000a002'),
  'and names the account manager, so there is somebody to chase');

select is(
  (select department_brief_total from campaign_list_rows where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
  2,
  'department briefs are COUNTED, not listed');

select is(
  (select department_brief_approved from campaign_list_rows where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
  1,
  'and the count distinguishes approved from waiting — "1 of 2"');

select is(
  (select array_length(brief_owner_names, 1) from campaign_list_rows where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
  2,
  'the owners are named — one per person with work, distinct');

-- A campaign nobody has given work to must still appear, with zeroes rather than vanishing: a list
-- that hides the campaigns needing attention most is worse than no list.
insert into campaigns (id, tenant_id, client_id, name, status) values
  ('aaaaaaaa-0000-0000-0000-0000000094f1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001','Untouched', 'pending_approval');
select is(
  (select department_brief_total from campaign_list_rows where id = 'aaaaaaaa-0000-0000-0000-0000000094f1'),
  0,
  'a campaign with no briefs and no owners is still a row, counted at zero');

-- THE fence. The view is SECURITY INVOKER, so RLS answers as the caller and tenant B is not here.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b001'),true);
select is(
  (select count(*)::int from campaign_list_rows where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
  0,
  'another tenant reads none of it — the convenience is not a way around RLS');

select * from finish();
rollback;
