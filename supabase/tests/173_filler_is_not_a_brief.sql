-- I59.27 / ADR-0111 — filler is not a brief: the rule (the SAME cases as src/lib/brief/filler.test.ts),
-- the refusal at a single job's release and at a campaign's approval with the field and its text named,
-- real text passing, and the tenant's own words (RLS, cross-tenant).
begin;
select plan(29);
\ir helpers/seed.sql
select app.seed_tenant_brief_templates(id) from tenants;

-- ---------------------------------------------------------------- the rule (keep in step with filler.test.ts) ----
select is(
  (select array_agg(t order by t) from unnest(array[
     'XYZ', 'xyz', 'TBD', 'tbd.', 'TBC', 'TBA', 'lorem ipsum', 'Lorem Ipsum',
     '…', '...', '-', 'x', 'X', 'test', 'TEST', 'aaaa', '????', 'XYZ 123', 'TBD - TBC',
     'XYZ ٢٠٢٦']) t
    where not app.is_filler_with(t, '{}')),
  null, 'every filler case is filler (built-ins, digits beside them, one repeated character, punctuation only)');
select is(
  (select array_agg(t order by t) from unnest(array[
     'Test the new pack shot', '1080x1920', 'Launch the summer offer to students', 'N/A for print, 30s for TikTok', 'N/A', 'n/a', 'NA', '123', '  42  ', '30', '٢٠٢٦',
     'Crescent Bank logo lock-up', 'اطلاق العرض الصيفي']) t
    where app.is_filler_with(t, '{}')),
  null, 'every real case passes');
select ok(not app.is_filler_with('', '{}') and not app.is_filler_with('   ', '{}') and not app.is_filler_with(null, '{}'),
  'blank is not filler — it is its own refusal');
select ok(app.is_filler_with('placeholder', array['Placeholder']), 'a tenant word is filler');
select ok(app.is_filler_with('placeholder 2', array['placeholder']), 'a tenant word with digits is filler');
select ok(app.is_filler_with('coming soon', array['Coming soon']), 'a tenant phrase matches the whole text');
select ok(not app.is_filler_with('coming', array['coming soon']), 'part of a phrase is not filler');
select ok(not app.is_filler_with('placeholder', '{}'), 'without the tenant''s word it is real text');

-- ---------------------------------------------------------------- the fixture ----
-- A single job with its brief (template single_execution: "The Task" is its required field) and a
-- campaign with its proposition, both waiting for approval.
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id, proposition) values
  ('aaaaaaaa-0000-0000-0000-0000000c1731', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'Job 173', 'pending_approval', 'single_job', '00000000-0000-0000-0000-00000000a001', null),
  ('aaaaaaaa-0000-0000-0000-0000000c1732', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'Season 173', 'pending_approval', 'campaign', '00000000-0000-0000-0000-00000000a001', 'TBD');
insert into campaign_briefs (tenant_id, campaign_id, department_id, brief_type, "values") values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000c1731', 'aaaaaaaa-0000-0000-0000-0000000de0ff',
   'single_execution', '{"task": "XYZ 123", "restrictions": "TBD"}');

create temp table caught (detail text, hint text);
grant all on caught to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

-- ---------------------------------------------------------------- the release refuses ----
select throws_ok($$ select public.approve_campaign('aaaaaaaa-0000-0000-0000-0000000c1731') $$,
  '22023', 'The Task still says ''XYZ 123'' — write the real task.',
  'releasing a single job whose Task says "XYZ 123" is refused, the field and the text named (d.2)');
select is((select status from campaigns where id = 'aaaaaaaa-0000-0000-0000-0000000c1731'), 'pending_approval',
  'and the job is not released');
-- The screen reads the field from DETAIL to say it in Arabic.
do $$
begin
  perform public.approve_campaign('aaaaaaaa-0000-0000-0000-0000000c1731');
exception when others then
  declare d text; h text;
  begin
    get stacked diagnostics d = pg_exception_detail, h = pg_exception_hint;
    insert into caught values (d, h);
  end;
end $$;
select is((select hint from caught), 'brief_filler', 'the refusal is hinted brief_filler');
select is((select detail::jsonb from caught), '{"field": "task", "label": "The Task", "text": "XYZ 123"}'::jsonb,
  'and carries the field, its label and its text');

reset role;
update campaign_briefs set "values" = '{"task": "Resize the Ramadan KV for the metro screens", "restrictions": "TBD"}'
 where campaign_id = 'aaaaaaaa-0000-0000-0000-0000000c1731';
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
-- I59 E10 (ADR-0111 addendum, 25 Sep): EVERY field with text is checked — an optional one saying TBD
-- is refused too; left blank it is allowed.
select throws_ok($$ select public.approve_campaign('aaaaaaaa-0000-0000-0000-0000000c1731') $$,
  '22023', 'Restrictions still says ''TBD'' — write the real restrictions.',
  'E10: real words in the required field, but an optional field saying TBD — refused, named');
reset role;
-- `inheritedRules` is stored by the system as the text "[]" — not a field of the template, so not a brief
-- field a person wrote (20260926151000). Before that fix every single-job release was refused on it.
update campaign_briefs set "values" = '{"task": "Resize the Ramadan KV for the metro screens", "restrictions": "", "inheritedRules": "[]"}'
 where campaign_id = 'aaaaaaaa-0000-0000-0000-0000000c1731';
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select lives_ok($$ select public.approve_campaign('aaaaaaaa-0000-0000-0000-0000000c1731') $$,
  'E10: the optional field left blank, and a stored value that is not a template field — released');
select is((select status from campaigns where id = 'aaaaaaaa-0000-0000-0000-0000000c1731'), 'approved', 'the job is released');

-- ---------------------------------------------------------------- campaign approval refuses ----
select throws_ok($$ select public.approve_campaign('aaaaaaaa-0000-0000-0000-0000000c1732') $$,
  '22023', 'The proposition still says ''TBD'' — write the real proposition.',
  'approving a campaign whose proposition says TBD is refused, named');
reset role;
update campaigns set proposition = '' where id = 'aaaaaaaa-0000-0000-0000-0000000c1732';
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
-- (A blank proposition is the wizard's refusal, unchanged; the database gate is about filler only.)

-- ---------------------------------------------------------------- the tenant's words ----
insert into tenant_filler_words (tenant_id, word) values ('aaaaaaaa-0000-0000-0000-000000000001', 'placeholder');
select is((select created_by from tenant_filler_words where word = 'placeholder'),
  '00000000-0000-0000-0000-00000000a001'::uuid, 'an admin adds a word, attributed');
select throws_ok($$ insert into tenant_filler_words (tenant_id, word) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Soon ') $$,
  '23514', null, 'a word is stored lower-case and trimmed');
select ok(app.is_filler('Placeholder'), 'the caller''s tenant''s word counts in app.is_filler');
reset role;
update campaigns set proposition = 'placeholder' where id = 'aaaaaaaa-0000-0000-0000-0000000c1732';
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select throws_ok($$ select public.approve_campaign('aaaaaaaa-0000-0000-0000-0000000c1732') $$,
  '22023', 'The proposition still says ''placeholder'' — write the real proposition.',
  'the tenant''s own word is refused at approval too');

-- A team member reads the list and cannot change it.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select is((select count(*)::int from tenant_filler_words), 1, 'a team member reads the tenant''s words');
select throws_ok($$ insert into tenant_filler_words (tenant_id, word) values ('aaaaaaaa-0000-0000-0000-000000000001', 'later') $$,
  '42501', null, 'and cannot add one');
delete from tenant_filler_words;
select is((select count(*)::int from tenant_filler_words), 1, 'nor remove one');

-- Tenant B sees none of Tenant A's words, writes none into A, and A's word is not filler in B.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000b001'), true);
select is((select count(*)::int from tenant_filler_words), 0, 'Tenant B reads none of Tenant A''s words');
select throws_ok($$ insert into tenant_filler_words (tenant_id, word) values ('aaaaaaaa-0000-0000-0000-000000000001', 'later') $$,
  '42501', null, 'nor writes into Tenant A');
select ok(not app.is_filler('placeholder'), 'Tenant A''s word is real text in Tenant B');

-- The built-ins cannot be removed: they are not rows.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
delete from tenant_filler_words;
select is((select count(*)::int from tenant_filler_words), 0, 'an admin removes the tenant''s own word');
select ok(app.is_filler('TBD'), 'and TBD is still filler — the built-ins are not removable');
select ok(not app.is_filler('placeholder'), 'while the removed word is real text again');
reset role;

select * from finish();
rollback;
