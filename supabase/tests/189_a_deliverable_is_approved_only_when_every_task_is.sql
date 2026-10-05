-- 20260927180000 (ADR-0118, I59.60) — a deliverable is approved only when EVERY task is done or cancelled.
-- An unassigned, unstarted task holds it open: neither the automatic close after a task approval nor a
-- direct sign-off gets past it. Once that task is cancelled, the deliverable closes (ADR-0118 addendum).
begin;
select plan(5);
\ir helpers/seed.sql

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000189501','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S189');
insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id, reviewer_id, due_at) values
  ('aaaaaaaa-0000-0000-0000-000000189d01','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000189501',
   'Piece 189','in_progress','00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-00000000a001', now() + interval '10 days');

-- A: worked and in review, with its reviewer's approval given. B: on the list, nobody on it, never started.
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, assignee_id, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-000000189a01','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000189d01',
   'Creative Direction — Piece 189','review','00000000-0000-0000-0000-00000000a003', 4),
  ('aaaaaaaa-0000-0000-0000-000000189a02','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000189d01',
   'Write Copy — Piece 189','todo',null, null);
-- Assigning A put the deliverable's reviewer on it; that reviewer has approved. `approved_at` is written only
-- by the review itself (ADR-0043 d.1), so the fixture sets it with triggers paused for this one statement.
set local session_replication_role = replica;
update sub_task_reviewers set approved_at = now(), is_mandatory = true
 where sub_task_id = 'aaaaaaaa-0000-0000-0000-000000189a01';
set local session_replication_role = origin;

select is(app.maybe_complete_sub_task('aaaaaaaa-0000-0000-0000-000000189a01'), true, 'task A is approved');
select is((select state::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-000000189d01'), 'in_progress',
  'and the deliverable stays In progress — task B, unassigned and unstarted, holds it (ADR-0118 d.1)');

select throws_ok($$
  update deliverables set state = 'approved' where id = 'aaaaaaaa-0000-0000-0000-000000189d01'
$$, '55000', 'deliverable: every sub-task must be APPROVED before sign-off (ADR-0038)',
  'a direct sign-off is refused too while B is open');

-- Since the ADR-0118 addendum (I65.4, 20260928160000) the cancel itself closes it — the roll-up an approval runs.
select lives_ok($$
  update sub_tasks set status = 'cancelled' where id = 'aaaaaaaa-0000-0000-0000-000000189a02'
$$, 'B is cancelled');
select is((select state::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-000000189d01'), 'approved',
  'every task is done or cancelled, one approved: it closes itself — Approved');

select * from finish();
rollback;
