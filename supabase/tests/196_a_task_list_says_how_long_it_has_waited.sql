-- 20260929130000 (I66.6) — `task_list_waiting`: each waiting task list and since when, on the one clock
-- (ADR-0119 d.3), read under the reader's own RLS.
begin;
select plan(5);
\ir helpers/seed.sql

update app_settings set value = (now() - interval '1 day')::text where key = 'task_list_gate_from';
update app_settings set value = (now() - interval '2 hours')::text where key = 'task_list_backlog_from';

insert into campaigns (id, tenant_id, client_id, name, status, kind, approved_at) values
  ('aaaaaaaa-0000-0000-0000-0000000196e1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'New 196', 'approved', 'campaign', now() - interval '5 hours'),
  ('aaaaaaaa-0000-0000-0000-0000000196e2', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'Old 196', 'approved', 'campaign', now() - interval '20 days'),
  ('aaaaaaaa-0000-0000-0000-0000000196e3', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'Pending 196', 'pending_approval', 'campaign', null),
  ('bbbbbbbb-0000-0000-0000-0000000196e4', 'bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-00000000c001',
   'B 196', 'approved', 'campaign', now() - interval '5 hours');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000196c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000196e1', 'Main'),
  ('aaaaaaaa-0000-0000-0000-0000000196c2', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000196e2', 'Main'),
  ('aaaaaaaa-0000-0000-0000-0000000196c3', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000196e3', 'Main'),
  ('bbbbbbbb-0000-0000-0000-0000000196c4', 'bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-0000000196e4', 'Main');
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, tasks_approved_at) values
  ('aaaaaaaa-0000-0000-0000-0000000196d1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000196c1', 'Waiting new', 'draft', now() + interval '9 days', null),
  ('aaaaaaaa-0000-0000-0000-0000000196d2', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000196c2', 'Waiting old', 'draft', now() + interval '9 days', null),
  ('aaaaaaaa-0000-0000-0000-0000000196d3', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000196c1', 'Approved list', 'in_progress', now() + interval '9 days', now()),
  ('aaaaaaaa-0000-0000-0000-0000000196d4', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000196c3', 'On pending', 'draft', now() + interval '9 days', null),
  ('bbbbbbbb-0000-0000-0000-0000000196d5', 'bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-0000000196c4', 'Tenant B', 'draft', now() + interval '9 days', null);

set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

select results_eq(
  $$ select deliverable_id from public.task_list_waiting where deliverable_id::text like '%0196d%' order by deliverable_id $$,
  $$ values ('aaaaaaaa-0000-0000-0000-0000000196d1'::uuid), ('aaaaaaaa-0000-0000-0000-0000000196d2'::uuid) $$,
  'only unapproved lists on approved campaigns — not an approved list, not a campaign still pending, not another tenant''s');
select is((select since from public.task_list_waiting where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000196d1'),
          (select approved_at from campaigns where id = 'aaaaaaaa-0000-0000-0000-0000000196e1'),
  'a list on a campaign approved after the gate waits from the campaign''s approval');
select is((select since from public.task_list_waiting where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000196d2'),
          (select value::timestamptz from app_settings where key = 'task_list_backlog_from'),
  'an older one waits from the release that brought the gate in (ADR-0119 d.3)');

reset role;
select ok((select reloptions::text like '%security_invoker=true%' from pg_class where oid = 'public.task_list_waiting'::regclass),
  'the view reads under the reader''s RLS');
select ok(not has_table_privilege('anon', 'public.task_list_waiting', 'select'), 'anon cannot read it');

select * from finish();
rollback;
