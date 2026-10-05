-- I74.31 / I74.37, superseded 4 Oct by the ADR-0071 addendum (I74.39): a task's title names its campaign and type, not
-- the deliverable — so a deliverable's rename changes no generated title (the single unit's task and the translation
-- task included), and a hand-named one is left alone as ever.
begin;
select plan(4);
\ir helpers/seed.sql
select app.seed_tenant_languages('aaaaaaaa-0000-0000-0000-000000000001');

insert into workflow_templates (id, tenant_id, code, name_en, is_system) values
  ('aaaaaaaa-0000-0000-0000-0000000225b1', 'aaaaaaaa-0000-0000-0000-000000000001', 'W225', 'Static 225', false);
insert into workflow_steps (id, tenant_id, template_id, sort_order, title_en, repeats_per_unit) values
  ('aaaaaaaa-0000-0000-0000-0000000225c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000225b1', 1, 'Write Copy', false),
  ('aaaaaaaa-0000-0000-0000-0000000225c2', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000225b1', 2, 'Create Artwork', true);
insert into deliverable_categories (tenant_id, code, name_en) values ('aaaaaaaa-0000-0000-0000-000000000001', 'T225', 'Category 225');
insert into deliverable_types (id, tenant_id, code, category_code, name_en, default_workflow_template_id) values
  ('aaaaaaaa-0000-0000-0000-0000000225a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'T225-1', 'T225', 'Social Advertisement',
   'aaaaaaaa-0000-0000-0000-0000000225b1');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000f2250', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000e001', 'S225');
-- (the deliverable's own rules — owner, department, due date — are not what this file tests)
set local session_replication_role = replica;
insert into deliverables (id, tenant_id, stream_id, name, deliverable_type_id, quantity, languages, due_at) values
  ('aaaaaaaa-0000-0000-0000-0000000d2250', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000f2250',
   'Social Advertisement', 'aaaaaaaa-0000-0000-0000-0000000225a1', 1, array['ar', 'en'], now() + interval '20 days');
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, unit_index) values
  ('aaaaaaaa-0000-0000-0000-0000000a2252', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d2250', 'Something we named ourselves', 'todo', null);
set local session_replication_role = origin;
select app.materialise_deliverable_workflow('aaaaaaaa-0000-0000-0000-0000000d2250');

update deliverables set name = 'Digital banner' where id = 'aaaaaaaa-0000-0000-0000-0000000d2250';

select is((select title from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2250' and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000225c1'),
  'Write Copy — Ramadan 2027', 'a rename leaves a once-only task on its campaign');
select is((select title from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2250' and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000225c2'),
  'Create Artwork — Ramadan 2027 · Social Advertisement', 'and a single unit''s task on its campaign and type');
select is((select title from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2250' and title like 'Translation — %'),
  'Translation — Ramadan 2027 (Arabic, English)', 'and the translation task');
select is((select title from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a2252'), 'Something we named ourselves',
  'a hand-named task is left alone');

select * from finish();
rollback;
