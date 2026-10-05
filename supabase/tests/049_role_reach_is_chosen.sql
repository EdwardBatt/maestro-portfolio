-- ADR-0041 (L6.12): a role's reach is chosen, never defaulted.
--
-- The assertion that matters is the first: a role created WITHOUT naming a reach comes out 'self',
-- not 'tenant'. That single default is what produced the `cco` role in Edward's tenant — created
-- through the Roles screen, which never asked, and handed company-wide reach by the column default.
--
-- The rest fence the decision either side of it: the five permitted values are unchanged (this is a
-- default change, not a new concept), a system role's reach cannot be moved at all (d.4), an
-- ordinary role's can (the whole point — Edward has to be able to correct `cco`), and the migration
-- left every existing row exactly as it found it (d.7 — no silent re-scoping).
--
-- Subject: a001 = power_admin (holds roles:manage). Role writes go through the authenticated admin
-- path because app.protect_system_roles fences them; a superuser insert would bypass the trigger
-- under test.

begin;
select plan(11);
\ir helpers/seed.sql

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

-- ------------------------------------------------- born narrow, not wide ----
-- The defect, directly: say nothing about reach and you used to get the whole organisation.
insert into roles (tenant_id, key, name, description, default_route)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'coordinator49', 'Coordinator 49',
        'created without naming a reach', '/my-work');

select is(
  (select scope from roles where key = 'coordinator49'),
  'self',
  'a role created without naming a reach is SELF — the narrowest, not the widest (ADR-0041 d.2)');

select is(
  (select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'roles' and column_name = 'scope'),
  '''self''::text',
  'and the column default itself is self, so a console insert or a script is safe too');

-- ------------------------------------------------ the five values stand ----
-- This is a default change, not a new concept: every value ADR-0009 defined still works, and
-- nothing outside the set does.
select lives_ok(
  $$update roles set scope = 'department' where key = 'coordinator49'$$,
  'an ordinary role''s reach can be set to department …');
select lives_ok(
  $$update roles set scope = 'account' where key = 'coordinator49'$$,
  '… to account …');
select lives_ok(
  $$update roles set scope = 'tenant' where key = 'coordinator49'$$,
  '… and widened to the whole organisation, deliberately (this is how cco gets corrected)');
select throws_ok(
  $$update roles set scope = 'everything' where key = 'coordinator49'$$,
  '23514', null,
  'an unknown reach is still refused by roles_scope_check');

-- --------------------------------------- a system role's reach is fixed ----
-- ADR-0041 d.4. The screen disables the field; Postgres is the boundary (AGENTS.md §2).
select throws_ok(
  $$update roles set scope = 'department'
     where key = 'power_admin' and tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '42501', null,
  'Power Admin cannot be narrowed — a system role''s reach is immutable');
select throws_ok(
  $$update roles set scope = 'tenant'
     where key = 'client_portal' and tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '42501', null,
  'and Client Portal cannot be widened — the external role stays fenced to self');

select is(
  (select scope from roles where key = 'power_admin'
    and tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'tenant',
  'Power Admin is still tenant-wide after the refusal');

-- The pre-existing fences are untouched by the reproduction in this migration.
select throws_ok(
  $$update roles set key = 'renamed49' where key = 'coordinator49'$$,
  null, null,
  'role keys are still immutable — the rest of protect_system_roles survived the rewrite');

-- ------------------------------------------- no live role was re-scoped ----
-- ADR-0041 d.7: the migration changed a default, not any data. Every seeded role still carries the
-- reach ADR-0009 assigned it.
select is(
  (select count(*)::int from roles
   where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and (key, scope) not in (
       ('power_admin','tenant'), ('client_portal','self'), ('scheduler','tenant'),
       ('account_manager','account'), ('department_lead','department'),
       ('team_lead','team'), ('deputy_team_lead','team'), ('team_member','self'),
       ('ceo','tenant'), ('coo','tenant'), ('cfo','tenant'), ('coordinator49','tenant'))),
  0,
  'every seeded role still holds the reach ADR-0009 gave it — nothing was silently re-scoped');

select * from finish();
rollback;
