# ADR-0088: A deadline is extended by asking, and the account manager answers

- **Status:** accepted (Edward, 11 Sep); d.1–d.10 superseded by ADR-0141 (3 Oct)
- **Date:** 2026-09-11
- **Open Decision:** advances **OD 4** (deadline authority) and **OD 5** (the attributable clock) one
  step past where ADR-0075 left them — see d.1 and d.4
- **Task(s):** I46. Depends on the ADR-0075 d.3 migration (unwritten — see d.12). Relates to
  [ADR-0039](0039-the-task-owns-its-dates.md) (a task's dates follow its bookings),
  [ADR-0045](0045-work-that-stalls-is-chased-and-escalated.md) and
  [ADR-0075](0075-at-risk-and-breach-are-measured-from-the-work-not-from-a-profile.md) d.8 (no reason
  is demanded for a move — kept, see d.4), [ADR-0070](0070-a-department-brief-is-approved-by-the-department.md)
  and [ADR-0073](0073-projects-manage-is-scoped-and-an-account-director-is-not.md) (the approver is
  computed from scope and the failsafe falls out of it), [ADR-0076](0076-one-company-clock-and-a-deadline-is-the-end-of-a-working-day.md)
  (a deadline is 18:00 Iraq), [ADR-0061](0061-assigning-work-says-what-actually-happened.md) d.4
  (moving work tells the person).

## Context

Edward, 11 Sep: *"We need a formal means to extend deadlines on tasks.... this is subject to AM
approval."*

**What "formal" is being contrasted with.** Today a task's deadline moves in three ways, none of which
is a request and none of which asks anybody: a chip is dragged on the schedule and
`app.tg_booking_syncs_subtask_span` rewrites `sub_tasks.due_at` to the envelope of the bookings
(ADR-0039); the schedule's `EditBookingDialog` or the Deliverables task dialog calls
`public.update_task_assignment` / `public.save_sub_task` with a new `p_due_at`; or the materialiser
re-spreads the work. ADR-0075 decided, deliberately, that those moves stay free — *"nothing is
blocked, nothing demands a reason"* (d.3) — and that what makes a moved deadline honest is that the
COMMITMENT is kept beside the plan: `committed_due_at`, stamped at assignment, never touched by a
reschedule, so a breach cannot delete itself when the work is dragged. An extension is the one case
ADR-0075 did not name: the moment the commitment itself legitimately changes, because somebody with
the authority to renegotiate it said yes.

**Who can move a deadline today, measured against the schema, not the notes.** The task RPCs gate on
`project_tasks:manage` **and** `app.in_write_scope(department, team, app.deliverable_account_manager(deliverable))`.
`app.in_write_scope` returns `false` for `self` scope, so a Team Member — who in any case lost
`project_tasks:manage` on 25 Aug (`20260825110000`, Edward) — has **no route to move their own
deadline**, and the comment in `EditBookingDialog.tsx:266` saying they still hold that grant is stale.
The people who can move it are the department and team leads over the task, the campaign's account
manager (by the account branch), the Account Director, Traffic and Power Admin. So the maker who knows
on Tuesday that Friday is impossible has exactly one thing they can do about it: say so in chat.
Nothing they say there reaches the deadline, the exception feed, or the record.

**Except through a side door nobody built on purpose.** `sub_tasks_manage_update` carries
`or (assignee_id = auth.uid())` so a maker can progress their own task, and it fences no columns.
`public.save_sub_task` is `security invoker` with no gate of its own, so an assignee calling it with
`p_due_at` — or a plain PostgREST `update sub_tasks set due_at` — moves their own deadline today, with
no booking moving and no notification, and the next booking write silently puts it back. No screen
offers this. It is the same shape `20260827100000` closed for `status = 'done'`: a policy written to
let somebody progress a task, read as permission to write anything on it.

**What the record can hold today.** `sla_events` (`20260728110600`) is the append-only log ADR-0075
names for exactly this. Measured on 11 Sep: its subject is `deliverable_id`, `job_id` or
`booking_id` — **there is no `sub_task_id`**, so no event can be anchored to a task; its check
constraint lists `deadline_set`, `deadline_changed`, `scope_change`, `clock_paused`, `clock_resumed`,
`blocked_flagged`, `block_cleared`, `delivered`, `revision_requested`, `approved`; and the only
writers in the whole migration history are the deliverable transition guard (`approved`,
`revision_requested`, `blocked_flagged`, `block_cleared`), `booking-transition`'s approve (`approved`
on a booking) and the delivery path. **`deadline_set` and `deadline_changed` have never been written
by anything**, and `attributed_to` — an enum of `assignee | client | dependency | approver` built in
July for OD 5 — has only ever carried `approver`, `assignee` and `dependency` as fixed labels on state
transitions. ADR-0075 d.3 says a move *"writes a `deadline_changed` row"*; it cannot, yet, because the
row has nowhere to point. The `committed_*` columns d.3 adds do not exist either: ADR-0075 is
accepted and its migration is unwritten, and `docs/TASKS.md` `I41.4` — *"its d.3 now stamps
`committed_starts_at`"* — overstates what is built. This ADR is that migration's first consumer, and
says so rather than pretending the ground is there.

**The promise is guarded less than the plan.** `deliverables_tenant_write` is `for all` on
`project_tasks:manage` with **no scope test**, so any lead in the tenant can rewrite a client's
promised date directly, while moving the task underneath it is scoped. Not this ADR's to fix; recorded
because a reader comparing d.7 with the schema would otherwise think the asymmetry was decided.

**Options weighed.**

- *Use chat.* Item threads exist (ADR-0027) and this is a conversation. Rejected: chat produces
  nothing the arithmetic can read, the AM's answer is a message rather than a change to a date, and
  "formal" is Edward's word — the point is that the answer lands on the task.
- *Let the assignee reschedule, and count the moves.* ADR-0075 d.8's pattern, extended one role down.
  Rejected: it hands the maker the authority to move their own commitment, which is the thing
  *"subject to AM approval"* says they must not have. The count is kept (d.5); the authority is not
  widened.
- *A `deadline_extension_requests` table with a status column.* One row to point at, a status to
  update, an entity for notifications. Rejected: the request would then live in two places — the
  table and the `sla_events` row ADR-0075 requires anyway — and the status column is a row that
  changes, on a fact whose whole value is that it does not. Two homes for one fact is the defect
  ADR-0038 and ADR-0039 each closed once.
- *Events only, in `sla_events`, with pending derived* — chosen (d.5). Fewer moving parts, one record,
  and "is there a pending request on this task" is a query over an indexed column.

## Decision

1. **An extension is a request to change a task's COMMITMENT — `committed_due_at` — and approval is
   the only thing that changes it.** A reschedule still moves `starts_at` / `due_at` freely and stays
   exactly as ADR-0075 d.3 and d.8 left it: unblocked, no reason demanded, counted. The two are
   different acts on different columns, and a screen never calls one the other.

2. **The assignee may ask, and so may anyone who could reschedule the task.** The assignee's route is
   the new thing: it is the first act a maker can take about a deadline they cannot meet that reaches
   the record. The reschedule authority — `project_tasks:manage` plus `app.in_write_scope` over the
   task's placement and its deliverable's account manager — may ask on their behalf, because the lead
   who moved the work on Monday is usually the one who knows the commitment no longer holds.

3. **The account manager answers, computed from scope, and no role is named.** The gate is
   `app.approve_campaign`'s, applied to the task's deliverable: `projects:manage` **and**
   `app.in_write_scope(null, null, app.deliverable_account_manager(deliverable_id))`. The assigned
   account manager passes by the account branch; the Account Director by `all_accounts`; Traffic and
   Power Admin because they are tenant-scoped. A department or team lead cannot answer, because
   `in_write_scope` with no department and no team fails their branches — which is right: they are the
   ones asking. **The failsafe falls out of the scope model** (ADR-0070 d.3, ADR-0073 d.2) and is a
   fallback, not a queue: d.9 sends the request to the resolved manager only.

   **Where no account manager resolves — ad-hoc and internal work — the request goes to whoever gave
   the work,** `sub_tasks.assigned_by`, and is answered by the reschedule authority of d.2. There is no
   client behind that deadline and nobody to renegotiate it with except the person who set it.
   Edward, 11 Sep: *"agreed, but please note the plan is to retire the ad-hoc scheduling once the
   necessary changes are in place"* — so this branch is a bridge for the existing 131 ad-hoc
   deliverables, which ADR-0082 d.9 leaves on the old model, and for internal jobs. Once every new
   piece of work is a campaign row with an account manager (ADR-0083 d.3), nothing new reaches it.

   **An approver who is also the requester does both in one press**, and the log shows the same
   person twice. The account manager extending a task on their own campaign has nobody to ask; a
   ceremony of asking oneself is the delay ADR-0073 d.6 refused to build into a failsafe. ADR-0070's
   amendment reached the same answer for briefs, and its reason to watch the audit applies here too.

4. **A request is a date, a reason, and who the time is charged to.** The date is a deadline and
   lands at 18:00 Asia/Baghdad on its day (ADR-0076 d.3). **The reason is mandatory, and this does not
   reopen ADR-0045 or ADR-0075 d.8** — both refused to demand a reason for a *move*, because a move
   is a planning act and a reason field turns a planning tool into a delay. A request is not a
   planning act; it is a message to another person asking them to accept something, and a request
   with no reason is a message with nothing in it — the approver cannot decide on it. It is the text
   of the ask, not a justification bolted beside it: one free line.

   **The attribution is one of three — the assignee, the client, or a dependency** — the values
   `attribution_party` has carried unused since July. *More work than planned*, *waiting on the
   client*, *waiting on an input*: the requester is the only person who knows which, so it is asked
   rather than derived (AGENTS.md §5 says derive when the system can; it cannot here). This is OD 5's
   attributable clock arriving as one radio button, and it is what lets d.5's count be read per cause
   instead of only per person. **Decided on Edward's behalf and flagged:** it is the one input in
   this ADR that could be dropped without losing the mechanism, and it is here because the enum and
   the column already exist and a free-text reason cannot be counted.

5. **The record is `sla_events`, which gains `sub_task_id`, and a request has no row of its own.**
   The column is added with an index, `chk_sla_events_has_subject` is widened to accept it, and every
   task event also carries `deliverable_id` (every task has one — ADR-0035). Three event types are
   added to the check: **`extension_requested`** (payload: `from`, `to`, `reason`, `attributed_to` on
   the row itself), **`extension_approved`** and **`extension_refused`** (payload: `request_id` — the
   id of the request row — `from`, `to`, and an optional note). A request is **pending** while no
   later decision names it and its task is not `done` or `cancelled`; that is a query over one indexed
   column, exposed as a `security invoker` view, not a status anybody updates. **One pending request
   per task**: a new request while one is pending supersedes it, recorded as `extension_withdrawn` by
   the requester and then the new request — nothing is edited. The requester may withdraw the same
   way. Approved extensions are **counted per task, per person, per department and per attribution** —
   ADR-0075 d.8's counter, with a cause attached.

   The insert policy on `sla_events` requires `actor_user_id = auth.uid()`; every row here is written
   by a signed-in person acting, so nothing needs a system actor.

6. **Approval moves `committed_due_at` to the requested date, and nothing else.** The plan —
   `starts_at`, `due_at`, the bookings — is not touched: it moves by the ordinary drag or dialog, by
   the people who hold that authority, and in the ordinary case it has already moved, because a
   deadline is usually known to be missed at the moment somebody drags the work. The extension is the
   act that makes the plan and the commitment agree; ADR-0039's rule that bookings are the plan is
   untouched. Refusal changes nothing on the task. The original commitment is not lost: it is in the
   `from` of the approval row, and in the `committed_*` history that d.5's count is built on.

   **Automatically re-spreading the work to the new date was weighed and rejected.** It would flatten
   a hand arrangement (`schedule_overridden`) from a screen that never showed the calendar, and the
   people who can approve an extension are not always the people who may book the assignee's
   calendar (ADR-0040). The approval notification (d.9) says the plan still ends where it ends.

7. **The deliverable's due date does not move.** ADR-0075 d.2 stands: a task never moves the promise.
   What an extension does is show the arithmetic — to the requester when asking and to the approver
   when answering — in ADR-0075 d.9's shape: how many working days the new date leaves before the
   deliverable's approval deadline less its department's review buffer, and therefore whether the
   deliverable is **still fine**, **tight**, or **at risk**. The approver may approve any of them:
   warn, never block, and the account manager is precisely the person who then renegotiates with the
   client. **Only a date after the campaign's go-live is refused**, on the reasoning d.9 gives for a
   deliverable date — it is a typing mistake, not a tight deadline. Changing `deliverables.due_at`
   is a separate, deliberate act — d.7a.

7a. **The deliverable's due date moves ONLY when the client has agreed, and the agreement is
   evidenced.** Edward, 11 Sep: *"the ability to change the deadline when approved by the client (via
   the AM for now.. this should require evidence to be attached)."* This is the one route by which the
   promise to the client changes, and it is the mirror of ADR-0066: the promise was made on evidence
   of what the client asked, so it is changed on evidence of what the client agreed. The account
   manager records it — a new `deliverables.due_at`, and an attachment that is the client's agreement
   (a screenshot, an email, filed through the ordinary asset path into the campaign's References, as
   the receipt is). **No attachment, no change**: the screen refuses to save without one, and the
   database refuses a `due_at` change on a live deliverable that does not arrive through this RPC
   (the same column-fence shape as d.11). No further approval — *"via the AM for now"* — the AM is
   the person the client agreed with. Recorded to `sla_events` as `deadline_changed` on the
   deliverable, `attributed_to = 'client'`, with the asset id in the payload, so ADR-0075's
   arithmetic reads the new promise and the old one stays on the log. A task extension (d.1–d.6) and
   a client-agreed deliverable change are therefore two different acts by two different rules, and
   neither one implies the other: the AM may do both, but has to do both.

8. **Work continues. Pending is not a status.** The task enters no state; Start, Submit and review are
   unaffected; a task's row *says* "extension requested to 18 Sep, awaiting <name>" the way ADR-0075
   d.4's feed says *waiting*. **A pending request changes no number**: at-risk and breach are measured
   against the current commitment until the answer comes, because if asking suppressed the warning,
   asking would become the way to silence the feed — ADR-0075 d.8's anti-gaming argument, applied to
   the request. A request on a task that becomes `done` or `cancelled` stops being pending by
   definition (d.5) and needs no write.

9. **Three notification types, each told to exactly the people it concerns, and the actor never told
   about their own act.** `extension_requested` goes to the resolved approver of d.3 only — the
   account manager, or `assigned_by` where none resolves — and **not** to the failsafe roles, for
   ADR-0070 d.6's reason: they can answer anything and would otherwise receive every request in the
   agency. `extension_approved` and `extension_refused` go to the requester and the assignee,
   de-duplicated. All three email: a decision about somebody's deadline is the high-signal slow lane
   ADR-0028 was kept for. **The type list, the `notify-email` `COPY` map, the EN/AR
   `notifications.type.*` keys and `src/test/notification-copy.test.ts` change in the same change
   set** — the constraint's own comment records that being missed six times. Because d.6 moves no
   booking, `rescheduled` does not fire on approval; it fires later, as today, when somebody drags.

10. **Where it lives.** On **My Work**, the assignee's row carries the ask and, once asked, the
    pending line and then the answer. On the task dialog on **/deliverables** and on the schedule's
    **`EditBookingDialog`**, the ask sits beside the date — and **when a reschedule moves `due_at`
    past `committed_due_at`, the dialog offers to raise the request in the same save.** Offers, never
    forces: ADR-0075 d.8 keeps the move free, and this is what turns the ordinary drag into the
    ordinary way a request gets made. On the **campaign page**, against the deliverable, the pending
    request with its arithmetic. On the **dashboard**, a panel on `BriefsAwaitingApproval`'s shape
    (ADR-0070 d.7): the requests the viewer can answer, resolved by the same primitive — the account
    manager sees theirs; Traffic sees everyone's, presented as standing in. Approve and refuse live
    there and on the campaign page.

11. **The side doors close, in the database.** A trigger in the shape of
    `app.tg_sub_task_completion_guard` — polices one thing, escapes on `app.system_op` — refuses a
    write to `starts_at`, `due_at`, `committed_starts_at`, `committed_due_at` or `committed_hours`
    from the assignee's own-row branch, and refuses any write to the `committed_*` columns that is not
    the assignment stamp or the approval RPC. Without this, "formal" is a screen: `save_sub_task` and
    a bare PostgREST update would remain an informal extension that asks nobody and records nothing.
    The assignee keeps everything the branch was written for — progressing the task.

12. **This is built on ADR-0075's migration and cannot be built before it.** `committed_due_at` is
    what an extension extends. That migration is unwritten and has no tracker ID of its own
    (`AGENTS.md` §8 — it needs one, raised with this ADR), and **it must backfill `committed_*` from
    the current dates of every task already assigned**, or every live task has nothing to extend.
    Stated as this ADR's assumption rather than decided for that one.

## Consequences

**Easier.** A maker who cannot make a date has something to press, and pressing it reaches the person
who can change the date and the record that says it changed. A breach that was renegotiated stops
looking identical to one that was not — the exception feed can say *extended twice, both charged to
the client* instead of *late*. `sla_events` finally carries a task, which is what ADR-0075 d.3's
`deadline_changed` needed anyway. And the AM learns about a slipping task from the task, at the time,
rather than from the client afterwards.

**Harder.** A second inbox item for account managers, on every task somebody asks about, and if it is
ignored the request sits — there is no clock on the answer (see *Not decided*). Two dates on one task
have to be read correctly on every surface: the plan and the commitment, and d.6 lets them disagree on
purpose. d.11 refuses a write that has always succeeded, so any script or test that moved a task's
dates as its assignee will start failing, which is the point and is why it gets the pgTAP first. And
d.4 adds a required field to an act people will want to do quickly; if the attribution proves to be
answered at random, it should be dropped rather than made optional, because a field nobody thinks
about is worse than none.

**Cost.** One migration: the `sla_events` column, index and widened check; the four event types; two
RPCs (`public.sub_task_extension_request`, `public.sub_task_extension_decide`) on the gates of d.2 and
d.3; the pending view; the fence trigger of d.11; the three notification types. `notify-email` copy
and EN/AR strings. Surfaces: My Work, the two task dialogs, the campaign page, one dashboard panel.
No dependency, no service, no money.

**Testing.** pgTAP: the assignee may request on their own task and nobody else's; a department lead
may request and may not decide; the account manager decides on their own campaign's task and not on
another's; Traffic decides on any; an ad-hoc task's request resolves to `assigned_by`; a second
request supersedes the first and both rows survive; approval moves `committed_due_at` and leaves
`due_at`, the bookings and `deliverables.due_at` untouched; refusal moves nothing; a done task's
request is not pending; the assignee cannot write `due_at` or any `committed_*` column; every path
writes its `sla_events` row with the actor, and none can be updated or deleted. Unit: the arithmetic
of d.7 classifies fine / tight / at risk against a department buffer and refuses only past go-live;
`notification-copy.test.ts` holds the three new types. E2E: the assignee's ask from My Work reaches
the account manager's panel and the answer reaches the assignee's row.

**Locked in.** That the commitment changes by request and answer, and by nothing else. That a request
is a record, not a status — nothing on the task changes until somebody says yes. That the approver is
computed from scope, exactly as the campaign's is, and that the failsafe is a capability rather than a
recipient. And that `sla_events` is anchored to tasks, so anything later that measures a task reads
one log.

## Not decided here

Extending a **deliverable's** due date — the promise still changes by the account manager editing it,
as ADR-0075 d.2 says, and the fact that `deliverables_tenant_write` lets any `project_tasks:manage`
holder in the tenant do the same is a defect for the tracker, not a decision for this ADR. **A clock
on the answer** — a request the account manager ignores is chased by nobody; that is ADR-0045's
`stall-sweep`, still unbuilt (`I14.7`), and the right home. **Extending several tasks at once** — the
30-post calendar case belongs with `I39`. Whether the count of extensions per person ever feeds a
scorecard — OD 6/7, and ADR-0075 deliberately left measuring and scoring apart.

## Addendum — 11 Sep, from the independent reviews

**`sla_hours` is fenced with the dates.** d.11 named `starts_at` and `due_at`; the review showed
the assignee could still write `sla_hours` — by bare update and through `save_sub_task` — and it is
the numerator of ADR-0075 d.4's at-risk arithmetic: the maker could silence "at risk" on their own
row by shrinking the estimate. Same door, same shape; the fence covers it (`20260911121000`).
**Edward may reverse this**: if a maker re-estimating their own work is wanted, it needs its own
route, not the side door.

**A commitment survives an unassignment.** The ADR-0075 migration cleared `committed_*` on
unassign and stamped afresh on the next assignment, so unassign → move the plan → reassign the same
person was a working extension with no request. The commitment is now stamped once and moves only
by an approved extension (d.1, "by nothing else").

**The deadline record is written by the system.** `sla_events_tenant_insert` accepts any actor and
any payload, and d.5 derives "pending" from the log — so a team member could write an
`extension_requested` on somebody else's task past every check in d.4/d.7, or an
`extension_approved` that made a real request vanish. The six deadline event types are now accepted
only from the two log triggers and the four RPCs here (`20260911130600`).

**Supersession is a tie the reader has to break.** A second request writes the first's withdrawal
and itself in one transaction, at one `created_at`; the row readers now rank the request above the
withdrawal on that tie, or the task read "withdrawn" while a request was pending.

**Row locks.** `sub_task_extension_request`, `_withdraw` and `_decide` lock the task, so two
concurrent requests cannot both become pending and a decide cannot race a withdraw.
