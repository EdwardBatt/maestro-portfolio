-- ADR-0030 (I8.2): the deliverable approval gate + sub-task Request Changes.
--
-- A deliverable may only enter review or be approved when EVERY sub-task is submitted
-- (status in review/done/cancelled). A reopened/unsubmitted sub-task holds the gate shut. Request
-- Changes reopens a specific sub-task (revision_number++), REQUIRES a change description (a review
-- comment — ADR-0025), and sends the deliverable back — so approval can't happen until it's redone.
-- Amends the deliverable transition guard (ADR-0024/0025) by adding the readiness gate.

create or replace function app.tg_deliverable_transition_guard() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_actor   uuid := auth.uid();
  has_manage boolean := app.has_permission('project_tasks', 'manage');
  has_review boolean := app.has_permission('reviews', 'moderate');
  allowed   deliverable_state[];
  ev        text := null;
  att       attribution_party := null;
begin
  -- Reviewer-only actors may change nothing but the workflow state.
  if not has_manage then
    if new.name        is distinct from old.name
       or new.stream_id is distinct from old.stream_id
       or new.job_id    is distinct from old.job_id
       or new.due_at    is distinct from old.due_at
       or new.revision_limit is distinct from old.revision_limit
       or new.tenant_id is distinct from old.tenant_id then
      raise exception 'deliverable: reviewers may change only workflow state' using errcode = '42501';
    end if;
  end if;

  -- Nothing to police unless the workflow state actually moves.
  if new.state is not distinct from old.state then
    new.revision_round := old.revision_round;   -- never client-writable
    return new;
  end if;

  -- Legal transition graph (ADR-0024).
  allowed := case old.state
    when 'draft'       then array['in_progress','archived']::deliverable_state[]
    when 'in_progress' then array['in_review','blocked','archived']::deliverable_state[]
    when 'blocked'     then array['in_progress','archived']::deliverable_state[]
    when 'in_review'   then array['approved','in_progress']::deliverable_state[]
    when 'approved'    then array['delivered','in_progress','archived']::deliverable_state[]
    when 'delivered'   then array['archived','in_progress']::deliverable_state[]
    when 'archived'    then array[]::deliverable_state[]
    else array[]::deliverable_state[]
  end;
  if not (new.state = any(allowed)) then
    raise exception 'deliverable: illegal transition % -> %', old.state, new.state using errcode = '22023';
  end if;

  -- ADR-0030 readiness gate: review/approval need every sub-task submitted. An open (todo/
  -- in_progress) sub-task — including one reopened by Request Changes — holds the gate shut.
  if new.state in ('in_review', 'approved') then
    if exists (select 1 from sub_tasks st
               where st.deliverable_id = new.id and st.status in ('todo', 'in_progress', 'blocked')) then
      raise exception 'deliverable: every sub-task must be submitted before % (open sub-tasks remain)', new.state
        using errcode = '55000';
    end if;
  end if;

  -- Authority per transition.
  if new.state = 'approved' then
    if not has_review then
      raise exception 'deliverable: sign-off (-> approved) requires reviews:moderate' using errcode = '42501';
    end if;
  elsif old.state = 'in_review' and new.state = 'in_progress' then
    if not (has_review or has_manage) then
      raise exception 'deliverable: send-back requires reviews:moderate or project_tasks:manage' using errcode = '42501';
    end if;
  else
    if not has_manage then
      raise exception 'deliverable: this transition requires project_tasks:manage' using errcode = '42501';
    end if;
  end if;

  -- Revision round: a rework cycle (back into in_progress from review/approved) counts a round.
  if new.state = 'in_progress' and old.state in ('in_review','approved') then
    new.revision_round := old.revision_round + 1;
  else
    new.revision_round := old.revision_round;
  end if;

  -- Append-only event for the accountability log (Phase 2 reads this).
  if new.state = 'approved' then ev := 'approved'; att := 'approver';
  elsif old.state = 'in_review' and new.state = 'in_progress' then ev := 'revision_requested'; att := 'assignee';
  elsif new.state = 'blocked' then ev := 'blocked_flagged'; att := 'dependency';
  elsif old.state = 'blocked' and new.state = 'in_progress' then ev := 'block_cleared'; att := null;
  end if;
  if ev is not null then
    insert into sla_events (tenant_id, deliverable_id, event_type, attributed_to, actor_user_id, payload)
    values (old.tenant_id, old.id, ev, att, v_actor,
            jsonb_build_object('from', old.state, 'to', new.state, 'revision_round', new.revision_round));
  end if;

  return new;
end $$;

-- ---- Request Changes: reopen a specific sub-task, with a MANDATORY change description ----
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

  -- MANDATORY change description: at least one unresolved review comment on the deliverable's media.
  -- Reopening a task without saying what to change is not allowed (ADR-0030).
  select exists (
    select 1 from review_feedback rf
    join media_records mr on mr.id = rf.media_record_id
    where mr.deliverable_id = v.deliverable_id and coalesce(rf.resolved, false) = false
  ) into v_has_comment;
  if not v_has_comment then
    raise exception 'a change description (an unresolved review comment) is required to request changes'
      using errcode = '55000';
  end if;

  -- reopen the sub-task for a new round
  update sub_tasks set status = 'in_progress', revision_number = revision_number + 1 where id = p_sub_task;

  -- send the deliverable back if it is in review (fires the guard → revision_round++ + event)
  select state into v_deliv_state from deliverables where id = v.deliverable_id;
  if v_deliv_state = 'in_review' then
    update deliverables set state = 'in_progress' where id = v.deliverable_id;
  end if;
end $$;
comment on function app.sub_task_request_changes(uuid) is
  'ADR-0030: reviewer reopens a submitted sub-task (revision_number++) — requires an unresolved review comment (the change description); sends the deliverable back to in_progress. Blocks approval until resubmitted.';
grant execute on function app.sub_task_request_changes(uuid) to authenticated;
