-- ADR-0043 (I14.1): a task may have several reviewers, some of them mandatory.
--
-- WHAT CHANGES. ADR-0038 put exactly one reviewer on a task — `sub_tasks.reviewer_id` — and four
-- places key off it: the CHECK that a task may not be assigned without a reviewer, the approve RPC
-- ("only THIS task's reviewer"), the submit-notify trigger, and the "Awaiting my review" inbox.
-- Real work is reviewed by whoever is available: an art director AND a copywriter on one execution,
-- or a stand-in while the named person is on leave. Today the only way to say that is to REPLACE the
-- reviewer, which destroys the record of who was originally asked.
--
-- WHERE THE LIST LIVES. A join table, `sub_task_reviewers`, as the SINGLE home — option C in the
-- ADR. Keeping `reviewer_id` as a "lead" alongside a table of extras was rejected because two homes
-- for one fact is how the schedule came to read a task's reviewer off the deliverable (I12.14) and
-- how eight Edge Functions missed the per-user grant overlay (ADR-0037). So the column is backfilled
-- and DROPPED here, and every call site moves in this same file.
--
-- WHEN THE TASK IS DONE (ADR-0043 d.5). Per appointment, not per person and not globally:
--   * every MANDATORY reviewer must approve — the task completes when the last of them does;
--   * with NO mandatory reviewer, the FIRST approval completes it (is_mandatory defaults to false,
--     so a single-reviewer task behaves exactly as it does today);
--   * an OPTIONAL reviewer's approval is recorded on their row and is a real part of the record, but
--     it never completes a task that still owes a mandatory approval.
-- `sub_tasks.approved_by` / `approved_at` keep meaning what they mean today: who completed it and
-- when — with mandatory reviewers, the last one to agree.
--
-- AN APPROVAL BELONGS TO A VERSION (d.6). Request-changes clears EVERY approved_at on the task,
-- including a mandatory one already given, because the work is now different and carrying the
-- approval forward would let a task complete on the strength of somebody agreeing to a draft they
-- never saw. Optional reviewers can do this too: a second pair of eyes that spots a problem must be
-- able to stop the job.
--
-- THE "REQUIRED" INVARIANT MOVES FROM A CHECK TO A TRIGGER (d.4), because a CHECK constraint cannot
-- see another table. That is strictly weaker — a CHECK cannot be disabled by accident and a trigger
-- can — and it is called out as a cost in the ADR rather than pretended away. It is a DEFERRABLE
-- CONSTRAINT TRIGGER so that creating a task and appointing its reviewers in one transaction is
-- legal while ending a transaction with an assigned, live, reviewer-less task is not.
--
-- FUNCTIONS REPRODUCED HERE, and the migration each was lifted from (traps.md: rebuild from the LAST
-- definition, never the first):
--   public.sub_task_approve          ← 20260825120000_adhoc_signoff_follows_task_approval.sql
--   public.update_task_assignment    ← 20260824140000_task_approval.sql
--   public.create_adhoc_deliverable  ← 20260824140000_task_approval.sql
--   app.sub_task_request_changes     ← 20260823110000_revert_temp_alpha_scope.sql (B.8)
--   app.tg_subtask_notify_reviewer   ← 20260820010000_adhoc_reviewable_deliverables.sql (step 3)
--   app.tg_subtask_seed_reviewer     ← 20260824140000_task_approval.sql (§1)
--
-- TESTS. `supabase/tests/056_sub_task_reviewers.sql` covers the rule; `057_…_hardening.sql` covers
-- the seams (reattribution, the escape hatch, the recoverable end-state, `done` as a written value,
-- a reviewer who loses the permission, partial saves, the tenant fence). The concurrency proof is
-- `scripts/db/race-test-reviewers.sh` — two real sessions, because pgTAP runs one session in one
-- rolled-back transaction and cannot express an interleaving at all.
--
-- search_path pinned inline on every function, per ADR-0033.

begin;

-- ============================================================================
-- 1) same-tenant anchor for the composite FK to user_profiles
-- ============================================================================
-- `user_id uuid references user_profiles(id)` alone does NOT stop a task naming ANOTHER tenant's
-- user as its reviewer: foreign keys ignore RLS by design, so the row is legal and merely invisible.
-- The composite FK on (tenant_id, id) makes Postgres refuse it for every writer, forever — the
-- pattern ADR-0042 established for sub_task_resources. `sub_tasks` already carries its half
-- (uq_sub_tasks_tenant_id_id, 20260826100000); user_profiles needs one.
alter table user_profiles add constraint uq_user_profiles_tenant_id_id unique (tenant_id, id);

-- ============================================================================
-- 2) sub_task_reviewers — the single home for "who reviews this task"
-- ============================================================================
create table sub_task_reviewers (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  sub_task_id  uuid not null,
  user_id      uuid not null,
  -- ADR-0043 d.5. Mandatory-ness is a property of the APPOINTMENT, not of the person or their role:
  -- the same reviewer is required on one task and optional on the next. Default false, so a task
  -- with several reviewers and none marked behaves as a POOL — the first approval completes it,
  -- which is what a single-reviewer task has always done.
  is_mandatory boolean not null default false,
  -- Null until that reviewer acts. Written ONLY by public.sub_task_approve and cleared only by
  -- app.tg_subtask_clear_approvals; the guard trigger below makes that true for every other writer,
  -- including a manager who may otherwise manage the row — and, since an appointment's user_id and
  -- sub_task_id are themselves frozen, there is no way to move a verdict onto somebody else either.
  approved_at  timestamptz,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint uq_sub_task_reviewers_task_user unique (sub_task_id, user_id),
  constraint fk_sub_task_reviewers_sub_task
    foreign key (tenant_id, sub_task_id) references sub_tasks (tenant_id, id) on delete cascade,
  constraint fk_sub_task_reviewers_user
    foreign key (tenant_id, user_id) references user_profiles (tenant_id, id),
  -- created_by is audit-only, but a plain `references user_profiles(id)` would still let another
  -- tenant's user be recorded as the person who made the appointment, which is a lie in the audit
  -- trail rather than a leak. Fenced the same way as the other two.
  constraint fk_sub_task_reviewers_created_by
    foreign key (tenant_id, created_by) references user_profiles (tenant_id, id)
);

create index idx_sub_task_reviewers_tenant_id on sub_task_reviewers (tenant_id);
create index idx_sub_task_reviewers_sub_task_id on sub_task_reviewers (sub_task_id);
create index idx_sub_task_reviewers_user_id on sub_task_reviewers (user_id);
-- The reviewer's inbox is "tasks in review where I have not acted yet" (ADR-0043 d.7), so the
-- outstanding rows are the hot read.
create index idx_sub_task_reviewers_outstanding on sub_task_reviewers (user_id)
  where approved_at is null;

comment on table sub_task_reviewers is
  'ADR-0043: who reviews a task — the single home, replacing sub_tasks.reviewer_id. is_mandatory '
  'decides completion (every mandatory reviewer must approve; with none mandatory the first '
  'approval completes it). approved_at is that reviewer''s own verdict and is server-written only.';
comment on column sub_task_reviewers.is_mandatory is
  'ADR-0043 d.5: this appointment cannot be skipped. A property of the appointment, not the person.';
comment on column sub_task_reviewers.approved_at is
  'ADR-0043 d.5/d.6: when THIS reviewer approved. Cleared for every reviewer when changes are '
  'requested — an approval belongs to a version.';

-- ============================================================================
-- 3) backfill, THEN drop the column
-- ============================================================================
-- Faithful copy: every existing reviewer becomes one non-mandatory row, which reproduces today's
-- behaviour exactly (no mandatory reviewer ⇒ the first — and only — approval completes the task).
--
-- The validation triggers are created AFTER this deliberately. The rows being copied were already
-- validated when they were written (chk_sub_tasks_no_self_review, and update_task_assignment /
-- create_adhoc_deliverable both check reviews:moderate), so re-validating history can only fail on
-- a person whose permissions changed since — which is a data question for Edward, not a reason for
-- this migration to refuse to run.
insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory, created_by, created_at)
select st.tenant_id, st.id, st.reviewer_id, false, st.created_by, st.created_at
from sub_tasks st
where st.reviewer_id is not null;

do $$
declare v_n int;
begin
  select count(*) into v_n from sub_task_reviewers;
  raise notice 'ADR-0043: % reviewer appointment(s) migrated off sub_tasks.reviewer_id', v_n;
end $$;

-- The seed trigger and both CHECKs are expressed in terms of the column, so they go with it.
drop trigger subtask_seed_reviewer on sub_tasks;
alter table sub_tasks drop constraint chk_sub_tasks_reviewer_required;
alter table sub_tasks drop constraint chk_sub_tasks_no_self_review;
alter table sub_tasks drop column reviewer_id;

-- ============================================================================
-- 4) the rules that used to be CHECK constraints
-- ============================================================================
-- 4a. Per-row, on write: the reviewer must be able to moderate reviews, and may not be the
--     assignee. ADR-0043 d.3 applies the no-self-review rule from ADR-0038 to EVERY row, not just to
--     a first among equals. Also the approved_at guard (d.1): the verdict is server-written only.
create or replace function app.tg_sub_task_reviewer_write_guard() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare v_assignee uuid;
begin
  -- AN APPOINTMENT IS A PERSON ON A TASK. Neither half may be edited: a row whose user_id or
  -- sub_task_id can move is a way around the approved_at guard rather than through it — a manager
  -- could take a verdict a004 gave and re-point the row at a001, leaving a001 holding an approval
  -- they never gave, permanently, in the record; or move it onto a different task entirely.
  -- Changing who reviews a task is a DELETE plus an INSERT, which is what it honestly is.
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'an appointment cannot change hands — remove it and appoint the other person'
        using errcode = '22023';
    end if;
    if new.sub_task_id is distinct from old.sub_task_id then
      raise exception 'an appointment cannot be moved to another task' using errcode = '22023';
    end if;
  end if;

  -- approved_at is not client-writable. Reset it rather than raising, exactly as the deliverable
  -- transition guard does with revision_round: a caller who did not ask for it should not be
  -- punished, and a caller who did should not be obeyed. public.sub_task_approve and
  -- app.tg_subtask_clear_approvals announce themselves with a transaction-local GUC.
  if coalesce(current_setting('app.reviewer_verdict', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      new.approved_at := null;
    else
      new.approved_at := old.approved_at;
    end if;
  end if;

  -- ELIGIBILITY IS CHECKED WHEN SOMEBODY IS APPOINTED, NOT ON EVERY LATER WRITE. Re-running it on
  -- UPDATE looked stricter and was a trap: a reviewer who approves and then loses reviews:moderate
  -- (an ADR-0036 deny overlay, a role change, leaving the team) made their own task unsendable-back
  -- AND uncancellable, because clearing approvals is an UPDATE of these rows and it raised from
  -- here. Since user_id can no longer change (above), INSERT is the only moment the question is
  -- live. Overlay-aware (app.user_holds_permission = role ∪ allow − deny, ADR-0036 L6.7).
  if tg_op = 'INSERT' then
    if not app.user_holds_permission(new.user_id, 'reviews', 'moderate') then
      raise exception 'the chosen reviewer cannot moderate reviews' using errcode = '22023';
    end if;

    select st.assignee_id into v_assignee from public.sub_tasks st where st.id = new.sub_task_id;
    if v_assignee is not null and v_assignee = new.user_id then
      raise exception 'the reviewer cannot be the assignee (no self-review)' using errcode = '22023';
    end if;
  end if;

  return new;
end $$;

comment on function app.tg_sub_task_reviewer_write_guard() is
  'ADR-0043 d.1/d.3: an appointment is a person on a task and neither half is editable; a named '
  'reviewer must hold reviews:moderate and may never be the task''s assignee (checked when they are '
  'appointed, not on every later write); approved_at is server-written only.';

create trigger sub_task_reviewer_write_guard
  before insert or update on sub_task_reviewers
  for each row execute function app.tg_sub_task_reviewer_write_guard();

-- 4b. Across rows, at COMMIT: a live assigned task has at least one reviewer, and none of them is
--     the assignee. ADR-0043 d.4 — the rule is unchanged from chk_sub_tasks_reviewer_required, only
--     its mechanism is. DEFERRED because "insert the task, then appoint its reviewers" is one
--     legitimate transaction and would otherwise be impossible; what is refused is ENDING a
--     transaction with an assigned, live, reviewer-less task.
--
--     The assignee half must live here as well as in 4a: 4a catches naming the assignee as a
--     reviewer, this catches the mirror image — reassigning the task TO somebody who is already one
--     of its reviewers (the drag-to-reassign path on the schedule can do exactly that).
create or replace function app.tg_sub_task_reviewer_required() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_task     uuid;
  v_assignee uuid;
  v_status   text;
  v_total    int;
  v_self     int;
begin
  if tg_table_name = 'sub_tasks' then
    v_task := new.id;
  elsif tg_op = 'DELETE' then
    v_task := old.sub_task_id;
  else
    v_task := new.sub_task_id;
  end if;

  select st.assignee_id, st.status into v_assignee, v_status
  from public.sub_tasks st where st.id = v_task;
  -- The task itself was deleted in this transaction and took its reviewer rows with it (cascade).
  if not found then
    return null;
  end if;

  select count(*), count(*) filter (where r.user_id = v_assignee)
    into v_total, v_self
  from public.sub_task_reviewers r where r.sub_task_id = v_task;

  -- Scoped exactly as chk_sub_tasks_reviewer_required was: required from the moment a task is
  -- ASSIGNED. An unassigned task has nobody whose work is waiting on a reviewer, and cancelled
  -- history predates the rule and must not be falsified.
  if v_assignee is not null and v_status <> 'cancelled' and v_total = 0 then
    raise exception 'a reviewer must be appointed for this task' using errcode = '23514';
  end if;
  if v_self > 0 then
    raise exception 'the reviewer cannot be the assignee (no self-review)' using errcode = '23514';
  end if;

  return null;
end $$;

comment on function app.tg_sub_task_reviewer_required() is
  'ADR-0043 d.4: a live ASSIGNED task has at least one reviewer, and no reviewer is its assignee. '
  'Replaces chk_sub_tasks_reviewer_required + chk_sub_tasks_no_self_review, which cannot be '
  'expressed as CHECKs once the fact lives in another table. Deferred to commit so a task and its '
  'reviewers can be written in one transaction.';

create constraint trigger sub_task_reviewer_required
  after insert or update on sub_tasks
  deferrable initially deferred
  for each row execute function app.tg_sub_task_reviewer_required();

create constraint trigger sub_task_reviewer_required
  after update or delete on sub_task_reviewers
  deferrable initially deferred
  for each row execute function app.tg_sub_task_reviewer_required();

-- ============================================================================
-- 5) RLS — reads tenant-wide, writes by whoever may manage the task
-- ============================================================================
alter table sub_task_reviewers enable row level security;
alter table sub_task_reviewers force row level security;

-- Reads are tenant-wide, exactly as sub_tasks and sub_task_resources are. ADR-0043 d.8 requires a
-- task in review to name its outstanding reviewers to EVERYONE — the assignee, the Deliverables
-- table, the exceptions strip — so a narrower read would defeat the decision.
create policy sub_task_reviewers_tenant_select on sub_task_reviewers
  for select to authenticated
  using (tenant_id = app.current_tenant_id());

-- ADR-0043 d.1: writes gated by app.can_manage_sub_task — the same authority that assigns the task.
create policy sub_task_reviewers_manage_insert on sub_task_reviewers
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id() and app.can_manage_sub_task(sub_task_id));

-- USING and WITH CHECK both, and both on the row's own sub_task_id: without the WITH CHECK half a
-- caller who may manage task X could move an appointment onto task Y they may not touch.
create policy sub_task_reviewers_manage_update on sub_task_reviewers
  for update to authenticated
  using      (tenant_id = app.current_tenant_id() and app.can_manage_sub_task(sub_task_id))
  with check (tenant_id = app.current_tenant_id() and app.can_manage_sub_task(sub_task_id));

create policy sub_task_reviewers_manage_delete on sub_task_reviewers
  for delete to authenticated
  using (tenant_id = app.current_tenant_id() and app.can_manage_sub_task(sub_task_id));

create trigger set_updated_at before update on sub_task_reviewers
  for each row execute function app.set_updated_at();
create trigger audit_row_change
  after insert or update or delete on sub_task_reviewers
  for each row execute function app.audit_row_change();

-- ============================================================================
-- 6) the seed: a task inherits its deliverable's reviewer
-- ============================================================================
-- Reproduced from 20260824140000 §1, moved from "set a column BEFORE insert" to "write a row AFTER
-- insert". The behaviour it exists for is unchanged and is what makes the required-reviewer rule
-- liveable: the deliverable already names a reviewer for ad-hoc work, so every insert site does not
-- have to remember. It still never seeds somebody onto their own work, and it silently declines a
-- deliverable reviewer who cannot moderate reviews rather than blocking the task insert — an
-- inherited default that no longer qualifies is not the inserting caller's mistake, and the
-- deferred rule in 4b still catches the resulting reviewer-less assignment.
create or replace function app.tg_subtask_seed_reviewer() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare v_reviewer uuid;
begin
  if new.deliverable_id is null or new.assignee_id is null then
    return null;
  end if;
  select d.reviewer_id into v_reviewer from public.deliverables d where d.id = new.deliverable_id;
  if v_reviewer is null or v_reviewer = new.assignee_id then
    return null;
  end if;
  if not app.user_holds_permission(v_reviewer, 'reviews', 'moderate') then
    return null;
  end if;
  insert into public.sub_task_reviewers (tenant_id, sub_task_id, user_id, created_by)
  values (new.tenant_id, new.id, v_reviewer, auth.uid())
  on conflict (sub_task_id, user_id) do nothing;
  return null;
end $$;

comment on function app.tg_subtask_seed_reviewer() is
  'ADR-0038 d.2, carried to ADR-0043: a task inherits its parent deliverable''s reviewer as one '
  'non-mandatory appointment when it is created assigned. Never the assignee, never somebody who '
  'cannot moderate reviews.';

create trigger subtask_seed_reviewer after insert on sub_tasks
  for each row execute function app.tg_subtask_seed_reviewer();

-- ============================================================================
-- 7) approval: every mandatory reviewer, or the first of a pool
-- ============================================================================
-- Reproduced from 20260825120000 (the ad-hoc sign-off version — reproducing the 20260824140000 one
-- would have silently dropped that fix, which is the exact mistake traps.md records).
--
-- The completion half lives in app.maybe_complete_sub_task rather than inline, because approving is
-- not the only thing that can satisfy the rule. ADR-0043's Consequences promise a manual escape
-- hatch for a task stalled on one person — "remove the mandatory reviewer" — and with the check
-- inline that hatch did not work: an optional reviewer approves (recorded, correctly not complete),
-- the mandatory one is removed, and nothing re-asks the question. The task then sat in `review` for
-- ever, because the optional reviewer could not approve twice and request-changes needs an
-- unresolved comment. One function, called from every event that can change the answer.
create or replace function app.maybe_complete_sub_task(p_sub_task uuid, p_actor uuid default null)
returns boolean language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v sub_tasks;
  v_stream uuid;
  v_state  deliverable_state;
  v_by     uuid;
begin
  -- FOR UPDATE, and it is the whole defence against a lost update. Two mandatory reviewers
  -- approving at the same moment each stamped their own row and then counted the other as
  -- outstanding — neither can see the other's uncommitted stamp under READ COMMITTED — so both
  -- returned "not yet", leaving the task with every approval given, status `review` and
  -- approved_by null, and unable to be approved again by anybody. Serialising per task is what
  -- makes the count taken after the stamp mean what it says.
  select * into v from sub_tasks where id = p_sub_task for update;
  if not found or v.status <> 'review' then
    return false;
  end if;

  -- Nobody has agreed to anything yet. This matters on the appointment-change path: removing one of
  -- two optional reviewers when neither has approved must not complete the task by arithmetic.
  if not exists (select 1 from sub_task_reviewers r
                  where r.sub_task_id = p_sub_task and r.approved_at is not null) then
    return false;
  end if;

  -- ADR-0043 d.5. With mandatory reviewers the task completes when the LAST of them agrees; with
  -- none marked mandatory the first approval completes it (the pool behaviour, and the behaviour of
  -- every task that has exactly one reviewer).
  if exists (select 1 from sub_task_reviewers r
              where r.sub_task_id = p_sub_task and r.is_mandatory and r.approved_at is null) then
    return false;
  end if;

  -- Who completed it. The caller when there is one; otherwise the reviewer whose verdict turned out
  -- to be the last one needed, which is the honest answer when an appointment change carried it.
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

  -- Tell the maker their work was accepted. Best-effort by convention: the row is the record.
  if v.assignee_id is not null and v.assignee_id is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
    values (v.tenant_id, v.assignee_id, 'signed_off', v.title, 'sub_task', v.id, auth.uid());
  end if;

  -- An AD-HOC deliverable (stream_id null) is this one piece of work, so approving its task is the
  -- sign-off. A CAMPAIGN deliverable holds several tasks and is signed off by whoever owns it —
  -- never as a side effect of one task (ADR-0038: "tasks are approved, deliverables are signed off").
  -- The `not exists` is belt-and-braces for a job-backed deliverable that somehow holds more than
  -- one task: the last approval carries it, an earlier one does not.
  select d.stream_id, d.state into v_stream, v_state
    from deliverables d where d.id = v.deliverable_id;

  if v_stream is null and v_state = 'in_review'
     and not exists (
       select 1 from sub_tasks st
       where st.deliverable_id = v.deliverable_id
         and st.status not in ('done', 'cancelled')
     )
  then
    -- Deliberately NOT swallowed. A silent best-effort here is what let the 25 Aug regression ship.
    --
    -- KNOWN EDGE, ACCEPTED: the deliverable guard demands reviews:moderate of the CALLER, and on the
    -- appointment-change path the caller is whoever manages the task, who need not hold it (a
    -- Traffic Manager does not). So removing the last mandatory reviewer from an AD-HOC task whose
    -- optional reviewer has already approved can be refused with the guard's own 42501. Narrow —
    -- ad-hoc work is created single-reviewer — and it is the honest failure: the alternative is a
    -- task marked done with its deliverable stranded in_review, which is exactly what
    -- 20260825120000 had to repair. Flagged for Edward rather than papered over.
    update deliverables set state = 'approved' where id = v.deliverable_id;
  end if;

  return true;
end $$;

comment on function app.maybe_complete_sub_task(uuid, uuid) is
  'ADR-0043 d.5: complete a task in review IF every mandatory reviewer has approved (or none is '
  'mandatory and somebody has). Locks the task row FOR UPDATE, so two reviewers approving at once '
  'cannot each count the other as outstanding. Called by sub_task_approve AND by the appointment '
  'trigger, so removing or demoting a mandatory reviewer re-asks the question — the manual escape '
  'hatch ADR-0043 promises.';

create or replace function public.sub_task_approve(p_sub_task uuid)
returns void language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v sub_tasks;
  v_mine   sub_task_reviewers;
begin
  select * into v from sub_tasks where id = p_sub_task and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002';
  end if;

  if v.status <> 'review' then
    raise exception 'task cannot be approved from % (only a submitted task can be approved)', v.status
      using errcode = '22023';
  end if;

  -- ADR-0043: one of THIS task's appointed reviewers, not the deliverable's owner and not any
  -- moderator at large. (ADR-0038 d.3, widened from one person to the appointed set.)
  select * into v_mine from sub_task_reviewers
   where sub_task_id = p_sub_task and user_id = auth.uid();
  if not found then
    raise exception 'only an appointed reviewer may approve this task' using errcode = '42501';
  end if;
  if v_mine.approved_at is not null then
    -- Already given. Re-ask the completion question before refusing: if the mandatory set is
    -- satisfied and the task is nonetheless still sitting in review, this call is somebody trying
    -- to unstick it and it should work. Refusing flatly is what made a raced task, or one whose
    -- mandatory reviewer was removed, terminal.
    if app.maybe_complete_sub_task(p_sub_task) then
      return;
    end if;
    raise exception 'you have already approved this task' using errcode = '22023';
  end if;

  -- The verdict is recorded on the reviewer's OWN row first, and it stands whether or not it
  -- completes the task: an optional reviewer's approval is a real part of the record (ADR-0043 d.5).
  perform set_config('app.reviewer_verdict', 'on', true);
  update sub_task_reviewers set approved_at = now() where id = v_mine.id;
  perform set_config('app.reviewer_verdict', 'off', true);

  perform app.maybe_complete_sub_task(p_sub_task, auth.uid());
end $$;

comment on function public.sub_task_approve(uuid) is
  'ADR-0038 + ADR-0043: an appointed reviewer records their approval on their own row. The TASK '
  'completes (review → done, approved_by/approved_at stamped) when the last MANDATORY reviewer '
  'agrees, or on the first approval when none is mandatory — decided by app.maybe_complete_sub_task, '
  'which also carries the ad-hoc deliverable sign-off.';
revoke execute on function public.sub_task_approve(uuid) from public;
revoke execute on function public.sub_task_approve(uuid) from anon;
grant  execute on function public.sub_task_approve(uuid) to authenticated;

-- ------------------------------------------------------------------------
-- 7b) changing the appointments re-asks the completion question
-- ------------------------------------------------------------------------
-- ADR-0043 Consequences: "The manual escape hatch remains either way: remove the mandatory
-- reviewer." That is the ADR's stated answer to "a task can now stall on one person", so it has to
-- actually move the task. Demoting a mandatory reviewer to optional is the same act under another
-- name, so it is handled here too.
create or replace function app.tg_sub_task_reviewers_recheck() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare v_task uuid;
begin
  if tg_op = 'DELETE' then
    v_task := old.sub_task_id;
  elsif new.is_mandatory is not distinct from old.is_mandatory then
    return null;   -- nothing about the rule changed
  else
    v_task := new.sub_task_id;
  end if;
  perform app.maybe_complete_sub_task(v_task);
  return null;
end $$;

comment on function app.tg_sub_task_reviewers_recheck() is
  'ADR-0043: removing or demoting a reviewer can be the last thing a task was waiting for. Without '
  'this the ADR''s own escape hatch left the task in review for ever, because the reviewer who had '
  'already approved could not approve again.';

create trigger sub_task_reviewers_recheck
  after delete or update of is_mandatory on sub_task_reviewers
  for each row execute function app.tg_sub_task_reviewers_recheck();

-- ------------------------------------------------------------------------
-- 7c) "done" is something reviewers do, not a value you can write
-- ------------------------------------------------------------------------
-- WHY THIS IS HERE AT ALL. `sub_tasks_manage_update` (20260819100000) carries an
-- `or assignee_id = auth.uid()` branch so a maker can PROGRESS their own task, and nothing on
-- sub_tasks polices which status they may progress it to. So a plain PostgREST
-- `update sub_tasks set status='done'` from the assignee has always worked, and after ADR-0043 it
-- lands a task with `approved_by` null and mandatory approvals outstanding. Pre-existing — but
-- ADR-0043's own reasoning for rejecting option A is that a fact with two homes goes wrong, and
-- "every mandatory reviewer must approve" living only inside an RPC is exactly that shape.
--
-- DELIBERATELY NARROW. This is not a transition guard: it says nothing about todo → review or about
-- cancellation, both of which have their own paths and their own blast radius. It polices ONE
-- value. Every SQL path that writes `done` was enumerated first — `public.sub_task_approve` and
-- `app.maybe_complete_sub_task` are the only two in the whole migration history, and no pgTAP
-- fixture inserts or updates a task to `done` — so the surface it can break is the surface it is
-- meant to close.
--
-- The auth.uid()/system_op escape is the same one ADR-0040's assignment trigger uses: a migration
-- or a seeder is not a signed-in user and must not be blocked by a permission it has no business
-- holding.
create or replace function app.tg_sub_task_completion_guard() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
begin
  if new.status <> 'done' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'done' then
    return new;   -- already done; this write is about something else
  end if;
  if auth.uid() is null or app.is_system_op() then
    return new;
  end if;

  if not exists (select 1 from public.sub_task_reviewers r
                  where r.sub_task_id = new.id and r.approved_at is not null) then
    raise exception
      'a task becomes done when its reviewers approve it, not by being marked done'
      using errcode = '42501';
  end if;
  if exists (select 1 from public.sub_task_reviewers r
              where r.sub_task_id = new.id and r.is_mandatory and r.approved_at is null) then
    raise exception 'this task still owes a mandatory reviewer''s approval' using errcode = '42501';
  end if;

  return new;
end $$;

comment on function app.tg_sub_task_completion_guard() is
  'ADR-0043 d.5, held by Postgres rather than only by the RPC: a task may not reach `done` unless a '
  'reviewer has approved it and no mandatory approval is outstanding. Closes the assignee''s own '
  'progress branch on sub_tasks_manage_update, which let a maker mark their own work complete.';

create trigger sub_task_completion_guard
  before insert or update of status on sub_tasks
  for each row execute function app.tg_sub_task_completion_guard();

-- ============================================================================
-- 8) request changes clears every approval
-- ============================================================================
-- Reproduced from 20260823110000 (B.8) — the last definition — with two edits, both marked. The
-- reviews:moderate gate is unchanged: every appointed reviewer holds it by d.3, so "anyone
-- appointed may request changes" (d.6) is already true, and narrowing the gate to appointees only
-- would take the action away from the Deliverables page, which offers it to any moderator today and
-- which this ADR does not touch.
create or replace function app.sub_task_request_changes(p_sub_task uuid)
returns void language plpgsql security definer set search_path = public, app, extensions as $$
declare v sub_tasks; v_deliv_state deliverable_state; v_has_comment boolean;
begin
  if not app.has_permission('reviews', 'moderate') then
    raise exception 'requesting changes requires reviews:moderate' using errcode = '42501';
  end if;
  -- EDIT 1: tenant fence. The original looked the task up by id alone, so a caller holding
  -- reviews:moderate in tenant A could reopen a task in tenant B by id. Every sibling RPC
  -- (sub_task_approve, update_task_assignment) already filters on app.current_tenant_id().
  select * into v from sub_tasks where id = p_sub_task and tenant_id = app.current_tenant_id();
  if v.id is null then raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002'; end if;
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
  -- EDIT 2 (ADR-0043 d.6): this statement is also what clears every approval on the task, via
  -- app.tg_subtask_clear_approvals below. An approval is an approval OF A VERSION, and that rule is
  -- owned by the status change rather than by this RPC, so no other path can move a task out of
  -- review while an approval of the old version quietly survives.
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
  'ADR-0030/0035, amended by ADR-0043 d.6: reopen a submitted task to todo for a fresh timed round. '
  'Clearing every reviewer''s approval is the status change''s job (app.tg_subtask_clear_approvals), '
  'not this function''s — an approval belongs to a version, whichever path moves the task.';

-- ------------------------------------------------------------------------
-- 8b) an approval belongs to a VERSION — enforced on the status change itself
-- ------------------------------------------------------------------------
-- ADR-0043 d.6 words this as a consequence of requesting changes, and requesting changes is the path
-- that matters in the product. But putting the rule in that one RPC would make the RPC the home of
-- an invariant, and this project has been bitten twice by a fact with two homes (ADR-0037; I12.14).
-- Any move out of `review` or `done` into anything except `done` means the work under review is no
-- longer the work that was approved, so the verdicts on it are void — whatever moved it.
--
-- Deliberately NOT cleared on review → done: that transition IS the completion, and the approvals
-- that produced it are the record of who completed it.
create or replace function app.tg_subtask_clear_approvals() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
begin
  if new.status is distinct from old.status and new.status <> 'done' then
    perform set_config('app.reviewer_verdict', 'on', true);
    update public.sub_task_reviewers set approved_at = null
     where sub_task_id = new.id and approved_at is not null;
    perform set_config('app.reviewer_verdict', 'off', true);
  end if;
  return new;
end $$;

comment on function app.tg_subtask_clear_approvals() is
  'ADR-0043 d.6: an approval belongs to a version. Any status change that is not the completion '
  'itself voids every reviewer verdict on the task, so nothing can complete later on the strength '
  'of somebody agreeing to a draft that no longer exists.';

create trigger subtask_clear_approvals after update of status on sub_tasks
  for each row execute function app.tg_subtask_clear_approvals();

-- ============================================================================
-- 9) submitting notifies EVERY named reviewer
-- ============================================================================
-- Reproduced from 20260820010000 step 3 (its only definition). It read the DELIVERABLE's reviewer,
-- which ADR-0038 already made the wrong place to ask — campaign deliverables name nobody, so a
-- submitted campaign task notified no one at all. It now reads the task's own appointments, which
-- is also what makes multiple reviewers work: all of them are told, not just a lead.
create or replace function app.tg_subtask_notify_reviewer()
returns trigger language plpgsql security definer set search_path = public, app, extensions as $$
declare v_name text;
begin
  if new.status <> 'review' or new.status is not distinct from old.status then
    return new;
  end if;
  select d.name into v_name from deliverables d where d.id = new.deliverable_id;
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
  select new.tenant_id, r.user_id, 'review_requested', coalesce(v_name, new.title),
         case when new.deliverable_id is null then 'sub_task' else 'deliverable' end,
         coalesce(new.deliverable_id, new.id), auth.uid()
  from sub_task_reviewers r
  where r.sub_task_id = new.id
    and r.user_id is distinct from auth.uid();   -- never notify the actor about their own action
  return new;
end $$;

comment on function app.tg_subtask_notify_reviewer() is
  'ADR-0035, amended by ADR-0043 d.7: on submit, notify EVERY reviewer appointed to the task '
  '(the actor excepted). Reads sub_task_reviewers, not deliverables.reviewer_id.';

-- ============================================================================
-- 10) update_task_assignment takes a LIST of reviewers
-- ============================================================================
-- Reproduced from 20260824140000 §4 (the last definition). The signature changes, so the old one is
-- dropped rather than replaced: p_reviewer uuid becomes p_reviewers jsonb —
--   [{"user_id": "…", "is_mandatory": true}, …]
-- NULL means "leave the appointments alone", which is what the drag-to-reassign path on the schedule
-- wants: moving work to somebody else is not a decision about who reviews it, and making that path
-- re-send the reviewer list would be a second home for the fact.
drop function if exists public.update_task_assignment(uuid, text, uuid, uuid, timestamptz, timestamptz, numeric);

create or replace function public.update_task_assignment(
  p_sub_task   uuid,
  p_title      text,
  p_assignee   uuid,
  p_reviewers  jsonb default null,
  p_starts_at  timestamptz default null,
  p_due_at     timestamptz default null,
  p_hours      numeric default null
) returns table(sub_task_id uuid, deliverable_id uuid, reschedule_needed boolean)
language plpgsql security definer set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v sub_tasks%rowtype;
  v_reassigned boolean;
  v_dates_changed boolean;
  v_lead uuid;
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

  -- ADR-0043: the reviewer set, not a single reviewer. Validated up front, applied AFTER the
  -- assignee is written — see below.
  if p_reviewers is not null then
    if jsonb_typeof(p_reviewers) <> 'array' then
      raise exception 'the reviewer list must be a JSON array' using errcode = '22023';
    end if;
    if jsonb_array_length(p_reviewers) = 0 then
      raise exception 'a reviewer must be appointed for this task' using errcode = '22023';
    end if;
    -- Otherwise a repeated name surfaces as a raw 23505, or as 21000 from the update below, neither
    -- of which tells the person what they did.
    if (select count(*) from jsonb_array_elements(p_reviewers) e) <>
       (select count(distinct e ->> 'user_id') from jsonb_array_elements(p_reviewers) e) then
      raise exception 'the same reviewer is listed twice' using errcode = '22023';
    end if;
  end if;

  v_reassigned := p_assignee is distinct from v.assignee_id;
  v_dates_changed := (p_starts_at is not null and p_starts_at is distinct from v.starts_at)
                  or (p_due_at    is not null and p_due_at    is distinct from v.due_at)
                  or (p_hours     is not null and p_hours     is distinct from v.sla_hours);

  update sub_tasks set
    title       = trim(p_title),
    assignee_id = p_assignee,
    starts_at   = coalesce(p_starts_at, starts_at),
    due_at      = coalesce(p_due_at, due_at),
    sla_hours   = coalesce(p_hours, sla_hours),
    -- reset the human-override flag so subtask-schedule rebuilds the booking on reassign / date change
    schedule_overridden = case when v_reassigned or v_dates_changed then false else schedule_overridden end
  where id = p_sub_task;

  -- The appointments are applied AFTER the assignee moves, and the order is load-bearing: one call
  -- can both reassign the task and name the previous assignee as a reviewer (which is a perfectly
  -- ordinary thing to do — the person who did it last is often the right person to check it). The
  -- write guard tests each appointment against the task's CURRENT assignee, so doing this first
  -- would refuse that edit against an assignee who is on their way out.
  --
  -- Tenant membership is enforced structurally by the composite FK, and reviews:moderate +
  -- no-self-review by the write guard on sub_task_reviewers — ONE home for each rule, checked for
  -- every writer, not re-implemented here.
  if p_reviewers is not null then
    delete from sub_task_reviewers r
     where r.sub_task_id = p_sub_task
       and not exists (
         select 1 from jsonb_array_elements(p_reviewers) e
         where (e ->> 'user_id')::uuid = r.user_id);

    -- Written as update-then-insert rather than ON CONFLICT: the conflict target is an expression
    -- context, and `sub_task_id` is also this function's OUT parameter, so plpgsql resolves the
    -- name to the variable and raises 42702. Keeping the existing rows (rather than
    -- delete-and-reinsert) is also what preserves an approval a reviewer has already given.
    update sub_task_reviewers r
       set is_mandatory = coalesce((e ->> 'is_mandatory')::boolean, false)
      from jsonb_array_elements(p_reviewers) e
     where r.sub_task_id = p_sub_task
       and r.user_id = (e ->> 'user_id')::uuid
       and r.is_mandatory is distinct from coalesce((e ->> 'is_mandatory')::boolean, false);

    insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory, created_by)
    select v_tenant, p_sub_task, (e ->> 'user_id')::uuid,
           coalesce((e ->> 'is_mandatory')::boolean, false), auth.uid()
    from jsonb_array_elements(p_reviewers) e
    where not exists (
      select 1 from sub_task_reviewers r
      where r.sub_task_id = p_sub_task and r.user_id = (e ->> 'user_id')::uuid);
  end if;

  -- parent deliverable: keep the deliverable-level reviewer record in step (ADR-0043 d.9 keeps
  -- deliverables.reviewer_id as the review stack's record and out of scope for multi-reviewer). A
  -- mandatory appointment is the truest single answer to "who signs this off"; failing that, the
  -- first one named. Only rename an AD-HOC deliverable (stream_id null) — never rename a project
  -- (stream-backed) deliverable from a booking edit.
  if v.deliverable_id is not null then
    select r.user_id into v_lead from sub_task_reviewers r
     where r.sub_task_id = p_sub_task
     order by r.is_mandatory desc, r.created_at, r.user_id
     limit 1;
    update deliverables set
      reviewer_id = coalesce(v_lead, reviewer_id),
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

comment on function public.update_task_assignment(uuid, text, uuid, jsonb, timestamptz, timestamptz, numeric) is
  'ADR-0038/0040, amended by ADR-0043: edit a task from the schedule modal. p_reviewers is a JSON '
  'array of {user_id, is_mandatory}; NULL leaves the existing appointments untouched (the '
  'drag-to-reassign path). Reviewer eligibility and no-self-review are enforced by the '
  'sub_task_reviewers write guard, not duplicated here.';

revoke execute on function public.update_task_assignment(uuid, text, uuid, jsonb, timestamptz, timestamptz, numeric) from public;
revoke execute on function public.update_task_assignment(uuid, text, uuid, jsonb, timestamptz, timestamptz, numeric) from anon;
grant  execute on function public.update_task_assignment(uuid, text, uuid, jsonb, timestamptz, timestamptz, numeric) to authenticated;

-- ============================================================================
-- 11) ad-hoc creation writes the reviewer to both homes (ADR-0043 d.9)
-- ============================================================================
-- Reproduced from 20260824140000 §4 (the last definition). Ad-hoc work stays SINGLE-reviewer at the
-- deliverable level — making it multi is explicitly out of scope in ADR-0043 d.9 — so the signature
-- is unchanged; what changes is that the reviewer is written to sub_task_reviewers as well, so the
-- deliverable-level record and the task-level authority can never disagree.
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

  insert into deliverables (tenant_id, job_id, name, state, reviewer_id, due_at)
  values (v_tenant, v_job, trim(p_title), 'in_progress', p_reviewer, p_due_at)
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
  'ADR-0035, amended by ADR-0043 d.9: create an ad-hoc reviewable deliverable + its sub-task under '
  'the tenant Ad-hoc job. The chosen reviewer is written to deliverables.reviewer_id AND to '
  'sub_task_reviewers, so the two can never disagree. Ad-hoc stays single-reviewer by decision.';

-- ============================================================================
-- 12) one atomic write for the Deliverables page: task + its reviewers
-- ============================================================================
-- WHY THIS EXISTS. The campaign breakdown form inserts sub_tasks directly through RLS. With the
-- reviewer on the task that was one statement; with the reviewer in another table it is two, and
-- PostgREST puts each in its own transaction — so "insert the task, then appoint its reviewers"
-- would end a transaction with an assigned, reviewer-less task and be refused by 4b. Both halves
-- have to happen together, which means one call.
--
-- SECURITY INVOKER ON PURPOSE. It adds atomicity and nothing else: RLS decides both writes exactly
-- as it does today (sub_tasks_manage_insert/update, sub_task_reviewers_manage_*), so this is not a
-- new authorization surface and gets no elevation (AGENTS.md §6 — definer needs an ADR).
create or replace function public.save_sub_task(
  p_sub_task    uuid,
  p_deliverable uuid,
  p_title       text,
  p_reviewers   jsonb,
  p_description text default null,
  p_assignee    uuid default null,
  p_department  uuid default null,
  p_team        uuid default null,
  p_sla_hours   numeric default null,
  p_sla_profile uuid default null,
  p_starts_at   timestamptz default null,
  p_due_at      timestamptz default null,
  -- NOT `default 'todo'`. With a default, an update that mentions no status silently reopened the
  -- task, which fired app.tg_subtask_clear_approvals and destroyed a mandatory reviewer's recorded
  -- verdict — and `coalesce(p_status, status)` could never fall through to save it, because the
  -- parameter was never null.
  p_status      text default null
) returns uuid
language plpgsql security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_id uuid := p_sub_task;
begin
  if coalesce(trim(p_title), '') = '' then
    raise exception 'a task title is required' using errcode = '22023';
  end if;
  if p_reviewers is not null then
    if jsonb_typeof(p_reviewers) <> 'array' then
      raise exception 'the reviewer list must be a JSON array' using errcode = '22023';
    end if;
    -- Otherwise a repeated name surfaces as a raw 23505 from the unique index, which tells the
    -- person nothing about what they did.
    if (select count(*) from jsonb_array_elements(p_reviewers) e) <>
       (select count(distinct e ->> 'user_id') from jsonb_array_elements(p_reviewers) e) then
      raise exception 'the same reviewer is listed twice' using errcode = '22023';
    end if;
  end if;

  if v_id is null then
    insert into sub_tasks (tenant_id, deliverable_id, title, description, assignee_id,
                           department_id, team_id, sla_hours, sla_profile_id,
                           starts_at, due_at, status, created_by)
    values (v_tenant, p_deliverable, trim(p_title), p_description, p_assignee,
            p_department, p_team, p_sla_hours, p_sla_profile,
            p_starts_at, p_due_at, coalesce(p_status, 'todo'), auth.uid())
    returning id into v_id;
  else
    -- COALESCE, every field. A bare assignment made this a full-row replace, so a caller that
    -- changed only the title wiped the description, hours, dates, SLA profile AND the assignee —
    -- and unassigning is why the deferred required-reviewer rule did not catch the damage. NULL
    -- here means "leave it alone", the same convention update_task_assignment already uses. A
    -- field that genuinely needs clearing is a separate, explicit call.
    update sub_tasks set
      title          = trim(p_title),
      description    = coalesce(p_description, description),
      assignee_id    = coalesce(p_assignee, assignee_id),
      department_id  = coalesce(p_department, department_id),
      team_id        = coalesce(p_team, team_id),
      sla_hours      = coalesce(p_sla_hours, sla_hours),
      sla_profile_id = coalesce(p_sla_profile, sla_profile_id),
      starts_at      = coalesce(p_starts_at, starts_at),
      due_at         = coalesce(p_due_at, due_at),
      status         = coalesce(p_status, status)
    where id = v_id and tenant_id = v_tenant;
    if not found then
      raise exception 'sub_task % not found', v_id using errcode = 'P0002';
    end if;
  end if;

  -- NULL leaves the appointments alone (an edit that is not about who reviews the work); an empty
  -- array is a request to have nobody review it, which 4b would refuse at commit anyway — say so
  -- here, where the message can be useful.
  if p_reviewers is not null then
    if jsonb_array_length(p_reviewers) = 0 and p_assignee is not null then
      raise exception 'a reviewer must be appointed for this task' using errcode = '22023';
    end if;

    delete from sub_task_reviewers r
     where r.sub_task_id = v_id
       and not exists (
         select 1 from jsonb_array_elements(p_reviewers) e
         where (e ->> 'user_id')::uuid = r.user_id);

    -- Update-then-insert, guarded on an ACTUAL change, exactly as update_task_assignment does.
    -- `on conflict … do update set is_mandatory` touched every listed reviewer on every save, and
    -- a no-op UPDATE still fires the row triggers — so one appointment that no longer satisfies a
    -- guard would break every later save of the task even when nothing about it was being changed.
    update sub_task_reviewers r
       set is_mandatory = coalesce((e ->> 'is_mandatory')::boolean, false)
      from jsonb_array_elements(p_reviewers) e
     where r.sub_task_id = v_id
       and r.user_id = (e ->> 'user_id')::uuid
       and r.is_mandatory is distinct from coalesce((e ->> 'is_mandatory')::boolean, false);

    insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory, created_by)
    select v_tenant, v_id, (e ->> 'user_id')::uuid,
           coalesce((e ->> 'is_mandatory')::boolean, false), auth.uid()
    from jsonb_array_elements(p_reviewers) e
    where not exists (
      select 1 from sub_task_reviewers r
      where r.sub_task_id = v_id and r.user_id = (e ->> 'user_id')::uuid);
  end if;

  return v_id;
end $$;

comment on function public.save_sub_task(uuid, uuid, text, jsonb, text, uuid, uuid, uuid, numeric, uuid, timestamptz, timestamptz, text) is
  'ADR-0043: write a task and its reviewer appointments in ONE transaction, which is what the '
  'deferred required-reviewer rule needs and what two PostgREST calls cannot give. SECURITY '
  'INVOKER — RLS decides both writes exactly as it does for a direct table write.';

revoke execute on function public.save_sub_task(uuid, uuid, text, jsonb, text, uuid, uuid, uuid, numeric, uuid, timestamptz, timestamptz, text) from public;
revoke execute on function public.save_sub_task(uuid, uuid, text, jsonb, text, uuid, uuid, uuid, numeric, uuid, timestamptz, timestamptz, text) from anon;
grant  execute on function public.save_sub_task(uuid, uuid, text, jsonb, text, uuid, uuid, uuid, numeric, uuid, timestamptz, timestamptz, text) to authenticated;

commit;
