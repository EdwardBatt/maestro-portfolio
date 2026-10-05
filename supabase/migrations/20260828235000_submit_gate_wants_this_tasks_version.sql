-- I25.3 (ADR-0058 d.5) — the submit gate asks for the SUBMITTING TASK'S OWN version.
--
-- This is the line that made six approvals of one file possible. `app.sub_task_submit` refuses a
-- submission with nothing to review — but it asked whether the DELIVERABLE had a version at this
-- round, not whether this task did. So under one deliverable, the first person to upload satisfied
-- the gate for everybody.
--
-- Nobody hit it, because until ADR-0052 a deliverable rarely held more than one task. Laying a
-- whole workflow's tasks down at once is exactly what would have hit it.
--
-- Reproduced from `20260824150000` with the marked change; that is the current definition
-- (`grep -ln "function app.sub_task_submit" supabase/migrations/*.sql | tail -1`).

begin;

create or replace function app.sub_task_submit(p_id uuid, p_manual_minutes numeric default null)
returns void language plpgsql security definer set search_path = public, app as $$
declare v sub_tasks; v_open task_time_entries; v_round integer;
begin
  select * into v from sub_tasks where id = p_id;
  if v.id is null then raise exception 'sub_task % not found', p_id using errcode = 'P0002'; end if;
  if v.assignee_id is distinct from auth.uid() then
    raise exception 'only the assignee may submit this task' using errcode = '42501';
  end if;
  if v.status not in ('todo', 'in_progress') then
    raise exception 'task cannot be submitted from % (only todo or in_progress)', v.status using errcode = '22023';
  end if;

  -- I11.9, corrected by ADR-0058 d.5 (I25.3). THIS round must have something to review — and it
  -- must be THIS TASK'S something.
  --
  -- The old predicate asked only `m.deliverable_id = v.deliverable_id`, so ANY version on the
  -- deliverable at this round satisfied it. With six sub-tasks under one deliverable, one person
  -- uploaded one file and all six passed their gate: six approvals, five of them of something
  -- nobody looked at. That is the defect ADR-0058 exists to fix, and it was a gap in the UPLOAD
  -- path — not, as an earlier reading had it, proof that review is per-deliverable.
  --
  -- A task with no deliverable is still exempt: it can hold no version at all.
  if v.deliverable_id is not null then
    select d.revision_round + 1 into v_round from deliverables d where d.id = v.deliverable_id;
    if not exists (
      select 1 from media_records m
      where m.round = v_round
        and (
          -- The task's own artefact. This is the rule from here on.
          m.sub_task_id = p_id
          -- Legacy: a version uploaded before the container model has no sub_task_id, and the
          -- backfill could not attach it because its deliverable holds more than one task. Those
          -- rows still satisfy the gate for the deliverable they belong to, because refusing them
          -- would strand work that was legitimately submitted under the old rule. New uploads
          -- always carry a sub_task_id, so this arm narrows to nothing over time rather than
          -- being a permanent hole.
          or (m.sub_task_id is null and m.deliverable_id = v.deliverable_id)
        )
    ) then
      raise exception 'attach this round''s version before submitting for review'
        using errcode = '55000';
    end if;
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

comment on function app.sub_task_submit(uuid, numeric) is
  'ADR-0030 + I11.9, corrected by ADR-0058 d.5: the assignee submits a task for review. Requires a '
  'version stamped with THIS round AND belonging to THIS TASK — a submission with nothing of its '
  'own to review is refused in the database, not only on screen. Versions predating the container '
  'model, which carry no sub_task_id, still satisfy the gate for their deliverable.';

commit;
