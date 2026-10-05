-- I68.5 (ADR-0132 d.4, Edward 30 Sep): a task added to a deliverable whose task list is already approved.
--
--   * Added by the deliverable's OWNER, it counts as approved — the list stays approved, the task can be assigned at once.
--     The owner is the person who approves the list (ADR-0100 d.2); asking them to approve their own addition is a step
--     with nothing in it.
--   * Added by anyone else (a lead, the account manager, Traffic), the list's approval is cleared and it waits for the
--     owner again — the Needs-you "approve the task list" card (my_pending_approvals, ADR-0119) appears for the owner.
--
-- Until now an insert left the approval as it was for everyone, so a lead's added task was assignable without the owner
-- ever seeing it — the second gate had a side door.
--
-- Not affected: system work (no signed-in caller, or `app.is_system_op()`), a list not yet approved (it waits anyway), a
-- deliverable with no owner (nobody could approve it again — clearing it would strand the work), and
-- a type change (`change_deliverable_type`, ADR-0132 d.3), which sets the approval itself after the new list is written.
--
-- Adding a task needs only its title (and, on screen, its due date): `save_sub_task` inserts with every other column
-- optional — unassigned, no hours (hours are asked when the task is assigned, I59: "a task is assigned only with its
-- hours"), the deliverable's department. No change to it here.

begin;

create or replace function app.tg_subtask_added_to_an_approved_list() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_owner    uuid;
  v_approved timestamptz;
  v_prior    text;
begin
  if auth.uid() is null or app.is_system_op()
     or coalesce(current_setting('app.change_request_apply', true), '') = 'on' then
    return null;
  end if;
  select d.owner_user_id, d.tasks_approved_at into v_owner, v_approved
    from deliverables d where d.id = new.deliverable_id;
  -- No owner: nobody could approve it again, so a cleared approval would strand the work. Left as it is.
  if v_approved is null or v_owner is null or v_owner = auth.uid() then
    return null;
  end if;
  v_prior := coalesce(current_setting('app.task_list_approval', true), '');
  perform set_config('app.task_list_approval', 'on', true);
  update deliverables set tasks_approved_at = null, tasks_approved_by = null where id = new.deliverable_id;
  perform set_config('app.task_list_approval', v_prior, true);
  insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload)
  values (new.tenant_id, auth.uid(), 'task_list_reopened', 'deliverables', new.deliverable_id,
          jsonb_build_object('reason', 'a task was added by someone other than the owner', 'sub_task_id', new.id,
                             'title', new.title, 'was_approved_at', v_approved));
  return null;
end $$;

comment on function app.tg_subtask_added_to_an_approved_list() is
  'I68.5 / ADR-0132 d.4: a task added to an APPROVED task list by anyone but the deliverable''s owner clears the '
  'approval, so the owner approves the list again (my_pending_approvals); the owner''s own addition keeps it. System '
  'work and a type change (change_deliverable_type, which sets the approval itself) are left alone.';

create trigger sub_tasks_added_to_an_approved_list
  after insert on sub_tasks
  for each row execute function app.tg_subtask_added_to_an_approved_list();

commit;
