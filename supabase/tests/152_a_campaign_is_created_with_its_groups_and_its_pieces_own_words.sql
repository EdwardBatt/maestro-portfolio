-- I56.3 / I56.8 (24 Sep) — everything section C added to a piece reaches the row through the ONE
-- door that creates a campaign, and the groups are made by the same call.
--
-- `20260924100000`. Section C put six new things on a campaign's work — a group, an idea, notes, a
-- language, a priority and the event a phase ends on — and the wizard collects every one. Only the
-- priority was being written. A person laid out five workstreams, pressed submit, and got a
-- campaign with no groups in it.
--
--   * THE GROUPS ARE MADE IN THE SAME CALL, keyed by the wizard's own draft ids — strings it
--     invented, because the rows do not exist yet. Each piece names its group by that key.
--   * THE DEPARTMENT IS STAMPED FROM THE GROUP, by `app.tg_deliverable_stamp_department`, not by
--     anything in the writer (ADR-0099 d.3). That is the assertion that proves the group is set in
--     the INSERT itself rather than in a second statement afterwards.
--   * AND SO ARE THE CODE'S LETTERS. `DA-001` for a piece created into "Design & Animation" is the
--     other half of the same proof: `app.tg_deliverable_stamp_code` reads `new.workstream_id`
--     BEFORE INSERT, so a piece grouped after the fact would already be carrying `WS-001` forever
--     (I56.9 — the code never changes).
--   * UNGROUPED IS A NORMAL, PERMANENT STATE (d.1). It keeps a null group and takes its department
--     from its owner, once, exactly as it did before section C existed.
--   * TWO GROUPS WHOSE NAMES DIFFER ONLY IN CASE are refused as a sentence naming the one in the
--     way (d.7). In the wizard this is the ORDINARY case — a person typed "Always-on" into one
--     card and "always-on" into another — and it must not arrive as
--     "duplicate key value violates unique constraint uq_workstreams_campaign_name".
--   * A PAYLOAD WITH NONE OF THE NEW FIELDS BEHAVES EXACTLY AS BEFORE. Every addition is optional,
--     and `create_campaign_from_brief` is still called POSITIONALLY with seven arguments by
--     `supabase/seed.sql` and by pgTAP 102 — the regression guard, and the one that catches an
--     argument added without dropping the old signature ("function is not unique").
begin;
select plan(17);
\ir helpers/seed.sql

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de1520', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 152'),
  ('aaaaaaaa-0000-0000-0000-000000de1521', 'aaaaaaaa-0000-0000-0000-000000000001', 'Content 152');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a170', 'am152@a.test'),
  ('00000000-0000-0000-0000-00000000a171', 'creativelead152@a.test');
-- The owner carries the FIXTURE department, not either of the two above: the ungrouped piece takes
-- its department from them (once, at creation) and the grouped ones must visibly not.
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
values ('00000000-0000-0000-0000-00000000a170', 'aaaaaaaa-0000-0000-0000-000000000001', 'AM 152',
        (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = 'account_manager'),
        'aaaaaaaa-0000-0000-0000-0000000de0ff');
-- ADR-0101 d.8: a workstream's owner is a department lead, team lead or deputy — so the group's
-- owner is Creative's lead, not the AM (who still owns the pieces).
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
values ('00000000-0000-0000-0000-00000000a171', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative lead 152',
        (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = 'department_lead'),
        'aaaaaaaa-0000-0000-0000-000000de1520');
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id = '00000000-0000-0000-0000-00000000a170';

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a170'),true);

-- ==================================================== the whole wizard, in one call ====
-- Two groups, two phases, three pieces: one in the first group, two in the second (ADR-0116, 27 Sep:
-- every piece of a campaign is in a workstream — "one in neither" is now refused, see pgTAP 188). Every piece carries
-- a phaseNumber because the campaign runs in phases and `app.tg_deliverable_phase_guard` holds
-- that invariant both ways (ADR-0096 d.3).
select lives_ok($$
  select public.create_campaign_from_brief(
    'aaaaaaaa-0000-0000-0000-00000000c001', null, 'Season 152',
    '{"languages":["en"],"proposition":"p"}'::jsonb, '2026-10-09T12:00:00Z',
    '[{"name":"Post 2 — the payment-chime carousel","ownerUserId":"00000000-0000-0000-0000-00000000a170",
       "quantity":"1","dueAt":"2026-10-01T15:00:00Z","phaseNumber":"1","priority":"high",
       "workstreamKey":"ws-draft-1","language":"ar",
       "contentIdea":"Everyday purchases become tickets; say where to find them.",
       "notes":"Client wants the Kurdish cut first. Legal have seen the number."},
      {"name":"Teaser cutdown 152","ownerUserId":"00000000-0000-0000-0000-00000000a170",
       "quantity":"1","dueAt":"2026-10-02T15:00:00Z","phaseNumber":"1","workstreamKey":"ws-draft-2"},
      {"name":"Ungrouped explainer 152","ownerUserId":"00000000-0000-0000-0000-00000000a170",
       "quantity":"1","dueAt":"2026-10-08T15:00:00Z","phaseNumber":"2","workstreamKey":"ws-draft-2"}]'::jsonb,
    '00000000-0000-0000-0000-00000000a170', 'campaign',
    '[{"name":"Week 2","startsOn":"2026-09-26","endsOn":"2026-10-02","endsOnEvent":"Draw Night 2"},
      {"name":"Wrap","startsOn":"2026-10-03","endsOn":"2026-10-09"}]'::jsonb,
    '[{"key":"ws-draft-1","name":"Design & Animation","departmentId":"aaaaaaaa-0000-0000-0000-000000de1520",
       "ownerUserId":"00000000-0000-0000-0000-00000000a171"},
      {"key":"ws-draft-2","name":"Short Format · Meridian Squad","departmentId":"aaaaaaaa-0000-0000-0000-000000de1521"}]'::jsonb)
$$, 'a campaign is created with its groups, its phases and its pieces in one call (I56.3)');

-- ================================================================== the groups ====
select results_eq($$
  select w.name, w.department_id, w.owner_user_id
    from workstreams w join campaigns c on c.id = w.campaign_id
   where c.name = 'Season 152' order by w.name
$$, $$ values
  ('Design & Animation',       'aaaaaaaa-0000-0000-0000-000000de1520'::uuid, '00000000-0000-0000-0000-00000000a171'::uuid),
  ('Short Format · Meridian Squad', 'aaaaaaaa-0000-0000-0000-000000de1521'::uuid, null::uuid)
$$, 'each group in the payload became a row, with its department and the owner it was given (d.1/d.3/d.5)');

-- ==================================================== each piece in the right group ====
-- The key is the WIZARD's own draft id — "ws-draft-1", a string it invented — and it is resolved
-- here and never stored. Asserting on the group's NAME rather than an id is the point: if the two
-- keys were mapped to the wrong rows, the departments below would still look plausible.
select results_eq($$
  select d.name, w.name
    from deliverables d
    join streams s on s.id = d.stream_id
    join campaigns c on c.id = s.campaign_id
    left join workstreams w on w.id = d.workstream_id
   where c.name = 'Season 152' order by d.name
$$, $$ values
  ('Post 2 — the payment-chime carousel', 'Design & Animation'),
  ('Teaser cutdown 152',                  'Short Format · Meridian Squad'),
  ('Ungrouped explainer 152',             'Short Format · Meridian Squad')
$$, 'every piece is in the group its key named (ADR-0099 d.1, ADR-0116 d.3)');

-- ADR-0102 (24 Sep) — a deliverable's department is its OWNER's; the group no longer sets it
-- (supersedes ADR-0099 d.3). All three are the account manager's, who sits in the fixture department.
select results_eq($$
  select d.name, d.department_id
    from deliverables d
    join streams s on s.id = d.stream_id
    join campaigns c on c.id = s.campaign_id
   where c.name = 'Season 152' order by d.name
$$, $$ values
  ('Post 2 — the payment-chime carousel', 'aaaaaaaa-0000-0000-0000-0000000de0ff'::uuid),
  ('Teaser cutdown 152',                  'aaaaaaaa-0000-0000-0000-0000000de0ff'::uuid),
  ('Ungrouped explainer 152',             'aaaaaaaa-0000-0000-0000-0000000de0ff'::uuid)
$$, 'every piece takes its OWNER''s department, grouped or not — the group does not set it (ADR-0102 d.1/d.2)');

-- The other half of the same proof, and the one that could never be repaired: the letters of a
-- code come from the workstream at insert, and the code never changes (I56.9).
select results_eq($$
  select d.name, d.code
    from deliverables d
    join streams s on s.id = d.stream_id
    join campaigns c on c.id = s.campaign_id
   where c.name = 'Season 152' order by d.name
$$, $$ values
  ('Post 2 — the payment-chime carousel', 'DA-001'),
  ('Teaser cutdown 152',                  'SF-001'),
  ('Ungrouped explainer 152',             'SF-002')
$$, 'and the code takes its letters from the group it was created into — DA, SF, and SF counts on (I56.9)');

-- ============================================================ the piece's own words ====
select results_eq($$
  select content_idea, notes, languages, priority
    from deliverables where name = 'Post 2 — the payment-chime carousel'
$$, $$ values (
  'Everyday purchases become tickets; say where to find them.',
  'Client wants the Kurdish cut first. Legal have seen the number.',
  array['ar'], 'high')
$$, 'the idea, the notes, the language and the priority all land on the row (I56.7/I56.8)');

select is(
  (select coalesce(content_idea,'') || coalesce(notes,'') || coalesce(priority,'')
     from deliverables where name = 'Teaser cutdown 152'),
  '', 'and a piece that carries none of them is created with all three null — every one is optional');
select is((select languages from deliverables where name = 'Teaser cutdown 152'), array['en'],
  'a piece given no language starts with its campaign''s (ADR-0117 addendum, Q18)');

-- ============================================================== the phase's event ====
select results_eq($$
  select p.name, p.ends_on_event from campaign_phases p
    join campaigns c on c.id = p.campaign_id
   where c.name = 'Season 152' order by p.number
$$, $$ values
  ('Week 2', 'Draw Night 2'),
  ('Wrap',   null::text)
$$, 'a phase ends on the event it was given, and one that simply ends on its date is left alone (I56.10)');

-- ======================================================= two names that are one name ====
-- d.7. Refused as a sentence naming the group in the way — the person has to be able to find it,
-- and "always-on" echoed back tells them nothing. The whole call is refused, so nothing half-built
-- survives: the campaign row itself is rolled back with it.
select throws_ok($$
  select public.create_campaign_from_brief(
    'aaaaaaaa-0000-0000-0000-00000000c001', null, 'Clashing 152',
    '{"languages":["en"]}'::jsonb, null, '[]'::jsonb, '00000000-0000-0000-0000-00000000a170', 'campaign', null,
    '[{"key":"a","name":"Always-on","departmentId":"aaaaaaaa-0000-0000-0000-000000de1520"},
      {"key":"b","name":"always-on","departmentId":"aaaaaaaa-0000-0000-0000-000000de1521"}]'::jsonb)
$$, '23505', 'This campaign already has a workstream called "Always-on".',
  'two groups whose names differ only in case are refused IN WORDS, not as a unique-index violation (d.7)');

select is((select count(*)::int from campaigns where name = 'Clashing 152'), 0,
  'and nothing of that campaign was left behind — the call is one statement or none of it');

-- A group with no department is refused the same way it is on the work screen, in the same
-- sentence: one rule, one wording, wherever a person meets it.
select throws_ok($$
  select public.create_campaign_from_brief(
    'aaaaaaaa-0000-0000-0000-00000000c001', null, 'Departmentless 152',
    '{"languages":["en"]}'::jsonb, null, '[]'::jsonb, '00000000-0000-0000-0000-00000000a170', 'campaign', null,
    '[{"key":"a","name":"No department 152"}]'::jsonb)
$$, '22023', 'A workstream needs a department: it is what decides who can be given the work.',
  'a group with no department is refused as a sentence (d.3), the same one save_workstream uses');

-- A key that names no group is a payload contradicting itself. Dropping the grouping silently
-- would be the cheap answer and the wrong one: the person asked for that piece to be in a group.
select throws_ok($$
  select public.create_campaign_from_brief(
    'aaaaaaaa-0000-0000-0000-00000000c001', null, 'Dangling key 152',
    '{"languages":["en"]}'::jsonb, null,
    '[{"name":"Orphan 152","ownerUserId":"00000000-0000-0000-0000-00000000a170",
       "quantity":"1","workstreamKey":"ws-draft-9"}]'::jsonb,
    '00000000-0000-0000-0000-00000000a170', 'campaign', null,
    '[{"key":"ws-draft-1","name":"Only group 152","departmentId":"aaaaaaaa-0000-0000-0000-000000de1520"}]'::jsonb)
$$, '22023', '"Orphan 152" names a workstream that was not created with this campaign.',
  'a piece naming a group that is not in the payload is refused by name, not quietly ungrouped');

-- ================================================================= the regression guard ====
-- Seven arguments, POSITIONALLY, exactly as pgTAP 102 calls it. This fails with "function is not
-- unique" if an argument is ever added beside the old signature instead of replacing it. Since
-- ADR-0116 (27 Sep) the piece it sends, having no workstream, is refused — which still proves the
-- call resolves to the one function and reaches its body.
select throws_ok($$
  select public.create_campaign_from_brief(
    'aaaaaaaa-0000-0000-0000-00000000c001', null, 'As it was 152',
    '{"languages":["en"],"proposition":"p"}'::jsonb, '2026-10-09T12:00:00Z',
    '[{"name":"Plain piece 152","ownerUserId":"00000000-0000-0000-0000-00000000a170",
       "quantity":"2","dueAt":"2026-10-05T15:00:00Z","channel":"instagram","format":"reel"}]'::jsonb,
    '00000000-0000-0000-0000-00000000a170')
$$, '22023', 'Every piece of a campaign goes in a workstream: "Plain piece 152" is in none.',
  'called positionally with seven arguments, it resolves — and refuses a piece with no workstream (ADR-0116)');

select lives_ok($$
  select public.create_campaign_from_brief(
    'aaaaaaaa-0000-0000-0000-00000000c001', null, 'As it was 152',
    '{"languages":["en"],"proposition":"p"}'::jsonb, '2026-10-09T12:00:00Z',
    '[{"name":"Plain piece 152","ownerUserId":"00000000-0000-0000-0000-00000000a170",
       "quantity":"2","dueAt":"2026-10-05T15:00:00Z","channel":"instagram","format":"reel","workstreamKey":"g"}]'::jsonb,
    '00000000-0000-0000-0000-00000000a170',
    p_workstreams => '[{"key":"g","name":"Plain group","departmentId":"aaaaaaaa-0000-0000-0000-000000de1520"}]'::jsonb)
$$, 'the same piece in a workstream goes through, with none of the other new fields');

select results_eq($$
  select d.quantity, d.channel, d.format, w.name, d.content_idea, d.notes, d.languages, d.priority,
         d.department_id, d.code, d.phase_id
    from deliverables d left join workstreams w on w.id = d.workstream_id where d.name = 'Plain piece 152'
$$, $$ values (
  2, 'instagram', 'reel', 'Plain group', null::text, null::text, array['en'], null::text,
  'aaaaaaaa-0000-0000-0000-0000000de0ff'::uuid, 'PG-001', null::uuid)
$$, 'and writes what it always wrote: no new words, the owner''s department, the group''s letters');

select is(
  (select c.has_phases from campaigns c where c.name = 'As it was 152'),
  false, 'a campaign created with no phases runs without them (ADR-0096, ADR-0116 d.1)');

select * from finish();
rollback;
