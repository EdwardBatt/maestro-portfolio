-- I40.19 — a department's default brief, and the invariant that makes it worth having.
--
-- Edward, 6 Sep: *"before all these changes were made, selecting a campaign was automatic."* It was:
-- `departments.brief_template_id` held one answer per department until `20260830230000` made
-- availability many-to-many so Creative could hold a second brief. This restores the automatic
-- answer as a DEFAULT, and these assertions are the two halves of that:
--
--   * ONE default per department, held by Postgres. Two would make the campaign page choose
--     arbitrarily, which is the thing this exists to remove.
--   * A default may only be one of the department's OWN briefs. Naming a brief the department is
--     not allowed to write would put a template on the campaign page that the generator refuses —
--     the same "the screen promises what the RPC refuses" failure as I40.12.
begin;
select plan(9);
\ir helpers/seed.sql

reset role;
select app.seed_tenant_brief_templates(id) from tenants;

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000de101','aaaaaaaa-0000-0000-0000-000000000001','Creative'),
  ('aaaaaaaa-0000-0000-0000-0000000de102','aaaaaaaa-0000-0000-0000-000000000001','Influencers');

-- Creative may write two briefs; Influencers exactly one. That is the whole shape of the problem:
-- one of them has to be asked and the other never did.
insert into department_brief_templates (tenant_id, department_id, brief_template_id)
select 'aaaaaaaa-0000-0000-0000-000000000001',
       'aaaaaaaa-0000-0000-0000-0000000de101', id
  from brief_templates
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   and brief_type in ('360', 'single_execution');

insert into department_brief_templates (tenant_id, department_id, brief_template_id)
select 'aaaaaaaa-0000-0000-0000-000000000001',
       'aaaaaaaa-0000-0000-0000-0000000de102', id
  from brief_templates
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and brief_type = 'influencer';

-- ---------------------------------------------------------------- the invariant ----
select is(
  (select count(*)::int from department_brief_templates
    where department_id = 'aaaaaaaa-0000-0000-0000-0000000de101' and is_default), 0,
  'a department with a choice starts with no default — guessing one would be inventing an answer');

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

select lives_ok($$
  select public.set_department_default_brief(
    'aaaaaaaa-0000-0000-0000-0000000de101',
    (select id from brief_templates
      where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and brief_type = '360'))
$$, 'organization:manage sets the department''s normal brief');

select is(
  (select bt.brief_type from department_brief_templates d
     join brief_templates bt on bt.id = d.brief_template_id
    where d.department_id = 'aaaaaaaa-0000-0000-0000-0000000de101' and d.is_default),
  '360', 'and it is the one that was named');

-- Switching is the case the partial unique index would break if the two writes were not one
-- transaction: the old default has to go before the new one lands.
select lives_ok($$
  select public.set_department_default_brief(
    'aaaaaaaa-0000-0000-0000-0000000de101',
    (select id from brief_templates
      where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and brief_type = 'single_execution'))
$$, 'switching the default replaces it rather than adding a second');

select is(
  (select count(*)::int from department_brief_templates
    where department_id = 'aaaaaaaa-0000-0000-0000-0000000de101' and is_default), 1,
  'exactly one default, which is what stops the campaign page choosing arbitrarily');

-- Clearing is a real request: a department may go back to being asked.
select lives_ok($$
  select public.set_department_default_brief('aaaaaaaa-0000-0000-0000-0000000de101', null)
$$, 'passing null clears it');

select is(
  (select count(*)::int from department_brief_templates
    where department_id = 'aaaaaaaa-0000-0000-0000-0000000de101' and is_default), 0,
  'and the department is asked again — false everywhere is a legal state, not a broken one');

-- ---------------------------------------------------------------- the two refusals ----
select throws_ok($$
  select public.set_department_default_brief(
    'aaaaaaaa-0000-0000-0000-0000000de101',
    (select id from brief_templates
      where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and brief_type = 'production'))
$$, 'P0002', null,
  'a brief the department may NOT write cannot be its default — the screen must never name one '
  'the generator would refuse');

-- a003 holds no organization:manage. The RPC is `security definer`, so the check is written in it
-- rather than inherited from the table's policy — which is exactly why it needs asserting.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);

select throws_ok($$
  select public.set_department_default_brief(
    'aaaaaaaa-0000-0000-0000-0000000de102',
    (select id from brief_templates
      where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and brief_type = 'influencer'))
$$, '42501', null,
  'without organization:manage it is refused — a definer function inherits no policy');

select * from finish();
rollback;
