-- ADR-0024 (Phase I): the deliverable lifecycle engine — the internal work→review→sign-off
-- state machine, defining the "write-state ownership" left open by L1.16.
--
-- Enforced in the DB (defense in depth); the `deliverable-transition` Edge Function (next
-- increment) runs the same graph client-side and drives these updates as the caller. Every
-- state change is legality-checked, authority-gated, revision-stamped server-side, and logged
-- to the append-only sla_events log so the Phase-2 accountability engine has its history.
--
-- Tasks: I1.1, I1.4, I1.5 (and I1.3's schema hook: bookings.sub_task_id).

-- ------------------------------------------------------------- columns ----
-- Revision allowance: per-work-type default, overridable per deliverable (ADR-0024 §8).
-- Warn-and-allow only — no DB block; the surfaces warn when revision_round exceeds the limit.
alter table work_types  add column revision_limit integer check (revision_limit is null or revision_limit >= 0);
alter table deliverables add column revision_limit integer check (revision_limit is null or revision_limit >= 0);
comment on column deliverables.revision_limit is
  'ADR-0024: per-deliverable override of work_types.revision_limit. Effective limit = coalesce(this, work_type). Warn-and-allow.';

-- Sub-task ↔ scheduling hook (ADR-0024 §2 / I1.3): a booking may be the materialisation of a
-- sub-task, so it shows on the grid and consumes capacity. Deleting the sub-task removes its
-- booking. The materialisation logic (create/sync via the capacity engine) is the Edge-Function
-- increment; this is the link the schema needs.
alter table bookings add column sub_task_id uuid references sub_tasks(id) on delete cascade;
create index idx_bookings_sub_task_id on bookings (sub_task_id);

-- ---------------------------------------------------------------- RLS ----
-- The existing deliverables_tenant_write (FOR ALL, project_tasks:manage) stays — that's the
-- makers'/AM's write path. Add an UPDATE path for reviewers so a lead can sign off / send back
-- without holding project_tasks:manage. Permissive (OR-combined); the guard trigger restricts a
-- reviewer-only actor to review outcomes and freezes the other columns.
create policy deliverables_reviewer_update on deliverables
  for update to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('reviews', 'moderate'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('reviews', 'moderate'));

-- ------------------------------------------------ transition guard trigger ----
-- SECURITY DEFINER (search_path pinned; RLS bypass justified): enforces the transition graph,
-- server-stamps revision_round, gates sign-off on reviews:moderate, freezes non-state columns
-- for reviewer-only actors, and emits the append-only sla_events row (whose actor-pin insert
-- policy we bypass to stamp actor = auth.uid() ourselves). No cross-tenant reach — operates on
-- the row being updated, tenant already fenced by RLS. Authority is read from the caller's JWT
-- grants (GUC claims survive SECURITY DEFINER).
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
  -- Server-stamped; the client value is always ignored.
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
  'ADR-0024: enforce the deliverable transition graph + authority, stamp revision_round, emit append-only sla_events. Fires before set_updated_at (d < s).';

create trigger deliverable_transition_guard before update on deliverables
  for each row execute function app.tg_deliverable_transition_guard();
