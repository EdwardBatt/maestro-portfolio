-- ADR-0077 / I40.23 — a container closes when its contents are done.
--
-- ADR-0058 d.6 was decided on 28 Aug ("if all sub-tasks are approved, then the deliverable by
-- default is approved") and built the same week. It has never fired. The approval is gated on the
-- deliverable being `in_review`, and NOTHING IN THE SYSTEM EVER WRITES THAT STATE — every reference
-- in every migration is a read. The only way in is a person pressing a button, and on the Ad-hoc tab
-- the row actions are filtered to `archived` only, so for ad-hoc work there is no button at all.
--
-- Measured on the live tenant, 8 Sep: a number of ad-hoc deliverables, one task each, task `done` AND
-- approved, container still `in_progress`. Unreachable from both directions.
--
-- Edward, 8 Sep: "the deliverable is a container for the tasks… the sub-tasks are what get reviewed
-- and approved… why is there a third path for the same process?" There is no reason. The container's
-- state machine was written on 17 Aug; ADR-0058 later made the sub-task the unit of review and these
-- states were never revisited.
--
-- WHAT THIS DOES NOT TOUCH: `sub_tasks.status`. Sixteen ad-hoc tasks are in `review` right now —
-- live work correctly waiting for a reviewer. The container's state and its tasks' statuses are
-- independent, and nothing below reads or writes a task's status except to ask whether it is
-- settled.

begin;

-- ---------------------------------------------------------------------------------------------
-- 1. The transition guard.
--
-- Reproduced from `20260828210000`, which IS the current definition — checked, because traps.md
-- records what rebuilding a function from the wrong base costs. Three changes, everything else
-- verbatim:
--
--   (a) `in_progress` may go straight to `approved`, and no longer to `in_review`.
--   (b) `in_review` KEEPS its outbound edges. The nine rows sitting there must be able to leave;
--       stranding them in a state that has just become unreachable would be the cure causing the
--       disease. Nothing can enter it, so it drains and stays empty.
--   (c) `in_progress -> approved` needs no permission of its own. This is the ADR's point: the
--       container is approved as a CONSEQUENCE of decisions already made on each task, by people
--       already entitled to make them. It cannot be reached otherwise — the readiness gate below
--       still requires every task settled. The manual `in_review -> approved` path keeps needing
--       `reviews:moderate`, so nothing an authenticated user can do today becomes easier.
-- ---------------------------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------------------------
-- 2. The automatic sign-off now fires from the state deliverables are actually in.
--
-- Reproduced from `20260828235500`, the current definition. ONE condition changed: the container may
-- be `in_progress` as well as `in_review`. Everything else — the FOR UPDATE serialisation, the
-- mandatory-reviewer arithmetic, the notification — is verbatim.
-- ---------------------------------------------------------------------------------------------
create or replace function app.maybe_complete_sub_task(p_sub_task uuid, p_actor uuid default null)
returns boolean language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v sub_tasks;
  v_stream uuid;
  v_state  deliverable_state;
  v_by     uuid;
begin
  select * into v from sub_tasks where id = p_sub_task for update;
  if not found or v.status <> 'review' then
    return false;
  end if;

  if not exists (select 1 from sub_task_reviewers r
                  where r.sub_task_id = p_sub_task and r.approved_at is not null) then
    return false;
  end if;

  if exists (select 1 from sub_task_reviewers r
              where r.sub_task_id = p_sub_task and r.is_mandatory and r.approved_at is null) then
    return false;
  end if;

  v_by := coalesce(p_actor, (
    select r.user_id from sub_task_reviewers r
     where r.sub_task_id = p_sub_task and r.approved_at is not null
     order by r.approved_at desc, r.created_at desc, r.user_id desc
     limit 1));

  update sub_tasks
     set status      = 'done',
         approved_by = v_by,
         approved_at = now()
   where id = p_sub_task;

  if v.assignee_id is not null and v.assignee_id is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
    values (v.tenant_id, v.assignee_id, 'signed_off', v.title, 'sub_task', v.id, auth.uid());
  end if;

  select d.stream_id, d.state into v_stream, v_state
    from deliverables d where d.id = v.deliverable_id;

  -- ADR-0077 d.2. `v_state = 'in_review'` stood alone here, and no path ever put a deliverable in
  -- that state — so this branch was unreachable and ADR-0058 d.6 never happened once. `in_progress`
  -- is where deliverables actually live.
  if v_state in ('in_progress', 'in_review')
     and not exists (
       select 1 from sub_tasks st
       where st.deliverable_id = v.deliverable_id
         and st.status not in ('done', 'cancelled')
         and (st.assignee_id is not null
              or st.status <> 'todo'
              or exists (select 1 from task_time_entries te where te.sub_task_id = st.id)))
  then
    update deliverables set state = 'approved' where id = v.deliverable_id;
  end if;

  return true;
end $$;

comment on function app.maybe_complete_sub_task(uuid, uuid) is
  'ADR-0043 d.5 + ADR-0058 d.6 + ADR-0077 d.2: completes a task when its reviewers have agreed, and '
  'closes its deliverable when nothing unsettled is left. Accepts a container in in_progress, which '
  'is where deliverables actually sit — the previous in_review-only condition made this unreachable.';

-- ---------------------------------------------------------------------------------------------
-- 3. The rows the system already decided and could not write (ADR-0077 d.4, d.5).
--
-- `app.system_op` is set so the guard's ordinary authority checks stand aside for a migration
-- running as superuser, where `auth.uid()` is null and every permission reads false. The guard still
-- RUNS — the readiness gate, `unassigned_at_signoff` and the `sla_events` row are all produced
-- exactly as they would be for a person. Disabling the trigger would have skipped that bookkeeping.
-- ---------------------------------------------------------------------------------------------
set local app.system_op = 'on';

-- d.4: nine deliverables sitting in the state that is now unreachable. Out, in the honest direction:
-- approved where the work is settled, back to in_progress where any of it is still live.
update deliverables d set state = 'approved'
 where d.state = 'in_review'
   and not exists (select 1 from sub_tasks st
                    where st.deliverable_id = d.id and st.status not in ('done','cancelled'));

update deliverables d set state = 'in_progress'
 where d.state = 'in_review';

-- d.5: every deliverable whose work is finished and approved, and which the gate could never close.
-- Written as the general condition rather than the eleven ids: the same eleven, plus any that
-- reached this state between the measurement and the migration running.
--
-- `exists (... approved_at is not null)` is what keeps d.6 honest — a deliverable whose only task
-- was CANCELLED has nothing approved, so it is not swept up here and stays as it is.
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
