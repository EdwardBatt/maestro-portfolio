-- I19.6 (ADR-0052 d.10) — an unassigned task does not hold the approval gate.
--
-- ADR-0052 d.5 lays a deliverable's whole task list down at once, unassigned. That is unshippable
-- against the guard as it stands: `in_review` is refused while ANY sub-task is `todo`, `approved`
-- is refused unless every sub-task is `done` or `cancelled`, and an unassigned task can never be
-- submitted (`app.sub_task_submit` raises "only the assignee may submit this task"). A LONG FORM
-- deliverable seeded with sixteen unassigned tasks could never reach review or sign-off at all.
--
-- The naive fix — `and st.assignee_id is not null` — is NOT enough, and the reason decides the
-- shape of the predicate. Both SUPPORTED unassign paths refuse to null an assignee, but a plain
-- `PATCH /sub_tasks {"assignee_id": null}` is permitted by `sub_tasks_manage_update` and is
-- anticipated by the schema (`app.tg_stamp_subtask_assignment` "clears on unassign"). So an
-- `in_progress` task with real hours logged could be unassigned and would vanish from BOTH gates —
-- a deliverable signed off with started work outstanding.
--
-- So the predicate says what "a plan" actually means:
--
--   **A task is a plan only if it is unassigned, still at `todo`, and has never been worked on.**
--
-- Work nobody was ever given is not outstanding work. Work somebody STARTED is, whoever holds it
-- now. An assigned task at `todo` still holds both gates exactly as it does today. The `exists`
-- rides `idx_task_time_entries_sub_task`, and it is not decoration: `todo` is reachable AFTER work,
-- because `app.sub_task_request_changes` reopens a task to `todo` — so "unassigned and at todo"
-- alone would have let a task with three rounds of logged time slip both gates.
--
-- `'blocked'` LEAVES the `in_review` arm at the same time. `sub_tasks_status_check` was redefined
-- on 19 Aug as ('todo','in_progress','review','done','cancelled') — ADR-0030 dropped `blocked` as a
-- sub-task status and modelled waiting as a dependency — but this predicate has carried it ever
-- since, matching nothing for nine days. It is removed rather than left, because a predicate nobody
-- can satisfy is exactly what the next reader assumes is load-bearing. (`blocked` remains a legal
-- DELIVERABLE state; only the sub-task literal was dead.)
--
-- The body is `20260828100000` reproduced by script with the four marked edits, which is what keeps
-- the ADR-0033 `search_path` pin and the ADR-0055 frozen-column list intact.

begin;

-- Not client-writable: no policy grants it and the guard overwrites it on every update.
alter table deliverables add column unassigned_at_signoff integer;

comment on column deliverables.unassigned_at_signoff is
  'ADR-0052 d.10: how many sub-tasks were still unassigned when this was signed off. Stamped by '
  'app.tg_deliverable_transition_guard on the -> approved transition and frozen on every other '
  'update. It is a COUNT and nothing more - it cannot tell "sixteen tasks nobody was given" from '
  '"one somebody started and walked away from", and is not offered as an audit of why.';

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
  -- ADR-0052 d.10 part 3. Frozen by DEFAULT and overwritten in exactly one branch below, which is
  -- the pattern `revision_round` already establishes: never client-writable, and a no-op update
  -- cannot quietly clear it. `revision_round` freezes itself per-branch; doing it once here covers
  -- every path out of this function, including the early return on an unchanged state.
  new.unassigned_at_signoff := old.unassigned_at_signoff;
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
               where st.deliverable_id = new.id
                 and st.status in ('todo', 'in_progress')
                 and (st.assignee_id is not null
                      or st.status <> 'todo'
                      or exists (select 1 from task_time_entries te where te.sub_task_id = st.id))) then
      raise exception 'deliverable: every sub-task must be submitted before in_review (open sub-tasks remain)'
        using errcode = '55000';
    end if;
  end if;
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

  -- The one branch that writes it. Sign-off is the irreversible decision, so it is the one worth a
  -- permanent number: a client that skips the confirmation dialog still leaves the count on the
  -- row, and "this was signed off with 3 tasks nobody ever did" stays answerable afterwards.
  -- `in_review` is a step in a conversation and is deliberately NOT counted — it happens repeatedly
  -- and a number that changes every round records nothing.
  if new.state = 'approved' then
    select count(*) into new.unassigned_at_signoff
      from sub_tasks st
     where st.deliverable_id = new.id
       and st.assignee_id is null
       and st.status not in ('done', 'cancelled');
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
  'emit sla_events. ADR-0055 (I22.1): owner_user_id and department_id are frozen against reviewers. '
  'ADR-0052 d.10 (I19.6): a task that is unassigned, at todo and never worked on is a PLAN and does '
  'not hold either readiness gate; the count of unassigned tasks is stamped at sign-off.';

commit;
