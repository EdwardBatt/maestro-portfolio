-- ADR-0058 addendum (14 Sep) d.13–d.16 — I48.33: the review round of a task is the task's own
-- `revision_number + 1`, and everything that stamps or checks a round on a task reads it.
--
-- WHY. The sub-task has been the unit of review since ADR-0058, and `sub_task_request_changes`
-- has counted its rounds (`revision_number + 1`) since 20260820030000. But `app.task_review_round`
-- still answered `coalesce(d.revision_round, st.revision_number) + 1` — the DELIVERABLE's round for
-- any task that has one — and the media stamp and the digital submit gate did the same arithmetic
-- by hand. The deliverable's round moves only on the container's own in_review → in_progress
-- transition (the tier-2 review ADR-0077 made unnecessary), which a task-level send-back never
-- fires. So under a deliverable every round was round 1, a second upload was stamped round 1, and
-- last round's file satisfied this round's submit gate. Found writing the how-to guides.
--
-- Four functions re-emitted whole; the only edits are the round arithmetic, each marked `-- d.13`
-- etc. Then a backfill by time (d.16). No new table, no RLS change, no grant change.

begin;

-- ============================================================================
-- 1) ONE home for the round, now the task's own (d.13)
-- ============================================================================
-- Reproduced from 20260830090000. The left join to deliverables is gone: a task's round is its
-- revision_number + 1 whether or not it has a deliverable. Still SECURITY INVOKER — it adds no
-- reach, exactly as before.
create or replace function app.task_review_round(p_sub_task uuid) returns integer
language sql stable set search_path = public, app, extensions as $$
  select st.revision_number + 1
    from sub_tasks st
   where st.id = p_sub_task;
$$;

comment on function app.task_review_round(uuid) is
  'ADR-0058 addendum d.13 (was ADR-0059): the review round a task is currently on, 1-based — the '
  'task''s own revision_number + 1, which sub_task_request_changes increments. The one home for '
  'arithmetic the media stamp, the feedback stamp and the submit gate all depend on. It no longer '
  'reads the deliverable''s revision_round: that counter moves only on the container''s own '
  'transition, which a task-level send-back never fires.';

-- ============================================================================
-- 2) a version stamps its round from its task (d.14)
-- ============================================================================
-- Reproduced from 20260824150000 with the task arm added. A version with no sub_task_id — the
-- legacy rows ADR-0058 d.8 could not attach — keeps the deliverable arithmetic, so their rounds
-- stay as they were recorded.
create or replace function app.tg_media_record_stamp_round() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare v_round integer;
begin
  if new.sub_task_id is not null then                                        -- d.14
    select app.task_review_round(new.sub_task_id) into v_round;
    new.round := coalesce(v_round, 1);
  else
    select d.revision_round into v_round from public.deliverables d where d.id = new.deliverable_id;
    new.round := coalesce(v_round, 0) + 1;   -- first pass (revision_round 0) → round 1
  end if;
  return new;
end $$;
comment on function app.tg_media_record_stamp_round() is
  'I11.9, amended by ADR-0058 addendum d.14: stamp media_records.round from the TASK the version '
  'belongs to (task_review_round), or from the deliverable''s revision_round for a version with no '
  'task. The client never sets it, so an upload cannot claim to belong to a round it was not made in.';

-- ============================================================================
-- 3) a comment on a version follows the version's own round (d.14)
-- ============================================================================
-- Reproduced from 20260830090000. The task arm is unchanged (it already asked task_review_round,
-- which now answers the task's own counter). The media arm reads the version's stamped round —
-- which is the task's round for a task's version and the deliverable's for a legacy one — rather
-- than recomputing the deliverable arithmetic and disagreeing with the version it sits on.
create or replace function app.tg_review_feedback_set_round()
returns trigger language plpgsql set search_path = public, app, extensions as $$
declare v_round integer;
begin
  if new.sub_task_id is not null then
    select app.task_review_round(new.sub_task_id) into v_round;
    new.round := coalesce(v_round, 1);
  else
    select m.round into v_round from media_records m where m.id = new.media_record_id;   -- d.14
    new.round := coalesce(v_round, 1);
  end if;
  new.source := 'internal';
  return new;
end $$;

comment on function app.tg_review_feedback_set_round() is
  'ADR-0025, extended by ADR-0059 d.7 and ADR-0058 addendum d.14: BEFORE INSERT — stamp '
  'review_feedback.round from the task (task_review_round) or from the version the comment sits on, '
  'and force source = internal. The client never sets either.';

-- ============================================================================
-- 4) the submit gate asks for THIS task round's version (d.15)
-- ============================================================================
-- Reproduced WHOLE from 20260903110200. The only edit is in the digital arm: the task's own
-- versions are matched against task_review_round(p_id); the legacy no-task arm keeps the
-- deliverable's arithmetic so history still satisfies the gate for the deliverable it belongs to.
create or replace function app.sub_task_submit(p_id uuid, p_manual_minutes numeric default null)
returns void language plpgsql security definer set search_path = public, app as $$
declare v sub_tasks; v_open task_time_entries; v_round integer; v_deliv_round integer;
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

comment on function app.sub_task_submit(uuid, numeric) is
  'ADR-0030 §1 as amended by ADR-0069 d.2 and ADR-0058 addendum d.15: stops the clock and moves '
  'the task to review once THIS task round carries a version (digital) or the maker''s own note '
  '(manual). It no longer pings downstream tasks — approval sends that.';

-- ============================================================================
-- 5) re-stamp by time what was misstamped (d.16)
-- ============================================================================
-- A task that has been sent back has revision_number >= 1. Its versions and task-anchored
-- comments written AFTER its most recent send-back belong to its current round; they were stamped
-- with the deliverable's round (1) instead. The send-back's moment is the `changes_requested`
-- notification it wrote — the only timestamp the send-back leaves. Nothing earlier is touched.
-- A task that was never sent back (revision_number 0) is already right: round 1 either way.
with last_sendback as (
  select n.entity_id as sub_task_id, max(n.created_at) as at
    from notifications n
   where n.type = 'changes_requested' and n.entity_type = 'sub_task'
   group by n.entity_id
)
update media_records m
   set round = st.revision_number + 1
  from sub_tasks st
  join last_sendback ls on ls.sub_task_id = st.id
 where m.sub_task_id = st.id
   and st.revision_number >= 1
   and m.created_at > ls.at
   and m.round <> st.revision_number + 1;

with last_sendback as (
  select n.entity_id as sub_task_id, max(n.created_at) as at
    from notifications n
   where n.type = 'changes_requested' and n.entity_type = 'sub_task'
   group by n.entity_id
)
update review_feedback rf
   set round = st.revision_number + 1
  from sub_tasks st
  join last_sendback ls on ls.sub_task_id = st.id
 where rf.sub_task_id = st.id
   and st.revision_number >= 1
   and rf.created_at > ls.at
   and rf.round <> st.revision_number + 1;

-- A comment on a version follows the version it sits on (d.14), including the ones just moved.
update review_feedback rf
   set round = m.round
  from media_records m
 where rf.sub_task_id is null
   and rf.media_record_id = m.id
   and m.sub_task_id is not null
   and rf.round <> m.round;

commit;
