-- I52.14 d.3c — existing commitment stamps move to 18:00 Iraq of their own day.
--
-- 20260920110000 (ADR-0075 addendum d.3a) made a task's commitment the plan's last DAY at 18:00
-- Asia/Baghdad — `app.commitment_instant(due_at)` — never the hour a placed booking happens to
-- end. It changed the stamp for every commitment made from then on and, on purpose, left the
-- stamps already on production alone (d.3c): the screens print the committed DAY, so those rows
-- read correctly; only the stored instant was off — 13:00 for a four-hour booking from 09:00.
-- This is that correction, proposed with its row count (Edward, 21 Sep: "resolve 5").
--
-- WHAT IT DOES. One UPDATE: every `committed_due_at` that is not already the close of its own
-- Iraq day becomes that close. The DAY never changes — `commitment_instant` reads the day in
-- Asia/Baghdad and returns 18:00 of that same day — so nothing a person was promised moves; only
-- the hour the row carries. `committed_starts_at` and `committed_hours` are not touched.
--
-- WHAT IT DOES NOT DO. It writes no `sla_events` row: the deadline log records a stamp
-- (`deadline_set`, only when a commitment first appears) or a MOVE (`deadline_changed`, only when
-- the planned day changes), and this is neither. The `deadline_set` events already on the log keep
-- the instant they recorded — they are the record of what was stamped, not corrected history.
-- The audit trigger logs each row's change, as it should. The commitment-stamp guard admits a
-- migration (`auth.uid()` is null), so no trigger is disabled.
--
-- Idempotent: a second run finds nothing to change. The count is raised as a NOTICE so the push
-- log says how many rows moved.

begin;

do $$
declare
  v_count int;
begin
  update sub_tasks
     set committed_due_at = app.commitment_instant(committed_due_at)
   where committed_due_at is not null
     and committed_due_at is distinct from app.commitment_instant(committed_due_at);
  get diagnostics v_count = row_count;
  raise notice 'I52.14 d.3c: % commitment stamp(s) moved to 18:00 Asia/Baghdad of their own day', v_count;
end $$;

commit;
