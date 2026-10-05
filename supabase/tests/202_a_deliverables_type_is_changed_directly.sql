-- I68.4 / I68.5 (ADR-0132 d.3-d.4, 30 Sep).
--
--   * PREVIEW — what a type change would do: the old type's open tasks cancelled (with their assignee), finished and
--               hand-added tasks kept, the new type's steps added; refused outside reach.
--   * CHANGE  — ADR-0141 d.1 (3 Oct): direct, by the account manager's side only (the list then waits for the owner,
--               who is told); the owner and the department's leads are refused and ask; E7's effects: cancelled,
--               booking freed, assignee told, finished and hand-added kept, the new steps added unassigned. The preview
--               matches what happens.
--   * ADD     — a task added by title (and due date) alone is created unassigned; the owner's addition keeps the list
--               approved; another lead's clears it for the owner.
--
-- `notifications` is recipient-scoped: every count over it is read after `reset role` (traps.md).
begin;
select plan(25);
\ir helpers/seed.sql

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de2020', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 202'),
  ('aaaaaaaa-0000-0000-0000-000000de2021', 'aaaaaaaa-0000-0000-0000-000000000001', 'Content 202');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000007e202', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000de2020', 'Design 202');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000b020', 'am202@a.test'),
  ('00000000-0000-0000-0000-00000000b021', 'owner202@a.test'),
  ('00000000-0000-0000-0000-00000000b022', 'maker202@a.test'),
  ('00000000-0000-0000-0000-00000000b023', 'lead202@a.test'),
  ('00000000-0000-0000-0000-00000000b024', 'outsider202@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid, v.team::uuid
from (values
  ('00000000-0000-0000-0000-00000000b020','AM 202',       'account_manager', null, null),
  ('00000000-0000-0000-0000-00000000b021','Owner 202',    'department_lead','aaaaaaaa-0000-0000-0000-000000de2020', null),
  ('00000000-0000-0000-0000-00000000b022','Maker 202',    'team_member',    'aaaaaaaa-0000-0000-0000-000000de2020', 'aaaaaaaa-0000-0000-0000-00000007e202'),
  ('00000000-0000-0000-0000-00000000b023','Lead 202',     'department_lead','aaaaaaaa-0000-0000-0000-000000de2020', null),
  ('00000000-0000-0000-0000-00000000b024','Outsider 202', 'department_lead','aaaaaaaa-0000-0000-0000-000000de2021', null)
) as v(id, name, role_key, dept, team);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id::text like '00000000-0000-0000-0000-00000000b02%';
insert into resources (id, tenant_id, kind, name, capacity_model, load_ceiling_pct, warn_at_pct, user_id, department_id, team_id) values
  ('aaaaaaaa-0000-0000-0000-0000000e2022', 'aaaaaaaa-0000-0000-0000-000000000001', 'human', 'Maker 202', 'load_based', 120.0, 100.0,
   '00000000-0000-0000-0000-00000000b022', 'aaaaaaaa-0000-0000-0000-000000de2020', 'aaaaaaaa-0000-0000-0000-00000007e202');

-- Two workflows: A (Design, Resize) for a Poster; B (Design, Animate, Export) for a Motion poster. Design is in both.
insert into workflow_templates (id, tenant_id, code, name_en, is_system) values
  ('aaaaaaaa-0000-0000-0000-0000000202a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'W202A', 'Static 202', false),
  ('aaaaaaaa-0000-0000-0000-0000000202a2', 'aaaaaaaa-0000-0000-0000-000000000001', 'W202B', 'Motion 202', false);
insert into workflow_steps (id, tenant_id, template_id, sort_order, title_en) values
  ('aaaaaaaa-0000-0000-0000-0000000202c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000202a1', 1, 'Design'),
  ('aaaaaaaa-0000-0000-0000-0000000202c2', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000202a1', 2, 'Resize'),
  ('aaaaaaaa-0000-0000-0000-0000000202c3', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000202a2', 1, 'Storyboard'),
  ('aaaaaaaa-0000-0000-0000-0000000202c4', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000202a2', 2, 'Animate');
insert into deliverable_categories (tenant_id, code, name_en) values ('aaaaaaaa-0000-0000-0000-000000000001', 'CR202', 'Category 202');
insert into deliverable_types (id, tenant_id, code, category_code, name_en, default_workflow_template_id) values
  ('aaaaaaaa-0000-0000-0000-0000000c202a', 'aaaaaaaa-0000-0000-0000-000000000001', 'CR202-A', 'CR202', 'Poster', 'aaaaaaaa-0000-0000-0000-0000000202a1'),
  ('aaaaaaaa-0000-0000-0000-0000000c202b', 'aaaaaaaa-0000-0000-0000-000000000001', 'CR202-B', 'CR202', 'Motion poster', 'aaaaaaaa-0000-0000-0000-0000000202a2');

insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-000000002020', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Season 202', 'approved', 'campaign', '00000000-0000-0000-0000-00000000b020');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f202', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000002020', 'S202');
-- D1: the owner changes it. D2: another lead changes it. D3: tasks are added to it.
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id, department_id, deliverable_type_id, quantity) values
  ('aaaaaaaa-0000-0000-0000-0000000d2021', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f202',
   'Campus 202', 'in_progress', '2026-10-20 15:00:00+00', '00000000-0000-0000-0000-00000000b021', 'aaaaaaaa-0000-0000-0000-000000de2020',
   'aaaaaaaa-0000-0000-0000-0000000c202a', 1),
  ('aaaaaaaa-0000-0000-0000-0000000d2022', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f202',
   'Hall 202', 'in_progress', '2026-10-20 15:00:00+00', '00000000-0000-0000-0000-00000000b021', 'aaaaaaaa-0000-0000-0000-000000de2020',
   'aaaaaaaa-0000-0000-0000-0000000c202a', 1),
  ('aaaaaaaa-0000-0000-0000-0000000d2023', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f202',
   'Gate 202', 'in_progress', '2026-10-20 15:00:00+00', '00000000-0000-0000-0000-00000000b021', 'aaaaaaaa-0000-0000-0000-000000de2020',
   'aaaaaaaa-0000-0000-0000-0000000c202a', 1);
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-000000002020');

-- D1: Resize in progress (assigned, booked) — the old type's open task; Design done; a hand-added task to do.
-- D2: Resize to do, assigned.
set local app.system_op = 'on';
update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000b022', sla_hours = 6, status = 'in_progress',
       starts_at = '2026-10-01 06:00+00', due_at = '2026-10-05 15:00+00'
 where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2021' and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000202c2';
update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000b022', sla_hours = 2, status = 'done'
 where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2021' and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000202c1';
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order) values
  ('aaaaaaaa-0000-0000-0000-0000000a2029', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d2021', 'Hand-added 202', 'todo', 9);
update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000b022', sla_hours = 4
 where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2022' and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000202c2';
insert into bookings (tenant_id, resource_id, starts_at, ends_at, state, sub_task_id)
select 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000e2022', '2026-10-01 06:00+00', '2026-10-01 12:00+00',
       'confirmed', t.id
  from sub_tasks t where t.deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2021' and t.workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000202c2';
set local app.system_op = 'off';

create temp table p202 (preview jsonb, result jsonb);
grant all on p202 to authenticated;

-- ================================================================ PREVIEW ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b024'),true);
select throws_ok(
  $$ select public.preview_deliverable_type_change('aaaaaaaa-0000-0000-0000-0000000d2021', 'aaaaaaaa-0000-0000-0000-0000000c202b') $$,
  '42501', null, 'preview: another department''s lead is outside reach');
select throws_ok(
  $$ select public.change_deliverable_type('aaaaaaaa-0000-0000-0000-0000000d2021', 'aaaaaaaa-0000-0000-0000-0000000c202b') $$,
  '42501', null, 'change: and may not change it either');

-- ADR-0141 d.1 (3 Oct): the owner and the department's leads no longer change a live piece's type — they ask. The
-- account manager does, and her change is "anybody but the owner" for ADR-0132 d.4: the list waits for the owner.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b021'),true);
select throws_ok(
  $$ select public.preview_deliverable_type_change('aaaaaaaa-0000-0000-0000-0000000d2021', 'aaaaaaaa-0000-0000-0000-0000000c202b') $$,
  '42501', null, 'ADR-0141 d.1: the owner no longer previews a type change — she asks the account manager');
select throws_ok(
  $$ select public.change_deliverable_type('aaaaaaaa-0000-0000-0000-0000000d2021', 'aaaaaaaa-0000-0000-0000-0000000c202b') $$,
  '42501', 'only the account manager changes a deliverable — ask AM 202 to change it',
  'ADR-0141 d.1: nor changes it — refused in the account manager''s name (hint ask_account_manager)');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b020'),true);
insert into p202 (preview)
select public.preview_deliverable_type_change('aaaaaaaa-0000-0000-0000-0000000d2021', 'aaaaaaaa-0000-0000-0000-0000000c202b');
select is((select jsonb_path_query_array(preview, '$.cancelled[*].title') from p202),
  '["Resize — Season 202"]'::jsonb, 'preview: the old type''s open task is the one cancelled');
select is((select preview #>> '{cancelled,0,assignee}' from p202), 'Maker 202', 'preview: with who has it');
select is((select jsonb_array_length(preview -> 'kept') from p202), 2, 'preview: the finished task and the hand-added one are kept');
select is((select preview -> 'added' from p202), '["Storyboard — Season 202", "Animate — Season 202"]'::jsonb,
  'preview: the new type''s steps, titled as the list will title them');
select is((select (preview ->> 'approved_after')::boolean from p202), false,
  'preview: the account manager''s change sends the list back to the owner');

-- ================================================================ CHANGE (the account manager) ====
update p202 set result = public.change_deliverable_type('aaaaaaaa-0000-0000-0000-0000000d2021', 'aaaaaaaa-0000-0000-0000-0000000c202b');
select is((select result from p202), '{"cancelled": 1, "added": 2, "approved": false}'::jsonb,
  'change: 1 cancelled, 2 added, the list waits for the owner — as the preview said');

reset role;
select is((select deliverable_type_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d2021'),
  'aaaaaaaa-0000-0000-0000-0000000c202b'::uuid, 'change: the type is the new one');
select is((select status from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2021'
             and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000202c2'), 'cancelled', 'E7: the old open task is cancelled');
select is((select count(*)::int from bookings b join sub_tasks t on t.id = b.sub_task_id
            where t.deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2021'), 0, 'E7: its booking is freed');
select is((select count(*)::int from notifications where user_id = '00000000-0000-0000-0000-00000000b022' and type = 'cancelled'),
  1, 'E7: its assignee is told');
select is((select string_agg(status, ',' order by title) from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2021'
             and (workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000202c1' or id = 'aaaaaaaa-0000-0000-0000-0000000a2029')),
  'done,todo', 'E7: the finished task and the hand-added one are kept as they were');
select is((select count(*)::int from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2021'
             and workflow_step_id in ('aaaaaaaa-0000-0000-0000-0000000202c3', 'aaaaaaaa-0000-0000-0000-0000000202c4')
             and assignee_id is null and status = 'todo'), 2, 'E7: the new type''s steps are added, unassigned');
select ok((select tasks_approved_at is null from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d2021'),
  'd.4: a change by anyone but the owner clears the approval for the owner');
select is((select count(*)::int from notifications where user_id = '00000000-0000-0000-0000-00000000b021'
             and type = 'deliverable_type_changed' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000d2021'),
  1, 'the owner is told who changed it');

-- ================================================================ CHANGE (another lead) ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b023'),true);
select throws_ok(
  $$ select public.change_deliverable_type('aaaaaaaa-0000-0000-0000-0000000d2022', 'aaaaaaaa-0000-0000-0000-0000000c202b') $$,
  '42501', null, 'ADR-0141 d.1: the department''s other lead no longer changes it directly — she asks');
reset role;
select ok((select tasks_approved_at is not null from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d2022'),
  'and nothing moved: the list is still approved');

-- ================================================================ ADD ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b021'),true);
select lives_ok(
  $$ select public.save_sub_task(null, 'aaaaaaaa-0000-0000-0000-0000000d2023', 'Owner extra 202', null,
       p_due_at => '2026-10-10 15:00+00') $$,
  'add: a title and a due date are enough');
reset role;
select ok((select assignee_id is null and due_at = '2026-10-10 15:00+00' from sub_tasks where title = 'Owner extra 202'),
  'add: the task is unassigned, due that day');
select ok((select tasks_approved_at is not null from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d2023'),
  'd.4: the owner''s own addition keeps the list approved');

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b023'),true);
select public.save_sub_task(null, 'aaaaaaaa-0000-0000-0000-0000000d2023', 'Lead extra 202', null,
       p_due_at => '2026-10-11 15:00+00');
reset role;
select ok((select tasks_approved_at is null from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d2023'),
  'd.4: another lead''s addition clears the approval — it waits for the owner');
select ok(exists (select 1 from audit_events where action = 'task_list_reopened'
                    and entity_id = 'aaaaaaaa-0000-0000-0000-0000000d2023'), 'd.4: and says why, on the record');

select * from finish();
rollback;
