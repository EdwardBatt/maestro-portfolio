-- 20261004170000 (I74.41, test script step 29) — a quantity raised lists its units in order: every unit of a step
-- stands at that step's place on the deliverable's list, not at the template step's number. The translation task,
-- placed after Write Copy, moves every later task down one; the units added later used to take the template's
-- (smaller) number and so came before unit 1 — "Billboard 2, Billboard 3, Billboard 1".
begin;
select plan(6);
\ir helpers/seed.sql
select app.seed_tenant_languages('aaaaaaaa-0000-0000-0000-000000000001');

insert into workflow_templates (id, tenant_id, code, name_en, is_system) values
  ('aaaaaaaa-0000-0000-0000-0000000230b1', 'aaaaaaaa-0000-0000-0000-000000000001', 'W230', 'Print 230', false);
insert into workflow_steps (id, tenant_id, template_id, sort_order, title_en, repeats_per_unit) values
  ('aaaaaaaa-0000-0000-0000-0000000230c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000230b1', 1, 'Creative Direction', false),
  ('aaaaaaaa-0000-0000-0000-0000000230c2', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000230b1', 2, 'Write Copy', false),
  ('aaaaaaaa-0000-0000-0000-0000000230c3', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000230b1', 3, 'Create Artwork', true);
insert into deliverable_categories (tenant_id, code, name_en) values ('aaaaaaaa-0000-0000-0000-000000000001', 'T230', 'Category 230');
insert into deliverable_types (id, tenant_id, code, category_code, name_en, default_workflow_template_id) values
  ('aaaaaaaa-0000-0000-0000-0000000230a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'T230-1', 'T230', 'Billboard', 'aaaaaaaa-0000-0000-0000-0000000230b1');
insert into campaigns (id, tenant_id, client_id, name, status, kind, languages) values
  ('aaaaaaaa-0000-0000-0000-0000000230e1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'Northwind 230', 'approved', 'campaign', array['ar', 'en']);
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000230f1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000230e1', 'Northwind 230');
set local session_replication_role = replica;
insert into deliverables (id, tenant_id, stream_id, name, deliverable_type_id, quantity, languages, due_at) values
  ('aaaaaaaa-0000-0000-0000-0000000230d1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000230f1',
   'Key visual', 'aaaaaaaa-0000-0000-0000-0000000230a1', 1, array['ar', 'en'], now() + interval '20 days');
set local session_replication_role = origin;
select app.materialise_deliverable_workflow('aaaaaaaa-0000-0000-0000-0000000230d1');

create or replace function pg_temp.list_230() returns text[] language sql as $$
  select array_agg(title order by sort_order nulls last, unit_index nulls first, created_at)
    from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000230d1' and status <> 'cancelled'
$$;

select is((select sort_order from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000230d1'
            and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000230c3'), 4,
  'the set-up: the translation task after Write Copy moved the unit to place 4 (its template step is 3)');

select is(app.resize_deliverable_units('aaaaaaaa-0000-0000-0000-0000000230d1', 3, 'test', '{}') ->> 'added', '2',
  'quantity 1 -> 3 adds two units');
select is(pg_temp.list_230(),
  array['Creative Direction — Northwind 230', 'Write Copy — Northwind 230', 'Translation — Northwind 230 (Arabic, English)',
        'Create Artwork — Northwind 230 · Billboard 1', 'Create Artwork — Northwind 230 · Billboard 2',
        'Create Artwork — Northwind 230 · Billboard 3'],
  'the list reads Billboard 1, 2, 3 — in order, after the translation task');
select is((select array_agg(distinct sort_order) from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000230d1'
            and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000230c3'), array[4],
  'every unit stands at the step''s place on the list');

-- Down and up again: the unit brought back takes the place too.
select app.resize_deliverable_units('aaaaaaaa-0000-0000-0000-0000000230d1', 1, 'test', '{}');
update sub_tasks set sort_order = 9
 where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000230d1' and unit_index = 2;   -- a stale place on a cancelled unit
select app.resize_deliverable_units('aaaaaaaa-0000-0000-0000-0000000230d1', 2, 'test', '{}');
select is((select sort_order from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000230d1'
            and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000230c3' and unit_index = 2 and status = 'todo'), 4,
  'a unit brought back takes the step''s place, not the one it had');

select is(app.unit_step_position('aaaaaaaa-0000-0000-0000-0000000230d1', gen_random_uuid(), 7), 7,
  'a step with no unit on the list yet takes the template''s number');

select * from finish();
rollback;
