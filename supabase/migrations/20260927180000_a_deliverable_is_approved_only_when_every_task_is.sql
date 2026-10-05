-- ADR-0118 (Edward, 27 Sep; accepted the same day) — I59.60.
--
-- A deliverable is approved only when EVERY one of its tasks is done or cancelled. Until now an unassigned,
-- unstarted task counted as "a plan" and did not hold sign-off (ADR-0052 d.10), so the first approved task
-- closed its deliverable while the rest had never been given out — "K one" locally went to Approved with
-- 1 of 4 tasks done; production had 5 such tasks.
--
-- 1) `app.maybe_complete_sub_task` — the automatic close after a task approval (ADR-0077 d.2).
-- 2) `app.tg_deliverable_transition_guard` — the check every approval passes.
--    Both re-emitted from the live definitions with ONLY the "plan" clause removed from the approval test.
-- 3) The deliverables already closed too early — Approved with a task still open — go back to In progress.
--    The transition guard stands aside for that one statement, so it does not add a revision round nobody
--    asked for or log a send-back that did not happen. Delivered ones are left and listed (ADR-0118 d.4).

begin;

-- ============================================================================
-- 1) the automatic close
-- ============================================================================
create or replace function app.maybe_complete_sub_task(p_sub_task uuid, p_actor uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $$
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

  -- ADR-0089 d.6. The task does not complete while any OPTIONAL reviewer has not answered — the
  -- point of the round is that the required reviewer reads every answer before deciding. An
  -- optional row is an unmarked one on a task that HAS a marked one (see the header); with nobody
  -- marked this is the retired pool state, which d.1 makes unreachable and which is left to the
  -- branch above as a defensive line rather than gated on answers nobody was asked for.
  if exists (select 1 from sub_task_reviewers r
              where r.sub_task_id = p_sub_task and r.is_mandatory)
     and exists (select 1 from sub_task_reviewers r
                  where r.sub_task_id = p_sub_task and not r.is_mandatory and r.responded_at is null) then
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
)
         -- ADR-0118 d.1: an unassigned task holds it open too — no "plan" exception (ADR-0052 d.10).
  then
    update deliverables set state = 'approved' where id = v.deliverable_id;
  end if;

  return true;
end $$;

-- ============================================================================
-- 2) the guard
-- ============================================================================
create or replace function app.tg_deliverable_transition_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app'
AS $$
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
  -- ADR-0118 d.1: a deliverable is approved only when EVERY task is done or cancelled — an unassigned
  -- task on an approved list is real work and holds it (the ADR-0052 d.10 "plan" exception is gone).
  if new.state = 'approved' then
    if exists (select 1 from sub_tasks st
               where st.deliverable_id = new.id
                 and st.status not in ('done', 'cancelled')) then
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
-- 3) put back what closed too early
-- ============================================================================
do $fix$
declare
  v_ids uuid[];
  v_delivered integer;
begin
  select array_agg(d.id) into v_ids
    from deliverables d
   where d.state = 'approved'
     and exists (select 1 from sub_tasks st where st.deliverable_id = d.id and st.status not in ('done', 'cancelled'));

  if v_ids is not null then
    alter table deliverables disable trigger deliverable_transition_guard;
    update deliverables set state = 'in_progress', unassigned_at_signoff = null where id = any (v_ids);
    alter table deliverables enable trigger deliverable_transition_guard;
  end if;
  raise notice 'ADR-0118: % deliverable(s) put back to in_progress', coalesce(array_length(v_ids, 1), 0);

  select count(*) into v_delivered
    from deliverables d
   where d.state = 'delivered'
     and exists (select 1 from sub_tasks st where st.deliverable_id = d.id and st.status not in ('done', 'cancelled'));
  raise notice 'ADR-0118: % delivered deliverable(s) still have open tasks — left as they are, for Edward', v_delivered;
end $fix$;

commit;
