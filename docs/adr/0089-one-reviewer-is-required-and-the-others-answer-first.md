# ADR-0089: One reviewer is required, and the others answer before they approve

- **Status:** accepted (Edward, 11 Sep)
- **Date:** 2026-09-11
- **Open Decision:** none — raised from the pilot, not from §11
- **Amends:** ADR-0043 d.4, d.5 and d.7 (the required-reviewer rule, the completion arithmetic, and
  who is told). Leaves ADR-0038 (tasks are approved, deliverables are signed off) and ADR-0059 (the
  review mode) untouched.
- **Task(s):** I47

## Context

Edward, 11 Sep, two instructions in one message. The first carries a defect report:

> *"one mandatory reviewer must be appointed.. currently this is not enforced as when a reviewer is
> assigned it is not in the system yet.. so when a task is scheduled the reviewer is appointed and
> the checkbox does not appear for mandatory. The task needs to be reopened to tick mandatory.. this
> two step process is ridiculous and what is happening review notifications are not being sent out
> as the mandatory reviewer is not assigned.. this has to become a single step."*

The second is a rule about how a review runs:

> *"the optional reviewers need to be notified of the review.... optional reviewers still need to
> either provide feedback or indicate no comment prior to the mandatory reviewer approving. This way
> all feedback is collected in a single run.. instead of multiple separate comments."*

The report was verified against the code rather than taken as read, and its stated cause is half
right. What follows is what is actually there.

**The two-step is real, and it lives on the ad-hoc path.** `BookingDialog.tsx` appoints reviewers
two different ways. The Project branch (`:478–489`) uses the shared `ReviewerPicker`, which has a
*required* checkbox per person. The ad-hoc branch (`:520–533`) is a single `<select>` bound to
`reviewerId` (`:98`) with **no mandatory option at all** — it was written for ADR-0035, when a task
had one reviewer and "mandatory" did not exist, and ADR-0043 never reached it. That branch calls
`public.create_adhoc_deliverable` (latest `20260829090000:105`), which inserts the appointment
without naming `is_mandatory` (`:185–188`), so the column takes its default of `false`. The only
place the checkbox then exists is `EditBookingDialog.tsx:381` — the reopen. **That is Edward's
second step**, and it is the ordinary path: 131 of this tenant's deliverables are ad-hoc (ADR-0080,
ADR-0082). The seed trigger `app.tg_subtask_seed_reviewer` (`20260827100000:325`) does the same for
a task inheriting its deliverable's reviewer: *"one non-mandatory appointment"*, by its own comment.

**"Review notifications are not being sent out as the mandatory reviewer is not assigned" is not
the mechanism.** `app.tg_subtask_notify_reviewer` (`20260827100000:701–717`) fires when a task
enters `review` and writes `review_requested` to **every** row in `sub_task_reviewers` for that
task, the actor excepted. It does not read `is_mandatory`; a reviewer appointed before submit is
told whether or not they are required, and `notify-email` carries copy for `review_requested` in
both languages (`supabase/functions/notify-email/index.ts:63, :95`). Two things ARE true, and
either would look like "the review never reached me":

1. **A reviewer appointed after submit is never told.** The trigger fires on the status change into
   `review` and on nothing else (`:705`: `if new.status <> 'review' or new.status is not distinct
   from old.status then return`). `update_task_assignment` (`20260830150000:378–399`) inserts the
   new appointment and changes no status. So the exact sequence Edward describes — create with one
   reviewer, the work is submitted, reopen the task to tick *required* and add a second name — puts
   somebody on a task in review with no notification, ever.

2. **With nobody marked required, the first approval finishes the task**, and every other reviewer
   loses it. `app.maybe_complete_sub_task` (latest `20260908150000:201–209`) completes on any
   approval when no row is mandatory — ADR-0043 d.5's pool rule, which the ad-hoc path reaches by
   default because of the point above. The task leaves `review`, `useAwaitingMyReview`
   (`deliverables-api.ts:996`) starts from `status = 'review'` so the second reviewer's inbox row
   vanishes, and no further notification goes to anyone. From the second reviewer's chair, the
   review disappeared before they could comment. **This is the behaviour Edward's second instruction
   is written against**, whether or not it is what he saw as a missing notification.

**Measured.** The local stack (ADR-0081) holds 27 tasks and **zero** `sub_task_reviewers` rows —
the synthetic tenant appoints nobody — so the count of live tasks with reviewers but no required
one cannot be taken here. a one-off production diagnostic query (not included) §3 and §6 measure exactly
that tenant-wide on the live database and should be run before the migration lands; d.11 is
written as a general condition so the number does not matter.

**What the system already believes, and is not applying.** `update_task_assignment:402–405` picks a
*lead* reviewer for `deliverables.reviewer_id` by `is_mandatory desc, created_at` — the earliest
appointed stands in when nobody is marked. `WaitingOn` names the mandatory reviewers on tracking
surfaces because, Edward, 8 Sep, *"they are the only ones that block the work"* (`I40.22`). And
ADR-0043's own Consequences worried that *"a task can now stall on one person"* and promised
*"remove the mandatory reviewer"* as the escape hatch. The rules below keep every one of those
sentences true.

### Options weighed for the required reviewer

- **A — enforce it in the pickers only.** Rejected: a screen rule is a rule about a screen. The
  ad-hoc dialog is the proof — the rule existed in one picker and not the other, and the database
  accepted both. ADR-0055 and ADR-0068: the guard is the front door.
- **B — refuse at commit whenever no reviewer is marked.** Nearly right, and rejected for the
  single-reviewer case: it would break `create_adhoc_deliverable`, the seed trigger and every test
  fixture that appoints one person without a flag, and it would refuse the one case that has only
  one possible answer. If one person is appointed, that person is the required one; the database
  can say so rather than ask.
- **C — a lone reviewer is required by definition; several with none marked are refused (chosen).**
  Deterministic where the answer is determined, refused where it would be a guess.

### Options weighed for "answer before approving"

- **D — reuse `approved_at` on optional rows to mean "I've looked".** No schema change. Rejected:
  it makes "no comment" and "approved" the same word on the record, and ADR-0043 already spent a
  paragraph keeping those apart. It also cannot say *whether* feedback was given.
- **E — infer the answer from `review_feedback`.** Derive, don't ask (AGENTS.md §5). Half right:
  the system can tell that a comment *exists*, not that the reviewer is *finished* — stamping on
  the first comment would tell the required reviewer "all feedback is in" while somebody is still
  writing. So the kind of answer is derived and the moment of it is asked (d.5).
- **F — block the required reviewer until every optional one has answered (chosen — by Edward).**
  The reading closest to his words. The draft rejected it — an optional reviewer on leave would
  hold finished work for a fortnight, the stall ADR-0043 feared — and proposed warn-and-record
  instead, with an *Approve anyway*. Put to Edward as the crux, and he chose the hard wait, 11 Sep.
  The stall is answered not by an override but by **removal**: whoever manages the task may remove
  an optional reviewer who is not answering, visibly, on the appointment record (d.7). The
  difference is who decides — a named person removing a named reviewer, rather than a button that
  skips the collection the rule exists for.

## Decision

1. **Every assigned, live task with reviewers has at least one REQUIRED reviewer.** Enforced where
   ADR-0043 d.4's rule already is — `app.tg_sub_task_reviewer_required`, the deferred constraint
   trigger that refuses ending a transaction with an assigned reviewer-less task — and nowhere
   else. The trigger gains `insert` on `sub_task_reviewers`, because under this rule an insert can
   be the violating event (two unmarked people onto a task that had none) where before it could
   only make things better. Same scope as d.4: assigned, and not `cancelled`.

2. **One reviewer is the required one.** When the transaction ends with exactly one reviewer on an
   assigned task and that row is not marked, the trigger marks it rather than refusing. This is what
   makes "one step" a property of the record and not of any screen: `create_adhoc_deliverable` and
   `tg_subtask_seed_reviewer` are also changed to write `is_mandatory = true` so the intent is
   visible at the call site, but a path that forgets — a migration, a future door — ends up right
   anyway.

3. **Several reviewers with none marked are refused at commit** (`23514`, *"one of these reviewers
   must be marked required"*). The system may not choose among people. The pickers make this
   unreachable from a screen: `ReviewerPicker` marks the first person added as required when nobody
   is, and will not untick the last required one — to move the mark from A to B, tick B, then A
   becomes untickable and can be unticked. The message is the safety net, not the experience.

4. **ADR-0043 d.5's pool rule is retired.** *"If no reviewer is marked mandatory, the first
   approval completes it"* describes a state d.1 makes unreachable for any task that can be
   submitted — `sub_task_submit` requires the caller to be the assignee (`20260830090000:204`), so a
   task in `review` is an assigned task, so it has a required reviewer. The branch may stay in
   `maybe_complete_sub_task` as a defensive line; the pgTAP assertion that proves it (`056`) is
   replaced by assertions for d.2 and d.3.

5. **An optional reviewer ANSWERS; a required reviewer APPROVES.** New on `sub_task_reviewers`:
   `responded_at timestamptz` and `response text` (`no_comment` | `feedback`),
   both-or-neither, server-written only under the same GUC guard that protects `approved_at`. A new
   RPC `public.sub_task_respond(p_sub_task)` stamps the caller's own optional row: `feedback` if
   they authored at least one `review_feedback` row on this task this round (anchored to its
   version via `media_records.sub_task_id`, or to the task itself for a manual one — ADR-0059
   d.7), otherwise `no_comment`. **One press; the kind is derived, the moment is not.** On the
   review modal the optional reviewer's actions are *Request changes* and *Done — no comment* /
   *Done — feedback left*, the label following whether they have written anything. **Approve is
   withdrawn from optional reviewers.** This amends ADR-0043 d.5's third bullet: an optional
   reviewer's contribution is a response, not an approval, and it is still a real part of the
   record — more so, because it now says what kind it was.

6. **A required reviewer's completing approval waits for every optional answer** — a new gate in
   `app.maybe_complete_sub_task`, after the mandatory check: the task does not complete while any
   optional row has `responded_at` null. Amends ADR-0043 d.5's first bullet, which completes the
   task *"when the last of them does"*: now when the last of them does **and the optional reviewers
   have answered**. Only the *completing* approval is gated; with two required reviewers the first
   records their part whenever they like, since it completes nothing. Requesting changes by anyone
   is a response of the strongest kind and is never gated — it reopens the task and the next round
   re-asks everyone.

7. **The required reviewer CANNOT approve until every optional reviewer has answered — a hard
   wait.** Edward, 11 Sep, choosing this over the draft's warn-and-proceed: *"hard wait."* When the
   caller's approval would be the completing one and any optional row has `responded_at` null,
   `public.sub_task_approve` refuses it, before anything is stamped, with a distinct code the surface
   turns into a message naming exactly who has not answered. There is no *Approve anyway* and no
   `not_awaited` stamp: the record of a completed review says every appointed reviewer was heard, and
   it says it truthfully or the review is not complete. **The escape hatch is removal, not
   override.** Somebody who manages the task may REMOVE an optional reviewer who is not answering —
   the same act ADR-0043 already promised for a stalled mandatory reviewer — and the removal is on
   the appointment record with who did it. So a reviewer on leave can stall a task for exactly as
   long as nobody decides they should not, and the decision is visible. This is the one clause where
   the system's *warn, never block* philosophy (ADR-0075 d.9) does not apply, and Edward chose it
   knowing that: the point of collecting feedback in one run is defeated by a button that skips the
   collection. **Requesting changes is not gated**: a required reviewer may send work back at any
   time, because an assignee getting a real problem earlier is right, and the next round re-asks
   everyone anyway. The surface warns them that answers are still outstanding, so it is a choice.

8. **An answer belongs to a version, like an approval.** `app.tg_subtask_clear_approvals` clears
   `responded_at` and `response` alongside `approved_at` on any status change that is not the
   completion. A "no comment" on a draft says nothing about the next draft.

9. **The required reviewers are told when the last answer is in.** New notification type
   `feedback_collected`, sent by `sub_task_respond` to every required reviewer whose approval is
   still owed when the last outstanding optional row is stamped. Without it the required reviewer
   either polls the task or approves early, and the single run never actually happens. A task with
   no optional reviewer sends none — `review_requested` already said everything. This is the one
   new type, and adding one means three places in the same change set or it is silently in-app
   only: `notifications_type_check`, the `notify-email` COPY map in both languages, and
   `src/test/notification-copy.test.ts` (traps.md, *a hand-written second copy of a list drifts*).

10. **Somebody appointed to a task already in review is told.** A trigger on `sub_task_reviewers`
    insert sends `review_requested` to the new appointee when the task's status is `review`, the
    actor excepted. This closes the first of the two gaps in Context; it is small and it is the
    literal case in Edward's report.

11. **Existing rows are corrected in the same migration**, under `app.system_op`, by condition and
    never by id. For every assigned, non-cancelled task that has reviewers and none marked required:
    with exactly one reviewer, that one is marked (d.2's definition, applied once to history); with
    several, **the earliest appointed** is marked — the convention `update_task_assignment` already
    uses to choose the deliverable's lead reviewer, so the migration invents nothing. Every optional
    row already carrying `approved_at` is stamped `response = 'no_comment', responded_at =
    approved_at`: under the old model that person looked and pressed Approve, and "I looked and had
    nothing to add" is the honest translation. The migration reports what it changed, by task and
    name, as `raise notice`; **nobody is notified by the migration** — those people were already
    appointed and already told on submit, and what changed is the weight of their silence, which is
    a conversation (the shape of `I42.4a`), not a system message. **Flagged**: the multi-reviewer
    case marks a person required who was not chosen for it. The alternative — leaving those tasks
    outside the rule — leaves the pool behaviour alive on exactly the rows that produced this
    report.

12. **`WaitingOn` says which kind of wait it is.** An optional reviewer is outstanding until they
    answer, a required one until they approve, and the marks differ: *(required)* stays as it is;
    *(no answer yet)* is added for an optional reviewer with `responded_at` null. Tracking surfaces
    (`blockingOnly`, `I40.22`) keep naming only the required reviewers — an optional reviewer does
    not block the work under d.7, and Edward's 8 Sep instruction stands. The review modal names
    everyone with their state, because that is where the required reviewer decides whether to wait.
    `approvalCompletesTask` learns d.6 so the Approve button's label stays honest.

13. **The ad-hoc dialog is not rebuilt.** ADR-0082 d.8 retires it; the pilot runs on it until then.
    d.2 makes its single select produce a required reviewer with no change to the screen, and the
    label reads *Reviewer (required)* so the person appointing knows what they are doing. Investing
    a picker in a path with a closing date was weighed and declined. The new intake's assignment
    step (the ADR after ADR-0085, which hands the owner a held task list) inherits d.1–d.3 by
    construction, because they hold on the write path and not on any form.

## Consequences

**Easier.** Appointing a reviewer is one act with one result: the person named is the person whose
approval is required, and nobody has to remember to come back and say so. A review runs as one
round — the optional reviewers' feedback is collected and the required reviewer reads all of it
before deciding — instead of the assignee receiving three separate sets of comments across three
reopenings, which is what Edward is describing. The second gap in Context stops existing: a task can
no longer complete under a second reviewer who never saw it. And a reviewer added late is told,
which today they are not.

**Harder.** Review gains a state — *answered* — and every surface that shows a reviewer's standing
has to know it: `WaitingOn`, `ReviewerNames`, the review modal, the inbox. Two columns, one RPC, one
notification type, one trigger extended and one added, three RPCs re-emitted whole (the house
pattern for `create or replace`, so the `search_path` pin survives), and the `056`/`057` suites
change shape. **The hard wait is the cost that will be felt**: a required reviewer with finished
work in front of them cannot complete it while one optional reviewer is silent, and the only way
through is somebody with authority removing that reviewer — visibly. Edward chose that over an
override, and the choice is the point: the system will be nagged about silent reviewers rather than
quietly working around them, which is what makes `I42.4b`'s chase worth building.
ADR-0043's escape hatch narrows: *"remove the mandatory reviewer"* becomes *"replace the mandatory
reviewer"*, because removing the last required one from a multi-reviewer task now fails d.1 at
commit unless another is marked in the same save — the hatch still exists, it is one tick longer.

**Locked in.** That a required reviewer is a property of every reviewed task, not an option on some
of them. That optional reviewers answer and required reviewers approve — two verbs, two columns,
never one word for both. That an answer, like an approval, belongs to a version. And that the
system collects before it decides, and refuses to decide until it has: a completed review means
every appointed reviewer was heard or was removed by name, never skipped.

**Not decided here.** Chasing an optional reviewer who does not answer — that is reminders, `I42.4b`
/ ADR-0045, and this ADR gives it a second thing to chase without building the runner. Whether an
answer is timed against anything. Whether a task may have *only* optional reviewers under some
future review kind (today: no). `deliverables.reviewer_id` and ADR-0043 d.9 are unchanged. Bulk
appointment (`I39`). Whether the ad-hoc dialog gets the full picker before ADR-0082 ships — d.13
says no, and if the pilot proves otherwise it is one component swap.

**Cost.** One migration, one Edge Function copy addition, four components, EN and AR strings. No
dependency, no service, no money.

## Testing

- **pgTAP, the rule:** appointing ONE unmarked reviewer to an assigned task ends the transaction
  with that reviewer required (d.2); appointing TWO unmarked is refused at commit (d.3), and
  marking one of them makes it pass; removing the only required reviewer from a two-reviewer task is
  refused, and removing them while marking the other in the same transaction is allowed (the
  narrowed escape hatch); an unassigned task with unmarked reviewers is untouched (d.4 scope);
  `create_adhoc_deliverable` writes a required reviewer; the seed trigger writes a required reviewer.
- **pgTAP, the run:** a required reviewer's approval with one optional answer outstanding is refused
  with the named code and stamps nothing; there is no flag that lets it through; after the optional
  reviewer answers, the same approval completes; after the optional reviewer is REMOVED by somebody
  who manages the task, the same approval completes and the removal is on the record;
  `sub_task_respond` writes `feedback` when the caller commented this round and `no_comment` when
  not, on a digital task and on a manual one; a required reviewer calling `sub_task_respond` is
  refused; an optional reviewer calling `sub_task_approve` is refused; the last answer writes
  `feedback_collected` to each required reviewer still owed and to nobody else (`reset role` before
  reading `notifications` — traps.md); requesting changes clears every answer; with two required
  reviewers the first approval is never gated. Appointing somebody to a task in `review` writes
  `review_requested` to them and to nobody else.
- **The backfill is NOT covered by pgTAP**, for the reason ADR-0059 records: it runs before any test
  transaction exists. Its two fences — one reviewer marked, earliest-of-several marked — are
  verified by inspection and by a one-off production diagnostic query (not included) §6 before and after.
- **Unit:** `ReviewerPicker` marks the first appointee required, refuses to untick the last required
  one, and lets the mark move; `WaitingOn` distinguishes *(required)* from *(no answer yet)* and
  says nothing about anyone who has answered or approved; `approvalCompletesTask` returns false
  while an optional answer is outstanding; the review modal offers Approve to a required reviewer
  and Done to an optional one; `notification-copy.test.ts` sees `feedback_collected` in both
  languages.
- **Regression:** every ADR-0043 assertion that does not describe the pool rule passes unmodified,
  and `scripts/db/race-test-reviewers.sh` (two required reviewers approving at once) still passes —
  d.6 is one more predicate under the same `for update`.

## Addendum — 11 Sep, from the independent review

**The Consequences and Testing sections above say removing the only required reviewer from a
TWO-reviewer task is refused. d.2 says otherwise, and d.2 is the decision.** Removing one of two
leaves one, and a lone reviewer is the required one at commit — the trigger marks them, test 097
asserts it. The refusal applies from THREE or more, where two unmarked people would be left and
the system may not choose between them. The prose is left as written; this note corrects it.

**The wait is held by Postgres, not only by the RPC.** `app.tg_sub_task_completion_guard` (ADR-0043
d.5) is the copy of the completion rule that a direct `status = 'done'` write on
`sub_tasks_manage_update` meets, and the first build had gated only `maybe_complete_sub_task`,
`sub_task_approve` and `sub_task_respond`. The review found the route — first required reviewer
approves, the other is demoted or removed, the assignee or a scoped manager writes `done` by hand —
and the guard now carries the same d.6 predicate. Test 097 asserts the refusal, and asserts that
`responded_at`/`response` reset on a client write (d.5), which the build had not tested.

**d.13's ad-hoc dialog no longer exists in the integrated tree.** ADR-0082 retired ad-hoc
assignment from `/schedule`; `create_adhoc_deliverable` keeps its required-reviewer write for the
seed and for any remaining caller, but the single-select screen d.13 describes is gone.

## Addendum — 15 Sep, a send-back waits for the answers too

**Tracker:** I48.37. **Accepted** (Edward, 15 Sep).

**What changed.** d.6 gated only the completing approval and said *"requesting changes by anyone
is a response of the strongest kind and is never gated — it reopens the task and the next round
re-asks everyone."* Reviewing guide 8 against the product, Edward saw the asymmetry and reversed it:

> *"This is a mistake on my part. Both feedback and approval should be blocked. It is far more
> efficient to have one consolidated round of feedback rather than multiple different rounds from
> individuals."*

The point of appointing several reviewers is that the maker hears from all of them once, on one
version — not one send-back per reviewer, each restarting the round before the next has looked.

**Decision.**

- **d.14 — A send-back waits for every optional answer, exactly as the completing approval does.**
  `app.sub_task_request_changes` refuses with `55089`, naming who has not answered, while any
  optional reviewer *other than the caller* has `responded_at` null. The caller's own press is
  their answer: an optional reviewer sending the work back has spoken. Required reviewers approve
  rather than answer, so a second required reviewer's outstanding approval does not hold a
  send-back — only optional answers do.
- **d.15 — The way through is unchanged: removal, not override** (d.7). No "send back anyway".
- **d.16 — The screen says so before the press.** `ReviewActions` disables *Request changes* on
  the same condition and shows the same *"You can … once every reviewer has answered"* line for
  both buttons; the message names who is outstanding.

**Consequences.** One round per version: every appointed reviewer looks at the same file before
anything goes back. An optional reviewer on leave now holds a send-back as well as an approval —
the stall d.7 already answers with removal. pgTAP 097's send-back assertion stands unedited (its
optional reviewer had answered); 117 proves the new refusal and that an optional reviewer's own
send-back is not held by their own missing answer.
