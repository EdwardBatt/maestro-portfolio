-- ADR-0075 d.3 / I46.1 — a task's committed span is stamped when it is assigned, and every later
-- move of the plan is RECORDED, never refused.
--
-- ADR-0075 was accepted on 9 Sep and this migration was never written (I46.1, found 11 Sep while
-- drafting ADR-0088). What it closes: a task's dates follow its bookings (ADR-0039), so dragging a
-- chip rewrote `sub_tasks.due_at` and a breach could not be observed — it was indistinguishable
-- from a reschedule and deleted itself the moment somebody moved the work. The promise to the
-- client (`deliverables.due_at`) was already safe; the task's commitment was not.
--
-- WHAT THIS ADDS
--
--   * `sub_tasks.committed_starts_at / committed_due_at / committed_hours` — the span as it was
--     when the task was assigned. Server-stamped, like `assigned_at` (20260823130000): a client
--     cannot write them. They change ONLY by the stamp (assignment, or the first dates an assigned
--     task receives) or by an approved extension (ADR-0088 d.6, `app.extension_decide`).
--   * `sla_events.sub_task_id` — the log can now point at a task. Until now its subject was a
--     deliverable, a job or a booking, so ADR-0075's "writes a deadline_changed row" had nowhere
--     to point (ADR-0088 context). Composite FK on (tenant_id, id): a plain `references` is not a
--     tenant fence (traps.md). No ON DELETE: the record pins its task, as it pins its deliverable.
--   * `deadline_set` when the commitment is stamped, `deadline_changed` on every later move of the
--     plan — both event types have existed since July (20260728110600) and have never been written
--     by anything. Emitted by a trigger on `sub_tasks`, so EVERY path that moves a task's dates is
--     logged: the drag handler, `subtask-schedule`, `update_task_assignment`, `save_sub_task`,
--     the span sync. ADR-0075 Consequences: "a missed one is a silent hole in exactly the record
--     that makes the metric trustworthy", which is why it is not written into each RPC.
--   * A backfill: every task already assigned takes its current dates as its commitment. ADR-0088
--     d.12 assumes this — "or every live task has nothing to extend".
--
-- WHAT COUNTS AS A MOVE. A deadline is a DAY (ADR-0076: 18:00 Asia/Baghdad). The scheduler stamps
-- `due_at` from the END of the last booking, so seconds after a task is assigned with an 18:00
-- deadline its `due_at` becomes 14:00 the same day. That is not a move; logging it would put a
-- `deadline_changed` on every task ever scheduled. A move is a change of the Iraq calendar day of
-- either end — the same test `app.tg_booking_notify_reschedule` uses to decide whether to tell
-- the assignee. The hours are recorded in the payload either way.
--
-- NOT HERE, AND SAID SO. ADR-0075's migration paragraph also names three settings columns and a
-- view per clock segment. The settings are `I41.10`'s (the Admin → Reminders screen that has never
-- existed) and the views have no reader yet; both are deferred, not forgotten. The at-risk
-- arithmetic (d.4) is a forward calculation over columns that all exist after this file.
--
-- SECURITY DEFINER on the two trigger functions: the same shape as `app.tg_sub_task_completion_guard`
-- and `app.tg_booking_syncs_subtask_span`. The log row is written by the system on the actor's
-- behalf and must land whoever the actor is, and the guard reads the task's deliverable and its
-- campaign's account manager, which the actor's own RLS view need not include. search_path pinned
-- per ADR-0033.
--
-- Tests: supabase/tests/099_a_task_keeps_the_span_it_was_committed_to.sql — a rescheduled task
-- keeps its committed date, the move is logged with its actor, the deliverable's due date is
-- unchanged by any of it, and the committed columns cannot be written by hand.

begin;

-- ============================================================================
-- 1) the commitment, beside the plan
-- ============================================================================
alter table sub_tasks add column committed_starts_at timestamptz;
alter table sub_tasks add column committed_due_at    timestamptz;
alter table sub_tasks add column committed_hours     numeric(6,2)
  check (committed_hours is null or committed_hours > 0);

comment on column sub_tasks.committed_starts_at is
  'ADR-0075 d.3: the start the task was committed to when it was assigned. Server-stamped; a '
  'reschedule never touches it. Compare with starts_at to see how far the plan has drifted.';
comment on column sub_tasks.committed_due_at is
  'ADR-0075 d.3: the deadline the task was committed to when it was assigned — what a breach is '
  'measured against. Changes ONLY by an approved extension (ADR-0088 d.6). due_at is the plan.';
comment on column sub_tasks.committed_hours is
  'ADR-0075 d.3: the hours committed at assignment (sla_hours as it then stood).';

-- ============================================================================
-- 2) the log can point at a task
-- ============================================================================
alter table sla_events add column sub_task_id uuid;
alter table sla_events
  add constraint fk_sla_events_sub_task_tenant
  foreign key (tenant_id, sub_task_id) references sub_tasks (tenant_id, id);
create index idx_sla_events_sub_task_id on sla_events (sub_task_id);

alter table sla_events drop constraint chk_sla_events_has_subject;
alter table sla_events add constraint chk_sla_events_has_subject
  check (deliverable_id is not null or job_id is not null
         or booking_id is not null or sub_task_id is not null);

comment on column sla_events.sub_task_id is
  'ADR-0075 d.3 / ADR-0088 d.5: the task this event is about. Every task event also carries its '
  'deliverable_id, so a deliverable''s log reads whole.';

-- ============================================================================
-- 3) backfill — BEFORE the stamp trigger exists, so nothing can refuse or restamp it
-- ============================================================================
-- Same shape as 20260823130000: the touch and audit triggers are off for the one-time fill so it
-- neither bumps updated_at nor writes 179 audit rows saying "the migration ran". No sla_events
-- rows either: a deadline_set with no actor, dated today, for a commitment made in August would be
-- a false record, and the arithmetic reads the columns, not the log.
--
-- The DEFERRED reviewer check (`sub_task_reviewer_required`, 20260827100000) is off for it too.
-- It queues an event per updated row and runs them at commit — and with events queued, Postgres
-- refuses to re-enable any trigger on the table (55006, found on the production push, 14 Sep;
-- invisible on the test databases, which have no assigned tasks to update). The fill copies dates,
-- not reviewers, so the check has nothing to say about it.
alter table sub_tasks disable trigger set_updated_at;
alter table sub_tasks disable trigger audit_row_change;
alter table sub_tasks disable trigger sub_task_reviewer_required;
update sub_tasks
   set committed_starts_at = starts_at,
       committed_due_at    = due_at,
       committed_hours     = sla_hours
 where assignee_id is not null;
alter table sub_tasks enable trigger sub_task_reviewer_required;
alter table sub_tasks enable trigger audit_row_change;
alter table sub_tasks enable trigger set_updated_at;

-- ============================================================================
-- 4) the stamp, and the freeze
-- ============================================================================
-- Stamps the commitment the FIRST time a task is assigned (assignee null → somebody), or when an
-- assigned task receives its first dates (a task can be assigned bare and dated by the scheduler a
-- moment later — without this branch its commitment would stay null for ever). KEEPS it on
-- unassign and on reassign: the work is the same commitment, in different hands or in nobody's
-- for a while. The first build cleared it on unassign and stamped afresh on the next assignment,
-- and the independent review (11 Sep) walked straight through that — unassign, move the plan,
-- reassign the same person, and the commitment equalled the moved plan with no extension asked
-- (ADR-0088 d.1: "by nothing else"). A commitment, once made, moves only by an approved extension.
-- Any other write to the committed columns is refused unless it is the extension RPC (ADR-0088
-- d.6 sets `app.extension_decide`), a system op, or a superuser path with no actor (migrations,
-- seeders).
create or replace function app.tg_sub_task_commitment_stamp() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_free boolean := auth.uid() is null
                    or app.is_system_op()
                    or coalesce(current_setting('app.extension_decide', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.assignee_id is not null then
      new.committed_starts_at := new.starts_at;
      new.committed_due_at    := new.due_at;
      new.committed_hours     := new.sla_hours;
    else
      new.committed_starts_at := null;
      new.committed_due_at    := null;
      new.committed_hours     := null;
    end if;
    return new;
  end if;

  if old.committed_due_at is null and old.committed_starts_at is null
     and new.assignee_id is not null
     and (new.due_at is not null or new.starts_at is not null) then
    -- the FIRST commitment: assigned now with dates, or assigned earlier without dates and dated
    -- now. A task that was committed, unassigned and assigned again does not come through here —
    -- its commitment is still on the row, and stays.
    new.committed_starts_at := new.starts_at;
    new.committed_due_at    := new.due_at;
    new.committed_hours     := new.sla_hours;
  elsif not v_free
        and (new.committed_starts_at is distinct from old.committed_starts_at
             or new.committed_due_at is distinct from old.committed_due_at
             or new.committed_hours  is distinct from old.committed_hours) then
    raise exception
      'a task''s commitment is stamped when it is assigned and changes only by an approved extension'
      using errcode = '42501';
  end if;
  return new;
end $$;

comment on function app.tg_sub_task_commitment_stamp() is
  'ADR-0075 d.3: server-controls sub_tasks.committed_*: stamps the span on the FIRST assignment '
  '(or on the first dates an assigned task receives), keeps it through unassign and reassign, and '
  'refuses any other write unless app.extension_decide (ADR-0088 d.6) or app.system_op is on.';

create trigger sub_task_commitment_stamp before insert or update on sub_tasks
  for each row execute function app.tg_sub_task_commitment_stamp();

-- ============================================================================
-- 5) the record — deadline_set on the stamp, deadline_changed on every later move
-- ============================================================================
-- AFTER, not BEFORE: the event row references the task, and on INSERT the task does not exist
-- until the BEFORE triggers have run.
create or replace function app.tg_sub_task_deadline_log() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_stamped boolean;
  v_moved   boolean;
begin
  if tg_op = 'INSERT' then
    v_stamped := new.committed_due_at is not null or new.committed_starts_at is not null;
    v_moved := false;
  else
    v_stamped := old.committed_due_at is null and new.committed_due_at is not null;
    -- A move is a change of DAY at either end, in Iraq (ADR-0076), on a task that has a commitment
    -- to be measured against — assigned or not: the commitment survives an unassignment (§4), so
    -- a plan moved while the task sits unassigned is still a move away from what was promised.
    v_moved := not v_stamped
               and old.committed_due_at is not null
               and ((new.starts_at at time zone 'Asia/Baghdad')::date
                      is distinct from (old.starts_at at time zone 'Asia/Baghdad')::date
                    or (new.due_at at time zone 'Asia/Baghdad')::date
                      is distinct from (old.due_at at time zone 'Asia/Baghdad')::date);
  end if;

  if v_stamped then
    insert into sla_events (tenant_id, deliverable_id, sub_task_id, event_type, actor_user_id, payload)
    values (new.tenant_id, new.deliverable_id, new.id, 'deadline_set', auth.uid(),
            jsonb_build_object('starts_at', new.committed_starts_at,
                               'due_at',    new.committed_due_at,
                               'hours',     new.committed_hours));
  elsif v_moved then
    insert into sla_events (tenant_id, deliverable_id, sub_task_id, event_type, actor_user_id, payload)
    values (new.tenant_id, new.deliverable_id, new.id, 'deadline_changed', auth.uid(),
            jsonb_build_object('starts_at_from', old.starts_at, 'starts_at_to', new.starts_at,
                               'due_at_from',    old.due_at,    'due_at_to',    new.due_at,
                               'committed_due_at', new.committed_due_at,
                               -- the drag that makes an extension request the ordinary next step
                               -- (ADR-0088 d.10): the plan now ends after the commitment
                               'past_commitment', new.due_at > new.committed_due_at));
  end if;
  return null;
end $$;

comment on function app.tg_sub_task_deadline_log() is
  'ADR-0075 d.3: writes deadline_set to sla_events when a task''s commitment is stamped and '
  'deadline_changed on every later move of its plan (a change of Iraq day at either end). One '
  'trigger, so no path that moves a task''s dates can miss the log.';

create trigger sub_task_deadline_log after insert or update on sub_tasks
  for each row execute function app.tg_sub_task_deadline_log();

commit;
