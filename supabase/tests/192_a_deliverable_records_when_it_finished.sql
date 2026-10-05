-- 20260928100000 (I61.3, ADR-0122) — a deliverable records when it finished: the moment it first became
-- approved or delivered, kept when it moves on to delivered, and set for a piece written already finished.
begin;
select plan(6);
\ir helpers/seed.sql

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000192501','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S192');
insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id, reviewer_id, due_at) values
  ('aaaaaaaa-0000-0000-0000-000000192d01','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000192501',
   'Piece 192','in_progress','00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-00000000a001', now() + interval '10 days'),
  ('aaaaaaaa-0000-0000-0000-000000192d02','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000192501',
   'Piece 192 done','delivered','00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-00000000a001', now() + interval '10 days');

select is((select finished_at from deliverables where id = 'aaaaaaaa-0000-0000-0000-000000192d01'), null,
  'live work has not finished');
select isnt((select finished_at from deliverables where id = 'aaaaaaaa-0000-0000-0000-000000192d02'), null,
  'a piece written already delivered is stamped');

-- No tasks, so nothing holds the sign-off (ADR-0118).
update deliverables set state = 'approved' where id = 'aaaaaaaa-0000-0000-0000-000000192d01';
select isnt((select finished_at from deliverables where id = 'aaaaaaaa-0000-0000-0000-000000192d01'), null,
  'approving it stamps when it finished');

-- Pretend the approval was yesterday, then mark it delivered: the first moment stays.
set local session_replication_role = replica;
update deliverables set finished_at = now() - interval '1 day' where id = 'aaaaaaaa-0000-0000-0000-000000192d01';
set local session_replication_role = origin;
update deliverables set state = 'delivered' where id = 'aaaaaaaa-0000-0000-0000-000000192d01';
select is((select finished_at from deliverables where id = 'aaaaaaaa-0000-0000-0000-000000192d01'), now() - interval '1 day',
  'marking it delivered keeps the moment it first finished');

-- A write that tries to set the moment by hand on live work is undone.
insert into deliverables (id, tenant_id, stream_id, name, state, finished_at) values
  ('aaaaaaaa-0000-0000-0000-000000192d03','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000192501',
   'Piece 192 live','draft', now());
select is((select finished_at from deliverables where id = 'aaaaaaaa-0000-0000-0000-000000192d03'), null,
  'live work cannot carry a finish time');

select has_index('public', 'deliverables', 'idx_deliverables_finished_at', 'finished pieces are indexed by tenant and time');

select * from finish();
rollback;
