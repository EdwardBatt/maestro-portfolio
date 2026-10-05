-- ADR-0089 (I47): one reviewer is required, and the others answer before they approve.
--
-- WHAT WAS WRONG. Two things, both verified against the code rather than taken from the report:
--   * the ad-hoc path (`create_adhoc_deliverable`, the seed trigger) appointed its one reviewer
--     WITHOUT `is_mandatory`, so the column took its default of false and the only place to say
--     "required" was the reopen dialog — Edward's "ridiculous two-step";
--   * with nobody marked required, ADR-0043 d.5's pool rule let the FIRST approval complete the
--     task, and every other reviewer lost it: the row left their inbox, and nobody was told.
--
-- WHAT CHANGES (the ADR's decisions, by number):
--   d.1–d.3  every assigned, live task with reviewers has at least one REQUIRED one. Held by the
--            deferred constraint trigger that already holds "at least one reviewer" — and nowhere
--            else. A lone reviewer is marked required at commit (d.2); several with none marked are
--            refused, 23514 (d.3). The trigger now also fires on INSERT, because two unmarked people
--            onto a task that had none is a violation an insert can cause.
--   d.4      the pool rule is retired. Its branch stays in maybe_complete_sub_task as a defensive
--            line for a state d.1 makes unreachable.
--   d.5      an optional reviewer ANSWERS, a required reviewer APPROVES. Two new columns on
--            sub_task_reviewers — responded_at, response ('no_comment' | 'feedback'), both or
--            neither, server-written under the same GUC guard as approved_at — and one new RPC,
--            public.sub_task_respond. Approve is withdrawn from optional reviewers.
--   d.6–d.7  the completing approval WAITS for every optional answer. maybe_complete_sub_task gains
--            the gate; sub_task_approve refuses the completing approval up front with its own code
--            (55089, class 55 "object not in prerequisite state") naming who has not answered.
--            Hard wait — no override. The escape hatch is removing the silent reviewer by name.
--   d.8      an answer belongs to a version: cleared with the approvals on any status change that
--            is not the completion.
--   d.9      `feedback_collected` — the required reviewers still owed are told when the last
--            answer lands.
--   d.10     somebody appointed to a task already in `review` gets `review_requested`.
--   d.11     existing rows corrected by condition: one reviewer → marked; several unmarked → the
--            earliest appointed (the convention update_task_assignment already uses to pick the
--            deliverable's lead reviewer); optional rows already carrying approved_at get
--            response = 'no_comment' at that moment. Reported by raise notice; nobody is notified.
--   d.2      create_adhoc_deliverable and tg_subtask_seed_reviewer write is_mandatory = true, so
--            the intent is visible at the call site even though the trigger would fix it anyway.
--
-- "OPTIONAL", PRECISELY. A row is optional when it is unmarked AND the task has a marked one. A
-- lone unmarked reviewer is the required one by definition (d.2) and is treated so BEFORE the
-- deferred trigger has stamped the flag — otherwise every path that appoints one person and then
-- approves inside the same transaction (fixtures, the ad-hoc dialog before commit) would find
-- itself refused as "optional". Several unmarked is refused at commit, so it never lasts.
--
-- "THIS ROUND", PRECISELY. `app.task_review_round` reads the DELIVERABLE's revision_round, which
-- advances only when the container leaves in_review/approved — and under ADR-0077 a task-level
-- send-back never moves the container, so that number does not change between a task's rounds.
-- The kind of answer is therefore anchored on the task's own latest SUBMISSION instead
-- (task_time_entries.submitted_at for the current revision_number, which sub_task_submit always
-- stamps): a comment written on this task, or on this task's version, since the maker last handed
-- it over. With no submission stamp at all (a task moved into review by hand) every comment counts.
--
-- FUNCTIONS REPRODUCED HERE, and the migration each was lifted from (traps.md: rebuild from the
-- LAST definition, never the first — `grep -rln "<name>" supabase/migrations/*.sql`):
--   app.tg_sub_task_reviewer_write_guard ← 20260830150000_assignment_says_what_happened.sql
--   app.tg_sub_task_reviewer_required    ← 20260827100000_sub_task_reviewers.sql (only definition)
--   app.maybe_complete_sub_task          ← 20260908150000_a_container_closes_when_its_contents_are_done.sql
--   app.tg_sub_task_completion_guard     ← 20260827100000_sub_task_reviewers.sql (only definition)
--   public.sub_task_approve              ← 20260827100000_sub_task_reviewers.sql (only definition)
--   app.tg_subtask_clear_approvals       ← 20260827100000_sub_task_reviewers.sql (only definition)
--   app.tg_subtask_seed_reviewer         ← 20260827100000_sub_task_reviewers.sql (§6)
--   public.create_adhoc_deliverable      ← 20260829090000_department_restamp_and_adhoc_owner.sql
--   notifications_type_check             ← 20260903130100_approving_a_campaign_delivers_its_department_briefs.sql
-- NOT touched: app.sub_task_request_changes (latest 20260830090000) — requesting changes is never
-- gated (d.7), and clearing answers is the status change's job, not the RPC's (d.8).
--
-- TESTS. `supabase/tests/097_one_reviewer_is_required_and_the_others_answer_first.sql` covers the
-- rule and the run; 056 loses its pool assertions for d.2/d.3 ones; 057's escape hatch changes
-- shape (answer, then remove, then approve). The backfill is verified by inspection — it runs before
-- any test transaction exists (ADR-0059's reason).
--
-- search_path pinned inline on every function, per ADR-0033.

begin;

-- ============================================================================
-- 1) the answer: two columns, both or neither
-- ============================================================================
alter table sub_task_reviewers
  add column responded_at timestamptz,
  add column response     text,
  add constraint chk_sub_task_reviewers_response
    check (response is null or response in ('no_comment', 'feedback')),
  add constraint chk_sub_task_reviewers_response_both_or_neither
    check ((responded_at is null) = (response is null));

comment on column sub_task_reviewers.responded_at is
  'ADR-0089 d.5: when THIS optional reviewer said they were done with this version. Server-written '
  'only (public.sub_task_respond); cleared with the approvals when the version changes (d.8).';
comment on column sub_task_reviewers.response is
  'ADR-0089 d.5: what kind of answer — feedback (they commented this round) or no_comment. Derived '
  'by the server at the moment they press Done; never chosen by the reviewer.';

-- The required reviewer's question is "who has not answered yet" (d.7, d.9); the outstanding rows
-- are the hot read, exactly as idx_sub_task_reviewers_outstanding is for approvals.
create index idx_sub_task_reviewers_unanswered on sub_task_reviewers (sub_task_id)
  where responded_at is null and not is_mandatory;

-- ============================================================================
-- 2) the write guard protects the answer the way it protects the verdict
-- ============================================================================
-- Reproduced from 20260830150000. One addition, marked: responded_at / response reset under the
-- same GUC as approved_at. A manager who may manage the row must not be able to answer on an
-- optional reviewer's behalf, for the same reason they cannot approve on a colleague's.
create or replace function app.tg_sub_task_reviewer_write_guard() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare v_assignee uuid;
begin
  -- AN APPOINTMENT IS A PERSON ON A TASK. Neither half may be edited: a row whose user_id or
  -- sub_task_id can move is a way around the approved_at guard rather than through it.
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'an appointment cannot change hands — remove it and appoint the other person'
        using errcode = '22023';
    end if;
    if new.sub_task_id is distinct from old.sub_task_id then
      raise exception 'an appointment cannot be moved to another task' using errcode = '22023';
    end if;
  end if;

  -- approved_at is not client-writable. Reset rather than raise: a caller who did not ask for it
  -- should not be punished, and a caller who did should not be obeyed.
  -- ADR-0089 d.5: responded_at and response are held to exactly the same rule.
  if coalesce(current_setting('app.reviewer_verdict', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      new.approved_at  := null;
      new.responded_at := null;
      new.response     := null;
    else
      new.approved_at  := old.approved_at;
      new.responded_at := old.responded_at;
      new.response     := old.response;
    end if;
  end if;

  if tg_op = 'INSERT' then
    -- ADR-0061 d.10. Checked BEFORE the permission, because "that person has left" is the more
    -- useful sentence than "that person cannot moderate reviews" when both are true.
    if not exists (select 1 from public.user_profiles up
                    where up.id = new.user_id and up.is_active) then
      raise exception 'that person is deactivated and cannot be appointed a reviewer'
        using errcode = '22023';
    end if;

    -- Overlay-aware (app.user_holds_permission = role ∪ allow − deny, ADR-0036 L6.7).
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
  'ADR-0043 d.1/d.3, extended by ADR-0061 d.10 and ADR-0089 d.5: an appointment is a person on a '
  'task and neither half is editable; a named reviewer must be an ACTIVE user holding '
  'reviews:moderate and may never be the task''s assignee — all checked when they are appointed, '
  'not on every later write; approved_at, responded_at and response are server-written only.';

-- ============================================================================
-- 3) the rule: at least one reviewer, and at least one of them REQUIRED (d.1–d.3)
-- ============================================================================
-- Reproduced from 20260827100000 §4b (its only definition). Additions marked ADR-0089.
create or replace function app.tg_sub_task_reviewer_required() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_task     uuid;
  v_assignee uuid;
  v_status   text;
  v_total    int;
  v_self     int;
  v_required int;
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

  select count(*),
         count(*) filter (where r.user_id = v_assignee),
         count(*) filter (where r.is_mandatory)
    into v_total, v_self, v_required
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

  -- ADR-0089 d.1–d.3, same scope. With ONE reviewer there is only one possible answer, so the
  -- database says it rather than asks (d.2): the mark is written here, at commit, and a path that
  -- forgot the flag ends up right anyway. With SEVERAL and none marked, choosing among people would
  -- be a guess, so it is refused (d.3); the pickers make that unreachable from a screen.
  if v_assignee is not null and v_status <> 'cancelled' and v_required = 0 then
    if v_total = 1 then
      update public.sub_task_reviewers set is_mandatory = true where sub_task_id = v_task;
    else
      raise exception 'one of these reviewers must be marked required' using errcode = '23514';
    end if;
  end if;

  return null;
end $$;

comment on function app.tg_sub_task_reviewer_required() is
  'ADR-0043 d.4 + ADR-0089 d.1–d.3: a live ASSIGNED task has at least one reviewer, none of them '
  'is its assignee, and at least one is REQUIRED — a lone reviewer is marked required here; several '
  'with none marked are refused (23514). Deferred to commit so a task and its reviewers can be '
  'written in one transaction.';

-- The trigger on sub_task_reviewers gains INSERT: under d.3 an insert can be the violating event.
drop trigger if exists sub_task_reviewer_required on sub_task_reviewers;
create constraint trigger sub_task_reviewer_required
  after insert or update or delete on sub_task_reviewers
  deferrable initially deferred
  for each row execute function app.tg_sub_task_reviewer_required();

-- ============================================================================
-- 4) the kind of answer is derived, never asked (d.5)
-- ============================================================================
-- Invoker, not definer: it reads only tables the caller may already read tenant-wide, and inside
-- public.sub_task_respond (definer) it runs as the owner anyway. `stable` so PostgREST may call the
-- public wrapper with GET semantics and the planner may fold it.
create or replace function app.reviewer_feedback_kind(p_sub_task uuid, p_user uuid) returns text
language sql stable
set search_path = public, app, extensions as $$
  with st as (
    select s.id, s.deliverable_id, s.revision_number from sub_tasks s where s.id = p_sub_task
  ),
  since as (
    -- The maker's latest hand-over of THIS revision. Null when the task reached review without
    -- one (a fixture, a hand-moved row), in which case every comment counts.
    select max(te.submitted_at) as at
      from task_time_entries te, st
     where te.sub_task_id = st.id and te.round = st.revision_number
  )
  select case when exists (
    select 1
      from review_feedback rf
      left join media_records mr on mr.id = rf.media_record_id
      cross join st
      cross join since
     where rf.author_user_id = p_user
       and (since.at is null or rf.created_at >= since.at)
       and (
         -- ADR-0059 d.7: a manual task is reviewed in its own thread.
         rf.sub_task_id = st.id
         -- ADR-0059 / ADR-0058: a digital task's comments hang off its version.
         or mr.sub_task_id = st.id
         -- Legacy: a version uploaded before the container model carries no sub_task_id; it
         -- belongs to the deliverable and narrows to nothing over time (same arm as sub_task_submit).
         or (mr.sub_task_id is null and mr.deliverable_id = st.deliverable_id)
       )
  ) then 'feedback' else 'no_comment' end
$$;

comment on function app.reviewer_feedback_kind(uuid, uuid) is
  'ADR-0089 d.5: feedback if this person wrote at least one review comment on this task (or its '
  'version) since the maker last submitted it, otherwise no_comment. The kind is derived; the '
  'moment of answering is not.';

-- The label on the reviewer's Done button follows the same derivation, so the screen can never
-- promise one word and the record write another.
create or replace function public.sub_task_response_kind(p_sub_task uuid) returns text
language sql stable
set search_path = public, app, extensions as $$
  select app.reviewer_feedback_kind(p_sub_task, auth.uid())
$$;

comment on function public.sub_task_response_kind(uuid) is
  'ADR-0089 d.5: what public.sub_task_respond WOULD record for the caller right now — read by the '
  'review modal to label Done — no comment / Done — feedback left honestly.';
revoke execute on function public.sub_task_response_kind(uuid) from public;
revoke execute on function public.sub_task_response_kind(uuid) from anon;
grant  execute on function public.sub_task_response_kind(uuid) to authenticated;

-- ============================================================================
-- 5) completion waits for every optional answer (d.6)
-- ============================================================================
-- Reproduced from 20260908150000 §2. One addition, marked ADR-0089 d.6, under the same
-- `for update` — one more predicate, not a second lock.
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
         and (st.assignee_id is not null
              or st.status <> 'todo'
              or exists (select 1 from task_time_entries te where te.sub_task_id = st.id)))
  then
    update deliverables set state = 'approved' where id = v.deliverable_id;
  end if;

  return true;
end $$;

comment on function app.maybe_complete_sub_task(uuid, uuid) is
  'ADR-0043 d.5 + ADR-0058 d.6 + ADR-0077 d.2 + ADR-0089 d.6: completes a task when every required '
  'reviewer has approved AND every optional reviewer has answered, and closes its deliverable when '
  'nothing unsettled is left. One lock (for update), every predicate under it.';

-- ============================================================================
-- 5a) the Postgres-held copy of the same wait (d.6) — the completion guard
-- ============================================================================
-- Reproduced from 20260827100000 §(the guard), its only definition. ADR-0043 built this trigger so
-- that "done" is held by Postgres rather than only by the RPC: sub_tasks_manage_update lets the
-- assignee and any scoped manager write status directly, and without this the sequence "first
-- required reviewer approves → the other required one is demoted or removed → PATCH status=done"
-- reaches done with an optional answer still outstanding. Found by review, 11 Sep. One addition,
-- marked ADR-0089 d.6 — the same predicate maybe_complete_sub_task holds, in the same words.
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
  -- ADR-0089 d.6: an optional reviewer who has not answered holds completion here too. "Optional"
  -- is an unmarked row on a task that has a marked one (see the header).
  if exists (select 1 from public.sub_task_reviewers r
              where r.sub_task_id = new.id and r.is_mandatory)
     and exists (select 1 from public.sub_task_reviewers r
                  where r.sub_task_id = new.id and not r.is_mandatory and r.responded_at is null) then
    raise exception 'this task still waits for an optional reviewer''s answer' using errcode = '42501';
  end if;

  return new;
end $$;

comment on function app.tg_sub_task_completion_guard() is
  'ADR-0043 d.5 + ADR-0089 d.6, held by Postgres rather than only by the RPC: a task may not reach '
  '`done` unless a reviewer has approved it, no mandatory approval is outstanding, and no optional '
  'reviewer is still to answer. Closes the assignee''s and the manager''s direct-write branch on '
  'sub_tasks_manage_update.';

-- ============================================================================
-- 6) approving: required reviewers only, and the completing one waits (d.5, d.7)
-- ============================================================================
-- Reproduced from 20260827100000 §7 (its only definition). Additions marked ADR-0089.
create or replace function public.sub_task_approve(p_sub_task uuid)
returns void language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v sub_tasks;
  v_mine         sub_task_reviewers;
  v_has_required boolean;
  v_unanswered   text;
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

  -- ADR-0089 d.5: an optional reviewer answers; approving is the required reviewer's act. A lone
  -- unmarked reviewer is the required one by definition (d.2) and is not refused here — the
  -- deferred trigger writes the flag at commit, which may not have happened yet.
  v_has_required := exists (select 1 from sub_task_reviewers r
                             where r.sub_task_id = p_sub_task and r.is_mandatory);
  if v_has_required and not v_mine.is_mandatory then
    raise exception 'an optional reviewer answers rather than approves — press Done when you have finished'
      using errcode = '42501';
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

  -- ADR-0089 d.7, the hard wait. When THIS approval would be the completing one — no other required
  -- reviewer is still owed — and any optional reviewer has not answered, it is refused before
  -- anything is stamped, naming who. There is no "approve anyway": the record of a completed review
  -- says every appointed reviewer was heard, or the review is not complete. The way through is a
  -- named person removing the silent reviewer, on the appointment record.
  if v_has_required
     and not exists (select 1 from sub_task_reviewers r
                      where r.sub_task_id = p_sub_task and r.is_mandatory
                        and r.approved_at is null and r.user_id <> auth.uid())
  then
    select string_agg(coalesce(up.display_name, r.user_id::text), ', ' order by up.display_name)
      into v_unanswered
      from sub_task_reviewers r
      left join user_profiles up on up.id = r.user_id
     where r.sub_task_id = p_sub_task and not r.is_mandatory and r.responded_at is null;
    if v_unanswered is not null then
      raise exception 'this approval would complete the task, and not every reviewer has answered yet: %',
        v_unanswered using errcode = '55089';
    end if;
  end if;

  -- The verdict is recorded on the reviewer's OWN row first, and it stands whether or not it
  -- completes the task: with two required reviewers the first records their part whenever they like.
  perform set_config('app.reviewer_verdict', 'on', true);
  update sub_task_reviewers set approved_at = now() where id = v_mine.id;
  perform set_config('app.reviewer_verdict', 'off', true);

  perform app.maybe_complete_sub_task(p_sub_task, auth.uid());
end $$;

comment on function public.sub_task_approve(uuid) is
  'ADR-0038 + ADR-0043 + ADR-0089: a REQUIRED reviewer records their approval on their own row; an '
  'optional reviewer is refused (they answer, via sub_task_respond). The task completes when the '
  'last required reviewer agrees AND every optional reviewer has answered — the completing approval '
  'is refused with 55089, naming who has not, until then. No override. Decided by '
  'app.maybe_complete_sub_task, which also carries the deliverable sign-off.';

-- ============================================================================
-- 7) answering: the optional reviewer's one press (d.5, d.9)
-- ============================================================================
create or replace function public.sub_task_respond(p_sub_task uuid)
returns void language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v       sub_tasks;
  v_mine  sub_task_reviewers;
  v_kind  text;
  v_label text;
begin
  select * into v from sub_tasks where id = p_sub_task and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002';
  end if;
  if v.status <> 'review' then
    raise exception 'task cannot be answered from % (only a submitted task is under review)', v.status
      using errcode = '22023';
  end if;

  select * into v_mine from sub_task_reviewers
   where sub_task_id = p_sub_task and user_id = auth.uid();
  if not found then
    raise exception 'only an appointed reviewer may answer on this task' using errcode = '42501';
  end if;
  -- A required reviewer approves; so does a lone unmarked one, who is required by definition (d.2).
  if v_mine.is_mandatory
     or not exists (select 1 from sub_task_reviewers r
                     where r.sub_task_id = p_sub_task and r.is_mandatory) then
    raise exception 'your approval is required on this task — approve or request changes rather than answering'
      using errcode = '42501';
  end if;
  if v_mine.responded_at is not null then
    raise exception 'you have already answered on this version' using errcode = '22023';
  end if;

  -- One press; the kind is derived, the moment is not.
  v_kind := app.reviewer_feedback_kind(p_sub_task, auth.uid());

  perform set_config('app.reviewer_verdict', 'on', true);
  update sub_task_reviewers set responded_at = now(), response = v_kind where id = v_mine.id;
  perform set_config('app.reviewer_verdict', 'off', true);

  -- ADR-0089 d.9: when this was the LAST outstanding answer, every required reviewer whose approval
  -- is still owed is told the round is complete. Without it they either poll the task or approve
  -- early, and the single run never actually happens. A task with no other optional reviewer
  -- sends exactly one; the label and entity follow tg_subtask_notify_reviewer so the inbox opens
  -- the same place for both.
  if not exists (select 1 from sub_task_reviewers r
                  where r.sub_task_id = p_sub_task and not r.is_mandatory and r.responded_at is null) then
    select d.name into v_label from deliverables d where d.id = v.deliverable_id;
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
    select v.tenant_id, r.user_id, 'feedback_collected', coalesce(v_label, v.title),
           case when v.deliverable_id is null then 'sub_task' else 'deliverable' end,
           coalesce(v.deliverable_id, v.id), auth.uid()
      from sub_task_reviewers r
     where r.sub_task_id = p_sub_task and r.is_mandatory and r.approved_at is null
       and r.user_id is distinct from auth.uid();
  end if;

  -- The answer can be the last thing the task was waiting for: every required approval already
  -- given (a required reviewer removed after the others approved — 057's hatch, one tick longer).
  perform app.maybe_complete_sub_task(p_sub_task);
end $$;

comment on function public.sub_task_respond(uuid) is
  'ADR-0089 d.5/d.9: an OPTIONAL reviewer says they are done with this version. Stamps their own '
  'row with responded_at and a derived response (feedback if they commented since the last '
  'submission, else no_comment); refused for a required reviewer. When it is the last outstanding '
  'answer, writes feedback_collected to every required reviewer still owed and re-asks completion.';
revoke execute on function public.sub_task_respond(uuid) from public;
revoke execute on function public.sub_task_respond(uuid) from anon;
grant  execute on function public.sub_task_respond(uuid) to authenticated;

-- ============================================================================
-- 8) an answer belongs to a version (d.8)
-- ============================================================================
-- Reproduced from 20260827100000 §8b (its only definition); the two new columns join the clear.
create or replace function app.tg_subtask_clear_approvals() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
begin
  if new.status is distinct from old.status and new.status <> 'done' then
    perform set_config('app.reviewer_verdict', 'on', true);
    update public.sub_task_reviewers
       set approved_at = null, responded_at = null, response = null
     where sub_task_id = new.id
       and (approved_at is not null or responded_at is not null);
    perform set_config('app.reviewer_verdict', 'off', true);
  end if;
  return new;
end $$;

comment on function app.tg_subtask_clear_approvals() is
  'ADR-0043 d.6 + ADR-0089 d.8: an approval — and an answer — belongs to a version. Any status '
  'change that is not the completion itself voids every reviewer verdict and every answer on the '
  'task; a "no comment" on a draft says nothing about the next draft.';

-- ============================================================================
-- 9) somebody appointed to a task already in review is told (d.10)
-- ============================================================================
-- tg_subtask_notify_reviewer fires on the status change INTO review and on nothing else, so the
-- exact sequence in Edward's report — submit, then reopen the task to add a second name — put a
-- person on a task in review with no notification, ever.
create or replace function app.tg_sub_task_reviewer_appointed_in_review() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare v sub_tasks; v_label text;
begin
  select * into v from public.sub_tasks st where st.id = new.sub_task_id;
  if not found or v.status <> 'review' then
    return null;
  end if;
  if new.user_id is not distinct from auth.uid() then
    return null;   -- never notify the actor about their own action
  end if;
  select d.name into v_label from public.deliverables d where d.id = v.deliverable_id;
  insert into public.notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
  values (new.tenant_id, new.user_id, 'review_requested', coalesce(v_label, v.title),
          case when v.deliverable_id is null then 'sub_task' else 'deliverable' end,
          coalesce(v.deliverable_id, v.id), auth.uid());
  return null;
end $$;

comment on function app.tg_sub_task_reviewer_appointed_in_review() is
  'ADR-0089 d.10: a reviewer appointed to a task that is ALREADY in review gets review_requested, '
  'the actor excepted. The submit-time trigger cannot see a late appointment.';

create trigger sub_task_reviewer_appointed_in_review
  after insert on sub_task_reviewers
  for each row execute function app.tg_sub_task_reviewer_appointed_in_review();

-- ============================================================================
-- 10) the new notification type (d.9)
-- ============================================================================
-- Reproduced from 20260903130100, plus `feedback_collected`. The constraint is drop-and-recreate,
-- so anything omitted here is silently un-emittable afterwards.
-- Check with: grep -rln "notifications_type_check" supabase/migrations/*.sql | tail -1
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in (
    'assigned', 'review_requested', 'changes_requested', 'signed_off', 'blocked', 'due_soon',
    'dependency_ready', 'cancelled', 'resource_clash', 'resource_required',
    'campaign_approved', 'deliverable_reassigned', 'rescheduled', 'chat_added',
    'task_reinstated', 'brief_awaiting_approval', 'feedback_collected'
  ));

comment on constraint notifications_type_check on notifications is
  'ADR-0028 + I31.7 + ADR-0068 d.6 + ADR-0070 d.6 + ADR-0089 d.9. Every value here needs COPY in '
  'notify-email or it is silently in-app only, AND copy under `notifications.type.*` in EN and AR '
  'or the inbox renders the raw key at the reader. Both have already been missed more than once.';

-- ============================================================================
-- 11) the two doors that appoint one reviewer say "required" out loud (d.2)
-- ============================================================================
-- Reproduced from 20260827100000 §6. One change: is_mandatory = true.
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
  -- ADR-0089 d.2: the inherited reviewer is the one whose approval is required. The deferred rule
  -- would mark a lone reviewer anyway; saying it here makes the intent visible at the call site.
  insert into public.sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory, created_by)
  values (new.tenant_id, new.id, v_reviewer, true, auth.uid())
  on conflict (sub_task_id, user_id) do nothing;
  return null;
end $$;

comment on function app.tg_subtask_seed_reviewer() is
  'ADR-0038 d.2, carried to ADR-0043 and ADR-0089 d.2: a task inherits its parent deliverable''s '
  'reviewer as one REQUIRED appointment when it is created assigned. Never the assignee, never '
  'somebody who cannot moderate reviews.';

-- Reproduced from 20260829090000 (the ad-hoc owner version). One change, marked ADR-0089 d.2.
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
  -- ADR-0089 d.2: and that one person is the REQUIRED reviewer — the ad-hoc dialog's single select
  -- produces a required appointment with no change to the screen (d.13).
  --
  -- NOT `on conflict (sub_task_id, user_id)`: a conflict target is an expression context, and
  -- `sub_task_id` is this function's OUT parameter, so plpgsql binds the name to the variable and
  -- raises 42702 "column reference is ambiguous". `where not exists` keeps every name qualified.
  insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory, created_by)
  select v_tenant, v_sub, p_reviewer, true, auth.uid()
  where not exists (
    select 1 from sub_task_reviewers r where r.sub_task_id = v_sub and r.user_id = p_reviewer);
  update sub_task_reviewers r set is_mandatory = true
   where r.sub_task_id = v_sub and r.user_id = p_reviewer and not r.is_mandatory;

  sub_task_id := v_sub; deliverable_id := v_deliv; return next;
end $$;

comment on function public.create_adhoc_deliverable(uuid, text, numeric, timestamptz, timestamptz, uuid) is
  'ADR-0035, amended by ADR-0043 d.9, ADR-0053 d.6 and ADR-0089 d.2: create an ad-hoc reviewable '
  'deliverable + its sub-task under the tenant Ad-hoc job. The assignee is also the OWNER, which is '
  'what gives ad-hoc work a department and a Discipline label. The chosen reviewer is written to '
  'deliverables.reviewer_id AND to sub_task_reviewers as the REQUIRED reviewer, so the two can never '
  'disagree. Ad-hoc stays single-reviewer, and the reviewer still may not be the assignee.';

-- ============================================================================
-- 12) the rows already there (d.11)
-- ============================================================================
-- By condition, never by id. `app.system_op` so any guard that asks who is acting stands aside for
-- a migration running as superuser; `app.reviewer_verdict` because the write guard resets
-- responded_at for any writer that does not announce itself — including this one.
set local app.system_op = 'on';
select set_config('app.reviewer_verdict', 'on', true);

do $$
declare
  r record;
  v_marked int := 0;
  v_stamped int := 0;
begin
  -- (a) every assigned, live task with reviewers and none marked: one reviewer → that one (d.2,
  --     applied once to history); several → the EARLIEST appointed, the convention
  --     update_task_assignment already uses to choose the deliverable's lead reviewer.
  for r in
    select st.id as task_id, st.title,
           (select count(*) from sub_task_reviewers x where x.sub_task_id = st.id) as n,
           pick.id as row_id, pick.user_id, coalesce(up.display_name, pick.user_id::text) as who
      from sub_tasks st
      join lateral (
        select x.id, x.user_id from sub_task_reviewers x
         where x.sub_task_id = st.id
         order by x.created_at, x.id
         limit 1
      ) pick on true
      left join user_profiles up on up.id = pick.user_id
     where st.assignee_id is not null
       and st.status <> 'cancelled'
       and not exists (select 1 from sub_task_reviewers m
                        where m.sub_task_id = st.id and m.is_mandatory)
  loop
    update sub_task_reviewers set is_mandatory = true where id = r.row_id;
    v_marked := v_marked + 1;
    raise notice 'ADR-0089 d.11: task % (%) — % marked required (% reviewer(s), none was)',
      r.task_id, r.title, r.who, r.n;
  end loop;

  -- (b) an optional reviewer who had already pressed Approve under the old model looked and had
  --     nothing to add: "no comment", at the moment they said so.
  for r in
    select x.id, x.sub_task_id, coalesce(up.display_name, x.user_id::text) as who, st.title
      from sub_task_reviewers x
      join sub_tasks st on st.id = x.sub_task_id
      left join user_profiles up on up.id = x.user_id
     where not x.is_mandatory and x.approved_at is not null and x.responded_at is null
  loop
    update sub_task_reviewers
       set responded_at = approved_at, response = 'no_comment'
     where id = r.id;
    v_stamped := v_stamped + 1;
    raise notice 'ADR-0089 d.11: task % (%) — optional reviewer % stamped no_comment at their approval',
      r.sub_task_id, r.title, r.who;
  end loop;

  raise notice 'ADR-0089 d.11: % task(s) given a required reviewer, % optional approval(s) translated to no_comment',
    v_marked, v_stamped;
end $$;

select set_config('app.reviewer_verdict', 'off', true);

commit;
