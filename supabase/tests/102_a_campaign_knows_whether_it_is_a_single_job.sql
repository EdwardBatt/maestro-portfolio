-- I44 (ADR-0086 d.8–d.11) — `campaigns.kind` is a stored fact, both creation paths set it, and a
-- single job is promoted one way by somebody in scope.
--
-- Four properties:
--
--   * The column exists, is NOT NULL, is checked, and every row that existed before is a campaign.
--   * `create_campaign_from_brief` and `start_campaign_draft` keep working WITHOUT `p_kind` — the
--     seed calls the first positionally with seven arguments and the wizard calls both by name —
--     and produce a campaign; with `p_kind = 'single_job'` they produce a single job; anything
--     else is refused with 22023. The "without" case is the one that guards against the overload
--     trap the migration header describes: had the old signature survived, this call would fail
--     with "function is not unique" rather than succeed.
--   * Promotion is refused for a campaign (22023), refused out of scope (42501 — another account
--     manager, a department lead who holds the grant), refused across tenants (P0002), and is one
--     way: a second press on the promoted row is a 22023, not a silent no-op.
--   * `campaign_list_rows` carries `kind`, because that is what the list filters on.
--
-- Every write runs as `authenticated` with the caller's own claims; the functions read
-- `app.has_permission()` and `app.in_write_scope()`, so a superuser run would prove nothing.
begin;
select plan(24);
\ir helpers/seed.sql

-- ---------------------------------------------------------------- shape ----
select has_column('public', 'campaigns', 'kind', 'campaigns.kind exists (d.8)');
select col_not_null('public', 'campaigns', 'kind', 'kind is NOT NULL — a stored fact, never inferred (d.8)');
select col_has_check('public', 'campaigns', 'kind', 'kind is constrained to single_job | campaign');

select is(
  (select kind from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
  'campaign', 'every campaign that existed before is backfilled `campaign`');

select has_column('public', 'campaign_list_rows', 'kind', 'the campaigns list can filter on kind (d.9)');

-- ---------------------------------------------------------------- fixtures ----
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a010', 'am-one@a.test'),
  ('00000000-0000-0000-0000-00000000a011', 'am-two@a.test'),
  ('00000000-0000-0000-0000-00000000a013', 'lead@a.test');

insert into user_profiles (id, tenant_id, display_name, role_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r
         where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key)
from (values
  ('00000000-0000-0000-0000-00000000a010', 'AM One',    'account_manager'),
  ('00000000-0000-0000-0000-00000000a011', 'AM Two',    'account_manager'),
  ('00000000-0000-0000-0000-00000000a013', 'Dept Lead', 'department_lead')
) as v(id, name, role_key);

insert into test_claims
select up.id,
       json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
from user_profiles up
where up.id in ('00000000-0000-0000-0000-00000000a010', '00000000-0000-0000-0000-00000000a011',
                '00000000-0000-0000-0000-00000000a013');

-- ---------------------------------------------------------------- the two creation paths ----
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a010'), true);

-- Seven positional arguments, exactly as supabase/seed.sql calls it. If the old signature had
-- survived beside the new one this would be "function is not unique".
select lives_ok($$
  select public.create_campaign_from_brief(
    'aaaaaaaa-0000-0000-0000-00000000c001', null, 'One-shot without kind',
    '{"languages":["en"]}'::jsonb, null, '[]'::jsonb, '00000000-0000-0000-0000-00000000a010')
$$, 'create_campaign_from_brief still works WITHOUT p_kind — the seed and the wizard are unchanged');

select is(
  (select kind from campaigns where name = 'One-shot without kind'),
  'campaign', 'and what it makes is a campaign — the default');

select lives_ok($$
  select public.create_campaign_from_brief(
    'aaaaaaaa-0000-0000-0000-00000000c001', null, 'One-shot single job',
    '{"languages":["en"]}'::jsonb, null, '[]'::jsonb, '00000000-0000-0000-0000-00000000a010', 'single_job')
$$, 'create_campaign_from_brief accepts p_kind');

select is(
  (select kind from campaigns where name = 'One-shot single job'),
  'single_job', 'and stores single_job when asked (d.8)');

select throws_ok($$
  select public.create_campaign_from_brief(
    'aaaaaaaa-0000-0000-0000-00000000c001', null, 'Bad kind',
    '{"languages":["en"]}'::jsonb, null, '[]'::jsonb, null, 'project')
$$, '22023', null, 'an unknown kind is refused with 22023, before anything is written');

select lives_ok($$
  select public.start_campaign_draft(
    'aaaaaaaa-0000-0000-0000-00000000c001', null, 'Draft without kind', null)
$$, 'start_campaign_draft still works WITHOUT p_kind');

select is(
  (select kind from campaigns where name = 'Draft without kind'),
  'campaign', 'and defaults to campaign');

select lives_ok($$
  select public.start_campaign_draft(
    'aaaaaaaa-0000-0000-0000-00000000c001', null, 'Draft single job', null, 'single_job')
$$, 'start_campaign_draft accepts p_kind — SJ-02''s draft has folders to file into (ADR-0085 d.8)');

select is(
  (select kind from campaigns where name = 'Draft single job'),
  'single_job', 'and stores single_job');

-- ---------------------------------------------------------------- promotion ----
-- A campaign is not promotable: there is nothing to promote it to.
select throws_ok($$
  select public.promote_single_job((select id from campaigns where name = 'One-shot without kind'))
$$, '22023', 'this is already a campaign', 'a campaign cannot be promoted (d.10)');

-- Out of scope: another account manager. `account` scope is bounded by the responsible manager.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a011'), true);
select throws_ok($$
  select public.promote_single_job((select id from campaigns where name = 'One-shot single job'))
$$, '42501', null, 'a DIFFERENT account manager is refused — projects:manage in scope (d.9)');

-- Out of scope: a department lead, who HOLDS projects:manage and is department-scoped. The grant
-- alone is never enough (ADR-0073 d.1).
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a013'), true);
select throws_ok($$
  select public.promote_single_job((select id from campaigns where name = 'One-shot single job'))
$$, '42501', null, 'a department lead holding projects:manage is refused — the grant is necessary, never sufficient');

-- Found by review: `campaigns_tenant_write` has no scope, so the same lead could flip kind by PATCH
-- — both ways. The column is fenced (20260911130600); the RPC is the only route.
select throws_ok($$
  update campaigns set kind = 'campaign' where name = 'One-shot single job'
$$, '42501', null, '… and cannot write kind by hand either — the fence, not the policy, decides');
select throws_ok($$
  update campaigns set kind = 'single_job' where name = 'One-shot without kind'
$$, '42501', null, 'nor turn a campaign into a single job, which no RPC offers (d.11)');
select is(
  (select kind from campaigns where name = 'One-shot single job'),
  'single_job', 'nothing moved');

-- Across tenants: the row is not even visible.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000b001'), true);
select throws_ok($$
  select public.promote_single_job((select id from campaigns where name = 'One-shot single job'))
$$, 'P0002', null, 'tenant B cannot promote tenant A''s job — it does not exist for them');

-- The responsible account manager.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a010'), true);
select lives_ok($$
  select public.promote_single_job((select id from campaigns where name = 'One-shot single job'))
$$, 'the responsible account manager promotes their own job');

select is(
  (select kind from campaigns where name = 'One-shot single job'),
  'campaign', 'and it is now a campaign (d.10)');

-- One way (d.11): a second press is an error, not a silent success.
select throws_ok($$
  select public.promote_single_job((select id from campaigns where name = 'One-shot single job'))
$$, '22023', 'this is already a campaign', 'promotion is one way — a second press is refused (d.11)');

select * from finish();
rollback;
