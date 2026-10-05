-- I40 — a draft keeps the brief that was written into it.
--
-- ADR-0067 promises a draft is *"resumable"*. Only its identity ever was: `update_campaign_draft`
-- wrote brand, name and account manager, and everything typed on steps 2 to 4 stayed in the
-- browser until submit. Edward, 5 Sep, coming back to step 2: *"all the data is missing… the form
-- is blank."*
--
-- Two assertions carry the weight, and the second is the one that could rot silently:
--
--   * what is passed IS stored — otherwise the wizard saves into a void;
--   * what is NOT passed is LEFT ALONE. Step 1 is reachable by going back, and its save carries no
--     brief. If null meant "blank it" rather than "leave it", pressing Next from step 1 a second
--     time would erase every strategy field typed since — a data loss with no error and no trace.
--
-- The old 4-argument call is exercised too, because that is precisely the shape step 1 sends.
begin;
select plan(7);
\ir helpers/seed.sql

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);

select public.start_campaign_draft(
  'aaaaaaaa-0000-0000-0000-00000000c001', null, 'Resumable Draft', null);

-- ---------------------------------------------------------------- stored ----
select lives_ok($$
  select public.update_campaign_draft(
    (select id from campaigns where name = 'Resumable Draft'),
    null, 'Resumable Draft', null,
    '{"proposition":"Closer, for less.","deliverables":[{"name":"Hero film","quantity":3}]}'::jsonb,
    '2026-10-01T00:00:00Z'::timestamptz)
$$, 'the draft accepts the brief and the go-live date');

select is(
  (select brief->>'proposition' from campaigns where name = 'Resumable Draft'),
  'Closer, for less.',
  'the strategy is stored on the draft, not held in the browser until submit');

-- Steps 3 and 4 round-trip through the SAME jsonb, which is why they need no relational shape of
-- their own — the deliverable ROWS are still written once, at submit.
select is(
  (select brief->'deliverables'->0->>'name' from campaigns where name = 'Resumable Draft'),
  'Hero film',
  'the deliverables are stored inside the brief the submit path was going to write anyway');

select is(
  (select go_live_at from campaigns where name = 'Resumable Draft'),
  '2026-10-01T00:00:00Z'::timestamptz,
  'the go-live date is stored, so step 4 survives a resume');

-- ---------------------------------------------------------------- left alone ----
-- Exactly what step 1 sends: four arguments, no brief. This is the regression guard.
select lives_ok($$
  select public.update_campaign_draft(
    (select id from campaigns where name = 'Resumable Draft'),
    null, 'Resumable Draft Renamed', null)
$$, 'the 4-argument call step 1 makes still works against the 6-argument function');

select is(
  (select brief->>'proposition' from campaigns where name = 'Resumable Draft Renamed'),
  'Closer, for less.',
  'going BACK to step 1 and pressing Next does not erase the brief a later step wrote');

select is(
  (select go_live_at from campaigns where name = 'Resumable Draft Renamed'),
  '2026-10-01T00:00:00Z'::timestamptz,
  'and it does not erase the go-live date either');

select * from finish();
rollback;
