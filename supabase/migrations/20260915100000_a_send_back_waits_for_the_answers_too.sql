-- ADR-0089 addendum d.14–d.16 (15 Sep) — I48.37: a send-back waits for the optional answers too.
--
-- WHY. d.6 gated only the completing approval; "requesting changes by anyone is never gated".
-- Edward, reviewing guide 8 against the product: "both feedback and approval should be blocked —
-- it is far more efficient to have one consolidated round of feedback rather than multiple
-- different rounds from individuals." So the same wait, the same errcode (55089), the same names.
--
-- ONE function re-emitted WHOLE from 20260830090000 — its latest definition; 20260911100000 named
-- it as deliberately untouched, which this reverses. The only edit is the gate after the
-- change-description check, marked d.14. Nothing else about a send-back changes: it still needs an
-- unresolved comment, still reopens to todo, still clears every approval and answer for the next
-- round (tg_subtask_clear_approvals).

begin;

create or replace function app.sub_task_request_changes(p_sub_task uuid)
returns void language plpgsql security definer set search_path = public, app, extensions as $$
declare v sub_tasks; v_deliv_state deliverable_state; v_has_comment boolean; v_unanswered text;
begin
  if not app.has_permission('reviews', 'moderate') then
    raise exception 'requesting changes requires reviews:moderate' using errcode = '42501';
  end if;
  select * into v from sub_tasks where id = p_sub_task and tenant_id = app.current_tenant_id();
  if v.id is null then raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002'; end if;
  if v.status <> 'review' then
    raise exception 'changes can only be requested on a submitted (review) sub-task (is %)', v.status using errcode = '22023';
  end if;

  -- A change description is mandatory: an unresolved comment on this deliverable's media (as
  -- before) OR on this task itself (ADR-0059 d.7). Reopening a task without saying what to change
  -- is not allowed, whichever way the work was reviewed.
  --
  -- **The task arm excludes the ASSIGNEE'S own comments, and that exclusion is the whole point.**
  -- A manual submission IS an unresolved comment on the task — it is what d.6 requires instead of a
  -- file. Counting it here would mean every manual task arrived already satisfying its own
  -- send-back gate, and a reviewer could reopen the work without saying a word. The media arm needs
  -- no such clause because uploading a file writes no comment.
  select exists (
    select 1 from review_feedback rf
     where coalesce(rf.resolved, false) = false
       and (
         (rf.sub_task_id = p_sub_task and rf.author_user_id is distinct from v.assignee_id)
         or exists (
           select 1 from media_records mr
            where mr.id = rf.media_record_id and mr.deliverable_id = v.deliverable_id
         )
       )
  ) into v_has_comment;
  if not v_has_comment then
    raise exception 'a change description (an unresolved review comment) is required to request changes'
      using errcode = '55000';
  end if;

  -- ADR-0089 addendum d.14 (I48.37): one consolidated round. A send-back waits for every optional
  -- answer exactly as the completing approval does — the maker hears from everyone once, on one
  -- version, not one send-back per reviewer. The caller's own press is their answer (an optional
  -- reviewer sending it back has spoken); a second REQUIRED reviewer's outstanding approval does
  -- not hold it — only optional answers do. Same errcode and shape as sub_task_approve's gate, so
  -- the screen shows one message for both. No "send back anyway": the way through is removal (d.7).
  select string_agg(coalesce(up.display_name, r.user_id::text), ', ' order by up.display_name)
    into v_unanswered
    from sub_task_reviewers r
    left join user_profiles up on up.id = r.user_id
   where r.sub_task_id = p_sub_task
     and not r.is_mandatory
     and r.responded_at is null
     and r.user_id <> auth.uid();
  if v_unanswered is not null then
    raise exception 'this would send the work back before every reviewer has answered: %',
      v_unanswered using errcode = '55089';
  end if;

  -- Reopen to TODO (not in_progress) so the maker Starts a fresh timed round before resubmitting.
  -- This statement is also what clears every approval on the task, via app.tg_subtask_clear_approvals
  -- (ADR-0043 d.6): an approval is an approval OF what was submitted, and that rule is owned by the
  -- status change rather than by this RPC.
  update sub_tasks set status = 'todo', revision_number = revision_number + 1 where id = p_sub_task;

  if v.assignee_id is not null and v.assignee_id is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
    values (v.tenant_id, v.assignee_id, 'changes_requested', v.title, 'sub_task', p_sub_task, auth.uid());
  end if;

  select state into v_deliv_state from deliverables where id = v.deliverable_id;
  if v_deliv_state = 'in_review' then
    update deliverables set state = 'in_progress' where id = v.deliverable_id;
  end if;
end $$;

comment on function app.sub_task_request_changes(uuid) is
  'ADR-0030/0035, amended by ADR-0043 d.6, ADR-0059 d.8 and ADR-0089 addendum d.14: reopen a '
  'submitted task to todo for a fresh timed round. Needs an unresolved comment (on the '
  'deliverable''s media or on the task itself), and — one consolidated round — refuses with 55089, '
  'naming who, while any optional reviewer other than the caller has not answered.';

commit;
