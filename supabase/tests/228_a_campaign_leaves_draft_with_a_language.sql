-- 20261004140000 (ADR-0117 addendum, 4 Oct — Edward Q19; I74.34) — a campaign or single job leaves draft with at least
-- one language. A draft may be saved with none; the submit (complete_campaign_draft) and the one-shot create
-- (create_campaign_from_brief) are refused without one (hint campaign_languages_required), in the campaign's words or
-- the job's. A campaign already past draft with none is not touched: approving it still works.
begin;
select plan(9);
\ir helpers/seed.sql

set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

-- A draft saves with no language.
select lives_ok($$
  select public.start_campaign_draft('aaaaaaaa-0000-0000-0000-00000000c001', null, 'Draft 228', null, 'campaign')
$$, 'a campaign draft is started');
select lives_ok($$
  select public.update_campaign_draft((select id from campaigns where name = 'Draft 228'), null, 'Draft 228', null,
    '{"proposition":"p","languages":[]}'::jsonb, null)
$$, 'and saved with no language — a draft may be');

-- Leaving draft without one is refused.
select throws_ok($$
  select public.complete_campaign_draft((select id from campaigns where name = 'Draft 228'),
    '{"proposition":"p","languages":[]}'::jsonb, null,
    '[{"name":"Key Visual","dueAt":"2026-10-01T15:00:00Z","ownerUserId":"00000000-0000-0000-0000-00000000a001","workstreamKey":"w"}]'::jsonb,
    p_workstreams => '[{"key":"w","name":"Main work","departmentId":"aaaaaaaa-0000-0000-0000-0000000de0ff"}]'::jsonb)
$$, '22023', 'a campaign is made in at least one language — choose one on the brief step',
  'submitting a campaign with no language is refused, saying where to choose one');
select is((select status from campaigns where name = 'Draft 228'), 'draft', 'and it stays a draft');

select lives_ok($$
  select public.complete_campaign_draft((select id from campaigns where name = 'Draft 228'),
    '{"proposition":"p","languages":["ar","en"]}'::jsonb, null,
    '[{"name":"Key Visual","dueAt":"2026-10-01T15:00:00Z","ownerUserId":"00000000-0000-0000-0000-00000000a001","workstreamKey":"w"}]'::jsonb,
    p_workstreams => '[{"key":"w","name":"Main work","departmentId":"aaaaaaaa-0000-0000-0000-0000000de0ff"}]'::jsonb)
$$, 'with Arabic and English it goes through');
select is((select status from campaigns where name = 'Draft 228'), 'pending_approval', 'and leaves draft');

-- The one-shot create, for a single job: refused in the job's words.
select throws_ok($$
  select public.create_campaign_from_brief('aaaaaaaa-0000-0000-0000-00000000c001', null, 'Job 228',
    '{"kind":"single_job"}'::jsonb, null, '[]'::jsonb, null, 'single_job')
$$, '22023', 'a job is made in at least one language — choose one beside what is being made',
  'a single job created with no language is refused, saying where to choose one');
reset role;

-- A campaign already past draft with none (made before this rule) is not changed and can still be approved.
insert into campaigns (id, tenant_id, client_id, name, status, kind, languages) values
  ('aaaaaaaa-0000-0000-0000-0000000c2280','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000c001',
   'Legacy 228','pending_approval','campaign','{}');
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select lives_ok($$ select public.approve_campaign('aaaaaaaa-0000-0000-0000-0000000c2280') $$,
  'a campaign already past draft with no language is still approved — it is listed, not refused');
reset role;
select is((select status from campaigns where id = 'aaaaaaaa-0000-0000-0000-0000000c2280'), 'approved', 'it is approved');

select * from finish();
rollback;
