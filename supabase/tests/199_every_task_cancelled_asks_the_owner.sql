-- 20260929160000 (I66.11) — a piece whose every task was cancelled asks its OWNER to add a task or close it, and
-- escalates on the task_list rung from the last cancellation; the task-list card and rung leave it out.
begin;
select plan(6);
\ir helpers/seed.sql
select app.seed_tenant_escalation_rules(id) from tenants;
update app_settings set value = (now() - interval '30 days')::text where key = 'task_list_gate_from';

insert into campaigns (id, tenant_id, client_id, name, status, kind, approved_at) values
  ('aaaaaaaa-0000-0000-0000-0000000199e1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'Released 199', 'approved', 'campaign', now() - interval '5 days');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000199c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000199e1', 'Main');
-- d1: its one task cancelled (the list approved). d2: one cancelled, one done — it closes, not this. d3: a live task.
insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id, due_at, tasks_approved_at) values
  ('aaaaaaaa-0000-0000-0000-0000000199d1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000199c1',
   'A All cancelled', 'in_progress', '00000000-0000-0000-0000-00000000a001', now() + interval '9 days', now() - interval '4 days'),
  ('aaaaaaaa-0000-0000-0000-0000000199d2', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000199c1',
   'B One done', 'in_progress', '00000000-0000-0000-0000-00000000a001', now() + interval '9 days', now() - interval '4 days'),
  ('aaaaaaaa-0000-0000-0000-0000000199d3', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000199c1',
   'C Live', 'in_progress', '00000000-0000-0000-0000-00000000a001', now() + interval '9 days', now() - interval '4 days');
set local session_replication_role = replica;
insert into sub_tasks (tenant_id, deliverable_id, title, status, updated_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000199d1', 'Design', 'cancelled', now() - interval '3 days'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000199d2', 'Design', 'cancelled', now() - interval '3 days'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000199d2', 'Copy', 'done', now() - interval '3 days'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000199d3', 'Design', 'todo', now() - interval '3 days');
set local session_replication_role = origin;

-- 2) the escalation — read as the database, before switching to the owner
select is((select extra ->> 'all_cancelled' from app.escalation_due(now())
            where kind = 'task_list' and subject_id = 'aaaaaaaa-0000-0000-0000-0000000199d1'), 'true',
  'a piece whose every task was cancelled escalates on the task_list rung, marked all_cancelled');
select is((select count(*)::int from app.escalation_due(now())
            where kind = 'task_list' and subject_id = 'aaaaaaaa-0000-0000-0000-0000000199d1'), 1,
  'once — the unapproved-list rung does not also take it');
select is_empty($$ select 1 from app.escalation_due(now() - interval '3 days' + interval '1 hour')
                    where kind = 'task_list' and subject_id = 'aaaaaaaa-0000-0000-0000-0000000199d1' $$,
  'counted from the last cancellation — not due an hour after it');

-- 1) the card, as its owner
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select results_eq(
  $$ select kind from public.my_pending_approvals() where target_id = 'aaaaaaaa-0000-0000-0000-0000000199d1' $$,
  $$ values ('tasks_all_cancelled'::text) $$,
  'its owner is asked to add a task or close it — one card, not a task-list card');
select is_empty(
  $$ select 1 from public.my_pending_approvals() where kind = 'tasks_all_cancelled'
       and target_id in ('aaaaaaaa-0000-0000-0000-0000000199d2', 'aaaaaaaa-0000-0000-0000-0000000199d3') $$,
  'not a piece with a done task, nor one with live work');
select ok((select since from public.my_pending_approvals() where target_id = 'aaaaaaaa-0000-0000-0000-0000000199d1')
            < now() - interval '2 days',
  'waiting since the last cancellation');

select * from finish();
rollback;
