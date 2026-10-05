-- ADR-0080 (I42.1) — archiving a job calls off the work under it.
--
-- WHAT BROKE. `public.sub_task_cancel` archives an ad-hoc job only when no live task remains — it
-- counts first, and it is correct. The container's own transition is unguarded in the other
-- direction: `20260908150000`'s graph makes `archived` reachable from `draft`, `in_progress`,
-- `blocked`, `approved` and `delivered`, and nothing on that path looks at the tasks. So archiving
-- a deliverable with somebody assigned leaves a live task under a dead container.
--
-- Measured on the live tenant, 9 Sep: a handful of tasks across several people. Three of them are one person's
-- ("Al Waha KV"), and they are UNREACHABLE — `DeliverablesPage.tsx:819` hides every task
-- control when the container is `approved` or `archived`, so a finished row's modal offers no
-- Cancel; the assignee has no authority to cancel her own work; and `archived` is terminal
-- (ADR-0024), so the container cannot be reopened to get at the task. No surface in the product can
-- settle those rows. That is why section 2 exists and is not optional tidying.
--
-- The system already names this state as wrong: `20260903120000` refuses `sub_task_reinstate`
-- rather than "produce a live task under a dead container". It guards one route in. This guards the
-- door people actually walk through.
--
-- WHAT THIS DOES NOT CHANGE, because it is the first question anyone asks (Edward did): cancelling
-- ONE task of ten. `public.sub_task_cancel` is untouched. It cancels that task, releases that
-- task's bookings, notifies that assignee, and then counts what is still live — nine, so the
-- container is not archived and the other nine are not touched. Only the LAST cancellation empties
-- an ad-hoc container, and when it does, the trigger below finds nothing left to call off. The two
-- rules meet at zero and never fight.

begin;

-- ---------------------------------------------------------------------------------------------
-- 1. Archiving cancels the live work underneath it (ADR-0080 d.1–d.4).
--
-- AFTER, not inside the BEFORE guard. `app.tg_deliverable_transition_guard` shapes the row being
-- written — revision round, unassigned count, the sla_events row — and has been reproduced verbatim
-- across four migrations. A cascade added to it would be copied forward by every future
-- reproduction, which is how `20260908150000` inherited a dead `in_review` arm in the first place.
-- This is a separate trigger with one job, and the guard is left alone.
--
-- SECURITY DEFINER is authorised by ADR-0080 d.6: the archiver's authority carries the
-- cancellations, so this writes tasks the actor may not hold `project_tasks:manage` over. That is
-- the one clause of the ADR that widens an authority; it is made safe by being loud (every assignee
-- is notified, d.4) rather than by being narrow. search_path pinned per AGENTS.md §6.
--
-- ONE STATEMENT, no temporary table. A first cut collected the victims into a temp table, which
-- fails the SECOND time the trigger fires in one transaction — "relation _called_off already
-- exists" — and archiving two deliverables in one transaction is ordinary. Data-modifying CTEs are
-- the right shape here and Postgres guarantees each executes exactly once and to completion,
-- whether or not the primary query reads it, so the DELETE cannot be skipped for being unreferenced.
--
-- NO RECURSION. Updating `sub_tasks.status` fires `subtask_clear_approvals` (voids reviewer
-- verdicts — correct, ADR-0043 d.6: an approval belongs to a version) and `subtask_notify_reviewer`
-- (returns immediately unless the new status is `review`). Neither writes to `deliverables`. The
-- archive-on-cancel rule lives inside `public.sub_task_cancel`, which is a function and not a
-- trigger, so a status write cannot re-enter this.
create or replace function app.tg_deliverable_archive_calls_off_work() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare v_actor uuid := auth.uid();
begin
  -- `done` and `cancelled` are excluded: an approved task is the record of something that actually
  -- happened, and archiving the job afterwards must not rewrite it (ADR-0080 d.1).
  with called_off as (
    update sub_tasks st
       set status = 'cancelled'
     where st.deliverable_id = new.id
       and st.status not in ('done', 'cancelled')
    returning st.id, st.tenant_id, st.title, st.assignee_id
  ),
  -- Free the calendar, for the same reason public.sub_task_cancel does: cancelled work must stop
  -- consuming capacity, or the schedule keeps telling everyone that person is busy.
  freed as (
    delete from bookings b where b.sub_task_id in (select id from called_off)
  )
  -- ADR-0080 d.4. The whole point of the rule is that work leaving somebody's list is something the
  -- system did on purpose and said so. The same notification type `public.sub_task_cancel` sends,
  -- so the inbox and `notify-email`'s COPY map need nothing new. The actor is excepted from being
  -- told about their own act, as every other notify path here does it.
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
  select c.tenant_id, c.assignee_id, 'cancelled', c.title, 'sub_task', c.id, v_actor
    from called_off c
   where c.assignee_id is not null
     and c.assignee_id is distinct from v_actor;

  return null;
end $$;

comment on function app.tg_deliverable_archive_calls_off_work() is
  'ADR-0080 d.1: archiving a deliverable cancels every task under it that is not already done or '
  'cancelled, releases their bookings and tells their assignees. security definer per d.6 — the '
  'archiver''s authority carries the cancellations, which is the one clause of that ADR widening an '
  'authority and is made safe by the notification rather than by a narrower check.';

create trigger deliverable_archive_calls_off_work
  after update of state on deliverables
  for each row
  when (new.state = 'archived' and old.state is distinct from 'archived')
  execute function app.tg_deliverable_archive_calls_off_work();

-- ---------------------------------------------------------------------------------------------
-- 2. The rows already stranded (ADR-0080 d.9).
--
-- Six tasks, four people, as measured — but written as the general condition rather than as six
-- ids, the shape `20260908170000` established, so it cannot matter how many there are by the time
-- this runs.
--
-- `delivered` is deliberately NOT swept. ADR-0080 d.12 leaves `approved -> delivered` open, and d.8
-- (the My Work classifier, in `src/`) covers the display either way. Cancelling work under a
-- container that shipped is a different decision and does not get made by a migration written for
-- archiving.
--
-- `actor_id` null on the notification: no person pressed anything, and the inbox already renders a
-- null actor as the system. Sending nothing was the alternative and it is the one d.4 exists to
-- refuse — these people have been carrying this work on their list for up to two weeks.
set local app.system_op = 'on';

with stranded as (
  update sub_tasks st
     set status = 'cancelled'
    from deliverables d
   where d.id = st.deliverable_id
     and d.state = 'archived'
     and st.status not in ('done', 'cancelled')
  returning st.id, st.tenant_id, st.title, st.assignee_id
),
freed as (
  delete from bookings b where b.sub_task_id in (select id from stranded)
)
insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
select s.tenant_id, s.assignee_id, 'cancelled', s.title, 'sub_task', s.id, null
  from stranded s
 where s.assignee_id is not null;

commit;
