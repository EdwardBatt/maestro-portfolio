-- Reported live 3 Sep: "all fields are filled in but it is not letting them proceed to the next
-- step", by a user holding `projects:manage` — and, on the second report, one who was **not the
-- client's assigned account manager**.
--
-- TWO CAUSES, ONE SYMPTOM.
--
--   1. `campaigns_tenant_write` checked `in_write_scope(null, null, campaign_account_manager(id))`
--      for every operation, and that function looks the campaign up BY ID. On an INSERT there is no
--      row, so it resolved to NULL, and an account-scoped caller needs a non-null match. No Account
--      Manager could create a campaign at all. Tenant-scoped roles return true unconditionally and
--      never met it — which is why it went unreported: Power Admin created the campaigns.
--   2. Reading the AM from the row being written fixed that, but `in_write_scope` for `account` is
--      `p_account_manager = auth.uid()` — so it still only admitted an AM creating a campaign THEY
--      would own. One AM raising a brief on a colleague's client stayed refused.
--
-- Edward, 3 Sep: *"anyone with project:manage can create, edit and delete… we have audit tracking
-- anyway."* So scope no longer governs campaign or stream writes; the PERMISSION does.
--
-- ADR-0067 is why this surfaced today rather than in August: the INSERT moved from submit to
-- leaving step 1, so a refusal that used to arrive after five steps of typing now arrives at once.
--
-- What this suite holds: the permission decides, a Team Member is still refused everything, and the
-- whole wizard path works for an AM who owns nothing — because a rule that admits the INSERT and
-- refuses the stream would look identical to the user, four steps later.
begin;
select plan(9);
\ir helpers/seed.sql

-- a002 is the Traffic Manager in the shared seed. Make them an Account Manager — account scope —
-- and leave the client owned by SOMEBODY ELSE (a001). This is the reported case exactly.
update user_profiles
   set role_id = (select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                    and key = 'account_manager')
 where id = '00000000-0000-0000-0000-00000000a002';
update clients set account_manager_id = '00000000-0000-0000-0000-00000000a001'
 where id = 'aaaaaaaa-0000-0000-0000-00000000c001';

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);

-- The permission was never what refused them, and this is asserted because it is the first thing
-- anybody will check when this is reported again.
select is(app.has_permission('projects','manage'), true,
  'the Account Manager holds projects:manage — never the problem');
select is(app.current_scope()::text, 'account',
  'and their scope is `account`, which is what refused them');

-- THE REPORTED CASE: raising a brief on a client owned by another account manager.
select lives_ok($$
  select public.start_campaign_draft(
    'aaaaaaaa-0000-0000-0000-00000000c001', null, 'Raised for a colleague''s client',
    '00000000-0000-0000-0000-00000000a001')
$$, 'an AM can start a draft on a client owned by SOMEBODY ELSE — the reported case');

select lives_ok($$
  select public.start_campaign_draft(
    'aaaaaaaa-0000-0000-0000-00000000c001', null, 'Inherits the client''s AM', null)
$$, 'and with no account manager named, inheriting the client''s');

-- END TO END. A rule that admits the campaign but refuses its STREAM would present as the identical
-- failure at submit instead of step 1, which is the trap this assertion exists for.
select lives_ok($$
  select public.complete_campaign_draft(
    (select id from campaigns where name = 'Inherits the client''s AM'),
    '{"languages":["en"],"proposition":"p"}'::jsonb, null, '[]'::jsonb)
$$, 'and the whole wizard completes — the campaign''s stream is written by the same caller');

select is(
  (select count(*)::int from streams s
     join campaigns c on c.id = s.campaign_id
    where c.name = 'Inherits the client''s AM'),
  1, 'exactly one stream, written by somebody who owns neither the client nor the campaign');

-- Editing and deleting are open too, by the same decision.
select lives_ok($$
  update campaigns set name = 'Renamed by a non-owning AM'
   where name = 'Raised for a colleague''s client'
$$, 'and an AM may edit a campaign they do not own (Edward, 3 Sep — audit is the control)');

-- The permission is what draws the line, and a Team Member does not hold it.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select throws_ok($$
  select public.start_campaign_draft(
    'aaaaaaaa-0000-0000-0000-00000000c001', null, 'Team member tries', null)
$$, '42501', null, 'a Team Member still cannot create one');

-- An RLS-filtered UPDATE matches NO ROWS rather than raising, so the assertion is that nothing
-- moved. A throws_ok here would pass even if the policy had been dropped entirely.
update campaigns set name = 'Renamed by a team member'
 where id = 'aaaaaaaa-0000-0000-0000-00000000e001';
select is(
  (select name from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
  'Ramadan 2027',
  'nor edit one — the permission is the line, and they are on the wrong side of it');

select * from finish();
rollback;
