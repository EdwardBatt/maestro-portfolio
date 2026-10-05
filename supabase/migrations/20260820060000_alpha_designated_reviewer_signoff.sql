-- TEMPORARY (alpha, TMP.2): let anyone be assigned as an ad-hoc deliverable's reviewer and actually
-- sign it off, without holding the global reviews:moderate grant.
--
-- Background: ADR-0035 added deliverables.reviewer_id (the assigner-chosen reviewer). But every gate a
-- reviewer must pass to close the loop is keyed on the GLOBAL reviews:moderate grant, not on being the
-- named reviewer: (1) the deliverables_reviewer_update RLS policy (the deliverable-transition Edge
-- Function runs as the caller, so RLS bites), (2) the transition guard's approved sign-off + send-back
-- branches, and (3) app.sub_task_request_changes. So a non-moderator named reviewer is stopped before
-- they can Approve / Request changes. (Leaving comments/pins is already open to any internal user.)
--
-- This toggle introduces a per-deliverable authority notion — app.can_moderate_deliverable(id) = holds
-- reviews:moderate OR is that deliverable's reviewer_id — and swaps it in at those three gates (plus the
-- review_feedback resolve policy), and drops the "reviewer must be a moderator" check in
-- create_adhoc_deliverable. Deliverables with reviewer_id = NULL (every campaign deliverable) are
-- byte-for-byte unchanged: can_moderate_deliverable collapses to has_permission('reviews','moderate').
--
-- WHY TEMPORARY: this widens sign-off authority for alpha testing so any assigned reviewer can drive the
-- loop. It is NOT the intended permanent model. See docs/TASKS.md TMP.2 for the full revert path.
--
-- REVERT PATH (new forward migration; do NOT edit this one):
--   1. drop function app.can_moderate_deliverable(uuid);
--   2. restore deliverables_reviewer_update to the reviews:moderate USING/WITH CHECK from 20260817110100;
--   3. restore the approved/send-back authority branches in app.tg_deliverable_transition_guard to the
--      bare has_review / (has_review or has_manage) form from 20260819150000;
--   4. restore the `if not app.has_permission('reviews','moderate')` gate in app.sub_task_request_changes
--      from 20260820030000;
--   5. restore review_feedback_resolve_update to the author-or-moderate form from 20260818110000;
--   6. restore the "chosen reviewer must hold reviews:moderate" check in public.create_adhoc_deliverable
--      from 20260820050000 (keeping the grant-only scope from that alpha migration until TMP.1 reverts);
--   7. revert the frontend reviewer picker (useReviewers) to list only reviews:moderate holders.

begin;

-- 1) per-deliverable moderation authority. SECURITY DEFINER (search_path pinned, ADR-0033) so it can
--    read one boolean off deliverables from inside an RLS policy without recursing; it discloses nothing
--    (a boolean about the caller themselves). Owned by the migration role (superuser → bypasses RLS on
--    the inner read), so no policy recursion.
create or replace function app.can_moderate_deliverable(p_deliverable uuid)
returns boolean
language sql stable security definer set search_path = public, app as $$
  select app.has_permission('reviews', 'moderate')
      or (p_deliverable is not null and exists (
            select 1 from deliverables d
            where d.id = p_deliverable and d.reviewer_id = auth.uid()));
$$;
comment on function app.can_moderate_deliverable(uuid) is
  'TEMPORARY alpha (TMP.2): may the caller moderate this deliverable? True if they hold reviews:moderate '
  'OR they are the deliverable''s named reviewer_id (ADR-0035). Reverts with the TMP.2 revert path.';
revoke execute on function app.can_moderate_deliverable(uuid) from public;
grant  execute on function app.can_moderate_deliverable(uuid) to authenticated, service_role;

-- 2) deliverables UPDATE RLS: the named reviewer may update the row (to drive the workflow state), not
--    only reviews:moderate holders. The guard still freezes every non-state column for a non-manage actor.
drop policy deliverables_reviewer_update on deliverables;
create policy deliverables_reviewer_update on deliverables
  for update to authenticated
  using (tenant_id = app.current_tenant_id() and app.can_moderate_deliverable(id))
  with check (tenant_id = app.current_tenant_id() and app.can_moderate_deliverable(id));

-- 3) transition guard: approved sign-off and send-back accept the named reviewer. Reproduces the
--    authoritative definition from 20260819150000 with ONLY the two authority branches widened.
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

  -- ADR-0030 readiness gate: review/approval need every sub-task submitted. An open (todo/
  -- in_progress) sub-task — including one reopened by Request Changes — holds the gate shut.
  if new.state in ('in_review', 'approved') then
    if exists (select 1 from sub_tasks st
               where st.deliverable_id = new.id and st.status in ('todo', 'in_progress', 'blocked')) then
      raise exception 'deliverable: every sub-task must be submitted before % (open sub-tasks remain)', new.state
        using errcode = '55000';
    end if;
  end if;

  -- Authority per transition. TEMPORARY alpha (TMP.2): the named reviewer counts as a moderator of
  -- THIS deliverable, so a non-moderator assigned reviewer can sign off / send back their own work.
  if new.state = 'approved' then
    if not (has_review or app.can_moderate_deliverable(new.id)) then
      raise exception 'deliverable: sign-off (-> approved) requires reviews:moderate' using errcode = '42501';
    end if;
  elsif old.state = 'in_review' and new.state = 'in_progress' then
    if not (has_review or has_manage or app.can_moderate_deliverable(new.id)) then
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

-- 4) Request Changes: the named reviewer may reopen their deliverable's sub-task. Reproduces the
--    authoritative definition from 20260820030000 with ONLY the authority gate widened (and the sub-task
--    fetched first so its deliverable_id is available for the per-deliverable check).
create or replace function app.sub_task_request_changes(p_sub_task uuid)
returns void language plpgsql security definer set search_path = public, app as $$
declare v sub_tasks; v_deliv_state deliverable_state; v_has_comment boolean;
begin
  select * into v from sub_tasks where id = p_sub_task;
  if v.id is null then raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002'; end if;

  -- TEMPORARY alpha (TMP.2): moderator OR this deliverable's named reviewer may request changes.
  if not app.can_moderate_deliverable(v.deliverable_id) then
    raise exception 'requesting changes requires reviews:moderate' using errcode = '42501';
  end if;

  if v.status <> 'review' then
    raise exception 'changes can only be requested on a submitted (review) sub-task (is %)', v.status using errcode = '22023';
  end if;

  -- a change description is mandatory: at least one unresolved review comment on this deliverable.
  select exists (
    select 1 from review_feedback rf
    join media_records mr on mr.id = rf.media_record_id
    where mr.deliverable_id = v.deliverable_id and coalesce(rf.resolved, false) = false
  ) into v_has_comment;
  if not v_has_comment then
    raise exception 'a change description (an unresolved review comment) is required to request changes'
      using errcode = '55000';
  end if;

  -- Reopen to TODO (not in_progress) so the maker Starts a fresh timed round before resubmitting.
  update sub_tasks set status = 'todo', revision_number = revision_number + 1 where id = p_sub_task;

  -- notify the assignee that changes were requested on their task
  if v.assignee_id is not null and v.assignee_id is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
    values (v.tenant_id, v.assignee_id, 'changes_requested', v.title, 'sub_task', p_sub_task, auth.uid());
  end if;

  -- send the deliverable back if it is in review (fires the guard → revision_round++ + event)
  select state into v_deliv_state from deliverables where id = v.deliverable_id;
  if v_deliv_state = 'in_review' then
    update deliverables set state = 'in_progress' where id = v.deliverable_id;
  end if;
end $$;
comment on function app.sub_task_request_changes(uuid) is
  'ADR-0030/0035 + TEMPORARY alpha (TMP.2): reviewer reopens a submitted sub-task (revision_number++) — '
  'requires an unresolved review comment; sends the deliverable back. Authority: reviews:moderate OR the '
  'deliverable''s named reviewer. Revert restores the bare reviews:moderate gate.';

-- 5) review_feedback resolve/edit: the author, a moderator, OR the named reviewer of the deliverable the
--    comment is anchored to. Reproduces 20260818110000 with the per-deliverable reviewer added.
drop policy review_feedback_resolve_update on review_feedback;
create policy review_feedback_resolve_update on review_feedback
  for update to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and (
      author_user_id = auth.uid()
      or app.has_permission('reviews', 'moderate')
      or exists (
        select 1 from media_records mr
        where mr.id = review_feedback.media_record_id
          and app.can_moderate_deliverable(mr.deliverable_id)
      )
    )
  )
  with check (tenant_id = app.current_tenant_id());

-- 6) create_adhoc_deliverable: any same-tenant user may be named reviewer (drop the reviews:moderate
--    requirement). Reproduces 20260820050000 with only the reviewer check changed.
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

  -- TEMPORARY (alpha, TMP.1 extension): scope relaxed to grant-only — any project_tasks:manage holder
  -- may assign an ad-hoc task. The per-assignee in_write_scope check is dropped (revert restores it).
  if not app.has_permission('project_tasks', 'manage') then
    raise exception 'assigning this task requires project-task management permission' using errcode = '42501';
  end if;

  -- Tenant isolation stays structural: the assignee must belong to the caller's tenant.
  select department_id, team_id into v_dept, v_team
  from user_profiles where id = p_assignee and tenant_id = v_tenant;
  if not found then
    raise exception 'that assignee is not in your organization' using errcode = '22023';
  end if;

  -- TEMPORARY alpha (TMP.2): any same-tenant user may be the named reviewer (the reviews:moderate
  -- requirement is dropped — the named reviewer can now sign off via app.can_moderate_deliverable).
  -- Tenant isolation preserved: the reviewer must belong to the caller's tenant.
  if p_reviewer is not null and not exists (
    select 1 from user_profiles up where up.id = p_reviewer and up.tenant_id = v_tenant
  ) then
    raise exception 'that reviewer is not in your organization' using errcode = '22023';
  end if;

  -- No self-review: the named reviewer may not be the assignee (Edward). A person can't sign off
  -- their own work. (The reviewer picker already excludes the assignee; this is the authoritative gate.)
  if p_reviewer is not null and p_reviewer = p_assignee then
    raise exception 'the reviewer cannot be the assignee (no self-review)' using errcode = '22023';
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
                         title, sla_hours, starts_at, due_at, status, created_by)
  values (v_tenant, v_deliv, v_dept, v_team, p_assignee,
          trim(p_title), p_hours, p_starts_at, p_due_at, 'todo', auth.uid())
  returning id into v_sub;

  sub_task_id := v_sub; deliverable_id := v_deliv; return next;
end $$;

comment on function public.create_adhoc_deliverable(uuid, text, numeric, timestamptz, timestamptz, uuid) is
  'ADR-0035 + TEMPORARY alpha (TMP.1/TMP.2): create an ad-hoc reviewable deliverable + its sub-task under '
  'the tenant Ad-hoc job. Gated project_tasks:manage only (in_write_scope dropped, TMP.1); the named '
  'reviewer may be ANY same-tenant user (moderate requirement dropped, TMP.2 — they sign off via '
  'app.can_moderate_deliverable). Revert restores both checks.';

revoke execute on function public.create_adhoc_deliverable(uuid, text, numeric, timestamptz, timestamptz, uuid) from public;
grant  execute on function public.create_adhoc_deliverable(uuid, text, numeric, timestamptz, timestamptz, uuid) to authenticated;

commit;
