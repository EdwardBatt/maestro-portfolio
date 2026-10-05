-- ADR-0030/0035 (Edward): Request Changes must give the maker a fresh, timed round.
--
-- The prior definition reopened the sub-task to `in_progress`, but with no running timer — and
-- `sub_task_submit` refuses an untimed round unless manual minutes are supplied, so the assignee
-- could never resubmit round 2. Reopen to `todo` instead: the maker Starts round N (opening a timed
-- entry for the new revision) then Submits, exactly as round 1. Everything else — the mandatory
-- unresolved comment, revision_number++, the `changes_requested` notification, sending the
-- deliverable back — is unchanged. Reproduces the authoritative definition (20260819170000) with the
-- single status change. `todo` and `in_progress` are both "open" to the approval gate, so the gate
-- semantics are unaffected.

create or replace function app.sub_task_request_changes(p_sub_task uuid)
returns void language plpgsql security definer set search_path = public, app as $$
declare v sub_tasks; v_deliv_state deliverable_state; v_has_comment boolean;
begin
  if not app.has_permission('reviews', 'moderate') then
    raise exception 'requesting changes requires reviews:moderate' using errcode = '42501';
  end if;
  select * into v from sub_tasks where id = p_sub_task;
  if v.id is null then raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002'; end if;
  if v.status <> 'review' then
    raise exception 'changes can only be requested on a submitted (review) sub-task (is %)', v.status using errcode = '22023';
  end if;

  -- a change description is mandatory: at least one unresolved review comment on this deliverable.
  select exists (
    select 1 from review_feedback rf
    join media_records mr on mr.id = rf.media_record_id
    where mr.deliverable_id = v.deliverable_id and coalesce(rf.resolved, false) = false
  ) into v_has_comment;
  if not v_has_comment then
    raise exception 'a change description (an unresolved review comment) is required to request changes'
      using errcode = '55000';
  end if;

  -- Reopen to TODO (not in_progress) so the maker Starts a fresh timed round before resubmitting.
  update sub_tasks set status = 'todo', revision_number = revision_number + 1 where id = p_sub_task;

  -- notify the assignee that changes were requested on their task
  if v.assignee_id is not null and v.assignee_id is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
    values (v.tenant_id, v.assignee_id, 'changes_requested', v.title, 'sub_task', p_sub_task, auth.uid());
  end if;

  -- send the deliverable back if it is in review (fires the guard → revision_round++ + event)
  select state into v_deliv_state from deliverables where id = v.deliverable_id;
  if v_deliv_state = 'in_review' then
    update deliverables set state = 'in_progress' where id = v.deliverable_id;
  end if;
end $$;
