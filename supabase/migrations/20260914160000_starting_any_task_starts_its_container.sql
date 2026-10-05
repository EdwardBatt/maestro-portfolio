-- ADR-0077 addendum d.7–d.9 (14 Sep) — I48.35: starting any task starts its container.
--
-- WHY. A container closes from in_progress (ADR-0077 d.2), and nothing moved a deliverable out of
-- draft except a person pressing Start on it — a press that needs project_tasks:manage, so the
-- maker whose task just began could not make it. Found writing guide 10: four tasks done and
-- approved, the deliverable still "Draft · 4 of 4 tasks done". Sign-off was a consequence with no
-- authority of its own; the step before it was still a button somebody had to remember.
--
-- Two functions re-emitted WHOLE — app.sub_task_start from 20260819160000 (its only definition
-- since) and app.tg_deliverable_transition_guard from 20260908150000 (the current one; checked,
-- because traps.md records what rebuilding from the wrong base costs). Each edit is marked with
-- its decision number. Then the one-time move of the rows already stuck (d.9).

begin;

-- ============================================================================
-- 1) starting any task starts its container (d.7)
-- ============================================================================
create or replace function app.sub_task_start(p_id uuid)
returns void language plpgsql security definer set search_path = public, app as $$
declare v sub_tasks;
begin
  select * into v from sub_tasks where id = p_id;
  if v.id is null then raise exception 'sub_task % not found', p_id using errcode = 'P0002'; end if;
  if v.assignee_id is distinct from auth.uid() then
    raise exception 'only the assignee may start this task' using errcode = '42501';
  end if;
  if v.status <> 'todo' then
    raise exception 'task can only be started from todo (is %)', v.status using errcode = '22023';
  end if;
  update sub_tasks set status = 'in_progress' where id = p_id;
  insert into task_time_entries (tenant_id, sub_task_id, user_id, round, started_at, mode, started_ahead)
  values (v.tenant_id, p_id, auth.uid(), v.revision_number, now(), 'timer', app.sub_task_has_unmet_prereqs(p_id));
  -- ADR-0077 addendum d.7 (I48.35): the first Start on ANY task under a Draft container is the
  -- moment work on it began. The guard's d.8 branch lets this through for the maker; after the
  -- task update above, so the started task is there for it to see.
  if v.deliverable_id is not null then
    update deliverables set state = 'in_progress'
     where id = v.deliverable_id and state = 'draft';
  end if;
end $$;

comment on function app.sub_task_start(uuid) is
  'ADR-0030 §1, amended by ADR-0069 and ADR-0077 addendum d.7: the assignee starts a todo task, '
  'opening a timed entry for the current round (started_ahead when prerequisites are unmet), and a '
  'still-draft container moves to in_progress — the first Start on any task under it is when work '
  'on it began.';

-- ============================================================================
-- 2) that transition needs no authority of its own (d.8)
-- ============================================================================
create or replace function app.tg_deliverable_transition_guard() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_actor   uuid := auth.uid();
  has_manage boolean := app.has_permission('project_tasks', 'manage');
  has_review boolean := app.has_permission('reviews', 'moderate');
  has_reassign boolean := app.has_permission('deliverable_owner', 'manage');
  allowed   deliverable_state[];
  ev        text := null;
  att       attribution_party := null;
begin
  new.unassigned_at_signoff := old.unassigned_at_signoff;

  if not has_manage and v_actor is not null and not app.is_system_op() then
    if new.name        is distinct from old.name
       or new.stream_id is distinct from old.stream_id
       or new.job_id    is distinct from old.job_id
       or new.due_at    is distinct from old.due_at
       or new.revision_limit is distinct from old.revision_limit
       or (new.owner_user_id is distinct from old.owner_user_id and not has_reassign)
       or (new.department_id is distinct from old.department_id and not has_reassign)
       or new.tenant_id is distinct from old.tenant_id then
      raise exception 'deliverable: reviewers may change only workflow state' using errcode = '42501';
    end if;
  end if;

  if new.state is not distinct from old.state then
    new.revision_round := old.revision_round;
    return new;
  end if;

  -- (a) and (b). ADR-0077 d.2/d.3.
  allowed := case old.state
    when 'draft'       then array['in_progress','archived']::deliverable_state[]
    when 'in_progress' then array['approved','in_review','blocked','archived']::deliverable_state[]
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

  -- Readiness. The `in_review` arm is kept for the rows leaving that state; unreachable in practice.
  if new.state = 'in_review' then
    if exists (select 1 from sub_tasks st
               where st.deliverable_id = new.id
                 and st.status in ('todo', 'in_progress')
                 and (st.assignee_id is not null
                      or st.status <> 'todo'
                      or exists (select 1 from task_time_entries te where te.sub_task_id = st.id))) then
      raise exception 'deliverable: every sub-task must be submitted before in_review (open sub-tasks remain)'
        using errcode = '55000';
    end if;
  end if;
  -- UNCHANGED, and it is what makes d.2 safe: a container cannot close while any task is unsettled.
  if new.state = 'approved' then
    if exists (select 1 from sub_tasks st
               where st.deliverable_id = new.id
                 and st.status not in ('done', 'cancelled')
                 and (st.assignee_id is not null
                      or st.status <> 'todo'
                      or exists (select 1 from task_time_entries te where te.sub_task_id = st.id))) then
      raise exception 'deliverable: every sub-task must be APPROVED before sign-off (ADR-0038)'
        using errcode = '55000';
    end if;
  end if;

  -- (c) Authority.
  --
  -- The whole block stands aside for a SYSTEM operation — a migration or seeder running as
  -- superuser, where `auth.uid()` is null and every permission reads false. The reviewer-columns
  -- branch above has always done this; the authority branch never did, so the data fix at the foot
  -- of this migration was refused by its own guard on the first attempt. The guard still RUNS: the
  -- readiness gate, `unassigned_at_signoff` and the `sla_events` row are all produced exactly as
  -- they would be for a person. Disabling the trigger would have skipped that bookkeeping.
  if v_actor is not null and not app.is_system_op() then
    -- A rollup of approvals already given needs no authority of its own (ADR-0077 d.1) — but only
    -- if there is something to roll up. `cancelled` counts as settled for the readiness gate, so
    -- without the `approved_at` test a deliverable whose every task was CALLED OFF could be marked
    -- approved by anyone who can reach it: exactly the lie d.6 refuses to write in the data fix
    -- below, reachable through the front door instead. With no approved task this falls through and
    -- still demands `reviews:moderate`, as it always did.
    if new.state = 'approved' and old.state = 'in_progress'
       and exists (select 1 from sub_tasks st
                    where st.deliverable_id = new.id
                      and st.status = 'done' and st.approved_at is not null) then
      null;
    elsif new.state = 'approved' then
      if not has_review then
        raise exception 'deliverable: sign-off (-> approved) requires reviews:moderate' using errcode = '42501';
      end if;
    elsif old.state = 'in_review' and new.state = 'in_progress' then
      if not (has_review or has_manage) then
        raise exception 'deliverable: send-back requires reviews:moderate or project_tasks:manage' using errcode = '42501';
      end if;
    -- ADR-0077 addendum d.8 (I48.35): a container whose work has begun is In progress, and saying
    -- so needs no authority of its own — the maker who pressed Start on a task under it is the one
    -- writing this, through sub_task_start. With no started task the branch falls through and the
    -- deliverable's own Start button still needs project_tasks:manage.
    elsif old.state = 'draft' and new.state = 'in_progress'
       and exists (select 1 from sub_tasks st
                    where st.deliverable_id = new.id
                      and st.status in ('in_progress', 'review', 'done')) then
      null;
    else
      if not has_manage then
        raise exception 'deliverable: this transition requires project_tasks:manage' using errcode = '42501';
      end if;
    end if;
  end if;

  if new.state = 'approved' then
    select count(*) into new.unassigned_at_signoff
      from sub_tasks st
     where st.deliverable_id = new.id
       and st.assignee_id is null
       and st.status not in ('done', 'cancelled');
  end if;

  if new.state = 'in_progress' and old.state in ('in_review','approved') then
    new.revision_round := old.revision_round + 1;
  else
    new.revision_round := old.revision_round;
  end if;

  -- Append-only event for the accountability log (Phase 2 reads this). Reproduced from
  -- `20260828210000` VERBATIM. A first cut of this migration rebuilt it from `20260817110100`
  -- instead, which uses attribution values (`reviewer`) that are not in the `attribution_party`
  -- enum any more — nine suites died on a bad enum cast rather than on anything to do with this
  -- change. Exactly the trap traps.md describes: check for later definitions FIRST.
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

-- ============================================================================
-- 3) the rows already stuck (d.9)
-- ============================================================================
-- `app.system_op` so the guard's authority checks stand aside for a migration running as superuser;
-- the guard still RUNS — readiness, unassigned_at_signoff, the sla_events row — exactly as for a
-- person. Same shape as 20260908150000's data fix.
set local app.system_op = 'on';

-- A draft container whose work has begun is in progress.
update deliverables d set state = 'in_progress'
 where d.state = 'draft'
   and exists (select 1 from sub_tasks st
                where st.deliverable_id = d.id and st.status in ('in_progress', 'review', 'done'));

-- And one whose work is finished and approved closes — the d.6 rollup: at least one approved task,
-- nothing live. Runs after the move above, so these rows are in_progress by now.
update deliverables d set state = 'approved'
 where d.state = 'in_progress'
   and exists (select 1 from sub_tasks st
                where st.deliverable_id = d.id and st.status = 'done' and st.approved_at is not null)
   and not exists (select 1 from sub_tasks st
                    where st.deliverable_id = d.id
                      and st.status not in ('done','cancelled')
                      and (st.assignee_id is not null
                           or st.status <> 'todo'
                           or exists (select 1 from task_time_entries te where te.sub_task_id = st.id)));

commit;
