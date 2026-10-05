# ADR-0035: Ad-hoc assigned work is a reviewable deliverable, with an assigner-chosen reviewer

- **Status:** accepted
- **Date:** 2026-08-20
- **Relates to:** ADR-0034 (standalone ad-hoc tasks — superseded for review-needing work), ADR-0025/I3 (deliverable review: media_records + review_feedback + ReviewPanel), ADR-0024 (deliverable lifecycle + `reviews:moderate` sign-off), ADR-0029/I7.1 (internal clients/jobs).
- **Task(s):** `docs/TASKS.md` — I11. Migration `20260820010000` is increment 1 (backend).

## Context

I10 (ADR-0034) made ad-hoc scheduler assignments *actionable* tasks: assign → Start → Submit, with time tracking and a place in "Assigned to me". Live testing then exposed the back half: on Submit there was **nowhere to upload the output and nobody routed to review it**. Edward's decision: ad-hoc work should get **full deliverable-style review** (version uploads, pinned/timecoded feedback, sign-off), and **the assigner picks the reviewer at assignment**.

The review machinery is entirely **deliverable-scoped**: `media_records.deliverable_id` is NOT NULL, `review_feedback`, the `ReviewPanel`, the `in_review → approved` sign-off and the `reviews:moderate` reviewer all hang off a deliverable — and a deliverable must have a parent (`CHECK stream_id IS NOT NULL OR job_id IS NOT NULL`). So full review is **impossible on a deliverable-less standalone task**: to be reviewable, the ad-hoc task must *be* a deliverable.

## Decision

**An ad-hoc scheduler assignment (on a person) creates a lightweight deliverable + its sub-task, filed under a tenant-level "Ad-hoc" internal job — reusing the internal-projects mechanism (ADR-0029).** It then inherits the whole pipeline unchanged: Start/Submit + time tracking (already shipped) **plus** version upload, anchored feedback, and sign-off via the existing `ReviewPanel`/deliverable lifecycle. This **supersedes the standalone-sub-task path (ADR-0034)** for review-needing ad-hoc work; `sub_tasks.deliverable_id` stays nullable (harmless), but ad-hoc tasks now carry a real deliverable.

**The assigner picks the reviewer** — new nullable `deliverables.reviewer_id` (→ `user_profiles`). Null = role-based review (any `reviews:moderate` holder), exactly as campaign deliverables behave today; set = that specific person is the designated reviewer. The picker offers only `reviews:moderate` holders (they must be able to sign off). When the assignee submits their sub-task (`status → review`), a trigger notifies `reviewer_id` (`review_requested`), and the reviewer works it through the normal `ReviewPanel` on `/deliverables`.

## Increments

- **I11.1 (backend, migration `20260820010000`):** `deliverables.reviewer_id`; `public.create_adhoc_deliverable(assignee, title, hours, starts_at, due_at, reviewer)` RPC (SECURITY DEFINER, gated `project_tasks:manage` + `in_write_scope` over the assignee; get-or-creates the tenant "Ad-hoc" internal job; creates the deliverable + sub-task); `tg_subtask_notify_reviewer` trigger (sub-task → review notifies the deliverable's `reviewer_id`). pgTAP.
- **I11.2 (frontend):** the scheduler Ad-hoc path calls `create_adhoc_deliverable` (with a **Reviewer** picker listing `reviews:moderate` holders) instead of the standalone-task insert, then `subtask-schedule` materialises the booking. The task deep-links into `/deliverables` (full ReviewPanel) from My Work.
- **I11.3 (frontend):** the assignee submits **from My Work** — the Submit button opens an inline modal that uploads the deliverable version(s) (reusing `useUploadVersion` → `review-media` presigned PUT → `media_records`) and submits for review in one step, no trip to the campaign-scoped `/deliverables` page (which a campaign-less ad-hoc deliverable can't reach anyway). On submit, an ad-hoc deliverable (has a deliverable, no campaign) is advanced `in_progress → in_review` best-effort so its reviewer can sign off — the assignee holds `project_tasks:manage`, and the advance never blocks the submit. The reviewer gets an **"Awaiting my review"** inbox on the My Work home (`useAwaitingMyReview`: sub-tasks in `review` whose `deliverables.reviewer_id` is them), each opening the full `ReviewPanel` inline with **Approve** (`in_review → approved`) and **Request changes** (reopen the sub-task). The panel is hidden when nothing is waiting. My Work items with a deliverable but no campaign render as non-link (the modal is their entry point, not the campaign picker). No migration — pure frontend over the I11.1 backend.

- **I11.4 (round-trip):** the maker's side of a change request. `sub_task_request_changes` now reopens
  the sub-task to `todo` (migration `20260820030000`) instead of `in_progress`, so the assignee Starts a
  fresh **timed** round then Submits — the old `in_progress` reopen had no timer and `sub_task_submit`
  refuses an untimed round, so round 2 could never be submitted. On My Work a sent-back task reads
  **"Changes requested"** and reading the feedback is a **separate step from submitting**: a **Review
  feedback** button opens a read + upload modal (the reviewer's numbered pins + comments, and drag-drop
  upload of the revision), then the maker closes it and clicks **Submit for review** — feedback is read
  first, submit is a deliberate second action. Submitting an ad-hoc deliverable re-advances it to
  `in_review` for the reviewer.

## Consequences

Reuses the proven review stack with near-zero new review code — the cost is that an ad-hoc assignment now writes a client/job/deliverable/sub-task rather than a lone row (all fenced internal, invisible on external surfaces). `reviewer_id` is additive and null-safe for every existing deliverable. Booking materialisation, time tracking, and notifications are unchanged.
