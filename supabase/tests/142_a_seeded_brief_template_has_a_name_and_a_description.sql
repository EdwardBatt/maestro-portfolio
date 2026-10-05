-- SJ-v3-01 (22 Sep) — a tenant provisioned through the wrapper gets NAMED templates with a
-- one-line description, and a tenant's own wording survives every re-run.
--
-- The gap this guards: `seed_tenant_brief_templates` inserted only fields, so every tenant seeded
-- after 30 Aug showed `social_calendar` where "Social Media Brief" belonged (the API's fallback to
-- the key hid it). A fresh tenant is provisioned exactly as production does it and each of the
-- twelve seeded keys is checked for a name in both languages and a description.
begin;
select plan(8);
\ir helpers/seed.sql

insert into tenants (id, name, slug) values
  ('cccccccc-0000-0000-0000-000000000142', 'Fresh Tenant 142', 'fresh-142');
select lives_ok($$ select public.seed_tenant_roles('cccccccc-0000-0000-0000-000000000142') $$,
  'the public wrapper provisions a fresh tenant');

select is(
  (select count(*)::int from brief_templates where tenant_id = 'cccccccc-0000-0000-0000-000000000142'), 12,
  'twelve seeded templates: the deck''s seven, Edward''s four, and the Digital Build brief');

select is_empty($$
  select brief_type from brief_templates
   where tenant_id = 'cccccccc-0000-0000-0000-000000000142'
     and (name_en is null or name_ar is null or description_en is null or description_ar is null)
$$, 'every seeded template has a name in both languages and a description in both');

select is(
  (select name_en from brief_templates
    where tenant_id = 'cccccccc-0000-0000-0000-000000000142' and brief_type = 'social_calendar'),
  'Social Media Brief',
  'the name is the deck''s title, not the key');

select is(
  (select description_en from brief_templates
    where tenant_id = 'cccccccc-0000-0000-0000-000000000142' and brief_type = 'single_execution'),
  'One asset, already agreed. Just say what you need.',
  'the description is the Figma''s line');

-- A tenant's own wording is never overwritten: rename one, add a description of their own,
-- re-run the seed, and both survive.
update brief_templates
   set name_en = 'Our Social Brief', description_en = 'What we call it here.'
 where tenant_id = 'cccccccc-0000-0000-0000-000000000142' and brief_type = 'social_calendar';
select lives_ok($$ select app.seed_tenant_brief_template_names('cccccccc-0000-0000-0000-000000000142') $$,
  'the name seed re-runs');
select results_eq($$
  select name_en, description_en from brief_templates
   where tenant_id = 'cccccccc-0000-0000-0000-000000000142' and brief_type = 'social_calendar'
$$, $$ values ('Our Social Brief', 'What we call it here.') $$,
  'a tenant''s own name and description survive a re-run');

-- The seed fills the HOLES only: a row missing one half keeps the other half it had.
update brief_templates set name_ar = null
 where tenant_id = 'cccccccc-0000-0000-0000-000000000142' and brief_type = 'social_calendar';
select app.seed_tenant_brief_template_names('cccccccc-0000-0000-0000-000000000142');
select results_eq($$
  select name_en, name_ar from brief_templates
   where tenant_id = 'cccccccc-0000-0000-0000-000000000142' and brief_type = 'social_calendar'
$$, $$ values ('Our Social Brief', 'بريف السوشيال ميديا') $$,
  'a missing Arabic name is filled without touching the English one the tenant chose');

select * from finish();
rollback;
