-- I31.7 (ADR-0062 d.6, and Edward's standing rule in I30) — being pulled into a conversation is an
-- action on the work, so it reaches the person by EMAIL and not only in-app.
--
-- Edward, 31 Aug: "all actions on a task need to generate emails, this includes adding reviewers…
-- we cannot rely on in app notifications only." Adding somebody to a thread is exactly such an
-- action: they are now expected to read something, and nothing else tells them.
--
-- The type list is a SECOND HOME for a vocabulary that also lives in `notify-email`'s COPY map, and
-- that is precisely how six types came to have no email at all (I30.2). This migration adds the
-- type; the matching copy ships in the same change set, and `I30.3` adds the test that fails when
-- the two drift again.

begin;

alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('assigned','review_requested','changes_requested','signed_off','blocked',
                  'due_soon','dependency_ready','cancelled','resource_clash','resource_required',
                  'campaign_approved','deliverable_reassigned','rescheduled','chat_added'));

comment on constraint notifications_type_check on notifications is
  'ADR-0028 + I31.7. Every value here needs COPY in notify-email or it is silently in-app only — '
  'the failure mode this list has already produced six times (I30.2).';

commit;
