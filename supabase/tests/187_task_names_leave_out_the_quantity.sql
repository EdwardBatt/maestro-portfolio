-- 20260927140000 (I57.48) — no " ×N" count in a task's title; the deliverable keeps its own name; unit numbers stay.
-- Since 4 Oct (ADR-0071 addendum, I74.39) a title names the campaign and type, not the deliverable — so the count
-- cannot reach it, and a rename changes nothing.
begin;
select plan(8);
\ir helpers/seed.sql

insert into workflow_templates (id, tenant_id, code, name_en, is_system) values
  ('aaaaaaaa-0000-0000-0000-000000187f01','aaaaaaaa-0000-0000-0000-000000000001', 'WF-187','Test 187', false);
insert into workflow_steps (id, tenant_id, template_id, sort_order, title_en, repeats_per_unit) values
  ('aaaaaaaa-0000-0000-0000-000000187a01','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000187f01', 1, 'Creative Direction', false),
  ('aaaaaaaa-0000-0000-0000-000000187a02','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000187f01', 2, 'Create Artwork', true);
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000187501','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','S187');
insert into deliverables (id, tenant_id, stream_id, name, quantity, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-000000187d01','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000187501','Static Post ×3', 3, '00000000-0000-0000-0000-00000000a001');

select is(app.task_segment('Static Post ×3'), 'Static Post', 'the count comes off: Static Post ×3 -> Static Post');
select is(app.task_segment('Static Post'), 'Static Post', 'a name with no count is unchanged');

select is(app.materialise_deliverable_workflow(
  'aaaaaaaa-0000-0000-0000-000000187d01','aaaaaaaa-0000-0000-0000-000000187f01'), 4, 'one direction task and three artwork units');

select is((select title from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-000000187d01'
            and workflow_step_id = 'aaaaaaaa-0000-0000-0000-000000187a01'),
  'Creative Direction — Ramadan 2027', 'created: "<step> — <campaign>", no deliverable name and so no count');

select is((select title from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-000000187d01'
            and workflow_step_id = 'aaaaaaaa-0000-0000-0000-000000187a02' and unit_index = 2),
  'Create Artwork — Ramadan 2027 · 2', 'a unit keeps its number (no type here: the number alone)');

select is((select name from deliverables where id = 'aaaaaaaa-0000-0000-0000-000000187d01'),
  'Static Post ×3', 'the deliverable itself keeps its name, count and all');

-- A task a person wrote, reading like an old title: a rename no longer touches it.
insert into sub_tasks (id, tenant_id, deliverable_id, title, status) values
  ('aaaaaaaa-0000-0000-0000-000000187e01','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000187d01','Write Copy — Static Post ×3','todo');
update deliverables set name = 'Story Frame ×4' where id = 'aaaaaaaa-0000-0000-0000-000000187d01';

select is((select title from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-000000187e01'),
  'Write Copy — Static Post ×3', 'a rename leaves a person''s own title alone');
select is((select title from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-000000187d01'
            and workflow_step_id = 'aaaaaaaa-0000-0000-0000-000000187a02' and unit_index = 2),
  'Create Artwork — Ramadan 2027 · 2', 'and a generated title does not change on a rename either');

select * from finish();
rollback;
