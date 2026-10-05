-- A phase ends on an event, not on a date somebody typed (I56.10, section C).
--
-- `campaign_phases` holds a name and two dates. The frames hold a third thing, and it is the one
-- that explains the other two:
--
--   `CB-v3-P1`  "A phase ends on an event, not on a date somebody typed. Give it the event and
--               Maestro plans everything in it backwards from there."  Field: **Ends on**.
--   `CB-v3-04`  every phase heading reads *Week 2 — planned backwards from Draw Night 2*.
--   `CB-v3-03`  the phase chips on the work rows name the event, not the date.
--
-- Why it is worth a column rather than being folded into `name`. The name is the account
-- manager's handle for the stretch — "Week 2", "Pre-Launch" — and it is what everybody says out
-- loud. The event is the real-world thing the stretch is aimed at, and it is what makes a date
-- movable or not: moving Draw Night 2 moves every piece in Week 2, and that sentence has to be
-- sayable on screen. One field holding both would mean parsing a person's own words to find out
-- which half moved.
--
-- Nullable, because ADR-0096 d.1 keeps phases optional and a campaign may cut itself into
-- stretches that simply end on a date. The timing step falls back to the date when this is null.

begin;

alter table campaign_phases
  add column if not exists ends_on_event text;

comment on column campaign_phases.ends_on_event is
  'I56.10 (CB-v3-P1): the real-world event the phase ends on — "Draw Night 2", "Launch". The '
  'phase plans backwards from it, and moving it moves every piece in the phase. Null where the '
  'phase simply ends on its date; the timing step then reads the date instead.';

commit;
