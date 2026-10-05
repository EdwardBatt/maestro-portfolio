-- ADR-0038 (I12.1): tasks are approved; deliverables are signed off.
--
-- WHY. Every path that writes sub_tasks.status was enumerated: start (→ in_progress), submit
-- (→ review), request-changes (→ todo), the dependency unblock (→ in_progress). **None produces
-- `done`.** The status exists in the check constraint and nothing reaches it. The only approval in
-- the system is on the DELIVERABLE, and the reviewer's inbox Approve button transitions the parent
-- container — it never touches the task that was submitted, which sits in `review` for ever.
--
-- So "who finished this, and when?" has no answer: no completion timestamp, no signer, no per-person
-- record. Approving one deliverable silently absorbs every task inside it, individually unreviewed.
--
-- Edward's model: we approve TASKS, not deliverables; a deliverable cannot be approved before all
-- its tasks are complete; an approved task is complete and stops being work.
--
-- search_path pinned inline throughout, per ADR-0033.

begin;

-- ============================================================================
-- 1) every task carries its own reviewer
-- ============================================================================
-- The reviewer lives on the deliverable today (ADR-0035). A campaign deliverable can hold several
-- tasks needing different reviewers — a copy lead for the copy, an art director for the artwork — so
-- the reviewer belongs on the task, seeded from the deliverable where one exists.
alter table sub_tasks add column reviewer_id uuid references user_profiles(id);
alter table sub_tasks add column approved_by uuid references user_profiles(id);
alter table sub_tasks add column approved_at timestamptz;

comment on column sub_tasks.reviewer_id is
  'ADR-0038: who reviews THIS task. Required for live work (chk_sub_tasks_reviewer_required) — a task '
  'may not be assigned without a reviewer appointed.';
comment on column sub_tasks.approved_by is
  'ADR-0038: who approved this task. Written only by public.sub_task_approve; never client-writable.';

update sub_tasks st
   set reviewer_id = d.reviewer_id
  from deliverables d
 where d.id = st.deliverable_id
   and d.reviewer_id is not null
   and st.reviewer_id is null;

-- Fail LOUDLY rather than defaulting. Putting a plausible name against a review that person never
-- accepted is the exact failure this ADR exists to end, so the migration stops and names the rows.
do $$
declare v_open int; v_list text;
begin
  select count(*), string_agg(title, ', ' order by created_at)
    into v_open, v_list
  from sub_tasks
  where reviewer_id is null and assignee_id is not null and status <> 'cancelled';

  if v_open > 0 then
    raise exception
      'ADR-0038: % task(s) have no reviewer and are not cancelled: %. Appoint a reviewer on each '
      '(schedule → open the booking → Reviewer) and re-run. See scripts/db/list-task-reviewers.sql.',
      v_open, v_list
      using errcode = '23502';
  end if;
end $$;

-- A CHECK rather than NOT NULL, scoped exactly as ADR-0038 words it: "required from the moment a
-- task is ASSIGNED". An unassigned task has nobody whose work needs reviewing yet, and cancelled
-- history predates the rule and must not be falsified — but no live, assigned task may exist
-- without a reviewer. (The ADR said NOT NULL on the assumption that only a handful of rows lacked
-- one; rewriting history to satisfy a column constraint would be worse than scoping it honestly.)
alter table sub_tasks add constraint chk_sub_tasks_reviewer_required
  check (reviewer_id is not null or assignee_id is null or status = 'cancelled');

-- No self-review, permanently, at the lowest level — the RPCs already check it, this makes it true
-- for every path including a direct write.
alter table sub_tasks add constraint chk_sub_tasks_no_self_review
  check (reviewer_id is null or assignee_id is null or reviewer_id <> assignee_id);

-- ADR-0038 d.2: a task's reviewer is SEEDED from its parent deliverable when one is not given.
-- This is what makes the rule liveable — the deliverable already names a reviewer for ad-hoc work,
-- and a campaign deliverable can carry a default for the tasks under it — rather than every insert
-- site having to remember. An explicit reviewer always wins; the constraint above still catches an
-- assigned task where neither is present.
create or replace function app.tg_subtask_seed_reviewer() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
begin
  if new.reviewer_id is null and new.deliverable_id is not null then
    select d.reviewer_id into new.reviewer_id from public.deliverables d where d.id = new.deliverable_id;
  end if;
  -- Never seed someone onto their own work: no-self-review is permanent (ADR-0035).
  if new.reviewer_id is not null and new.reviewer_id = new.assignee_id then
    new.reviewer_id := null;
  end if;
  return new;
end $$;
comment on function app.tg_subtask_seed_reviewer() is
  'ADR-0038 d.2: inherit the parent deliverable''s reviewer when a task does not name one. An '
  'explicit reviewer wins, and it never seeds the assignee onto their own work.';

create trigger subtask_seed_reviewer before insert on sub_tasks
  for each row execute function app.tg_subtask_seed_reviewer();

-- ============================================================================
-- 2) task approval: review → done
-- ============================================================================
-- The mirror of app.sub_task_request_changes, which already implements the opposite outcome from
-- the same state. SECURITY DEFINER so it can stamp the row and notify a recipient other than the
-- actor; authority is checked here, in the database, not in the browser.
create or replace function public.sub_task_approve(p_sub_task uuid)
returns void language plpgsql security definer
set search_path = public, app, extensions as $$
declare v sub_tasks;
begin
  select * into v from sub_tasks where id = p_sub_task and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002';
  end if;

  if v.status <> 'review' then
    raise exception 'task cannot be approved from % (only a submitted task can be approved)', v.status
      using errcode = '22023';
  end if;

  -- THIS task's reviewer, not the deliverable's owner and not any moderator at large (ADR-0038 d.3).
  if v.reviewer_id is distinct from auth.uid() then
    raise exception 'only the appointed reviewer may approve this task' using errcode = '42501';
  end if;

  update sub_tasks
     set status      = 'done',
         approved_by = auth.uid(),
         approved_at = now()
   where id = p_sub_task;

  -- Tell the maker their work was accepted. Best-effort by convention: the row is the record.
  if v.assignee_id is not null and v.assignee_id is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
    values (v.tenant_id, v.assignee_id, 'signed_off', v.title, 'sub_task', v.id, auth.uid());
  end if;
end $$;

comment on function public.sub_task_approve(uuid) is
  'ADR-0038: the appointed reviewer approves a submitted task (review → done), stamping approved_by '
  'and approved_at. The mirror of sub_task_request_changes. This is the record that answers "who '
  'finished this, and when?".';
revoke execute on function public.sub_task_approve(uuid) from public;
revoke execute on function public.sub_task_approve(uuid) from anon;
grant  execute on function public.sub_task_approve(uuid) to authenticated;

-- ============================================================================
-- 3) the deliverable gate tightens: every task APPROVED, not merely submitted
-- ============================================================================
-- The body below is 20260823110000 (B.7) copied VERBATIM with exactly one edit: the readiness gate.
-- Reproducing it from memory got the transition graph, the sla_events columns and the no-op early
-- return all wrong, so it is lifted from the source instead.
create or replace function app.tg_deliverable_transition_guard() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_actor   uuid := auth.uid();
  has_manage boolean := app.has_permission('project_tasks', 'manage');
  has_review boolean := app.has_permission('reviews', 'moderate');
  allowed   deliverable_state[];
  ev        text := null;
  att       attribution_party := null;
begin
  -- Reviewer-only actors may change nothing but the workflow state.
  if not has_manage then
    if new.name        is distinct from old.name
       or new.stream_id is distinct from old.stream_id
       or new.job_id    is distinct from old.job_id
       or new.due_at    is distinct from old.due_at
       or new.revision_limit is distinct from old.revision_limit
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
  'deliverable is a rollup of decisions already made on each task.';


-- ============================================================================
-- 4) the two task-writing RPCs carry the reviewer onto the TASK
-- ============================================================================
-- Both bodies are 20260823110000 copied verbatim; the edits are marked inline. Without this the
-- new constraint would reject every task these create, since neither ever set sub_tasks.reviewer_id.
create or replace function public.create_adhoc_deliverable(
  p_assignee   uuid,
  p_title      text,
  p_hours      numeric,
  p_starts_at  timestamptz,
  p_due_at     timestamptz,
  p_reviewer   uuid default null
) returns table(sub_task_id uuid, deliverable_id uuid)
language plpgsql security definer set search_path = public, app as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_dept uuid; v_team uuid;
  v_client uuid; v_job uuid; v_deliv uuid; v_sub uuid;
begin
  if coalesce(trim(p_title), '') = '' then
    raise exception 'a task title is required' using errcode = '22023';
  end if;
  if p_assignee is null then
    raise exception 'an assignee is required' using errcode = '22023';
  end if;

  -- the assignee's placement, checked against the caller's write scope.
  select department_id, team_id into v_dept, v_team
  from user_profiles where id = p_assignee and tenant_id = v_tenant;
  if not (app.has_permission('project_tasks', 'manage') and app.in_write_scope(v_dept, v_team, null)) then
    raise exception 'assigning this task is outside your scope' using errcode = '42501';
  end if;

  -- Reviewer validation (ADR-0036 L6.7). Tenant isolation FIRST (user_holds_permission is not
  -- tenant-filtered), then reviews:moderate held by role OR the per-user overlay.
  -- ADR-0038: a task may not be assigned without a reviewer appointed. The old optional parameter
  -- backed the "Any reviewer (role-based)" option, which stored NULL and reached no inbox at all.
  if p_reviewer is null then
    raise exception 'a reviewer must be appointed for this task' using errcode = '22023';
  end if;
  if p_reviewer is not null then
    if not exists (select 1 from user_profiles up where up.id = p_reviewer and up.tenant_id = v_tenant) then
      raise exception 'that reviewer is not in your organization' using errcode = '22023';
    end if;
    if not app.user_holds_permission(p_reviewer, 'reviews', 'moderate') then
      raise exception 'the chosen reviewer cannot moderate reviews' using errcode = '22023';
    end if;
    -- No self-review (PERMANENT): the named reviewer may not be the assignee.
    if p_reviewer = p_assignee then
      raise exception 'the reviewer cannot be the assignee (no self-review)' using errcode = '22023';
    end if;
  end if;

  -- get-or-create the tenant-level "Ad-hoc" internal client + job (fenced from external surfaces).
  select id into v_client from clients
    where tenant_id = v_tenant and is_internal and internal_kind = 'tenant' limit 1;
  if v_client is null then
    insert into clients (tenant_id, name, is_internal, internal_kind)
    values (v_tenant, 'Internal', true, 'tenant') returning id into v_client;
  end if;
  select id into v_job from jobs
    where tenant_id = v_tenant and client_id = v_client and name = 'Ad-hoc assignments' limit 1;
  if v_job is null then
    insert into jobs (tenant_id, client_id, name)
    values (v_tenant, v_client, 'Ad-hoc assignments') returning id into v_job;
  end if;

  insert into deliverables (tenant_id, job_id, name, state, reviewer_id, due_at)
  values (v_tenant, v_job, trim(p_title), 'in_progress', p_reviewer, p_due_at)
  returning id into v_deliv;

  insert into sub_tasks (tenant_id, deliverable_id, department_id, team_id, assignee_id,
                         title, sla_hours, starts_at, due_at, status, created_by, reviewer_id)
  values (v_tenant, v_deliv, v_dept, v_team, p_assignee,
          trim(p_title), p_hours, p_starts_at, p_due_at, 'todo', auth.uid(), p_reviewer)
  returning id into v_sub;

  sub_task_id := v_sub; deliverable_id := v_deliv; return next;
end $$;

create or replace function public.update_task_assignment(
  p_sub_task   uuid,
  p_title      text,
  p_assignee   uuid,
  p_reviewer   uuid default null,
  p_starts_at  timestamptz default null,
  p_due_at     timestamptz default null,
  p_hours      numeric default null
) returns table(sub_task_id uuid, deliverable_id uuid, reschedule_needed boolean)
language plpgsql security definer set search_path = public, app as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v sub_tasks%rowtype;
  v_reassigned boolean;
  v_dates_changed boolean;
begin
  -- Fetch the target sub-task FIRST so its placement is available to the scope gate below.
  select * into v from sub_tasks where id = p_sub_task and tenant_id = v_tenant;
  if not found then raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002'; end if;

  -- project_tasks:manage AND write scope over the task's own placement / owning AM (restored L6.5).
  if not (app.has_permission('project_tasks', 'manage')
          and app.in_write_scope(v.department_id, v.team_id, app.deliverable_account_manager(v.deliverable_id))) then
    raise exception 'editing this task requires project-task management permission' using errcode = '42501';
  end if;

  if coalesce(trim(p_title), '') = '' then
    raise exception 'a task title is required' using errcode = '22023';
  end if;
  if p_assignee is null then
    raise exception 'an assignee is required' using errcode = '22023';
  end if;
  if not exists (select 1 from user_profiles where id = p_assignee and tenant_id = v_tenant) then
    raise exception 'that assignee is not in your organization' using errcode = '22023';
  end if;
  -- ADR-0038: the reviewer is required, and must actually be able to moderate reviews. The old
  -- version accepted NULL (clearing the reviewer on any edit — an unseeded form could wipe it
  -- silently) and only checked tenant membership.
  if p_reviewer is null then
    raise exception 'a reviewer must be appointed for this task' using errcode = '22023';
  end if;
  if not exists (select 1 from user_profiles where id = p_reviewer and tenant_id = v_tenant) then
    raise exception 'that reviewer is not in your organization' using errcode = '22023';
  end if;
  if not app.user_holds_permission(p_reviewer, 'reviews', 'moderate') then
    raise exception 'the chosen reviewer cannot moderate reviews' using errcode = '22023';
  end if;
  -- No self-review (PERMANENT): the reviewer may not be the assignee.
  if p_reviewer is not null and p_reviewer = p_assignee then
    raise exception 'the reviewer cannot be the assignee (no self-review)' using errcode = '22023';
  end if;

  v_reassigned := p_assignee is distinct from v.assignee_id;
  v_dates_changed := (p_starts_at is not null and p_starts_at is distinct from v.starts_at)
                  or (p_due_at    is not null and p_due_at    is distinct from v.due_at)
                  or (p_hours     is not null and p_hours     is distinct from v.sla_hours);

  update sub_tasks set
    title       = trim(p_title),
    assignee_id = p_assignee,
    reviewer_id = p_reviewer,
    starts_at   = coalesce(p_starts_at, starts_at),
    due_at      = coalesce(p_due_at, due_at),
    sla_hours   = coalesce(p_hours, sla_hours),
    -- reset the human-override flag so subtask-schedule rebuilds the booking on reassign / date change
    schedule_overridden = case when v_reassigned or v_dates_changed then false else schedule_overridden end
  where id = p_sub_task;

  -- parent deliverable: set the designated reviewer always; only rename an AD-HOC deliverable
  -- (stream_id null) — never rename a project (stream-backed) deliverable from a booking edit.
  if v.deliverable_id is not null then
    update deliverables set
      reviewer_id = p_reviewer,
      name = case when stream_id is null then trim(p_title) else name end
    where id = v.deliverable_id;
  end if;

  -- keep the linked booking's title column in step (chip label for ad-hoc comes via deliverable name).
  -- Qualify bookings.sub_task_id — the OUT parameter sub_task_id would otherwise shadow it.
  update bookings set title = trim(p_title) where bookings.sub_task_id = p_sub_task;

  sub_task_id := p_sub_task;
  deliverable_id := v.deliverable_id;
  reschedule_needed := v_reassigned or v_dates_changed;
  return next;
end $$;

commit;
