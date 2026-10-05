-- ADR-0076 d.4 / I1.9 — a deadline is 18:00 Iraq, not midnight UTC.
--
-- Every deadline in the system was picked as a DAY and written as midnight UTC (`${day}T00:00:00Z`
-- in DeliverablesPage), then printed by thirteen render sites as the UTC day. Both halves wrong,
-- cancelling, and correct only while every user sits east of UTC. ADR-0076 makes a deadline a real
-- instant instead — the close of the working day, 18:00 Asia/Baghdad — after which the ordinary
-- rule (store UTC, display in a named zone) applies to it like any other timestamp.
--
-- This moves the rows that already exist, so old and new work answer the same question the same
-- way. Without it the pilot carries two populations: everything created before today meaning
-- "midnight, i.e. the START of the day it is due" and everything after meaning "the end of it" —
-- a day's difference in every at-risk calculation, invisible in the data.
--
-- ONLY rows at exactly 00:00:00+00 move. A deadline at any other time was set deliberately (the
-- scheduler stamps `due_at` from the last booking's END, which is a real working hour) and is left
-- alone. This is why the WHERE clause tests the time-of-day and not the column.
--
-- 15:00Z is 18:00 in Baghdad and Iraq does not observe DST, so the arithmetic is stable — but it is
-- written as an explicit timezone conversion rather than "+ 15 hours" so that it stays correct if
-- that ever stops being true, and so the intent is legible.
--
-- No RLS, policy, table or column changes here, so no paired pgTAP suite: there is no new gate to
-- prove and nothing to migrate on a freshly built database, which is what `scripts/db/verify.sh`
-- runs against. The BEHAVIOUR this enables is covered by `src/lib/time/iraq.test.ts`, which asserts
-- that 18:00 Iraq is 15:00Z and that reading the UTC day of a late-evening instant is off by one.

update deliverables
   set due_at = (date_trunc('day', due_at at time zone 'UTC')::date + time '18:00')
                at time zone 'Asia/Baghdad'
 where due_at is not null
   and (due_at at time zone 'UTC')::time = time '00:00';

update sub_tasks
   set due_at = (date_trunc('day', due_at at time zone 'UTC')::date + time '18:00')
                at time zone 'Asia/Baghdad'
 where due_at is not null
   and (due_at at time zone 'UTC')::time = time '00:00';

comment on column deliverables.due_at is
  'ADR-0076: the deadline as a real instant — 18:00 Asia/Baghdad on the day it is due, the close of '
  'the working day. NOT midnight, and NOT a day wearing a timestamp''s clothes. Display through '
  'src/lib/time/iraq.ts, which names the clock; slice(0, 10) on this column is banned (d.6).';

comment on column sub_tasks.due_at is
  'ADR-0076: the deadline as a real instant — 18:00 Asia/Baghdad on the day it is due, unless the '
  'scheduler stamped it from the end of the last booking, which is already a real working hour. '
  'Display through src/lib/time/iraq.ts; slice(0, 10) on this column is banned (d.6).';
