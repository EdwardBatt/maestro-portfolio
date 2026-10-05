-- I36.3 (ADR-0069 d.2/d.4) — submitting no longer says "you can start".
--
-- FOUND WHILE BUILDING, AND IT CORRECTS ADR-0069's CONTEXT. That ADR says nothing emits a "your
-- input has landed" event. **That is wrong.** `app.sub_task_submit` has emitted `dependency_ready`
-- since ADR-0030 (I8.4) — on SUBMIT, which was correct while §1b made submission the moment a
-- dependency was satisfied. The DECISION is unaffected: d.4 still says the notification belongs at
-- approval. What changes is that this is a MOVE, not an addition.
--
-- AND AFTER d.2 THE OLD BLOCK CANNOT FIRE AT ALL. Its own guard is
-- `not app.sub_task_has_unmet_prereqs(b.id)`, evaluated immediately after the prerequisite reaches
-- `review` — and `review` no longer satisfies, so the dependent always still has an unmet
-- requirement and the insert selects nothing, for ever. Left in place it would be dead code whose
-- comment claims to be "the payoff of the dep model", which is precisely the kind of statement that
-- outlives its truth and misleads the next reader. Removed here, deliberately and in the open.
--
-- The notification now comes from `app.tg_sub_task_dependents_ready` (previous migration), which
-- hangs off the status reaching `done` rather than off any one function that sets it.
--
-- Reproduced WHOLE from `20260830090000_review_mode_digital_or_manual.sql`, the house pattern for
-- `create or replace`: a bare replace resets `proconfig` and silently drops the ADR-0033
-- `search_path` pin. The ONLY edit is the removal of the block described above.

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
    -- I11.9, corrected by ADR-0058 d.5 (I25.3). THIS round must have something to review — and it
    -- must be THIS TASK'S something.
    --
    -- The old predicate asked only `m.deliverable_id = v.deliverable_id`, so ANY version on the
    -- deliverable at this round satisfied it. With six sub-tasks under one deliverable, one person
    -- uploaded one file and all six passed their gate: six approvals, five of them of something
    -- nobody looked at.
    --
    -- A task with no deliverable is still exempt: it can hold no version at all.
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
end $$;


comment on function app.sub_task_submit(uuid, numeric) is
  'ADR-0030 §1 as amended by ADR-0069 d.2: stops the clock and moves the task to review. It no '
  'longer pings downstream tasks — submission is no longer what satisfies a dependency, so that '
  'ping would have been a promise the reader could not act on. Approval sends it now.';

commit;
