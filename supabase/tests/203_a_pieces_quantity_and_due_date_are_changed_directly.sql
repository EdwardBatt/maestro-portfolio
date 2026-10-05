-- I68.4 / I68.5 continued (ADR-0132 d.2-d.4, 30 Sep).
--
--   * ADR-0141 d.1 (3 Oct): only the account manager's side changes a live piece — the owner and the department's
--     leads ask. The changes below are therefore the account manager's.
--   * QUANTITY — refused outside reach and to the owner; the preview names the unit tasks a lower count cancels; down cancels the open
--                units above it (booking freed, assignee told), a finished unit kept; up brings a cancelled unit back
--                and adds a new one, unassigned; another lead's addition leaves the list for the owner.
--   * DUE      — changed directly on started work at 18:00 Iraq, logged deadline_changed {direct}; the owner is told
--                who changed it (deliverable_edited), not when they did it themselves.
--   * CLOCK    — an approved list opened again waits from its reopening, not from the campaign's approval: not escalated
--                at once, escalated a day later, once per reopening; the stamp cannot be written by a client.
--
-- `notifications` is recipient-scoped: every count over it is read after `reset role` (traps.md).
begin;
select plan(21);
\ir helpers/seed.sql
select app.seed_tenant_escalation_rules(id) from tenants;
update app_settings set value = (now() - interval '30 days')::text where key = 'task_list_gate_from';

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de2030', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 203'),
  ('aaaaaaaa-0000-0000-0000-000000de2031', 'aaaaaaaa-0000-0000-0000-000000000001', 'Content 203');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000b030', 'am203@a.test'),
  ('00000000-0000-0000-0000-00000000b031', 'owner203@a.test'),
  ('00000000-0000-0000-0000-00000000b032', 'maker203@a.test'),
  ('00000000-0000-0000-0000-00000000b033', 'lead203@a.test'),
  ('00000000-0000-0000-0000-00000000b034', 'outsider203@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid
from (values
  ('00000000-0000-0000-0000-00000000b030','AM 203',       'account_manager', null),
  ('00000000-0000-0000-0000-00000000b031','Owner 203',    'department_lead','aaaaaaaa-0000-0000-0000-000000de2030'),
  ('00000000-0000-0000-0000-00000000b032','Maker 203',    'team_member',    'aaaaaaaa-0000-0000-0000-000000de2030'),
  ('00000000-0000-0000-0000-00000000b033','Lead 203',     'department_lead','aaaaaaaa-0000-0000-0000-000000de2030'),
  ('00000000-0000-0000-0000-00000000b034','Outsider 203', 'department_lead','aaaaaaaa-0000-0000-0000-000000de2031')
) as v(id, name, role_key, dept);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id::text like '00000000-0000-0000-0000-00000000b03%';
insert into resources (id, tenant_id, kind, name, capacity_model, load_ceiling_pct, warn_at_pct, user_id, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000e2032', 'aaaaaaaa-0000-0000-0000-000000000001', 'human', 'Maker 203', 'load_based', 120.0, 100.0,
   '00000000-0000-0000-0000-00000000b032', 'aaaaaaaa-0000-0000-0000-000000de2030');

-- A workflow with one step for the piece and one per unit.
insert into workflow_templates (id, tenant_id, code, name_en, is_system) values
  ('aaaaaaaa-0000-0000-0000-0000000203a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'W203', 'Posts 203', false);
insert into workflow_steps (id, tenant_id, template_id, sort_order, title_en, repeats_per_unit) values
  ('aaaaaaaa-0000-0000-0000-0000000203c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000203a1', 1, 'Brief', false),
  ('aaaaaaaa-0000-0000-0000-0000000203c2', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000203a1', 2, 'Artwork', true);
insert into deliverable_categories (tenant_id, code, name_en) values ('aaaaaaaa-0000-0000-0000-000000000001', 'CR203', 'Category 203');
insert into deliverable_types (id, tenant_id, code, category_code, name_en, default_workflow_template_id) values
  ('aaaaaaaa-0000-0000-0000-0000000c203a', 'aaaaaaaa-0000-0000-0000-000000000001', 'CR203-A', 'CR203', 'Post', 'aaaaaaaa-0000-0000-0000-0000000203a1');

insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id, approved_at) values
  ('aaaaaaaa-0000-0000-0000-000000002030', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'Season 203', 'approved', 'campaign', '00000000-0000-0000-0000-00000000b030', now() - interval '10 days');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f203', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000002030', 'S203');
-- D1 (quantity, due), D2 (the clock).
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id, department_id, deliverable_type_id, quantity) values
  ('aaaaaaaa-0000-0000-0000-0000000d2031', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f203',
   'Posts 203', 'in_progress', '2026-10-20 15:00:00+00', '00000000-0000-0000-0000-00000000b031', 'aaaaaaaa-0000-0000-0000-000000de2030',
   'aaaaaaaa-0000-0000-0000-0000000c203a', 3),
  ('aaaaaaaa-0000-0000-0000-0000000d2032', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f203',
   'Banner 203', 'in_progress', '2026-10-20 15:00:00+00', '00000000-0000-0000-0000-00000000b031', 'aaaaaaaa-0000-0000-0000-000000de2030',
   'aaaaaaaa-0000-0000-0000-0000000c203a', 1);
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-000000002030');

-- D1: Artwork 1 done, Artwork 2 in progress (assigned, booked), Artwork 3 to do — started work.
set local app.system_op = 'on';
update sub_tasks set status = 'done', assignee_id = '00000000-0000-0000-0000-00000000b032', sla_hours = 2
 where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2031' and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000203c2' and unit_index = 1;
update sub_tasks set status = 'in_progress', assignee_id = '00000000-0000-0000-0000-00000000b032', sla_hours = 4,
       starts_at = '2026-10-01 06:00+00', due_at = '2026-10-05 15:00+00'
 where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2031' and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000203c2' and unit_index = 2;
insert into bookings (tenant_id, resource_id, starts_at, ends_at, state, sub_task_id)
select 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000e2032', '2026-10-01 06:00+00', '2026-10-01 12:00+00',
       'confirmed', t.id
  from sub_tasks t where t.deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2031' and t.unit_index = 2;
set local app.system_op = 'off';

create temp table r203 (k text, v jsonb);
grant all on r203 to authenticated;

-- ================================================================ QUANTITY ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b034'),true);
select throws_ok($$ select public.edit_piece_directly('aaaaaaaa-0000-0000-0000-0000000d2031', 1) $$,
  '42501', null, 'another department''s lead may not change it');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b031'),true);
select throws_ok($$ select public.edit_piece_directly('aaaaaaaa-0000-0000-0000-0000000d2031', 1) $$,
  '42501', null, 'ADR-0141 d.1: the owner no longer changes it directly — she asks the account manager');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b030'),true);
select is(jsonb_path_query_array(public.preview_quantity_change('aaaaaaaa-0000-0000-0000-0000000d2031', 1), '$.cancelled[*].title'),
  '["Artwork — Season 203 · Post 2", "Artwork — Season 203 · Post 3"]'::jsonb, 'preview: lowering to 1 cancels the two open units above it');
insert into r203 values ('down', public.edit_piece_directly('aaaaaaaa-0000-0000-0000-0000000d2031', 1));
select is((select (v ->> 'cancelled')::int from r203 where k = 'down'), 2, 'down: two cancelled, as the preview said');
reset role;
select is((select string_agg(status, ',' order by unit_index) from sub_tasks
            where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2031' and unit_index is not null),
  'done,cancelled,cancelled', 'down: the finished unit is kept');
select is((select count(*)::int from bookings b join sub_tasks t on t.id = b.sub_task_id
            where t.deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2031'), 0, 'down: the booking is freed');
select is((select count(*)::int from notifications where user_id = '00000000-0000-0000-0000-00000000b032' and type = 'cancelled'),
  1, 'down: the assignee of the in-progress unit is told');

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b030'),true);
select is(jsonb_array_length(public.preview_quantity_change('aaaaaaaa-0000-0000-0000-0000000d2031', 4) -> 'added'), 3,
  'preview: raising to 4 adds units 2, 3 and 4');
insert into r203 values ('up', public.edit_piece_directly('aaaaaaaa-0000-0000-0000-0000000d2031', 4));
select is((select (v ->> 'added')::int from r203 where k = 'up'), 3, 'up: three added — two brought back, one new');
reset role;
select is((select string_agg(status || ':' || coalesce(assignee_id::text, '-'), ',' order by unit_index) from sub_tasks
            where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2031' and unit_index > 1),
  'todo:-,todo:-,todo:-', 'up: every added unit is to do and unassigned');
select ok((select tasks_approved_at is null from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d2031'),
  'd.4: units added by anyone but the owner (here the account manager) leave the list for the owner');
select is((select count(*)::int from notifications where user_id = '00000000-0000-0000-0000-00000000b031'
             and type = 'deliverable_edited'), 2, 'the owner is told of each of the account manager''s changes');

-- ================================================================ DUE ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b030'),true);
select lives_ok($$ select public.edit_piece_directly('aaaaaaaa-0000-0000-0000-0000000d2031', null, '2026-10-25') $$,
  'due: the account manager corrects the due date of started work directly');
reset role;
select is((select due_at from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d2031'), '2026-10-25 15:00:00+00'::timestamptz,
  'due: at 18:00 Iraq on that day');
select ok(exists (select 1 from sla_events where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2031'
                    and event_type = 'deadline_changed' and (payload ->> 'direct')::boolean),
  'due: on the record as a direct change');

-- ================================================================ CLOCK ====
-- D2's list is approved; its campaign was approved ten days ago. Another lead adds a task: the list opens again.
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b033'),true);
select public.save_sub_task(null, 'aaaaaaaa-0000-0000-0000-0000000d2032', 'Extra 203', null, p_due_at => '2026-10-12 15:00+00');
reset role;
select ok((select tasks_approved_at is null and task_list_reopened_at is not null from deliverables
            where id = 'aaaaaaaa-0000-0000-0000-0000000d2032'), 'clock: the reopening is stamped');
select is_empty($$ select 1 from app.escalation_due(now()) where kind = 'task_list'
                     and subject_id = 'aaaaaaaa-0000-0000-0000-0000000d2032' $$,
  'clock: not escalated at once — the campaign''s approval ten days ago is not the start');
select is((select count(*)::int from app.escalation_due(now() + interval '25 hours') where kind = 'task_list'
             and subject_id = 'aaaaaaaa-0000-0000-0000-0000000d2032'), 1, 'clock: escalated a day after the reopening');
select is((select since from public.task_list_waiting where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d2032'),
  (select task_list_reopened_at from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d2032'),
  'clock: the task-list page reads the same start');
insert into escalation_log (tenant_id, kind, subject_id, occurrence)
select tenant_id, 'task_list', id, '' from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d2032';
select is((select count(*)::int from app.escalation_due(now() + interval '25 hours') where kind = 'task_list'
             and subject_id = 'aaaaaaaa-0000-0000-0000-0000000d2032'), 1,
  'clock: a list escalated before it was approved escalates again after it is reopened');

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b031'),true);
update deliverables set task_list_reopened_at = now() + interval '5 days' where id = 'aaaaaaaa-0000-0000-0000-0000000d2032';
reset role;
select ok((select task_list_reopened_at < now() + interval '1 day' from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d2032'),
  'clock: a client cannot move the stamp');

select * from finish();
rollback;
