-- I19.15 (ADR-0059) — a task is reviewed digitally or manually.
--
-- **The dead end this closes.** `app.sub_task_submit` refuses a submission with nothing to review,
-- and since ADR-0058 d.5 that means THIS task's own uploaded version. Since 29 Aug every
-- deliverable type materialises a task list, and those lists name real production work: Shoot,
-- Proof, Production, Installation, Physical Media, Archive. None of it produces a file. The person
-- holding one of those tasks could not submit it, so it could not be approved, so the deliverable
-- could never reach `approved` — the gate refuses while any sub-task is open. Production was
-- handed work the system would not let them finish.
--
-- Edward, 29 Aug: *"when we assign a task can we add a toggle for digital review or manual review.
-- digital routes to the existing upload, manual routes to a comment field, with request changes or
-- approve"* — and, 30 Aug, *"I would prefer that the toggle sit on the task and the template. The
-- template presents the default setting, which can be over written for individual tasks."*
--
-- TWO LEVELS, ONE AUTHORITY. `workflow_steps.review_mode` is what the template PROPOSES —
-- "Installation produces nothing to upload" is a fact about installation, stated once.
-- `sub_tasks.review_mode` is what is TRUE of a particular task, and it is the only thing the submit
-- gate reads. The materialiser COPIES the step's value onto the task rather than reading through
-- it, so a template edited in March cannot change how a task assigned in January is submitted
-- (ADR-0052 d.14 — the same reason resequencing never touches a date).
--
-- WHAT DOES NOT CHANGE. Reviewers, rounds, the request-changes loop, derived deliverable approval,
-- notifications, timers, `unassigned_at_signoff`, and ADR-0043's mandatory-reviewer arithmetic. The
-- digital arm of the submit gate is reproduced BYTE FOR BYTE from 20260828235000: this adds a
-- branch beside it and softens nothing.
--
-- Functions are reproduced WHOLE rather than patched, the house pattern: a bare `create or replace`
-- resets `proconfig` and silently drops the ADR-0033 `search_path` pin.

begin;

-- ============================================================================
-- 1) the two columns (ADR-0059 d.1, d.2)
-- ============================================================================
-- `digital` is the default in both places because it is right for most work and because every row
-- that exists today is digital. NOT NULL: the submit gate must read one unambiguous value on every
-- task, including a hand-added one that came from no step at all (I19.3).
alter table workflow_steps
  add column review_mode text not null default 'digital'
    check (review_mode in ('digital', 'manual'));

alter table sub_tasks
  add column review_mode text not null default 'digital'
    check (review_mode in ('digital', 'manual'));

comment on column workflow_steps.review_mode is
  'ADR-0059 d.2: what this KIND of work usually needs — the default the materialiser stamps onto '
  'each task it creates. A proposal, not an authority: sub_tasks.review_mode is what the gate reads.';
comment on column sub_tasks.review_mode is
  'ADR-0059 d.1: digital (submit requires this task''s own version for this round) or manual '
  '(submit requires a note from the assignee instead). The ONLY thing app.sub_task_submit reads. '
  'Copied from the workflow step at materialisation and overridable by anyone who can assign.';

-- ============================================================================
-- 2) a comment can hang off a TASK instead of a VERSION (ADR-0059 d.7)
-- ============================================================================
-- `review_feedback.media_record_id` has been NOT NULL since 20260728110800: every comment in the
-- system hangs off an uploaded version. A manual task has no version, and the comment IS the
-- manual path, so it needs somewhere to go. Exactly one parent — the CHECK makes a row with both
-- or neither unrepresentable rather than merely discouraged. Every existing row keeps its
-- media_record_id and is untouched.
alter table review_feedback
  alter column media_record_id drop not null,
  add column sub_task_id uuid references sub_tasks(id) on delete cascade,
  add constraint ck_review_feedback_one_parent
    check (num_nonnulls(media_record_id, sub_task_id) = 1);

create index idx_review_feedback_sub_task_id on review_feedback (sub_task_id);

comment on column review_feedback.sub_task_id is
  'ADR-0059 d.7: the task this comment is about, when it is about a task rather than a version. '
  'Exactly one of (media_record_id, sub_task_id) is set — ck_review_feedback_one_parent.';

-- ============================================================================
-- 3) which round a task is on — ONE home for the fact
-- ============================================================================
-- The round-stamping trigger and the manual submit gate must agree, and this project has been
-- bitten twice by a fact with two homes (ADR-0037; I12.14). Deliberately the SAME arithmetic the
-- digital arm already uses: the parent deliverable's revision_round + 1, 1-based, so
-- task-anchored feedback and uploaded versions land on the same round number for the same task.
-- A standalone ad-hoc task (20260820000000) has no deliverable and falls back to its own
-- revision_number, which starts at 0 for the same reason revision_round does.
-- SECURITY INVOKER (the default), deliberately: it adds no reach. Both callers can already read
-- these rows — the round trigger runs as whoever is writing the comment, who holds the tenant-wide
-- select on sub_tasks and deliverables, and sub_task_submit is already definer. A definer here
-- would be elevation for its own sake, which AGENTS.md §6 asks for an ADR to justify.
create or replace function app.task_review_round(p_sub_task uuid) returns integer
language sql stable set search_path = public, app, extensions as $$
  select coalesce(d.revision_round, st.revision_number) + 1
    from sub_tasks st
    left join deliverables d on d.id = st.deliverable_id
   where st.id = p_sub_task;
$$;

comment on function app.task_review_round(uuid) is
  'ADR-0059: the review round a task is currently on, 1-based — the parent deliverable''s '
  'revision_round + 1, or the task''s own revision_number + 1 when it has no deliverable. The one '
  'home for arithmetic the round trigger and the manual submit gate both depend on.';

-- ---------------------------------------------------------- round + source stamping ----
-- Reproduced from 20260818110000 with the task arm added. `source` is still forced to 'internal':
-- the client capture-at-source path arrives with the portal (M10) through its own route, and a
-- manual task's note is written by the person who did the work.
-- `search_path` pinned (ADR-0033). The 20260818110000 original was not — it predates the rule — and
-- re-emitting it unpinned would carry that forward on a function that now resolves one more name.
create or replace function app.tg_review_feedback_set_round()
returns trigger language plpgsql set search_path = public, app, extensions as $$
declare v_round integer;
begin
  if new.sub_task_id is not null then
    select app.task_review_round(new.sub_task_id) into v_round;
    new.round := coalesce(v_round, 1);
  else
    select d.revision_round into v_round
      from media_records m
      join deliverables d on d.id = m.deliverable_id
     where m.id = new.media_record_id;
    new.round := coalesce(v_round, 0) + 1;   -- 1-based: first pass (revision_round 0) → round 1
  end if;
  new.source := 'internal';
  return new;
end $$;

comment on function app.tg_review_feedback_set_round() is
  'ADR-0025, extended by ADR-0059 d.7: BEFORE INSERT — stamp review_feedback.round from whichever '
  'parent the row has (a version''s deliverable, or the task itself) and force source = internal. '
  'The client never sets either.';

-- ============================================================================
-- 4) the materialiser stamps the mode (ADR-0059 d.3)
-- ============================================================================
-- Reproduced WHOLE from 20260828220000:37. The only edit is `review_mode` in the insert.
create or replace function app.materialise_deliverable_workflow(
  p_deliverable uuid,
  p_template uuid default null
) returns integer
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant   uuid;
  v_dept     uuid;
  v_template uuid;
  v_created  integer;
begin
  select d.tenant_id, d.department_id,
         coalesce(p_template, dt.default_workflow_template_id)
    into v_tenant, v_dept, v_template
    from deliverables d
    left join deliverable_types dt on dt.id = d.deliverable_type_id
   where d.id = p_deliverable;

  if v_tenant is null or v_template is null then
    return 0;
  end if;

  if not exists (select 1 from workflow_templates wt
                  where wt.id = v_template and wt.tenant_id = v_tenant) then
    raise exception 'that workflow template is not in your organization' using errcode = '22023';
  end if;

  insert into sub_tasks (
    tenant_id, deliverable_id, title, description, department_id,
    status, sort_order, workflow_step_id, review_mode, created_by
  )
  select
    v_tenant, p_deliverable, ws.title_en, ws.description_en,
    v_dept,
    -- ADR-0059 d.3: COPIED, not read through. A template edited later changes the NEXT deliverable
    -- materialised from it and nothing already live, because how a task is submitted is not
    -- something a template edit may quietly change under the person holding it.
    'todo', ws.sort_order, ws.id, ws.review_mode, auth.uid()
  from workflow_steps ws
  where ws.tenant_id = v_tenant
    and ws.template_id = v_template
    and ws.is_active
    and not exists (
      select 1 from sub_tasks st
       where st.deliverable_id = p_deliverable and st.workflow_step_id = ws.id
    )
  order by ws.sort_order;

  get diagnostics v_created = row_count;
  return v_created;
end $$;

comment on function app.materialise_deliverable_workflow(uuid, uuid) is
  'ADR-0052 d.5/d.6, extended by ADR-0059 d.3: create one unassigned sub-task per active step of a '
  'deliverable''s workflow template, carrying that step''s review mode, and skipping steps that '
  'already have a task. Returns how many were created. Idempotent by sub_tasks.workflow_step_id.';

-- ============================================================================
-- 5) the submit gate grows a second arm (ADR-0059 d.5, d.6)
-- ============================================================================
-- Reproduced WHOLE from 20260828235000:17. **The digital arm is unchanged, deliberately** — ADR-0058
-- d.5's assertion must keep passing without being edited, so this branches AROUND that block rather
-- than inside it.
create or replace function app.sub_task_submit(p_id uuid, p_manual_minutes numeric default null)
returns void language plpgsql security definer set search_path = public, app as $$
declare v sub_tasks; v_open task_time_entries; v_round integer;
begin
  select * into v from sub_tasks where id = p_id;
  if v.id is null then raise exception 'sub_task % not found', p_id using errcode = 'P0002'; end if;
  if v.assignee_id is distinct from auth.uid() then
    raise exception 'only the assignee may submit this task' using errcode = '42501';
  end if;
  if v.status not in ('todo', 'in_progress') then
    raise exception 'task cannot be submitted from % (only todo or in_progress)', v.status using errcode = '22023';
  end if;

  if v.review_mode = 'manual' then
    -- ADR-0059 d.6. Physical work has no file, so the artefact is the account of it: "Shot 4
    -- setups, all approved on set". It must be THIS round's and THIS person's — a reviewer's
    -- comment is not the maker saying what they did, and last round's note is not this round's.
    --
    -- **Submitting with nothing at all is still refused**, in both modes and for the same reason: a
    -- reviewer asked to approve nothing is being asked to rubber-stamp. That is the rule ADR-0058
    -- d.5 exists to enforce; this changes what counts as something, never whether something is
    -- needed.
    if not exists (
      select 1 from review_feedback rf
       where rf.sub_task_id = p_id
         and rf.round = app.task_review_round(p_id)
         and rf.author_user_id = auth.uid()
    ) then
      raise exception 'describe what you did before submitting this task for review'
        using errcode = '55000';
    end if;

  elsif v.deliverable_id is not null then
    -- I11.9, corrected by ADR-0058 d.5 (I25.3). THIS round must have something to review — and it
    -- must be THIS TASK'S something.
    --
    -- The old predicate asked only `m.deliverable_id = v.deliverable_id`, so ANY version on the
    -- deliverable at this round satisfied it. With six sub-tasks under one deliverable, one person
    -- uploaded one file and all six passed their gate: six approvals, five of them of something
    -- nobody looked at.
    --
    -- A task with no deliverable is still exempt: it can hold no version at all.
    select d.revision_round + 1 into v_round from deliverables d where d.id = v.deliverable_id;
    if not exists (
      select 1 from media_records m
      where m.round = v_round
        and (
          -- The task's own artefact. This is the rule from here on.
          m.sub_task_id = p_id
          -- Legacy: a version uploaded before the container model has no sub_task_id, and the
          -- backfill could not attach it because its deliverable holds more than one task. Those
          -- rows still satisfy the gate for the deliverable they belong to, because refusing them
          -- would strand work that was legitimately submitted under the old rule. New uploads
          -- always carry a sub_task_id, so this arm narrows to nothing over time rather than
          -- being a permanent hole.
          or (m.sub_task_id is null and m.deliverable_id = v.deliverable_id)
        )
    ) then
      raise exception 'attach this round''s version before submitting for review'
        using errcode = '55000';
    end if;
  end if;

  select * into v_open from task_time_entries
    where sub_task_id = p_id and round = v.revision_number and submitted_at is null;
  if v_open.id is not null then
    update task_time_entries
      set submitted_at = now(), minutes = round(extract(epoch from (now() - started_at)) / 60.0, 1)
      where id = v_open.id;
  else
    if p_manual_minutes is null or p_manual_minutes <= 0 then
      raise exception 'submitting without a running timer requires manual minutes (> 0)' using errcode = '22023';
    end if;
    insert into task_time_entries (tenant_id, sub_task_id, user_id, round, submitted_at, minutes, mode)
    values (v.tenant_id, p_id, auth.uid(), v.revision_number, now(), p_manual_minutes, 'manual');
  end if;

  update sub_tasks set status = 'review' where id = p_id;

  -- notify downstream tasks whose prerequisites are now ALL satisfied (the payoff of the dep model)
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
  select b.tenant_id, b.assignee_id, 'dependency_ready', b.title, 'sub_task', b.id, auth.uid()
  from sub_task_dependencies dep
  join sub_tasks b on b.id = dep.sub_task_id
  where dep.depends_on_sub_task_id = p_id
    and b.assignee_id is not null and b.assignee_id is distinct from auth.uid()
    and not app.sub_task_has_unmet_prereqs(b.id);
end $$;

comment on function app.sub_task_submit(uuid, numeric) is
  'ADR-0030 + I11.9, corrected by ADR-0058 d.5 and extended by ADR-0059 d.5/d.6: the assignee '
  'submits a task for review. A DIGITAL task requires a version stamped with THIS round AND '
  'belonging to THIS TASK. A MANUAL task requires the assignee''s own note on this round instead — '
  'physical work has no file. Neither may be submitted with nothing at all.';

-- ============================================================================
-- 6) request changes accepts a comment on the TASK (ADR-0059 d.8)
-- ============================================================================
-- Reproduced WHOLE from 20260827100000:610. Without this the manual path is only half a loop: a
-- reviewer could approve a shoot but never send it back, because the mandatory change description
-- was looked for on the deliverable's MEDIA and a manual task has none. The media arm is unchanged,
-- so nothing about how a digital task is sent back moves.
create or replace function app.sub_task_request_changes(p_sub_task uuid)
returns void language plpgsql security definer set search_path = public, app, extensions as $$
declare v sub_tasks; v_deliv_state deliverable_state; v_has_comment boolean;
begin
  if not app.has_permission('reviews', 'moderate') then
    raise exception 'requesting changes requires reviews:moderate' using errcode = '42501';
  end if;
  select * into v from sub_tasks where id = p_sub_task and tenant_id = app.current_tenant_id();
  if v.id is null then raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002'; end if;
  if v.status <> 'review' then
    raise exception 'changes can only be requested on a submitted (review) sub-task (is %)', v.status using errcode = '22023';
  end if;

  -- A change description is mandatory: an unresolved comment on this deliverable's media (as
  -- before) OR on this task itself (ADR-0059 d.7). Reopening a task without saying what to change
  -- is not allowed, whichever way the work was reviewed.
  --
  -- **The task arm excludes the ASSIGNEE'S own comments, and that exclusion is the whole point.**
  -- A manual submission IS an unresolved comment on the task — it is what d.6 requires instead of a
  -- file. Counting it here would mean every manual task arrived already satisfying its own
  -- send-back gate, and a reviewer could reopen the work without saying a word. The media arm needs
  -- no such clause because uploading a file writes no comment.
  select exists (
    select 1 from review_feedback rf
     where coalesce(rf.resolved, false) = false
       and (
         (rf.sub_task_id = p_sub_task and rf.author_user_id is distinct from v.assignee_id)
         or exists (
           select 1 from media_records mr
            where mr.id = rf.media_record_id and mr.deliverable_id = v.deliverable_id
         )
       )
  ) into v_has_comment;
  if not v_has_comment then
    raise exception 'a change description (an unresolved review comment) is required to request changes'
      using errcode = '55000';
  end if;

  -- Reopen to TODO (not in_progress) so the maker Starts a fresh timed round before resubmitting.
  -- This statement is also what clears every approval on the task, via app.tg_subtask_clear_approvals
  -- (ADR-0043 d.6): an approval is an approval OF what was submitted, and that rule is owned by the
  -- status change rather than by this RPC.
  update sub_tasks set status = 'todo', revision_number = revision_number + 1 where id = p_sub_task;

  if v.assignee_id is not null and v.assignee_id is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
    values (v.tenant_id, v.assignee_id, 'changes_requested', v.title, 'sub_task', p_sub_task, auth.uid());
  end if;

  select state into v_deliv_state from deliverables where id = v.deliverable_id;
  if v_deliv_state = 'in_review' then
    update deliverables set state = 'in_progress' where id = v.deliverable_id;
  end if;
end $$;

comment on function app.sub_task_request_changes(uuid) is
  'ADR-0030/0035, amended by ADR-0043 d.6 and ADR-0059 d.8: reopen a submitted task to todo for a '
  'fresh timed round. The mandatory change description may be an unresolved comment on the '
  'deliverable''s media OR on the task itself, so a manual task can be sent back like any other.';

-- ============================================================================
-- 7) the mode is set where the assignee is (ADR-0059 d.4)
-- ============================================================================
-- Both wrappers gain `p_review_mode text default null`, NULL meaning "leave it alone" — the same
-- convention they already use for every other optional field, and what the drag-to-reassign path
-- needs. Adding a parameter changes the signature, so the old ones are dropped rather than left to
-- linger as an ambiguous overload.

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
  -- verdict.
  p_status      text default null,
  -- Added 2026-08-30 (ADR-0059 d.4). NULL leaves the task's mode alone.
  p_review_mode text default null
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
  if p_review_mode is not null and p_review_mode not in ('digital', 'manual') then
    raise exception 'review mode must be digital or manual' using errcode = '22023';
  end if;
  if p_reviewers is not null then
    if jsonb_typeof(p_reviewers) <> 'array' then
      raise exception 'the reviewer list must be a JSON array' using errcode = '22023';
    end if;
    if (select count(*) from jsonb_array_elements(p_reviewers) e) <>
       (select count(distinct e ->> 'user_id') from jsonb_array_elements(p_reviewers) e) then
      raise exception 'the same reviewer is listed twice' using errcode = '22023';
    end if;
  end if;

  if v_id is null then
    insert into sub_tasks (tenant_id, deliverable_id, title, description, assignee_id,
                           department_id, team_id, sla_hours, sla_profile_id,
                           starts_at, due_at, status, review_mode, created_by)
    values (v_tenant, p_deliverable, trim(p_title), p_description, p_assignee,
            p_department, p_team, p_sla_hours, p_sla_profile,
            p_starts_at, p_due_at, coalesce(p_status, 'todo'),
            coalesce(p_review_mode, 'digital'), auth.uid())
    returning id into v_id;
  else
    -- COALESCE, every field. A bare assignment made this a full-row replace, so a caller that
    -- changed only the title wiped the description, hours, dates, SLA profile AND the assignee.
    -- NULL here means "leave it alone".
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
      status         = coalesce(p_status, status),
      review_mode    = coalesce(p_review_mode, review_mode)
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

    -- Update-then-insert, guarded on an ACTUAL change. A no-op UPDATE still fires the row triggers,
    -- so one appointment that no longer satisfies a guard would otherwise break every later save.
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

comment on function public.save_sub_task(uuid, uuid, text, jsonb, text, uuid, uuid, uuid, numeric, uuid, timestamptz, timestamptz, text, text) is
  'ADR-0043, extended by ADR-0059 d.4: write a task, its reviewer appointments and its review mode '
  'in ONE transaction. SECURITY INVOKER — RLS decides every write exactly as it does for a direct '
  'table write. p_review_mode NULL leaves the mode alone.';

revoke execute on function public.save_sub_task(uuid, uuid, text, jsonb, text, uuid, uuid, uuid, numeric, uuid, timestamptz, timestamptz, text, text) from public;
revoke execute on function public.save_sub_task(uuid, uuid, text, jsonb, text, uuid, uuid, uuid, numeric, uuid, timestamptz, timestamptz, text, text) from anon;
grant  execute on function public.save_sub_task(uuid, uuid, text, jsonb, text, uuid, uuid, uuid, numeric, uuid, timestamptz, timestamptz, text, text) to authenticated;

drop function if exists public.save_sub_task(uuid, uuid, text, jsonb, text, uuid, uuid, uuid, numeric, uuid, timestamptz, timestamptz, text);

-- ---------------------------------------------------------------------------
-- Reproduced WHOLE from 20260827100000:734.
create or replace function public.update_task_assignment(
  p_sub_task    uuid,
  p_title       text,
  p_assignee    uuid,
  p_reviewers   jsonb default null,
  p_starts_at   timestamptz default null,
  p_due_at      timestamptz default null,
  p_hours       numeric default null,
  -- Added 2026-08-30 (ADR-0059 d.4). NULL leaves the task's mode alone, which is what the
  -- drag-to-reassign path wants: moving work to somebody else is not a decision about how it is
  -- reviewed.
  p_review_mode text default null
) returns table(sub_task_id uuid, deliverable_id uuid, reschedule_needed boolean)
language plpgsql security definer set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v sub_tasks%rowtype;
  v_reassigned boolean;
  v_dates_changed boolean;
  v_lead uuid;
begin
  select * into v from sub_tasks where id = p_sub_task and tenant_id = v_tenant;
  if not found then raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002'; end if;

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
  if p_review_mode is not null and p_review_mode not in ('digital', 'manual') then
    raise exception 'review mode must be digital or manual' using errcode = '22023';
  end if;

  if p_reviewers is not null then
    if jsonb_typeof(p_reviewers) <> 'array' then
      raise exception 'the reviewer list must be a JSON array' using errcode = '22023';
    end if;
    if jsonb_array_length(p_reviewers) = 0 then
      raise exception 'a reviewer must be appointed for this task' using errcode = '22023';
    end if;
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
    review_mode = coalesce(p_review_mode, review_mode),
    -- reset the human-override flag so subtask-schedule rebuilds the booking on reassign / date change
    schedule_overridden = case when v_reassigned or v_dates_changed then false else schedule_overridden end
  where id = p_sub_task;

  -- The appointments are applied AFTER the assignee moves, and the order is load-bearing: one call
  -- can both reassign the task and name the previous assignee as a reviewer. The write guard tests
  -- each appointment against the task's CURRENT assignee, so doing this first would refuse that
  -- edit against an assignee who is on their way out.
  if p_reviewers is not null then
    delete from sub_task_reviewers r
     where r.sub_task_id = p_sub_task
       and not exists (
         select 1 from jsonb_array_elements(p_reviewers) e
         where (e ->> 'user_id')::uuid = r.user_id);

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

  -- parent deliverable: keep the deliverable-level reviewer record in step (ADR-0043 d.9). Only
  -- rename an AD-HOC deliverable (stream_id null) — never rename a project deliverable from a
  -- booking edit.
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

  -- keep the linked booking's title column in step. Qualify bookings.sub_task_id — the OUT
  -- parameter sub_task_id would otherwise shadow it.
  update bookings set title = trim(p_title) where bookings.sub_task_id = p_sub_task;

  sub_task_id := p_sub_task;
  deliverable_id := v.deliverable_id;
  reschedule_needed := v_reassigned or v_dates_changed;
  return next;
end $$;

comment on function public.update_task_assignment(uuid, text, uuid, jsonb, timestamptz, timestamptz, numeric, text) is
  'ADR-0038/0040, amended by ADR-0043 and ADR-0059 d.4: edit a task from the schedule modal. '
  'p_reviewers is a JSON array of {user_id, is_mandatory}; NULL leaves appointments untouched. '
  'p_review_mode NULL leaves the review mode untouched (the drag-to-reassign path).';

revoke execute on function public.update_task_assignment(uuid, text, uuid, jsonb, timestamptz, timestamptz, numeric, text) from public;
revoke execute on function public.update_task_assignment(uuid, text, uuid, jsonb, timestamptz, timestamptz, numeric, text) from anon;
grant  execute on function public.update_task_assignment(uuid, text, uuid, jsonb, timestamptz, timestamptz, numeric, text) to authenticated;

drop function if exists public.update_task_assignment(uuid, text, uuid, jsonb, timestamptz, timestamptz, numeric);

-- ============================================================================
-- 8) the templates say which of their steps are physical (ADR-0059 d.10)
-- ============================================================================
-- **A column no seed writes is a feature nobody can find.** That is the I19 failure verbatim:
-- `deliverable_types.default_workflow_template_id` was read by the materialiser and written by
-- nothing, and 240 types shipped with no template for a day. Shipping `review_mode` with every
-- seeded step reading `digital` would repeat it — the toggle would exist and the seven production
-- templates would still be traps until somebody found it.
--
-- 32 of the 97 surviving seeded steps are physical, in three groups:
--
--   THE PHYSICAL ACT — Shoot, Production, Physical Production, Installation, Proof, Physical Media.
--     "Production" is manual in all five templates that use it because in each it IS the physical
--     event: the shoot in WF-03 and WF-10, the print run in WF-05 and WF-06, the fabrication in
--     WF-09. `Prepress` stays DIGITAL in both print templates — prepress output is a print-ready
--     PDF and is genuinely reviewable as one.
--   CUSTODY, NOT CREATION — Ingest, Backup, Archive. These move media that already exists. Asking
--     for an upload would mean re-uploading what is already there.
--   HANDOVER — Delivery, Delivery / Scheduling, Scheduling, Deployment. An earlier step made the
--     asset and it already has its version; delivering or scheduling it is an act, and "delivered
--     to the publisher 14 Mar, confirmed by X" is the record worth having.
--
-- WF-01 Standard Digital and WF-07 Branding come out wholly digital, correctly — neither makes
-- anything physical.
--
-- Approved by Edward, 30 Aug.
--
-- SAFETY. `is_system` templates only, matched on template code AND exact step title, and only where
-- the step is still `digital`. A step a tenant has renamed does not match and is left alone — they
-- have made it theirs. `not null default 'digital'` cannot distinguish "never chosen" from
-- "deliberately digital", which is why this runs at two moments where everything IS still the
-- default: once here for the existing tenant, and once per new tenant immediately after the
-- template seed.
create or replace function app.seed_tenant_step_review_modes(p_tenant uuid) returns void
language plpgsql as $$
begin
  update workflow_steps ws
     set review_mode = 'manual'
    from workflow_templates wt
   where wt.id = ws.template_id
     and wt.tenant_id = p_tenant
     and ws.tenant_id = p_tenant
     and wt.is_system
     and ws.review_mode = 'digital'
     and (wt.code, ws.title_en) in (
       ('WF-02', 'Scheduling'),
       ('WF-03', 'Production'), ('WF-03', 'Delivery'),
       ('WF-04', 'Shoot'),
       ('WF-05', 'Proof'), ('WF-05', 'Production'), ('WF-05', 'Delivery'),
       ('WF-06', 'Proof'), ('WF-06', 'Production'), ('WF-06', 'Delivery'),
       ('WF-08', 'Deployment'),
       ('WF-09', 'Production'), ('WF-09', 'Proof'), ('WF-09', 'Installation'), ('WF-09', 'Delivery'),
       ('WF-10', 'Production'), ('WF-10', 'Physical Production'), ('WF-10', 'QA'), ('WF-10', 'Delivery'),
       ('WF-11', 'Shoot'), ('WF-11', 'Physical Media'), ('WF-11', 'Ingest'),
       ('WF-11', 'Backup'), ('WF-11', 'Delivery'), ('WF-11', 'Archive'),
       ('WF-12', 'Delivery / Scheduling'),
       ('WF-13', 'Shoot'), ('WF-13', 'Physical Media'), ('WF-13', 'Ingest'),
       ('WF-13', 'Delivery'), ('WF-13', 'Archive'),
       ('WF-14', 'Delivery')
     );
end $$;

comment on function app.seed_tenant_step_review_modes(uuid) is
  'ADR-0059 d.10: mark the 32 seeded steps that produce no file as review_mode = manual, so the '
  'production templates arrive usable instead of arriving as traps. SYSTEM templates only, matched '
  'on code + exact title, and only where the step is still digital — a renamed or already-decided '
  'step is never touched.';

-- Existing tenants.
select app.seed_tenant_step_review_modes(id) from tenants;

-- Future tenants. Reproduced from the CURRENT wrapper (20260829140000:106). This runs AFTER the
-- step corrections — the lifecycle steps are gone by then, so it never marks a step that is about
-- to be deleted — and before the default-workflow mapping.
create or replace function public.seed_tenant_roles(p_tenant uuid) returns void
language sql as $$
  select app.seed_tenant_roles(p_tenant);
  select app.seed_tenant_brief_templates(p_tenant);
  select app.seed_tenant_deliverable_taxonomy(p_tenant);
  select app.seed_tenant_taxonomy_amendments(p_tenant);
  select app.seed_tenant_workflow_templates(p_tenant);
  select app.seed_tenant_workflow_step_corrections(p_tenant);
  select app.seed_tenant_step_review_modes(p_tenant);
  select app.seed_tenant_default_workflows(p_tenant);
$$;
revoke execute on function public.seed_tenant_roles(uuid) from public, anon, authenticated;
grant  execute on function public.seed_tenant_roles(uuid) to service_role;

-- ============================================================================
-- 9) the tasks that already exist — a ONE-TIME backfill, and why it is not d.3
-- ============================================================================
-- ADR-0059 d.3 says a template edit never reaches live work: how a task is submitted must not change
-- under the person holding it. **This is not that**, and the distinction is worth stating rather than
-- assuming.
--
-- A task materialised before today carries `digital` because the column did not exist when it was
-- made — not because anybody decided anything. Leaving those rows alone would mean every task that
-- already exists keeps the trap this migration is here to remove, and "the column defaulted" is not
-- a preference worth respecting the way a person's decision is.
--
-- **It may well change nothing on the pilot tenant.** The one campaign that had a materialised task
-- list — Zeta, created through the wizard on 29 Aug — was deleted on 30 Aug, so this could be a
-- no-op there. It stays because it is correct for whatever tasks do exist and for any tenant
-- restored from a backup taken before today, and because a fenced no-op costs nothing while the
-- alternative is stranding rows nobody would think to look for.
--
-- FENCED THREE WAYS, so it changes only rows where nothing has been decided or done:
--
--   * `workflow_step_id is not null` — the task came from a step, so the step's mode is a statement
--     about exactly this work. A hand-added task had a person choosing, and keeps what it has.
--   * `status in ('todo', 'in_progress')` — nothing has been submitted, reviewed or approved.
--     A task in `review` or `done` was submitted under the digital rule and its record stays true to
--     the rule it was submitted under.
--   * `review_mode = 'digital'` — the column default, which is every row, because it was created
--     moments ago in section 1 of this same transaction. There is no edit here to overwrite.
--
-- Runs ONCE. Nothing calls this again: a new tenant gets its modes from section 8 at provisioning,
-- and a new task gets its own from the materialiser.
update sub_tasks st
   set review_mode = ws.review_mode
  from workflow_steps ws
 where ws.id = st.workflow_step_id
   and ws.tenant_id = st.tenant_id
   and st.status in ('todo', 'in_progress')
   and st.review_mode = 'digital'
   and ws.review_mode = 'manual';

commit;
