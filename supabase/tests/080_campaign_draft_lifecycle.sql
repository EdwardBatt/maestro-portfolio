-- I35.4 (ADR-0067) — a campaign starts as a draft, and the draft functions refuse everything they
-- should refuse.
--
-- The risk this suite exists for is not that the happy path fails. It is that the guards are
-- decorative. Four of them carry real weight:
--
--   * `complete_campaign_draft` must refuse a second submit, or a double-click writes a second
--     stream and a second full set of deliverables onto a live campaign.
--   * `discard_campaign_draft` must refuse once anything is filed, because deleting the campaign
--     cascades to its folders and would take somebody's documents with it (d.7).
--   * `update_campaign_draft` must refuse a campaign that is no longer a draft — a live campaign is
--     edited through its own surface, under its own rules.
--   * None of them may reach another tenant, and all four are `security invoker`, so what actually
--     stops that is `campaigns_tenant_write` and not the function bodies.
--
-- And one structural assertion: the ONE content writer. ADR-0067 factored
-- `app.write_campaign_content` precisely so the one-shot path and the draft path cannot drift, and
-- a test that both routes produce the same shape is what keeps that true.
begin;
select plan(12);
\ir helpers/seed.sql

-- The wizard's own permission. a002 (scheduler) holds projects:manage in the seeded roles; a001 is
-- power_admin. Both are used below, deliberately, so the suite is not proving one role's quirk.
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);

-- ---------------------------------------------------------------- start ----
select lives_ok($$
  select public.start_campaign_draft(
    'aaaaaaaa-0000-0000-0000-00000000c001', null, 'Draft One', null)
$$, 'projects:manage may start a draft');

select is(
  (select status from campaigns where name = 'Draft One'),
  'draft',
  'the campaign is created as a DRAFT (d.1) — the value chk_campaigns_status has always allowed and nothing has ever written');

-- d.1: folders are provisioned by the INSERT trigger, so a draft has somewhere to file into. This
-- is the assertion the whole feature rests on; without it step 2 has no folder tree.
select isnt_empty($$
  select 1 from asset_folders f
   where f.campaign_id = (select id from campaigns where name = 'Draft One')
     and f.name = 'References'
$$, 'a draft campaign already has its References folder — provisioning needs no new code');

-- d.5: the name is claimed here, so a duplicate surfaces at step 2 rather than after five steps.
select throws_ok($$
  select public.start_campaign_draft(
    'aaaaaaaa-0000-0000-0000-00000000c001', null, 'Draft One', null)
$$, '23505', null, 'the campaign name is claimed at step 2 (d.5)');

-- ---------------------------------------------------------------- update ----
select lives_ok($$
  select public.update_campaign_draft(
    (select id from campaigns where name = 'Draft One'), null, 'Draft One Renamed', null)
$$, 'going back to step 1 renames the draft');

select throws_ok($$
  select public.update_campaign_draft(
    'aaaaaaaa-0000-0000-0000-00000000e001', null, 'Ramadan Renamed', null)
$$, '23514', null,
  'a LIVE campaign is refused — it is edited through the campaign surface, not the wizard');

-- ---------------------------------------------------------------- discard ----
select lives_ok($$
  select public.start_campaign_draft(
    'aaaaaaaa-0000-0000-0000-00000000c001', null, 'Draft To Bin', null)
$$, 'a second draft, to be discarded');

select lives_ok($$
  select public.discard_campaign_draft((select id from campaigns where name = 'Draft To Bin'))
$$, 'an EMPTY draft is discarded by hand (d.7)');

-- The guard that matters: a filed document must not be destroyed to tidy a list.
set local role postgres;
insert into assets (tenant_id, folder_id, name, provider, object_key)
select 'aaaaaaaa-0000-0000-0000-000000000001', f.id, 'reference.pdf', 'b2', 'k/1'
  from asset_folders f
 where f.campaign_id = (select id from campaigns where name = 'Draft One Renamed')
   and f.name = 'References';
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);

select throws_ok($$
  select public.discard_campaign_draft((select id from campaigns where name = 'Draft One Renamed'))
$$, '23514', null,
  'a draft holding filed documents REFUSES to be discarded — the cascade would take them with it (d.7)');

-- ---------------------------------------------------------------- complete ----
-- The wizard names an owner per deliverable. It always did on the screen (I22.5, 28 Aug); since
-- ADR-0100 d.8 the database refuses the row without one, because the owner is who approves the
-- task list and unowned work is work nobody could ever start. a001 owns it rather than the seed's
-- Creative A, whose role reaches no further than themselves — a team member is assigned tasks, not
-- given a deliverable (ADR-0083 d.9).
select lives_ok($$
  select public.complete_campaign_draft(
    (select id from campaigns where name = 'Draft One Renamed'),
    '{"languages":["en"],"proposition":"p","insight":"i","audiencePrimary":"a"}'::jsonb,
    null,
    '[{"name":"Key Visual","quantity":"2","dueAt":"2026-10-01T15:00:00Z",
       "ownerUserId":"00000000-0000-0000-0000-00000000a001","workstreamKey":"w"}]'::jsonb,
    p_workstreams => '[{"key":"w","name":"Main work","departmentId":"aaaaaaaa-0000-0000-0000-0000000de0ff"}]'::jsonb)
$$, 'submit completes the draft');

select results_eq($$
  select c.status, (select count(*) from streams s where s.campaign_id = c.id)::int,
         (select count(*) from deliverables d
            join streams s on s.id = d.stream_id where s.campaign_id = c.id)::int
    from campaigns c where c.name = 'Draft One Renamed'
$$, $$ values ('pending_approval', 1, 1) $$,
  'draft → pending_approval, with exactly ONE stream and the deliverables written once (d.4)');

-- The second-submit guard. Without it a double click writes a second stream and a second set of
-- deliverables onto a campaign that is already live.
-- The payload carries an owner so that what refuses this is the second-submit guard and not
-- ADR-0100 d.8's owner rule: a test of one guard must not be able to pass because of another.
select throws_ok($$
  select public.complete_campaign_draft(
    (select id from campaigns where name = 'Draft One Renamed'),
    '{"languages":["en"]}'::jsonb, null,
    '[{"name":"Again","dueAt":"2026-10-01T15:00:00Z",
       "ownerUserId":"00000000-0000-0000-0000-00000000a001"}]'::jsonb)
$$, '23514', null, 'a second submit is refused — one stream, not two');

select * from finish();
rollback;
