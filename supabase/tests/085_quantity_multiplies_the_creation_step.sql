-- I38.8 / I38.12 (ADR-0071 d.8, d.9, d.10, d.12) — quantity produces work, and existing work is
-- byte-identical across the change.
--
-- The materialiser has had NO pgTAP coverage since it was written on 28 August. That is why the
-- gap this suite closes went unnoticed for a week: ADR-0058 d.9 and ADR-0052 both state the rule,
-- and nothing anywhere asserted it.
--
-- Two halves, and the second matters more on a live site than the first:
--
--   1..6  the new behaviour — a repeating step makes `quantity` tasks, everything else makes one,
--         units are numbered and named, and re-running changes nothing.
--   7..9  the SAFETY property (d.12): a deliverable that already has tasks is never touched, no
--         matter what happens to its template afterwards. This is what protects the two live
--         campaigns, one of them approved.

begin;
select plan(11);
\ir helpers/seed.sql

-- ---------------------------------------------------------------- fixtures ----
-- A template with one repeating step among three, which is the ordinary shape: direct, then write,
-- then create N.
insert into workflow_templates (id, tenant_id, code, name_en, is_system) values
  ('aaaaaaaa-0000-0000-0000-000000038f01','aaaaaaaa-0000-0000-0000-000000000001',
   'WF-TEST','Test Social', false);

insert into workflow_steps (id, tenant_id, template_id, sort_order, title_en, repeats_per_unit) values
  ('aaaaaaaa-0000-0000-0000-000000038a01','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000038f01', 1, 'Creative Direction', false),
  ('aaaaaaaa-0000-0000-0000-000000038a02','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000038f01', 2, 'Write Copy', false),
  ('aaaaaaaa-0000-0000-0000-000000038a03','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000038f01', 3, 'Create Content', true);

-- A stream and a deliverable of quantity 6 — Edward's own example, six reels.
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000038501','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','Social');
insert into deliverables (id, tenant_id, stream_id, name, quantity, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-000000038d01','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000038501','Instagram Reel', 6,
   '00000000-0000-0000-0000-00000000a001');

-- ---------------------------------------------------------------- the rule ----
select is(
  app.materialise_deliverable_workflow(
    'aaaaaaaa-0000-0000-0000-000000038d01','aaaaaaaa-0000-0000-0000-000000038f01'),
  8,
  'quantity 6 over a 3-step template makes 8 tasks: 1 + 1 + 6, not 3 and not 18');

select is(
  (select count(*)::int from sub_tasks
    where deliverable_id = 'aaaaaaaa-0000-0000-0000-000000038d01'
      and workflow_step_id = 'aaaaaaaa-0000-0000-0000-000000038a03'),
  6,
  'the repeating step carries six tasks — the rule ADR-0058 d.9 stated and nothing implemented');

select is(
  (select count(*)::int from sub_tasks
    where deliverable_id = 'aaaaaaaa-0000-0000-0000-000000038d01'
      and workflow_step_id = 'aaaaaaaa-0000-0000-0000-000000038a02'),
  1,
  'a NON-repeating step still carries exactly one task however large the quantity');

select is(
  (select array_agg(unit_index order by unit_index) from sub_tasks
    where deliverable_id = 'aaaaaaaa-0000-0000-0000-000000038d01'
      and workflow_step_id = 'aaaaaaaa-0000-0000-0000-000000038a03'),
  array[1,2,3,4,5,6],
  'the six are numbered 1..6, so they can be told apart and re-running can find them');

select is(
  (select unit_index from sub_tasks
    where deliverable_id = 'aaaaaaaa-0000-0000-0000-000000038d01'
      and workflow_step_id = 'aaaaaaaa-0000-0000-0000-000000038a01'),
  null,
  'a task from a non-repeating step carries NO unit number');

-- ADR-0071 d.10. Edward, 5 Sep: "descriptive appropriate names for the deliverables".
select is(
  (select title from sub_tasks
    where deliverable_id = 'aaaaaaaa-0000-0000-0000-000000038d01'
      and workflow_step_id = 'aaaaaaaa-0000-0000-0000-000000038a03'
      and unit_index = 3),
  'Create Content — Ramadan 2027 · 3',
  'the title is composed from step, campaign and unit number (ADR-0071 addendum, 4 Oct: no type here, the number alone)');

-- ---------------------------------------------------------------- idempotence ----
select is(
  app.materialise_deliverable_workflow(
    'aaaaaaaa-0000-0000-0000-000000038d01','aaaaaaaa-0000-0000-0000-000000038f01'),
  0,
  're-running creates nothing — idempotent on (deliverable, step, unit)');

-- The index, not the function, is what makes that true for a caller that goes round the
-- materialiser. ADR-0052 d.4 specified it and it was never created; this is the assertion that
-- would have caught that.
select throws_ok($$
  insert into sub_tasks (tenant_id, deliverable_id, title, status, workflow_step_id, unit_index)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000038d01',
          'dupe','todo','aaaaaaaa-0000-0000-0000-000000038a03', 3)
$$, '23505',
  null,
  'a duplicate unit is refused by the DATABASE, not merely skipped by the function');

select throws_ok($$
  insert into sub_tasks (tenant_id, deliverable_id, title, status, workflow_step_id, unit_index)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000038d01',
          'dupe','todo','aaaaaaaa-0000-0000-0000-000000038a01', null)
$$, '23505',
  null,
  'and a duplicate of a NON-repeating step is refused too — the coalesce is what makes NULL '
  'comparable, and without it this is the case that would silently pass');

-- ---------------------------------------------------------------- d.12: nothing existing moves ----
-- The protection for the two live campaigns is not care, it is this: the trigger fires only on a
-- deliverable with NO template tasks, so a template gaining steps later reaches nothing already
-- laid out. Asserted through the real trigger, the way it actually happens in production.
insert into workflow_steps (id, tenant_id, template_id, sort_order, title_en, repeats_per_unit) values
  ('aaaaaaaa-0000-0000-0000-000000038a04','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000038f01', 4, 'Schedule', false);

select is(
  (select count(*)::int from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-000000038d01'),
  8,
  'adding a step to the template afterwards does NOT reach a deliverable already materialised (d.12)');

-- And a rename does not follow through to work already issued: the title was COPIED
-- (ADR-0059 d.3), which is the property the whole rename migration relies on.
update workflow_steps set title_en = 'Renamed After The Fact'
 where id = 'aaaaaaaa-0000-0000-0000-000000038a03';

select is(
  (select title from sub_tasks
    where deliverable_id = 'aaaaaaaa-0000-0000-0000-000000038d01'
      and workflow_step_id = 'aaaaaaaa-0000-0000-0000-000000038a03'
      and unit_index = 3),
  'Create Content — Ramadan 2027 · 3',
  'renaming the step leaves an issued task''s title untouched — copied, never read through');

select * from finish();
rollback;
