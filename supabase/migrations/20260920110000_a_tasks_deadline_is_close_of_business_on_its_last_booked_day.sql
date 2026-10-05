-- I52.14 — ADR-0075 addendum d.3a/d.3b (Edward, 20 Sep): a task's commitment is a DAY at close of
-- business, 18:00 Asia/Baghdad, never a booking's end hour.
--
-- A booking is entered as a day and a number of hours. The 09:00 start and the end hour are the
-- system's own placement on the capacity grid (src/lib/bookings/day-span.ts) — nobody chose them —
-- yet `app.sync_subtask_span` sets the task's due_at to the END of its last booking (ADR-0039) and
-- the commitment stamp copied that instant, so a four-hour task read "Committed: 17 Sept, 13:00"
-- on My Work. Edward: "time is not specified — only date and hours"; "close of business is 18:00
-- Iraq time".
--
-- Two changes, both to the stamp only (ADR-0075 d.3): the FIRST commitment takes the due day at
-- app.close_of_day (ADR-0076's 18:00 Iraq, the same instant an extension request names); nothing
-- else about the trigger moves. `due_at` itself (the plan) is untouched — it still tracks the
-- bookings, which is what the schedule reads.
--
-- NO BACKFILL HERE (d.3c). Production carries stamps at booking-end hours; correcting them is a
-- separate migration proposed with its row count for Edward to approve. The display already shows
-- the day (formatIraqDate), so nothing reads wrong meanwhile.

begin;

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
      new.committed_due_at    := app.commitment_instant(new.due_at);
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
    new.committed_due_at    := app.commitment_instant(new.due_at);
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

-- The instant a commitment is measured against: close of business on the plan's last day.
create or replace function app.commitment_instant(p_due_at timestamptz) returns timestamptz
language sql immutable
set search_path = public, app, extensions as $$
  select case when p_due_at is null then null
              else app.close_of_day((p_due_at at time zone 'Asia/Baghdad')::date) end
$$;

comment on function app.commitment_instant(timestamptz) is
  'ADR-0075 addendum d.3a: a task''s commitment is its plan''s last DAY at 18:00 Asia/Baghdad '
  '(app.close_of_day), never the hour the placed booking happens to end.';

comment on function app.tg_sub_task_commitment_stamp() is
  'ADR-0075 d.3 + addendum d.3a: server-controls sub_tasks.committed_*: stamps the span on the '
  'FIRST assignment (or on the first dates an assigned task receives) with the due DAY at close of '
  'business, keeps it through unassign and reassign, and refuses any other write unless '
  'app.extension_decide (ADR-0088 d.6) or app.system_op is on.';

commit;
