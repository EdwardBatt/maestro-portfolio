-- ADR-0030 (I8.4): sub-task-grain notifications.
--   changes_requested → the sub-task's assignee, when a reviewer reopens their task.
--   dependency_ready   → a downstream owner, when the prerequisite they were waiting on is submitted.
-- Emitted inside the action functions (SECURITY DEFINER, so they can write for another recipient);
-- the existing notifications broadcast + email triggers carry them onward.

-- new notification type for the dependency-satisfied ping
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('assigned','review_requested','changes_requested','signed_off','blocked','due_soon','dependency_ready'));

-- ---- Submit: also ping any downstream task now unblocked ----
create or replace function app.sub_task_submit(p_id uuid, p_manual_minutes numeric default null)
returns void language plpgsql security definer set search_path = public, app as $$
declare v sub_tasks; v_open task_time_entries;
begin
  select * into v from sub_tasks where id = p_id;
  if v.id is null then raise exception 'sub_task % not found', p_id using errcode = 'P0002'; end if;
  if v.assignee_id is distinct from auth.uid() then
    raise exception 'only the assignee may submit this task' using errcode = '42501';
  end if;
  if v.status not in ('todo', 'in_progress') then
    raise exception 'task cannot be submitted from % (only todo or in_progress)', v.status using errcode = '22023';
  end if;

  select * into v_open from task_time_entries
    where sub_task_id = p_id and round = v.revision_number and submitted_at is null;
  if v_open.id is not null then
    update task_time_entries
      set submitted_at = now(), minutes = round(extract(epoch from (now() - started_at)) / 60.0, 1)
      where id = v_open.id;
  else
    if p_manual_minutes is null or p_manual_minutes <= 0 then
      raise exception 'submitting without a running timer requires manual minutes (> 0)' using errcode = '22023';
    end if;
    insert into task_time_entries (tenant_id, sub_task_id, user_id, round, submitted_at, minutes, mode)
    values (v.tenant_id, p_id, auth.uid(), v.revision_number, now(), p_manual_minutes, 'manual');
  end if;

  update sub_tasks set status = 'review' where id = p_id;

  -- notify downstream tasks whose prerequisites are now ALL satisfied (the payoff of the dep model)
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
  select b.tenant_id, b.assignee_id, 'dependency_ready', b.title, 'sub_task', b.id, auth.uid()
  from sub_task_dependencies dep
  join sub_tasks b on b.id = dep.sub_task_id
  where dep.depends_on_sub_task_id = p_id
    and b.assignee_id is not null and b.assignee_id is distinct from auth.uid()
    and not app.sub_task_has_unmet_prereqs(b.id);
end $$;

-- ---- Request Changes: also notify the assignee whose task was reopened ----
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

  select exists (
    select 1 from review_feedback rf
    join media_records mr on mr.id = rf.media_record_id
    where mr.deliverable_id = v.deliverable_id and coalesce(rf.resolved, false) = false
  ) into v_has_comment;
  if not v_has_comment then
    raise exception 'a change description (an unresolved review comment) is required to request changes'
      using errcode = '55000';
  end if;

  update sub_tasks set status = 'in_progress', revision_number = revision_number + 1 where id = p_sub_task;

  -- notify the assignee that changes were requested on their task
  if v.assignee_id is not null and v.assignee_id is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
    values (v.tenant_id, v.assignee_id, 'changes_requested', v.title, 'sub_task', p_sub_task, auth.uid());
  end if;

  select state into v_deliv_state from deliverables where id = v.deliverable_id;
  if v_deliv_state = 'in_review' then
    update deliverables set state = 'in_progress' where id = v.deliverable_id;
  end if;
end $$;
