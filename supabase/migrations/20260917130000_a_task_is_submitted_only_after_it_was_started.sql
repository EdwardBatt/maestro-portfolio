-- I52.15 (Edward, 17 Sep) — a task is submitted for review only after it was started.
--
-- Edward: "users are not selecting start and somehow they are submitting items for review".
-- They are not: the only submit door (My Work) sends no manual minutes, so an unstarted task has
-- no running timer and app.sub_task_submit refuses it. What they saw was a stale list (I52.9's
-- class — fixed in the client alongside this). But the function DID accept `todo` when manual
-- minutes were supplied, so a direct call could put an unstarted task in review. The rule that the
-- button already implied is now the database's: submit only from in_progress, worded.
--
-- Reproduced WHOLE from the live definition (pg_get_functiondef, 17 Sep; last written in
-- 20260914150000), search_path pinned. The one edit is marked.

begin;

CREATE OR REPLACE FUNCTION app.sub_task_submit(p_id uuid, p_manual_minutes numeric DEFAULT NULL::numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 set search_path = public, app
AS $$
declare v sub_tasks; v_open task_time_entries; v_round integer; v_deliv_round integer;
begin
  select * into v from sub_tasks where id = p_id;
  if v.id is null then raise exception 'sub_task % not found', p_id using errcode = 'P0002'; end if;
  if v.assignee_id is distinct from auth.uid() then
    raise exception 'only the assignee may submit this task' using errcode = '42501';
  end if;
  -- I52.15 (Edward, 17 Sep): a task is submitted only after it was STARTED. The screen already
  -- offers Submit only from in_progress; the function accepted todo too, and with manual minutes
  -- an unstarted task could reach review by a direct call. The rule is now the database's.
  if v.status <> 'in_progress' then
    raise exception 'start the task before submitting it for review (it is %)', v.status using errcode = '22023';
  end if;

  if v.review_mode = 'manual' then
    -- ADR-0059 d.6. Physical work has no file, so the artefact is the account of it: "Shot 4
    -- setups, all approved on set". It must be THIS round's and THIS person's — a reviewer's
    -- comment is not the maker saying what they did, and last round's note is not this round's.
    --
    -- **Submitting with nothing at all is still refused**, in both modes and for the same reason: a
    -- reviewer asked to approve nothing is being asked to rubber-stamp. That is the rule ADR-0058
    -- d.5 exists to enforce; this changes what counts as something, never whether something is
    -- needed.
    if not exists (
      select 1 from review_feedback rf
       where rf.sub_task_id = p_id
         and rf.round = app.task_review_round(p_id)
         and rf.author_user_id = auth.uid()
    ) then
      raise exception 'describe what you did before submitting this task for review'
        using errcode = '55000';
    end if;

  elsif v.deliverable_id is not null then
    -- I11.9, corrected by ADR-0058 d.5 (I25.3) and d.15. THIS round must have something to
    -- review — and it must be THIS TASK'S something, at THIS TASK'S round.
    --
    -- The old predicate asked only `m.deliverable_id = v.deliverable_id`, so ANY version on the
    -- deliverable at this round satisfied it. With six sub-tasks under one deliverable, one person
    -- uploaded one file and all six passed their gate: six approvals, five of them of something
    -- nobody looked at. And the round it asked for was the DELIVERABLE's, which a task send-back
    -- never moves — so last round's file satisfied this round (I48.33).
    --
    -- A task with no deliverable is still exempt: it can hold no version at all.
    v_round := app.task_review_round(p_id);                                                   -- d.15
    select d.revision_round + 1 into v_deliv_round from deliverables d where d.id = v.deliverable_id;
    if not exists (
      select 1 from media_records m
      where (
          -- The task's own artefact, at the task's own round. This is the rule from here on.
          (m.sub_task_id = p_id and m.round = v_round)
          -- Legacy: a version uploaded before the container model has no sub_task_id, and the
          -- backfill could not attach it because its deliverable holds more than one task. Those
          -- rows still satisfy the gate for the deliverable they belong to, at the deliverable's
          -- round they were stamped with, because refusing them would strand work that was
          -- legitimately submitted under the old rule. New uploads always carry a sub_task_id, so
          -- this arm narrows to nothing over time rather than being a permanent hole.
          or (m.sub_task_id is null and m.deliverable_id = v.deliverable_id and m.round = v_deliv_round)
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
end $$;

commit;
