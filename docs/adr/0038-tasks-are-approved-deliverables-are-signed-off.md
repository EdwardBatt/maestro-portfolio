# ADR-0038: Tasks are approved; deliverables are signed off

- **Status:** accepted
- **Date:** 2026-08-24
- **Open Decision:** — (closes a gap in the ADR-0030 execution model)
- **Task(s):** I12.1–I12.4 (new); amends ADR-0024, ADR-0030, ADR-0035

## Context

**A task can never finish.** Every path in the database that writes `sub_tasks.status` was
enumerated: `sub_task_start` (→ `in_progress`), `sub_task_submit` (→ `review`),
`sub_task_request_changes` (→ `todo`, revision + 1), the dependency unblock (→ `in_progress`), and
the two alpha-era variants of the same. **None of them produces `done`.** The status exists in the
check constraint and nothing reaches it.

The only approval in the system is on the **deliverable**. The reviewer's "Awaiting my review" inbox
lists submitted *sub-tasks*, but its Approve button calls `useTransitionDeliverable(… to: 'approved')`
— it approves the parent container and never touches the task that was submitted. A maker's task sits
in `review` permanently.

Consequences visible in the code today, all of them workarounds for this hole:

- the Completed panel must test `status === 'done' OR deliverableState === 'approved'`, because the
  first half never becomes true on its own;
- excluding `done` from the assigned-work query was harmless for months — nothing was ever `done`;
- approving one deliverable silently absorbs every task inside it, individually unreviewed;
- the reviewer inbox had to be filtered on `deliverables.state = 'in_review'` to be meaningful, which
  broke campaign work outright: only *ad-hoc* deliverables are advanced to `in_review` (client-side,
  best-effort, in `MyWorkPanel`), so a submitted campaign task reaches no one.

The deliverable gate (`20260819150000`) already refuses `in_review`/`approved` while any sub-task is
`todo`/`in_progress`/`blocked` — but *submitted* satisfies it. A deliverable can therefore be approved
while every task inside it is merely submitted and unread.

**What this costs the business, not just the code:** there is no answer to "who finished this, and
when?". No completion timestamp, no signer, no per-person record. That is precisely the
end-to-end accountability the product exists to provide.

**A label promising authority that no longer exists.** The reviewer picker's default option reads
*"Any reviewer (role-based)"* and stores NULL. That description was accurate under TMP.2, when any
`reviews:moderate` holder could act on any deliverable. TMP.2 was reverted on 23 Aug (L6.5), and
`useAwaitingMyReview` filters on `deliverables.reviewer_id = auth.uid()` — so a NULL reviewer now
means the task reaches **no inbox at all**. Three deliverables carry it (measured below), and the
modal reports "Reviewer: Any reviewer (role-based)" against each, in both the read-only summary and
the dropdown. The screen states a policy is in force; the policy was removed four days earlier and
the field is simply empty. This is the concrete case that prompted the ADR: the option must not
exist, because a reviewer who is nobody is indistinguishable, on screen, from a reviewer who is
someone.

Edward's model, stated plainly: *we approve tasks, not deliverables; a deliverable cannot be approved
before all its tasks are complete; an approved task is complete and stops being work.*

### Options weighed

- **A — keep deliverable-only approval, auto-advance the deliverable to `in_review` when the last
  task is submitted.** Was the author's first proposal. Rejected: it preserves the real defect
  (work approved in bulk, nobody reviewed individually), yields no per-task record, and keeps the
  campaign/ad-hoc divergence alive. It builds machinery to serve a model nobody wants.
- **B — task approval, with the deliverable auto-approving once its last task is approved.**
  Rejected by Edward: the final sign-off is a deliberate human act, not a side effect.
- **C — task approval, deliverable sign-off separate (chosen).** One review path for campaign and
  ad-hoc alike; the deliverable's state stops being a precondition for a reviewer to act.
- **D — leave the reviewer on the deliverable only.** Rejected: a task may not be assigned without a
  reviewer (decision 2), and a multi-task deliverable can legitimately need different reviewers per
  discipline — a copy lead for the copy, an art director for the artwork.

## Decision

1. **Task approval exists.** `public.sub_task_approve(p_sub_task uuid)` moves a task
   `review → done`, `SECURITY DEFINER`, `search_path` pinned (ADR-0033). It is the mirror of
   `sub_task_request_changes`, which already implements the opposite outcome from the same state.
   Any other source state raises `22023`.
2. **Every task carries its own reviewer.** `sub_tasks.reviewer_id` (FK `user_profiles`), seeded from
   the parent deliverable's `reviewer_id` when a task is created there, and **required from the
   moment a task is assigned** — a task may not be assigned to someone without a reviewer appointed.
   The no-self-review guard (permanent, ADR-0035) applies: reviewer ≠ assignee. The reviewer must hold
   `reviews:moderate`, checked with `app.user_holds_permission` so an overlay grant qualifies (L6.7).
3. **Only that reviewer approves that task** — the task's `reviewer_id`, not the deliverable's owner
   and not any moderator at large. Authority is checked in the database, not the browser.
4. **Approving a task stamps who and when.** `approved_by` + `approved_at` on `sub_tasks`, written by
   the RPC, never client-writable. This is the record that makes "who finished this?" answerable.
5. **The deliverable gate tightens** from *every sub-task submitted* to *every sub-task `done`*.
   Approving a deliverable therefore becomes impossible until every task inside it has been reviewed
   and approved individually.
6. **Deliverable sign-off stays a separate, human act**, performed by the deliverable's **account
   manager** (`app.deliverable_account_manager`) **or a `reviews:moderate` holder** — "the appointed
   account manager or higher". It is never automatic, even when the last task is approved.
7. **The reviewer's inbox lists submitted tasks, full stop.** The `deliverables.state = 'in_review'`
   filter is removed; the deliverable's state is no longer a precondition for reviewing a task.
   Campaign and ad-hoc work follow one identical path, and the client-side "advance the ad-hoc
   deliverable to in_review" hack in `MyWorkPanel` is deleted with it.
8. **An approved task stops being work.** It leaves the open counts and the working lists, and
   appears only under Completed.

**Backfill — small, because campaign work has not started.** `reviewer_id` is written in exactly two
places: `create_adhoc_deliverable` (where it is `default null` — the picker offers "Any reviewer",
which stores nothing) and `update_task_assignment`. Nothing else has ever set it, and
`20260820060000` records the consequence: *"Deliverables with reviewer_id = NULL (every campaign
deliverable)"*.

As of 2026-08-24 **there are no campaign deliverables or campaign tasks in the tenant** (Edward,
confirmed). Measured with `scripts/db/list-task-reviewers.sql` on the same day, across 30 open tasks:

| | count |
| --- | --- |
| standalone tasks with no deliverable to inherit from | **0** |
| deliverables with no reviewer named ("Any reviewer") | **3** |
| reviewers named who cannot moderate reviews | **0** |
| tasks that satisfy the constraint as-is | **27** |

The alpha-era risk did not materialise: while the reviewer picker was open to every internal user
(TMP.2, 20–23 Aug) nobody named a reviewer who lacks `reviews:moderate`, so no task is stuck with a
reviewer who cannot act. Three deliverables need a reviewer appointed and the remaining 27 are already
compliant. That is a clean-up of three rows, not a migration of live work, and it lets the rule be
enforced at full strength:

- `sub_tasks.reviewer_id` is **`NOT NULL`** — a column constraint, not a trigger. The database
  refuses a task without a reviewer; there is no code path, present or future, that can route around
  it. A trigger would have been the concession to historical data, and that concession is not needed.
- The migration copies the parent deliverable's reviewer where one exists. Any remaining alpha rows
  are resolved **before** the constraint is applied — either a reviewer is named or the test row is
  deleted. The migration fails loudly rather than defaulting a name onto someone who never agreed to
  review that work.

**Prerequisite, not a follow-up:** the sub-task add form on the Deliverables page has an SLA-profile
picker and no reviewer field, and the ad-hoc picker still offers "Any reviewer" (which stores
nothing). Both must change in the same release — a reviewer picker restricted to `reviews:moderate`
holders, and no null option — or campaign work cannot be assigned at all once the constraint is on.
Since campaign work has not started, this is a gate on beginning it rather than a disruption to it.

No licensing or cost dimension.

## Consequences

**Easier.** "Who finished this, and when?" becomes a query. Every piece of work carries a named
reviewer before anyone starts it. Campaign and ad-hoc work run one review loop, so the divergence
that produced the current bug cannot recur. The lifecycle logic moves out of the browser and into the
database, which is where ADR-0024 says it belongs — the current ad-hoc advance is a best-effort
client call that fails silently.

**Harder.** A migration touching a hot table, plus a real data-quality problem surfaced rather than
hidden: work that has no reviewer today must acquire one. Assignment gains a required field, so every
assign path — the schedule dialog, the deliverables breakdown, the ad-hoc RPC — must supply it, and
assigning becomes marginally more effortful. A deliverable can no longer be waved through: if one task
of eight is unreviewed, sign-off waits. That is the intent, and it will be felt as friction the first
time someone is in a hurry.

**Locked in.** Approval is per person and per task. Anything that wants to approve work in bulk must
approve each task, by its own reviewer, first. The deliverable becomes a rollup of decisions already
made rather than a place where a decision is made for the first time.

**Supersedes in part.** ADR-0035 put the reviewer on the deliverable; that remains true for the
deliverable itself, but the task's reviewer is now the authority for reviewing the task. ADR-0030's
execution lifecycle gains its missing terminal transition.
