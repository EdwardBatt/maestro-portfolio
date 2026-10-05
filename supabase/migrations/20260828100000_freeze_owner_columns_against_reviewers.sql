-- I22.1 (ADR-0055) — a reviewer may change workflow state and NOTHING ELSE.
--
-- `app.tg_deliverable_transition_guard` has always carried a frozen-column list for actors who
-- hold `reviews:moderate` but not `project_tasks:manage` — the reviewer, deliberately limited to
-- "approve or send back". The list was written when `deliverables` had fewer columns and was
-- never extended:
--
--   name · stream_id · job_id · due_at · revision_limit · tenant_id
--
-- ADR-0050 then added `owner_user_id` and `department_id`, which are the two columns that decide
-- WHO IS ACCOUNTABLE for the work. Neither was added to the list. Combined with the permissive
-- `deliverables_reviewer_update` policy (`20260817110100`), that means a reviewer can reassign a
-- deliverable to anyone in the tenant — and `app.tg_deliverable_stamp_department` obligingly
-- restamps the department to match.
--
-- Nobody has done it. That is luck, not design: the intent was stated in the guard's own comment
-- ("reviewers may change nothing but the workflow state") and the code simply fell behind the
-- schema. Closed here rather than bundled into the rest of ADR-0055, because it is a live
-- authorization hole and should not wait behind a feature.
--
-- The body below is `20260824140000` reproduced VERBATIM. The only edit is the two added lines in
-- the frozen-column check, marked inline. Reproducing whole is the house pattern for
-- `create or replace` (see 20260823140000) and is what keeps `search_path` pinned — a bare
-- `create or replace` resets `proconfig` and silently drops the ADR-0033 pin.

begin;

create or replace function app.tg_deliverable_transition_guard() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_actor   uuid := auth.uid();
  has_manage boolean := app.has_permission('project_tasks', 'manage');
  has_review boolean := app.has_permission('reviews', 'moderate');
  -- ADR-0055 / I22.2. The permission itself is created by the NEXT migration; until then this is
  -- always false and the two accountability columns are frozen outright, which is the safe
  -- direction. Written here rather than in a third rewrite of this function, because a branch that
  -- redefines the same guard twice is harder to read than one that composes correctly at once.
  has_reassign boolean := app.has_permission('deliverable_owner', 'manage');
  allowed   deliverable_state[];
  ev        text := null;
  att       attribution_party := null;
begin
  -- Reviewer-only actors may change nothing but the workflow state.
  --
  -- I22.1: migrations and seeders escape, the same way `app.tg_sub_task_assignment_gate` and
  -- ADR-0040's assignment trigger let them. Without this the check runs against superuser paths
  -- too — `auth.uid()` is null there, so `has_manage` is false and every system write looks like
  -- a reviewer. That was already true of the five columns this list started with; adding
  -- `owner_user_id` is what made it bite, because ADR-0050's own pgTAP suite sets an owner as
  -- superuser and started failing on it. Policing a "reviewer" when there is no authenticated
  -- actor at all was never the intent.
  if not has_manage and v_actor is not null and not app.is_system_op() then
    if new.name        is distinct from old.name
       or new.stream_id is distinct from old.stream_id
       or new.job_id    is distinct from old.job_id
       or new.due_at    is distinct from old.due_at
       or new.revision_limit is distinct from old.revision_limit
       -- I22.1: accountability is not a workflow state. Added 2026-08-28.
       --
       -- Frozen unless the actor holds `deliverable_owner:manage`, which is the whole point of
       -- that permission (ADR-0055 d.1). Without this clause the permission would be unusable by
       -- anyone who does not ALSO hold `project_tasks:manage` — and a Traffic Manager granted
       -- exactly the narrow authority ADR-0055 defines would be refused by this guard.
       -- `department_id` rides along because `app.tg_deliverable_stamp_department` fires FIRST
       -- (trigger order is alphabetical: stamp, then guard), so by the time we get here the
       -- department has already been restamped from the incoming owner and would otherwise read
       -- as a second forbidden edit.
       or (new.owner_user_id is distinct from old.owner_user_id and not has_reassign)
       or (new.department_id is distinct from old.department_id and not has_reassign)
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

  -- ADR-0030 readiness gate, tightened by ADR-0038. in_review still needs every sub-task
  -- SUBMITTED. Sign-off now needs every sub-task APPROVED: a deliverable is a rollup of decisions
  -- already made on each task, not the place where the decision is made for the first time.
  -- Previously a merely-submitted task satisfied both, so a deliverable could be approved while
  -- every task inside it was unread. Cancelled tasks never hold the gate.
  if new.state = 'in_review' then
    if exists (select 1 from sub_tasks st
               where st.deliverable_id = new.id and st.status in ('todo', 'in_progress', 'blocked')) then
      raise exception 'deliverable: every sub-task must be submitted before in_review (open sub-tasks remain)'
        using errcode = '55000';
    end if;
  end if;
  if new.state = 'approved' then
    if exists (select 1 from sub_tasks st
               where st.deliverable_id = new.id and st.status not in ('done', 'cancelled')) then
      raise exception 'deliverable: every sub-task must be APPROVED before sign-off (ADR-0038)'
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

comment on function app.tg_deliverable_transition_guard() is
  'ADR-0024 + ADR-0038: enforce the deliverable transition graph + authority, stamp revision_round, '
  'emit sla_events. Sign-off requires every sub-task APPROVED (not merely submitted) — the '
  'deliverable is a rollup of decisions already made on each task. ADR-0055 (I22.1): the '
  'reviewer-frozen column list also covers owner_user_id and department_id — who is accountable '
  'is not a workflow state, and a reviewer holds no authority over it.';

commit;
