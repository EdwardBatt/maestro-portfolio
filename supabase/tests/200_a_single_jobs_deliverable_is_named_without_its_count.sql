-- 20260930100000 (I67.1) — a single job's deliverable named "Static Post ×3" is renamed "Static Post"; a campaign piece
-- is never touched; the task titles stay as they read; each rename is audited; nobody signed in may run it.
begin;
select plan(7);
\ir helpers/seed.sql

insert into campaigns (id, tenant_id, client_id, name, status, kind, approved_at) values
  ('aaaaaaaa-0000-0000-0000-0000000200e1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'Job 200', 'approved', 'single_job', now()),
  ('aaaaaaaa-0000-0000-0000-0000000200e2', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'Campaign 200', 'approved', 'campaign', now());
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000020051', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000200e1', 'S1'),
  ('aaaaaaaa-0000-0000-0000-000000020052', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000200e2', 'S2');
insert into deliverables (id, tenant_id, stream_id, name, quantity, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000200d1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000020051',
   'Static Post ×3', 3, '00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-0000000200d2', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000020051',
   'Logo', 1, '00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-0000000200d3', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000020052',
   'Eid banner ×2', 2, '00000000-0000-0000-0000-00000000a001');
insert into sub_tasks (id, tenant_id, deliverable_id, title, status) values
  ('aaaaaaaa-0000-0000-0000-0000000200f1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000200d1',
   'Translation — Static Post (English, Arabic)', 'todo');

-- Deny first: a signed-in person cannot run the rename.
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select throws_ok('select app.single_job_names_drop_their_count()', '42501', null,
  'nobody signed in may run the one-off rename');
reset role;

select is(app.single_job_names_drop_their_count(), 1, 'one single-job deliverable carried a count, one is renamed');
select is((select name from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000200d1'),
  'Static Post', 'the single job''s "Static Post ×3" is now "Static Post"');
select is((select quantity from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000200d1'),
  3, 'the count stays in quantity');
select is((select name from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000200d3'),
  'Eid banner ×2', 'a campaign piece is never touched');
select is((select title from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000200f1'),
  'Translation — Static Post (English, Arabic)', 'the task title is left as it read');
select is((select count(*)::int from audit_events
            where entity = 'deliverables' and action = 'update'
              and entity_id = 'aaaaaaaa-0000-0000-0000-0000000200d1'),
  1, 'the rename is in the audit log');

select * from finish();
rollback;
