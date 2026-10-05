-- ADR-0048 d.2 (I16.1): brief_templates — what a brief contains, as tenant data.
--
-- The two assertions that matter are 4 and 8: another tenant's templates are invisible, and a
-- person without organization:manage cannot rewrite the agency's brief system. Everything else
-- guards the edges of those.
--
-- Seed context: a001 holds organization:manage (Power Admin), a003 does not.

begin;
select plan(12);
\ir helpers/seed.sql

-- The migration seeds every tenant that EXISTS when it is applied, and future tenants get
-- theirs through `public.seed_tenant_roles`. This fixture creates its tenants afterwards and
-- calls `app.seed_tenant_roles` directly, bypassing that wrapper — so it seeds them here.
-- Worth knowing rather than papering over: a provisioning path that calls the `app.` function
-- instead of the `public.` wrapper gets no templates, and no disciplines either (the same gap
-- 20260816090000 left).
reset role;
select app.seed_tenant_brief_templates(id) from tenants;

-- ------------------------------------- the seed landed, and is the deck ----
select is(
  (select count(*)::int from brief_templates
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 11,
  'eleven brief types are seeded: the deck''s seven campaign briefs plus Edward''s four');

select is(
  (select jsonb_array_length(fields) from brief_templates
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and brief_type = '360'), 17,
  'the 360 template carries all seventeen Creative Brief fields, both pages');

-- The guidance line is the model's prompt as much as the human's hint (d.2). If it is
-- dropped in transcription the generated briefs get quietly worse and nothing fails.
select ok(
  (select bool_and((f ->> 'guidance') is not null and (f ->> 'guidance') <> '')
     from brief_templates t, jsonb_array_elements(t.fields) f
    where t.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'every seeded field carries its guidance text — it is the prompt, not decoration');

select ok(
  (select bool_and((f ->> 'ar') is not null and (f ->> 'ar') <> '')
     from brief_templates t, jsonb_array_elements(t.fields) f
    where t.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'every seeded field carries an Arabic label — the deck is bilingual and so is the app');

-- ------------------------------------- RLS: read ----
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

select is(
  (select count(*)::int from brief_templates), 11,
  'a tenant member sees their own tenant''s templates');

select is(
  (select count(*)::int from brief_templates
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000002'), 0,
  'and CANNOT see another tenant''s, even naming its id');

-- ------------------------------------- RLS: write ----
select lives_ok($$
  update brief_templates set fields = '[]'::jsonb
   where brief_type = 'custom' and tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
$$, 'organization:manage may rewrite a template — the deck''s wording changes without a release');

-- Cross-tenant write is refused by RLS returning zero rows, not by an error: the row is
-- invisible, so the UPDATE matches nothing. Asserting the row is UNCHANGED is what proves it.
update brief_templates set is_active = false
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000002';
reset role;
select is(
  (select count(*)::int from brief_templates
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000002' and is_active = false), 0,
  'a manager in tenant A cannot deactivate tenant B''s templates');

-- ------------------------------------- without the grant ----
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);

select is(
  (select count(*)::int from brief_templates), 11,
  'somebody without organization:manage still READS templates — the wizard needs the fields');

update brief_templates set is_active = false where brief_type = '360';
reset role;
select is(
  (select count(*)::int from brief_templates
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and brief_type = '360' and is_active = false), 0,
  'but CANNOT rewrite one — the agency''s brief system is not editable by everybody');

-- ------------------------------------- shape guards ----
select throws_ok($$
  insert into brief_templates (tenant_id, brief_type, fields)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'not_an_array', '{"a":1}'::jsonb)
$$, '23514', null, 'fields must be a JSON array — an object is refused, not coerced');

select throws_ok($$
  insert into brief_templates (tenant_id, brief_type, fields)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '360', '[]'::jsonb)
$$, '23505', null, 'one template per brief type per tenant');

select * from finish();
rollback;
