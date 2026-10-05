-- I59 (25 Sep, Edward) — every notification type the ADR-0105..0113 build raises, declared ONCE so the
-- parallel tracks that raise them do not each re-define notifications_type_check (the last one to run
-- would silently drop the others' values).
--
--   task_blocked            ADR-0107 d.2 — a maker raised "I'm blocked"; to the owner and the AM
--   untimed_round           ADR-0106 d.3 — a round was sent untimed; to the deliverable's owner
--   extension_forwarded     ADR-0109 d.2 — the owner forwarded a request; to the account manager
--                           (the owner's decline reuses extension_refused, detail.stage = 'owner')
--   change_request_sent     ADR-0110 d.1 — to the deliverable's owner
--   change_request_answered ADR-0110 d.2 — accepted / declined / pushed back; to the requester
--   change_request_resolved ADR-0110 d.3 — her version accepted / withdrawn; to the owner
--   question_asked          ADR-0113 d.2 — to each person the asker picked
--   question_replied        ADR-0113 d.2 — to the asker
--   nudged                  ADR-0113 d.1 — to the person nudged
--   too_much                ADR-0113 d.3 — to whoever assigned the task
--   too_much_answered       ADR-0113 d.3 — Rebalance / Keep it with her; to the maker
--   escalated               ADR-0108 d.2 — any of the seven escalations, detail.kind names which
--   review_reminder         ADR-0108 d.2 — the review row's reminder rung; to the outstanding reviewers
--   over_capacity           ADR-0108 d.6 — someone booked over the tenant's %; to their leads
--   task_unblocked          ADR-0107 addendum — a block was cleared; to whoever waited on it
--
-- entity_type gains 'resource' for over_capacity, which is about a person's week, not a piece.
--
-- Reproduced WHOLE from the latest definition (20260925100000), cumulatively.

begin;

alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in (
    'assigned', 'review_requested', 'changes_requested', 'signed_off', 'due_soon',
    'dependency_ready', 'cancelled', 'resource_clash', 'resource_required',
    'campaign_approved', 'deliverable_reassigned', 'rescheduled', 'chat_added',
    'task_reinstated', 'feedback_collected',
    'assignment_requested', 'assignment_approved', 'assignment_refused', 'assignment_superseded',
    'extension_requested', 'extension_approved', 'extension_refused',
    'deliverable_added',
    'deliverable_owner_removed', 'task_reassigned_away', 'feedback_requested',
    'assignment_overdue',
    'task_reopened', 'deliverable_reopened',
    -- I59
    'task_blocked', 'untimed_round', 'extension_forwarded',
    'change_request_sent', 'change_request_answered', 'change_request_resolved',
    'question_asked', 'question_replied', 'nudged', 'too_much', 'too_much_answered',
    'escalated', 'review_reminder', 'over_capacity', 'task_unblocked'
  ));
comment on constraint notifications_type_check on notifications is
  'I52 (17 Sep). Every value here needs COPY in notify-email AND `notifications.type.*` in EN and AR, '
  'or it is silently in-app only / renders its raw key; src/test/notification-copy.test.ts holds the '
  'three together. I59 (25 Sep, ADR-0105..0113) added fourteen values in one migration so parallel '
  'tracks do not overwrite each other: task_blocked, untimed_round, extension_forwarded, '
  'change_request_sent/answered/resolved, question_asked/replied, nudged, too_much(_answered), '
  'escalated, review_reminder, over_capacity.';

alter table notifications drop constraint if exists notifications_entity_type_check;
alter table notifications add constraint notifications_entity_type_check
  check (entity_type in ('deliverable', 'sub_task', 'campaign', 'booking', 'resource'));

commit;
