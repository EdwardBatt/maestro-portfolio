-- I20.4 + I20.5 (ADR-0053 d.5 and d.6) — the department label follows the person, and ad-hoc work
-- has an owner at last.
--
-- Both halves of ADR-0053 that are NOT gated on ADR-0032. The SLA tiers (d.2/d.4, tasks I20.2 and
-- I20.3) wait for that ADR to be finalised; nothing here touches `app.effective_sla`,
-- `sla_profiles`, or any tier. This migration only makes `deliverables.department_id` — which
-- ADR-0050 d.2 already stamps from the owner — keep telling the truth.
--
-- ============================================================================
-- d.5 — A PERSON CHANGING DEPARTMENT RESTAMPS THE LIVE WORK THEY OWN.
-- ============================================================================
-- `app.tg_deliverable_stamp_department` fires `before insert or update of owner_user_id`. It
-- stamps the department from the owner AT THE MOMENT THE OWNER IS WRITTEN, and never again. Move
-- the person to another department and every deliverable they own keeps the old one for ever,
-- because nothing wrote `owner_user_id`.
--
-- The label is answering "which department is doing this work", not "who owned it in March". Once
-- the department SLA tier is live (I20.2), a stale value is a deadline computed against a
-- department that no longer contains the owner — a wrong answer, not a historical one.
--
-- FINISHED WORK IS FROZEN. `delivered` and `archived` rows are records of what happened. Nothing
-- is being scheduled against them and no deadline is being computed from them, so restamping one
-- would rewrite history to tidy a column. A delivered row is therefore PERMITTED to disagree with
-- its owner's current department; ADR-0053 d.5 says so out loud precisely so that it is not later
-- filed as a bug.
--
-- WHAT IT IS NOT. This is a data correction, not an ownership change. It does not notify anybody
-- (nobody was reassigned), does not touch `owner_user_id`, and does not touch sub-task assignees,
-- their departments, or their bookings. A sub-task's department is the ASSIGNEE's and is stamped
-- by its own trigger; a person's move does not reach into work somebody else is doing.
--
-- ============================================================================
-- d.6 — AN AD-HOC DELIVERABLE'S OWNER IS ITS SINGLE ASSIGNEE.
-- ============================================================================
-- `create_adhoc_deliverable` has never set `owner_user_id`, so every ad-hoc deliverable in the
-- system has a null owner and therefore a null department: no Discipline label, and (once the
-- tiers land) no department SLA tier. The fix asks nobody a new question — the function already
-- requires the assignee and already reads their `department_id` two statements earlier.
--
-- It does not give ad-hoc work a second person. The assignee and the owner are the same human,
-- which is the honest description of a deliverable with exactly one task on it. The no-self-review
-- rule is untouched: the reviewer is still refused if they are the assignee, and an owner is not
-- a reviewer.

begin;

-- ----------------------------------------------------------------- d.5 ----

create or replace function app.tg_user_department_restamp() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_prior text;
begin
  if new.department_id is not distinct from old.department_id then
    return null;
  end if;

  -- `app.tg_deliverable_transition_guard` freezes `department_id` against an actor who does not
  -- hold `project_tasks:manage` or `deliverable_owner:manage`.
  --
  -- Today that guard stands down on its own here: a department change reaches the database through
  -- `update-user`'s SERVICE-ROLE client (`authenticated` holds UPDATE on `display_name`, `locale`
  -- and `office_id` only — `20260801090000:34`), and the guard skips an actor with no `auth.uid()`.
  -- So this fencing is belt-and-braces, deliberately: the moment department editing moves onto an
  -- authenticated path — a scoped RPC, an admin screen — the restamp would start failing with an
  -- authorization error about a deliverable the admin never mentioned. Fencing it now costs two
  -- lines; discovering it later costs somebody an afternoon. pgTAP 067 asserts both sides.
  --
  -- The prior value is saved and restored rather than reset: `set_config(..., true)` is scoped to
  -- the TRANSACTION, and leaving system-op on would silently disarm that guard for the rest of
  -- whatever statement batch the caller is running.
  v_prior := coalesce(current_setting('app.system_op', true), '');
  perform set_config('app.system_op', 'on', true);

  update deliverables d
     set department_id = new.department_id
   where d.owner_user_id = new.id
     and d.tenant_id = new.tenant_id
     -- Live work only. A delivered or archived row is a record (see the header).
     and d.state not in ('delivered', 'archived')
     and d.department_id is distinct from new.department_id;

  perform set_config('app.system_op', v_prior, true);
  return null;
end $$;

comment on function app.tg_user_department_restamp() is
  'ADR-0053 d.5: moving a person between departments restamps deliverables.department_id on the '
  'LIVE work they own. delivered/archived rows are frozen — a delivered row is a record, not a '
  'label. A data correction only: no owner changes, nobody is notified, no booking moves.';

-- AFTER, not BEFORE: the person's new department has to be committed to the row before anything
-- is copied out of it, and this writes other tables rather than shaping the row in hand.
drop trigger if exists user_department_restamp on user_profiles;
create trigger user_department_restamp
  after update of department_id on user_profiles
  for each row execute function app.tg_user_department_restamp();

-- ----------------------------------------------------------------- d.6 ----
-- Reproduced VERBATIM from `20260827100000_sub_task_reviewers.sql` §11 (the last definition). The
-- only edit is `owner_user_id` in the deliverables INSERT, marked inline. Reproducing whole is the
-- house pattern for `create or replace` — a bare replace resets `proconfig` and silently drops the
-- ADR-0033 `search_path` pin.
create or replace function public.create_adhoc_deliverable(
  p_assignee   uuid,
  p_title      text,
  p_hours      numeric,
  p_starts_at  timestamptz,
  p_due_at     timestamptz,
  p_reviewer   uuid default null
) returns table(sub_task_id uuid, deliverable_id uuid)
language plpgsql security definer set search_path = public, app, extensions as $$
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

  -- I20.5 (ADR-0053 d.6). `owner_user_id` added 2026-08-29, and NOT `department_id` beside it:
  -- `app.tg_deliverable_stamp_department` derives that from the owner on this very insert, and
  -- writing both here would be the one way to make the pair disagree.
  insert into deliverables (tenant_id, job_id, name, state, reviewer_id, due_at, owner_user_id)
  values (v_tenant, v_job, trim(p_title), 'in_progress', p_reviewer, p_due_at, p_assignee)
  returning id into v_deliv;

  insert into sub_tasks (tenant_id, deliverable_id, department_id, team_id, assignee_id,
                         title, sla_hours, starts_at, due_at, status, created_by)
  values (v_tenant, v_deliv, v_dept, v_team, p_assignee,
          trim(p_title), p_hours, p_starts_at, p_due_at, 'todo', auth.uid())
  returning id into v_sub;

  -- ADR-0043 d.9: the same person on BOTH homes, written here rather than left to the seed trigger
  -- so the intent is visible at the call site. (The seed trigger has already done it, from the
  -- deliverable this function just wrote; the guard is what makes saying it twice harmless.)
  --
  -- NOT `on conflict (sub_task_id, user_id)`: a conflict target is an expression context, and
  -- `sub_task_id` is this function's OUT parameter, so plpgsql binds the name to the variable and
  -- raises 42702 "column reference is ambiguous". `where not exists` keeps every name qualified.
  insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, created_by)
  select v_tenant, v_sub, p_reviewer, auth.uid()
  where not exists (
    select 1 from sub_task_reviewers r where r.sub_task_id = v_sub and r.user_id = p_reviewer);

  sub_task_id := v_sub; deliverable_id := v_deliv; return next;
end $$;

comment on function public.create_adhoc_deliverable(uuid, text, numeric, timestamptz, timestamptz, uuid) is
  'ADR-0035, amended by ADR-0043 d.9 and ADR-0053 d.6: create an ad-hoc reviewable deliverable + '
  'its sub-task under the tenant Ad-hoc job. The assignee is also the OWNER, which is what gives '
  'ad-hoc work a department and a Discipline label. The chosen reviewer is written to '
  'deliverables.reviewer_id AND to sub_task_reviewers, so the two can never disagree. Ad-hoc '
  'stays single-reviewer, and the reviewer still may not be the assignee.';

-- EXISTING ad-hoc rows are deliberately NOT backfilled here.
--
-- The temptation is one UPDATE setting `owner_user_id` from the deliverable's single sub-task's
-- assignee. It is declined for the same reason ADR-0058's I25.6 declined to guess which task a
-- file belonged to: a backfill that is right for most rows and silently wrong for the rest is
-- worse than no backfill, because nobody can tell afterwards which is which. An ad-hoc
-- deliverable whose task was reassigned would be stamped with whoever holds it TODAY and read as
-- though that person had owned it all along. Untyped, unowned ad-hoc rows created before this
-- migration keep their null owner, render "no owner" honestly, and can be given one through
-- `public.reassign_deliverable` (ADR-0055) by somebody who knows the answer.

commit;
