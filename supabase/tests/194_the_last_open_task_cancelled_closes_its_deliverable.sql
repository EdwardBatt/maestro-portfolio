-- 20260928160000 (ADR-0118 addendum, I65.4) — cancelling or deleting a deliverable's last open task closes it,
-- as an approval would, when at least one of its tasks was approved. Never one whose work was all called off,
-- never while a task is still open, never from any state but In progress.
begin;
select plan(8);
\ir helpers/seed.sql

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000194501','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S194');
-- d01: cancel closes it. d02: delete closes it. d03: nothing approved. d04: one still open. d05: blocked.
insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id, reviewer_id, due_at) values
  ('aaaaaaaa-0000-0000-0000-000000194d01','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000194501',
   'Cancel closes','in_progress','00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-00000000a001', now() + interval '10 days'),
  ('aaaaaaaa-0000-0000-0000-000000194d02','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000194501',
   'Delete closes','in_progress','00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-00000000a001', now() + interval '10 days'),
  ('aaaaaaaa-0000-0000-0000-000000194d03','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000194501',
   'All called off','in_progress','00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-00000000a001', now() + interval '10 days'),
  ('aaaaaaaa-0000-0000-0000-000000194d04','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000194501',
   'One still open','in_progress','00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-00000000a001', now() + interval '10 days'),
  ('aaaaaaaa-0000-0000-0000-000000194d05','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000194501',
   'Blocked','blocked','00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-00000000a001', now() + interval '10 days');

-- The approved tasks are the review's own writing (ADR-0043 d.1): the fixture sets them with triggers paused.
set local session_replication_role = replica;
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, assignee_id, approved_at) values
  ('aaaaaaaa-0000-0000-0000-000000194a01','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000194d01','A1','done','00000000-0000-0000-0000-00000000a003', now()),
  ('aaaaaaaa-0000-0000-0000-000000194a02','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000194d02','A2','done','00000000-0000-0000-0000-00000000a003', now()),
  ('aaaaaaaa-0000-0000-0000-000000194a04','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000194d04','A4','done','00000000-0000-0000-0000-00000000a003', now()),
  ('aaaaaaaa-0000-0000-0000-000000194a05','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000194d05','A5','done','00000000-0000-0000-0000-00000000a003', now());
set local session_replication_role = origin;
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, assignee_id) values
  ('aaaaaaaa-0000-0000-0000-000000194b01','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000194d01','B1','todo',null),
  ('aaaaaaaa-0000-0000-0000-000000194b02','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000194d02','B2','todo',null),
  ('aaaaaaaa-0000-0000-0000-000000194b03','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000194d03','B3','todo',null),
  ('aaaaaaaa-0000-0000-0000-000000194b04','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000194d04','B4','todo',null),
  ('aaaaaaaa-0000-0000-0000-000000194c04','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000194d04','C4','todo',null),
  ('aaaaaaaa-0000-0000-0000-000000194b05','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000194d05','B5','todo',null);

-- Cancelled: the last open task goes, one was approved — it closes.
update sub_tasks set status = 'cancelled' where id = 'aaaaaaaa-0000-0000-0000-000000194b01';
select is((select state::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-000000194d01'), 'approved',
  'cancelling the last open task closes the deliverable when one task was approved');

-- Deleted: a plan nobody was given is removed — the same.
delete from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-000000194b02';
select is((select state::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-000000194d02'), 'approved',
  'deleting the last open task closes it too');

-- Nothing was ever approved: every task called off is not "Approved".
update sub_tasks set status = 'cancelled' where id = 'aaaaaaaa-0000-0000-0000-000000194b03';
select is((select state::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-000000194d03'), 'in_progress',
  'a deliverable whose every task was called off stays In progress');

-- One still open: cancelling another changes nothing.
update sub_tasks set status = 'cancelled' where id = 'aaaaaaaa-0000-0000-0000-000000194b04';
select is((select state::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-000000194d04'), 'in_progress',
  'while a task is still open, a cancel does not close it');
update sub_tasks set status = 'cancelled' where id = 'aaaaaaaa-0000-0000-0000-000000194c04';
select is((select state::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-000000194d04'), 'approved',
  'and cancelling the last one does');

-- Blocked: only In progress closes; the cancel itself still succeeds.
select lives_ok($$ update sub_tasks set status = 'cancelled' where id = 'aaaaaaaa-0000-0000-0000-000000194b05' $$,
  'cancelling on a blocked deliverable succeeds');
select is((select state::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-000000194d05'), 'blocked',
  'and the blocked deliverable stays blocked');

-- Security definer, pinned search_path (AGENTS.md).
select ok((select prosecdef and proconfig::text like '%search_path%' from pg_proc
            where oid = 'app.tg_close_settled_deliverable()'::regprocedure),
  'the trigger function is security definer with a pinned search_path');

select * from finish();
rollback;
