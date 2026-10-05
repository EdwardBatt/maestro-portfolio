-- I53.29 — A deliverable's UNASSIGNED tasks follow its owner's department (Edward, 22 Sep).
--
-- What happened on production. A team lead was refused an assignment of her own team member on an
-- approved campaign. The deliverable's owner was in another department, so its tasks were that
-- department's work (ADR-0050 d.2, stamped at materialisation), and a team lead's reach does not
-- cover another department's work (ADR-0060 d.9). The account manager changed the owner to a
-- Creative lead — and the deliverable moved to Creative (`app.tg_deliverable_stamp_department`)
-- while its nineteen unassigned tasks kept the old department. Nothing had ever restamped them.
-- The lead was refused again, with the same wrong sentence (I53.28).
--
-- THE RULE. A task's department is the department of whoever does it; until somebody does, it is
-- the department of the deliverable's owner — the person accountable for it (ADR-0050). So when
-- the owner changes, the tasks nobody has yet been assigned follow the deliverable; a task that
-- IS assigned keeps the department of its assignee (ADR-0060 d.7, `20260830120000`), because that
-- is whose work it now is. Its team is cleared: a team is a fact about the person doing the work,
-- and there is no person.
--
-- 1. An AFTER trigger on the department change (the BEFORE trigger sets it from the owner and is
--    unchanged). SECURITY DEFINER like the stamp it follows: the owner change is authorised once,
--    by `app.tg_deliverable_owner_guard`, and the tasks' rows are its consequence, not a second
--    act needing its own grant — the same shape as `deliverable_archive_calls_off_work`.
-- 2. A correction for the rows already in this state on production: every UNASSIGNED task whose
--    department differs from its deliverable's takes the deliverable's. The count is raised as a
--    NOTICE. Assigned tasks are not touched.
--
-- What does not change: `sub_task_dependencies`, bookings (none — unassigned), the audit trail
-- (each row's change is logged by `audit_row_change`).

begin;

create or replace function app.tg_deliverable_tasks_follow_department() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
begin
  if new.department_id is not distinct from old.department_id then
    return null;
  end if;
  update sub_tasks st
     set department_id = new.department_id,
         team_id = null
   where st.deliverable_id = new.id
     and st.assignee_id is null
     and st.status <> 'cancelled'
     and (st.department_id is distinct from new.department_id or st.team_id is not null);
  return null;
end $$;

comment on function app.tg_deliverable_tasks_follow_department() is
  'I53.29 (22 Sep): when a deliverable''s department changes with its owner, its UNASSIGNED tasks '
  'take the new department and lose their team; an assigned task keeps its assignee''s (ADR-0060 '
  'd.7). SECURITY DEFINER: the owner change was authorised by tg_deliverable_owner_guard; this is '
  'its consequence.';

-- Watches the OWNER column (and the department, for a direct write): the department is set by the
-- BEFORE trigger from the owner, and a column a trigger sets is not one the statement "updated",
-- so `of department_id` alone would never fire. The function compares old and new itself.
drop trigger if exists deliverable_tasks_follow_department on deliverables;
create trigger deliverable_tasks_follow_department
  after update of owner_user_id, department_id on deliverables
  for each row execute function app.tg_deliverable_tasks_follow_department();

-- The rows already left behind.
do $$
declare
  v_count int;
begin
  update sub_tasks st
     set department_id = d.department_id,
         team_id = null
    from deliverables d
   where d.id = st.deliverable_id
     and st.assignee_id is null
     and st.status <> 'cancelled'
     and d.department_id is not null
     and st.department_id is distinct from d.department_id;
  get diagnostics v_count = row_count;
  raise notice 'I53.29: % unassigned task(s) moved to their deliverable''s department', v_count;
end $$;

commit;
