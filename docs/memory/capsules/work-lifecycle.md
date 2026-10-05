---
type: capsule
abstract: How work flows from a campaign to signed-off output, and the vocabulary that keeps it straight.
status: current
origin: ai-derived
verified: 2026-09-29
sources: [docs/adr/0024-*, 0030-*, 0034-*, 0035-*, 0038-*, 0043-*, 0058-* (addendum 14 Sep), 0059-* (addendum 15 Sep), 0071-*, 0077-* (addendum 14 Sep), 0080-*, 0088-*, src/features/deliverables/, supabase/migrations/20260824140000_task_approval.sql, supabase/migrations/20260905090000_quantity_multiplies_the_creation_step.sql, supabase/migrations/20260909120000_archiving_a_job_calls_off_the_work_under_it.sql]
---

# Capsule — Work lifecycle

## The vocabulary — get this right or everything reads wrong

- A **campaign** (or internal **job**, ADR-0029) holds **streams** → **deliverables** → **sub-tasks**
  ("tasks"); a task has exactly one assignee.
- **Quantity never splits a deliverable** (ADR-0058 d.9, ADR-0071 d.8). Six reels are ONE deliverable
  whose template marks one step `repeats_per_unit` — the **creation step**, `Create …` — and only it
  becomes six tasks (`sub_tasks.unit_index`). A template marking none means quantity is a **print
  run**, not a count of reviewable things; the template tells the two apart.
- **Tasks are approved. Deliverables are signed off** (ADR-0038) — different verbs, rows and people.

## The flow

1. **Assigned**, which materialises bookings on the assignee's calendar (ADR-0029).
2. The assignee **starts** it (`sub_task_start`, running a timer — ADR-0030), then **submits** it
   (`sub_task_submit`) with a version uploaded for review. **Starting ANY task moves a still-Draft
   container to `in_progress`** with no authority of its own (ADR-0077 addendum d.7, 14 Sep). **A
   task's review round is its own `revision_number + 1`** (`app.task_review_round`, ADR-0058
   addendum d.13): the media stamp, the feedback stamp and the submit gate read it; the
   deliverable's `revision_round` is the container's own and nothing about a task reads it.
3. The task's **appointed reviewers** — not any moderator at large — approve (`sub_task_approve`) or
   request changes (`sub_task_request_changes`, reopening to `todo` for a fresh timed round, clearing
   approvals and answers — ADR-0043 d.6). **Exactly one reviewer is required** (ADR-0089); optional
   ones ANSWER (`sub_task_respond`) and the completing approval is a **hard wait** on every answer
   (55089). Assignment needs the campaign approved and the owner's task list approved, every campaign
   (ADR-0048 d.8, ADR-0100 d.2, ADR-0119; `app.deliverable_work_acceptance_refusal`). Out-of-reach is a
   REQUEST (ADR-0087). OWED: `my_pending_approvals()` (leads too, ADR-0119; no live task = `task_list_undefined`, I66.3).
4. **Sign-off is a CONSEQUENCE of EVERY task done or cancelled** (ADR-0077, ADR-0118) — no button, and
   nobody moves a deliverable by hand but deliver/block/reopen/cancel. A re-opened task goes back
   unassigned (ADR-0121).

## Calling work off (ADR-0080) — the mirror of sign-off, and read them together

Cancelling **one task** (`sub_task_cancel`) touches only that task; archiving the **container**
cancels every task not `done`/`cancelled` (`deliverable_archive_calls_off_work`) and a `done` task
survives as the record. `archived` is terminal (ADR-0024). **Settled, for the queue**, is `done` OR
the container `approved`/`delivered`/`archived` (`isFinished`).

## What Postgres owns, not the app

A live **assigned** task always has at least one reviewer, enforced by `sub_task_reviewers` and a
*deferred* constraint trigger (refusal at COMMIT; pgTAP needs `set constraints all immediate`), so a
task plus its reviewers go in ONE transaction — `public.save_sub_task`. **`done` is not a value you
can write** (`app.tg_sub_task_completion_guard`); **changing the appointments re-asks the completion
question** (`app.tg_sub_task_reviewers_recheck` → `app.maybe_complete_sub_task`). Concurrency proof:
`scripts/db/race-test-reviewers.sh`. **A deliverable closes itself** (ADR-0118 + addendum): all done/cancelled, one approved.

## Ad-hoc work, and review

ADR-0035: ad-hoc work is **a real deliverable** under a per-tenant "Ad-hoc" internal job
(`create_adhoc_deliverable`) with the whole review stack; **ad-hoc is identified by having no
campaign.** Review is ADR-0025: `media_records` versions reached only through `review-media`, which
mints short-TTL presigned B2 URLs — no keys, no bytes through the app. A **manual** task (ADR-0059)
submits on the maker's own note instead; the note may carry a **link** (`review_feedback.link_url`,
addendum d.14) — metadata on the note, never a version. `TaskReviewThread` is that surface.

## Deadlines (ADR-0088) — where each act lives

The **ask** is `ExtensionControl` (My Work, the task row in the deliverable detail). The **answer**
is `ExtensionDecision` on that task row and in `ExtensionRequests` on `/admin`; the AM is also
told on My Work (*Waiting for you*). Guide 9.

## Where to look

- `docs/guides/05-…`, `07-…` to `10-…` — the user-facing walk of this capsule; fix them with the flow.
- `src/features/deliverables/` — `DeliverablesPage`, `ReviewPanel`, `MyWorkPanel`, `PipelinePage`,
  `NeedsYouPanel` (replaced Waiting for you and Awaiting review, 26 Sep, ADR-0105), `TaskPage`, `api/deliverables-api.ts`; `src/features/bookings/MyTasksPage.tsx` +
  `lib/my-work.ts` for the assignee's queue.
- The container's state machine is the TRIGGER `app.tg_deliverable_transition_guard` (latest `20260927180000`), not the Edge Function that calls it.
- **What a task is WAITING for** is declared on the department's own tab after approval, never in
  the wizard — the **Required input** cell writes `sub_task_dependencies`.
- Known gap (I11.4): `deliver_deliverable_version` has no callers — approval files nothing into the Library.

Related: [scheduling-and-capacity](scheduling-and-capacity.md) · [authorization](authorization.md).
