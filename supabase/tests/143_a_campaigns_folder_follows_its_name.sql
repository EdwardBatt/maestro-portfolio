-- SJ-v3 (22 Sep) — a campaign's Library folder follows its name.
--
-- The single job is now created on its first screen under a provisional name, and named on the
-- third; the draft's folder must end up under the real name, not the placeholder. The same rename
-- path serves the campaign wizard's own Back-and-rename.
begin;
select plan(5);
\ir helpers/seed.sql

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);

select lives_ok($$
  select public.start_campaign_draft(
    'aaaaaaaa-0000-0000-0000-00000000c001', null, 'Zeta · Execution Brief · 2026-09-22 09:42:17 e1y0', null)
$$, 'a draft starts under a provisional name');

select is(
  (select f.name from asset_folders f
    where f.campaign_id = (select id from campaigns where name = 'Zeta · Execution Brief · 2026-09-22 09:42:17 e1y0')
      and f.kind = 'campaign' and f.is_system),
  'Zeta · Execution Brief · 2026-09-22 09:42:17 e1y0',
  'the folder is provisioned under that name (as before)');

select lives_ok($$
  select public.update_campaign_draft(
    (select id from campaigns where name = 'Zeta · Execution Brief · 2026-09-22 09:42:17 e1y0'), null, 'Ramadan teaser posts', null)
$$, 'the title names the draft on who and when');

select is(
  (select f.name from asset_folders f
    where f.campaign_id = (select id from campaigns where name = 'Ramadan teaser posts')
      and f.kind = 'campaign' and f.is_system),
  'Ramadan teaser posts',
  'the campaign folder follows the rename');

-- The four system subfolders are untouched by the rename.
select results_eq($$
  select f.name from asset_folders f
   where f.campaign_id = (select id from campaigns where name = 'Ramadan teaser posts')
     and f.kind = 'asset_type' order by 1
$$, $$ values ('Deliverables'), ('Final Assets'), ('References'), ('Working Files') $$,
  'the subfolders keep their names');

select * from finish();
rollback;
