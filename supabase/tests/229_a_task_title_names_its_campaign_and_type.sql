-- 20261004160000 (ADR-0071 addendum, 4 Oct — Edward; I74.39) — a generated task's title names its campaign and the
-- deliverable's type, never the deliverable:
--   once per deliverable   "<Step> — <Campaign>"
--   per unit               "<Step> — <Campaign> · <Type> <n>"   (no number at quantity 1; no type: the number alone)
--   translation            "Translation — <Campaign> (<languages>)"
-- Titles follow the campaign's name, the type, the quantity and the languages; a rename of the deliverable changes
-- nothing; a hand-named task is left alone; the backfill rewrites only titles the old rules composed.
begin;
select plan(26);
\ir helpers/seed.sql
select app.seed_tenant_languages('aaaaaaaa-0000-0000-0000-000000000001');

-- Two workflows. W1: two steps done once and one per unit; W2: one once, one per unit.
insert into workflow_templates (id, tenant_id, code, name_en, is_system) values
  ('aaaaaaaa-0000-0000-0000-0000000229b1', 'aaaaaaaa-0000-0000-0000-000000000001', 'W229A', 'Static 229', false),
  ('aaaaaaaa-0000-0000-0000-0000000229b2', 'aaaaaaaa-0000-0000-0000-000000000001', 'W229B', 'Print 229', false);
insert into workflow_steps (id, tenant_id, template_id, sort_order, title_en, repeats_per_unit) values
  ('aaaaaaaa-0000-0000-0000-0000000229c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000229b1', 1, 'Creative Direction', false),
  ('aaaaaaaa-0000-0000-0000-0000000229c2', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000229b1', 2, 'Write Copy', false),
  ('aaaaaaaa-0000-0000-0000-0000000229c3', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000229b1', 3, 'Create Artwork', true),
  ('aaaaaaaa-0000-0000-0000-0000000229c4', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000229b2', 1, 'Brief Printer', false),
  ('aaaaaaaa-0000-0000-0000-0000000229c5', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000229b2', 2, 'Print Proof', true);
insert into deliverable_categories (tenant_id, code, name_en) values ('aaaaaaaa-0000-0000-0000-000000000001', 'T229', 'Category 229');
insert into deliverable_types (id, tenant_id, code, category_code, name_en, default_workflow_template_id) values
  ('aaaaaaaa-0000-0000-0000-0000000229a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'T229-1', 'T229', 'Static Post', 'aaaaaaaa-0000-0000-0000-0000000229b1'),
  ('aaaaaaaa-0000-0000-0000-0000000229a2', 'aaaaaaaa-0000-0000-0000-000000000001', 'T229-2', 'T229', 'Carousel',    'aaaaaaaa-0000-0000-0000-0000000229b1'),
  ('aaaaaaaa-0000-0000-0000-0000000229a3', 'aaaaaaaa-0000-0000-0000-000000000001', 'T229-3', 'T229', 'Billboard',   'aaaaaaaa-0000-0000-0000-0000000229b2');

insert into campaigns (id, tenant_id, client_id, name, status, kind, languages) values
  ('aaaaaaaa-0000-0000-0000-0000000229e1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'Northwind 229', 'approved', 'campaign', array['ar', 'en']);
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000229f1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000229e1', 'Northwind 229');
-- (the deliverable's own rules — owner, department, due date — are not what this file tests)
set local session_replication_role = replica;
insert into deliverables (id, tenant_id, stream_id, name, deliverable_type_id, quantity, languages, due_at) values
  ('aaaaaaaa-0000-0000-0000-0000000229d1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000229f1',
   'Social statics', 'aaaaaaaa-0000-0000-0000-0000000229a1', 6, array['ar', 'en'], now() + interval '20 days'),
  ('aaaaaaaa-0000-0000-0000-0000000229d2', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000229f1',
   'Key visual', 'aaaaaaaa-0000-0000-0000-0000000229a3', 1, '{}', now() + interval '20 days');
set local session_replication_role = origin;
select app.materialise_deliverable_workflow('aaaaaaaa-0000-0000-0000-0000000229d1');
select app.materialise_deliverable_workflow('aaaaaaaa-0000-0000-0000-0000000229d2');

create temp table d1 as select 'aaaaaaaa-0000-0000-0000-0000000229d1'::uuid as id;

-- ================================================================== creation ====
select is((select title from sub_tasks where deliverable_id = (select id from d1) and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000229c1'),
  'Creative Direction — Northwind 229', 'a task done once: "<step> — <campaign>"');
select is((select array_agg(title order by unit_index) from sub_tasks
            where deliverable_id = (select id from d1) and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000229c3'),
  array['Create Artwork — Northwind 229 · Static Post 1', 'Create Artwork — Northwind 229 · Static Post 2',
        'Create Artwork — Northwind 229 · Static Post 3', 'Create Artwork — Northwind 229 · Static Post 4',
        'Create Artwork — Northwind 229 · Static Post 5', 'Create Artwork — Northwind 229 · Static Post 6'],
  'quantity 6: "<step> — <campaign> · <type> <n>", one per unit, 1 to 6');
select is((select title from sub_tasks where deliverable_id = (select id from d1) and title like 'Translation — %'),
  'Translation — Northwind 229 (Arabic, English)', 'the translation task: "Translation — <campaign> (<languages>)"');
select is((select title from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000229d2'
            and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000229c5'),
  'Print Proof — Northwind 229 · Billboard', 'quantity 1: the type, no number');
select is(app.compose_task_title('Create Artwork', 'Northwind 229', null, 2, 3), 'Create Artwork — Northwind 229 · 2',
  'no type: the number alone');
select is((select count(*)::int from sub_tasks where deliverable_id = (select id from d1) and title like '%Social statics%'), 0,
  'the deliverable''s name is in no title');

-- Hand-named: unit 2 renamed by a person; a task a person added.
update sub_tasks set title = 'Hero post'
 where deliverable_id = (select id from d1) and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000229c3' and unit_index = 2;
set local session_replication_role = replica;
insert into sub_tasks (id, tenant_id, deliverable_id, title, status) values
  ('aaaaaaaa-0000-0000-0000-0000000229aa', 'aaaaaaaa-0000-0000-0000-000000000001', (select id from d1),
   'Creative Direction — Northwind 229', 'todo');
set local session_replication_role = origin;
-- the step and the translation task have an assignee (only she hears of a languages change)
set local session_replication_role = replica;
update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a003'
 where deliverable_id = (select id from d1) and title like 'Translation — %';
set local session_replication_role = origin;

-- ================================================================== a rename of the deliverable ====
create temp table before_rename as select id, title from sub_tasks where deliverable_id = (select id from d1);
update deliverables set name = 'Social posts' where id = (select id from d1);
select is((select count(*)::int from sub_tasks t join before_rename b on b.id = t.id where t.title <> b.title), 0,
  'renaming the deliverable changes no title — its name is not in them');

-- ================================================================== the campaign's rename ====
update campaigns set name = 'Northwind 229 B' where id = 'aaaaaaaa-0000-0000-0000-0000000229e1';
select is((select title from sub_tasks where deliverable_id = (select id from d1) and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000229c1'),
  'Creative Direction — Northwind 229 B', 'a campaign rename reaches a once-only task');
select is((select title from sub_tasks where deliverable_id = (select id from d1) and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000229c3' and unit_index = 6),
  'Create Artwork — Northwind 229 B · Static Post 6', 'and a unit task');
select is((select title from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000229d2' and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000229c5'),
  'Print Proof — Northwind 229 B · Billboard', 'and every deliverable''s tasks');
select is((select title from sub_tasks where deliverable_id = (select id from d1) and title like 'Translation — %'),
  'Translation — Northwind 229 B (Arabic, English)', 'and the translation task');
select is((select title from sub_tasks where deliverable_id = (select id from d1) and unit_index = 2), 'Hero post',
  'a hand-named task is left alone');
select is((select title from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000229aa'), 'Creative Direction — Northwind 229',
  'and so is a task a person added, even one that reads like a generated title');
select is((select count(*)::int from notifications where type = 'translation_languages_changed'), 0,
  'a campaign rename tells nobody');

-- ================================================================== the type ====
update deliverables set deliverable_type_id = 'aaaaaaaa-0000-0000-0000-0000000229a2' where id = (select id from d1);
select is((select title from sub_tasks where deliverable_id = (select id from d1) and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000229c3' and unit_index = 1),
  'Create Artwork — Northwind 229 B · Carousel 1', 'a type change (same workflow): the units take the new type');
update deliverables set deliverable_type_id = 'aaaaaaaa-0000-0000-0000-0000000229a1' where id = 'aaaaaaaa-0000-0000-0000-0000000229d2';
select is((select title from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000229d2' and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000229c3'),
  'Create Artwork — Northwind 229 B · Static Post', 'a type change (new workflow): the new type''s tasks are titled for it');
select is((select title from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000229d2' and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000229c5'),
  'Print Proof — Northwind 229 B · Billboard', 'and the old type''s work keeps the type it was made as');

-- ================================================================== the quantity ====
select is(app.resize_deliverable_units((select id from d1), 1, 'test', '{}') ->> 'cancelled', '5',
  'quantity 6 -> 1: units 2 to 6 are cancelled');
select is((select title from sub_tasks where deliverable_id = (select id from d1) and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000229c3' and unit_index = 1),
  'Create Artwork — Northwind 229 B · Carousel', 'at one unit the number goes');
select is(app.resize_deliverable_units((select id from d1), 3, 'test', '{}') ->> 'added', '2',
  'quantity 1 -> 3: units 2 and 3 come back');
select is((select array_agg(title order by unit_index) from sub_tasks
            where deliverable_id = (select id from d1) and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000229c3' and status <> 'cancelled'),
  array['Create Artwork — Northwind 229 B · Carousel 1', 'Hero post', 'Create Artwork — Northwind 229 B · Carousel 3'],
  'every unit is numbered again, unit 1 included; the hand-named one keeps its name');

-- An accepted change request now makes the units too (it changed the number and no task).
insert into deliverable_change_requests (id, tenant_id, deliverable_id, requested_by, changes, asked_by) values
  ('aaaaaaaa-0000-0000-0000-0000000229cc', 'aaaaaaaa-0000-0000-0000-000000000001', (select id from d1),
   '00000000-0000-0000-0000-00000000a001', '{"quantity": {"from": 3, "to": 4}}', 'us');
select app.apply_deliverable_change_request('aaaaaaaa-0000-0000-0000-0000000229cc', null);
select is((select title from sub_tasks where deliverable_id = (select id from d1) and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000229c3' and unit_index = 4 and status = 'todo'),
  'Create Artwork — Northwind 229 B · Carousel 4', 'an accepted change request to 4 adds unit 4, titled by the rule');

-- ================================================================== the languages ====
update deliverables set languages = array['en'] where id = (select id from d1);
select is((select title from sub_tasks where deliverable_id = (select id from d1) and title like 'Translation — %'),
  'Translation — Northwind 229 B (English)', 'a languages change: the translation task lists them');
select results_eq($$ select user_id, label from notifications where type = 'translation_languages_changed' $$,
  $$ values ('00000000-0000-0000-0000-00000000a003'::uuid, 'Translation — Northwind 229 B (English)') $$,
  'and its assignee — only she — is told');

-- ================================================================== the backfill ====
set local session_replication_role = replica;
insert into deliverables (id, tenant_id, stream_id, name, deliverable_type_id, quantity, languages, due_at) values
  ('aaaaaaaa-0000-0000-0000-0000000229d4', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000229f1',
   'Old poster ×3', 'aaaaaaaa-0000-0000-0000-0000000229a1', 3, array['ar', 'en'], now() + interval '20 days');
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, workflow_step_id, unit_index) values
  ('aaaaaaaa-0000-0000-0000-0000000229b4', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000229d4', 'Creative Direction — Old poster', 'todo', 'aaaaaaaa-0000-0000-0000-0000000229c1', null),
  ('aaaaaaaa-0000-0000-0000-0000000229b5', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000229d4', 'Create Artwork — Old poster', 'done', 'aaaaaaaa-0000-0000-0000-0000000229c3', 1),
  ('aaaaaaaa-0000-0000-0000-0000000229b6', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000229d4', 'Create Artwork — Old poster ×3 2', 'todo', 'aaaaaaaa-0000-0000-0000-0000000229c3', 2),
  ('aaaaaaaa-0000-0000-0000-0000000229b7', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000229d4', 'Translation — Old poster (Arabic)', 'todo', null, null),
  ('aaaaaaaa-0000-0000-0000-0000000229b8', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000229d4', 'Create Artwork — the big one', 'todo', 'aaaaaaaa-0000-0000-0000-0000000229c3', 3),
  ('aaaaaaaa-0000-0000-0000-0000000229b9', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000229d4', 'Write Copy — Old poster', 'todo', null, null);
set local session_replication_role = origin;
select is(app.backfill_task_titles(), 4, 'the backfill rewrites the four titles the old rules wrote — and nothing else');
select results_eq($$ select title from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000229d4' order by id $$,
  $$ values ('Creative Direction — Northwind 229 B'), ('Create Artwork — Northwind 229 B · Static Post 1'),
            ('Create Artwork — Northwind 229 B · Static Post 2'), ('Translation — Northwind 229 B (Arabic, English)'),
            ('Create Artwork — the big one'), ('Write Copy — Old poster') $$,
  'old titles take the new rule (unit 1 gains its number, the count goes, the languages are the deliverable''s); a hand-named step and a hand-added task are untouched');

select * from finish();
rollback;
