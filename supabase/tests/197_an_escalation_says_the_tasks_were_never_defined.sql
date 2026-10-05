-- 20260929140000 (I66.4) — the task_list escalation marks a piece with no live task `no_tasks`, so the notice says
-- its tasks were never defined; a piece with tasks is marked false. Same rung, same clock (ADR-0119 d.3).
begin;
select plan(3);
\ir helpers/seed.sql
select app.seed_tenant_escalation_rules(id) from tenants;
update app_settings set value = (now() - interval '30 days')::text where key = 'task_list_gate_from';

insert into campaigns (id, tenant_id, client_id, name, status, kind, approved_at) values
  ('aaaaaaaa-0000-0000-0000-0000000197e1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'Released 197', 'approved', 'campaign', now() - interval '3 days');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000197c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000197e1', 'Main');
insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id, due_at) values
  ('aaaaaaaa-0000-0000-0000-0000000197d1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000197c1',
   'With tasks', 'draft', '00000000-0000-0000-0000-00000000a001', now() + interval '9 days'),
  ('aaaaaaaa-0000-0000-0000-0000000197d2', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000197c1',
   'No tasks', 'draft', '00000000-0000-0000-0000-00000000a001', now() + interval '9 days');
insert into sub_tasks (tenant_id, deliverable_id, title, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000197d1', 'Design', 'todo');

select is((select (extra ->> 'no_tasks')::boolean from app.escalation_due(now())
            where kind = 'task_list' and subject_id = 'aaaaaaaa-0000-0000-0000-0000000197d2'), true,
  'a piece with no tasks escalates marked no_tasks');
select is((select (extra ->> 'no_tasks')::boolean from app.escalation_due(now())
            where kind = 'task_list' and subject_id = 'aaaaaaaa-0000-0000-0000-0000000197d1'), false,
  'a piece with a task on its list does not');
select is((select extra ->> 'waiting_on' from app.escalation_due(now())
            where kind = 'task_list' and subject_id = 'aaaaaaaa-0000-0000-0000-0000000197d2'), 'task_list',
  'on the same rung as before');

select * from finish();
rollback;
