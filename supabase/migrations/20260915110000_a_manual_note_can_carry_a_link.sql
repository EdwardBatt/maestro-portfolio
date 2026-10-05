-- ADR-0059 addendum d.14 (15 Sep) — I48.29: a task-anchored note may carry one link.
--
-- WHY. The manual path was written for work that leaves nothing behind (a shoot, an installation).
-- Edward found a second kind: work whose output exists somewhere the system cannot fetch — a
-- Keynote on iCloud, a working file on a shared drive. Today the maker writes "it is on the drive"
-- and the reviewer goes looking. The note gains a link beside it.
--
-- ON THE NOTE, NOT THE TASK (d.14): the link belongs to a ROUND — round 2's file is not round 1's —
-- and the note is already the manual round's artefact, stamped with its round and author, so a
-- link on it inherits both and every round's link stays in the thread where the reviewer read it.
--
-- THE CHECK LIVES HERE because the note is written by a plain RLS-governed insert, not an RPC
-- (traps.md: a form-only rule is no rule). Scheme only — http(s) — and a length cap; anything
-- stricter is guessing at what a URL looks like on every share service the team uses.
--
-- NOTHING ELSE MOVES. The note stays required (d.15), so `app.sub_task_submit` is not re-emitted;
-- no backfill (every existing row is null, correctly — nobody had a link to give); no new policy
-- (the column rides the table's existing RLS). One `alter table`.

begin;

alter table review_feedback
  add column link_url text,
  add constraint ck_review_feedback_link_url
    check (link_url is null
           or (link_url ~* '^https?://' and length(link_url) <= 2048));

comment on column review_feedback.link_url is
  'ADR-0059 addendum d.14: where the work reviewed by this note lives, when it lives somewhere the '
  'system cannot fetch. Optional beside the note; never a version (not filed, not delivered, not '
  'archived). http(s) only, 2048 chars at most.';

commit;
