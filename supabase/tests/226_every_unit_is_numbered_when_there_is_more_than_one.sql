-- I74.33, on the 4 Oct rule (ADR-0071 addendum, I74.39) — with more than one unit every per-unit task is numbered,
-- unit 1 included; with one, none is. "<step> — <campaign> · <type>[ <n>]"; a once-only task has no number.
begin;
select plan(5);
\ir helpers/seed.sql

insert into workflow_templates (id, tenant_id, code, name_en, is_system) values
  ('aaaaaaaa-0000-0000-0000-0000000226b1', 'aaaaaaaa-0000-0000-0000-000000000001', 'W226', 'Static 226', false);
insert into workflow_steps (id, tenant_id, template_id, sort_order, title_en, repeats_per_unit) values
  ('aaaaaaaa-0000-0000-0000-0000000226c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000226b1', 1, 'Write Copy', false),
  ('aaaaaaaa-0000-0000-0000-0000000226c2', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000226b1', 2, 'Create Content', true);
insert into deliverable_categories (tenant_id, code, name_en) values ('aaaaaaaa-0000-0000-0000-000000000001', 'T226', 'Category 226');
insert into deliverable_types (id, tenant_id, code, category_code, name_en, default_workflow_template_id) values
  ('aaaaaaaa-0000-0000-0000-0000000226a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'T226-1', 'T226', 'Static Post',
   'aaaaaaaa-0000-0000-0000-0000000226b1');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000f2260', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000e001', 'S226');
-- (the deliverable's own rules are not what this file tests)
set local session_replication_role = replica;
insert into deliverables (id, tenant_id, stream_id, name, deliverable_type_id, quantity, due_at) values
  ('aaaaaaaa-0000-0000-0000-0000000d2260', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000f2260',
   'Harbor Line Static Posts', 'aaaaaaaa-0000-0000-0000-0000000226a1', 1, now() + interval '20 days');
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, unit_index, workflow_step_id) values
  ('aaaaaaaa-0000-0000-0000-0000000a2262', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d2260', 'Our own name', 'todo', 2,
   'aaaaaaaa-0000-0000-0000-0000000226c2');
set local session_replication_role = origin;
select app.materialise_deliverable_workflow('aaaaaaaa-0000-0000-0000-0000000d2260');
create temp table u1 as
  select id from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2260'
                             and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000226c2' and unit_index = 1;

update deliverables set quantity = 4 where id = 'aaaaaaaa-0000-0000-0000-0000000d2260';
select is((select title from sub_tasks where id = (select id from u1)), 'Create Content — Ramadan 2027 · Static Post 1',
  'raised above one unit: unit 1 gains its number');
select is((select title from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2260' and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000226c1'),
  'Write Copy — Ramadan 2027', 'a once-only task gets no number');
select is((select title from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a2262'), 'Our own name',
  'a hand-named task is left alone');

update deliverables set quantity = 1 where id = 'aaaaaaaa-0000-0000-0000-0000000d2260';
select is((select title from sub_tasks where id = (select id from u1)), 'Create Content — Ramadan 2027 · Static Post',
  'back to one unit: the number goes');

update deliverables set quantity = 2 where id = 'aaaaaaaa-0000-0000-0000-0000000d2260';
select is((select title from sub_tasks where id = (select id from u1)), 'Create Content — Ramadan 2027 · Static Post 1',
  'and comes back when there are two again');

select * from finish();
rollback;
