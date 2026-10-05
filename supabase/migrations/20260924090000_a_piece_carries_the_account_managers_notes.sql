-- A piece carries the account manager's own notes (I56.8, section C).
--
-- The wizard already holds a `note` per row, but it is not this: ADR-0097 d.2 made that field the
-- BRIEF's own words about the row, put there by the proposal so a person can see what the model
-- read. It is evidence, and a person overwriting it destroys the only record of why the row was
-- proposed.
--
-- What is missing is the other direction — the account manager's own aside. "Client wants the
-- Kurdish cut first." "Do not reuse last season's key visual." "Legal have seen the number."
-- Today that has nowhere to go and ends up in a chat message nobody reading the piece will find.
--
-- Two fields, therefore, not one renamed:
--
--   `content_idea`  the line the creative reads first  (`20260923230000`, CB-v3-P4)
--   `notes`         whatever else the account manager needs the team to know
--
-- Free text and optional. It is deliberately not structured: the moment it has a schema it stops
-- being the place you can put the thing that did not fit anywhere else, which is its whole job.

begin;

alter table deliverables
  add column if not exists notes text;

comment on column deliverables.notes is
  'I56.8: the account manager''s own notes on this piece, written in the wizard and read by '
  'whoever picks the work up. Distinct from the brief''s words about the row (ADR-0097 d.2), '
  'which are evidence of what the proposal read and are never overwritten by a person.';

commit;
