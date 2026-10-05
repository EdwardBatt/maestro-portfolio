-- I25.1 / I25.2 / I25.6 (ADR-0058 d.3, d.4) — the artefact belongs to the sub-task.
--
-- Edward, 28 Aug: *"When there are multiple tasks under 1 deliverable, the deliverable is never
-- uploaded. It is merely approved when all tasks are approved. I keep saying this — the deliverable
-- is basically a container."*
--
-- Most of that model was already built: per-task reviewers, per-task approval, and a guard that
-- refuses to approve a deliverable while any sub-task is open. Only the FILE was attached to the
-- wrong row — and an earlier analysis read `unique (deliverable_id, version)` as meaning review
-- itself was per-deliverable, concluded six reels must be six deliverables, and built a whole
-- expansion mechanism on it. ADR-0058 supersedes that. Approval was always per task.
--
-- `deliverable_id` IS KEPT, not replaced. Delivery and Library filing (`20260817100000`), archive
-- residency (`20260817100100`) and the round backfill all read it directly, and they are genuinely
-- about the deliverable. Adding `sub_task_id` alongside leaves every one of them working.
--
-- THE UNIQUE CONSTRAINT. `unique (deliverable_id, version)` cannot survive: two tasks under one
-- deliverable must each be able to hold a version 1. It becomes
-- `unique nulls not distinct (deliverable_id, sub_task_id, version)`:
--
--   * rows WITH a sub-task are unique per task, so each numbers from 1 independently;
--   * legacy rows WITHOUT one keep exactly their old guarantee — and `nulls not distinct`
--     (Postgres 15+) is what makes that true. A plain unique treats every NULL as distinct, which
--     would have silently dropped uniqueness for every row this migration does not attach.

begin;

alter table media_records
  add column sub_task_id uuid references sub_tasks(id) on delete set null;

create index idx_media_records_sub_task_id on media_records (sub_task_id);

comment on column media_records.sub_task_id is
  'ADR-0058 d.3: the sub-task whose work this version IS. Null on rows created before the container '
  'model, and on any the backfill could not attach without guessing. `on delete set null` rather '
  'than cascade: deleting a task must never destroy the artefact somebody produced.';

-- ------------------------------------------------------------------- backfill ----
-- Attach every existing version to its deliverable's sub-task WHERE THERE IS EXACTLY ONE. That is
-- every ad-hoc row (create_adhoc_deliverable makes one deliverable and one task) and most campaign
-- rows. Where a deliverable holds several tasks there is no way to tell which one a file belonged
-- to, so those stay unattached and are REPORTED. A migration may not guess which of three people's
-- work a file was.
with single_task as (
  select st.deliverable_id, (array_agg(st.id))[1] as sub_task_id
  from sub_tasks st
  group by st.deliverable_id
  having count(*) = 1
),
attached as (
  update media_records m
     set sub_task_id = s.sub_task_id
    from single_task s
   where m.deliverable_id = s.deliverable_id
     and m.sub_task_id is null
  returning 1
)
select count(*) as versions_attached_to_their_only_task from attached;

select count(*) as versions_left_unattached_needing_a_human
  from media_records where sub_task_id is null;

-- --------------------------------------------------------------- the constraint ----
alter table media_records drop constraint uq_media_records_deliverable_version;
alter table media_records
  add constraint uq_media_records_deliverable_task_version
  unique nulls not distinct (deliverable_id, sub_task_id, version);

-- ------------------------------------------------------------ version numbering ----
-- Per TASK where there is one, per deliverable where there is not. Two reels are each on version 1;
-- under the old rule the second was forced to version 2 of a shared sequence that meant nothing.
--
-- Reproduced from `20260818100000` with the marked change. The advisory lock moves with it: it now
-- serialises on whichever key the version is counted within, or two uploads racing on the same task
-- would both read the same max.
create or replace function app.tg_media_record_set_version()
returns trigger language plpgsql as $$
begin
  if new.deliverable_id is null then
    raise exception 'media_records.deliverable_id is required' using errcode = '23502';
  end if;

  if new.sub_task_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(new.sub_task_id::text, 0));
    select coalesce(max(version), 0) + 1 into new.version
      from media_records
     where sub_task_id = new.sub_task_id;
  else
    perform pg_advisory_xact_lock(hashtextextended(new.deliverable_id::text, 0));
    select coalesce(max(version), 0) + 1 into new.version
      from media_records
     where deliverable_id = new.deliverable_id and sub_task_id is null;
  end if;

  return new;
end $$;

comment on function app.tg_media_record_set_version() is
  'ADR-0025, amended by ADR-0058 d.4: BEFORE INSERT — stamp the next version WITHIN THE SUB-TASK '
  'where there is one, otherwise within the deliverable. The client never sets version. The '
  'advisory lock is taken on whichever key the count is made over.';

commit;
