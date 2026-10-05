-- I22.5 (ADR-0055 d.10, Edward 28 Aug) — an internal project is a project with an internal client,
-- so its deliverables carry owners like any other project's.
--
-- `public.create_internal_project` predates `deliverables.owner_user_id` by eight days and was
-- never revisited, so every internal-project deliverable was created ownerless — and therefore
-- department-less, and unlabelled once ADR-0053 made the department the label.

begin;
select plan(6);
\ir helpers/seed.sql

reset role;

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000063d1','aaaaaaaa-0000-0000-0000-000000000001','Studio');
update user_profiles set department_id = 'aaaaaaaa-0000-0000-0000-0000000063d1'
 where id = '00000000-0000-0000-0000-00000000a003';

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

-- ============================================================ 1. the PM is required ====
select throws_ok(
  $$select public.create_internal_project('tenant', 'No PM project', null, null, null,
      '[{"name":"Deck"}]'::jsonb)$$,
  '22023', null,
  'an internal project without a project manager is refused — its deliverables would be ownerless');

-- ================================================== 2-4. the PM becomes the owner ====
select lives_ok(
  $$select public.create_internal_project('tenant', 'Brand refresh', null, null,
      '00000000-0000-0000-0000-00000000a003', '[{"name":"Deck"},{"name":"Toolkit"}]'::jsonb)$$,
  'with a PM it is created');

select is(
  (select count(*)::int from deliverables d
     join jobs j on j.id = d.job_id
    where j.name = 'Brand refresh' and d.owner_user_id = '00000000-0000-0000-0000-00000000a003'),
  2, 'every deliverable takes the PM as its owner');

select is(
  (select distinct d.department_id from deliverables d
     join jobs j on j.id = d.job_id where j.name = 'Brand refresh'),
  'aaaaaaaa-0000-0000-0000-0000000063d1'::uuid,
  'and its department is DERIVED from that person, never passed (ADR-0050 d.2)');

-- ============================================== 5. a row may name its own owner ====
select lives_ok(
  $$select public.create_internal_project('tenant', 'Mixed ownership', null, null,
      '00000000-0000-0000-0000-00000000a003',
      '[{"name":"Deck"},{"name":"Film","ownerUserId":"00000000-0000-0000-0000-00000000a002"}]'::jsonb)$$,
  'a deliverable row may name an owner other than the PM');

select is(
  (select d.owner_user_id from deliverables d
     join jobs j on j.id = d.job_id
    where j.name = 'Mixed ownership' and d.name = 'Film'),
  '00000000-0000-0000-0000-00000000a002'::uuid,
  'and that row keeps its own owner while the rest default to the PM');

select finish();
rollback;
