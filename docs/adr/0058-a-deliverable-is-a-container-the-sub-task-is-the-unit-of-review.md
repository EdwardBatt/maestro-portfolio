# ADR-0058: a deliverable is a container; the sub-task is the unit of work and of review

- **Status:** accepted
- **Date:** 2026-08-28
- **Open Decision:** —
- **Depends on:** nothing. **Supersedes ADR-0051 d.11 and d.16, and ADR-0052 d.7.**
- **Task(s):** I25

## Context

Edward has stated this model repeatedly, most plainly on 28 Aug:

> *"When there are multiple tasks under 1 deliverable, the deliverable is never uploaded. It is
> merely approved when all tasks are approved. I keep saying this — the deliverable is basically a
> container."*

and, on internal versus external review:

> *"Internal review — every task gets reviewed. The main deliverable cannot be approved without all
> sub-tasks being either approved or cancelled. External review — if there are six reels, they are
> all reviewed individually and approved or cancelled before the deliverable can be approved. If all
> sub-tasks are approved, then the deliverable by default is approved."*

**Most of this is already built.** What is missing is narrow, and the previous drafts of ADR-0051 and
ADR-0052 worked around it instead of naming it.

### What already works

- **Per-task reviewers and per-task approval** — `sub_task_reviewers`, `public.sub_task_approve`,
  `app.maybe_complete_sub_task` (ADR-0043).
- **A task cannot be submitted with nothing to review** — `app.sub_task_submit`
  (`20260824150000:79`) raises *"attach this round's version before submitting for review"*.
- **A deliverable cannot be approved with work outstanding** — `app.tg_deliverable_transition_guard`
  (`20260824140000:200-213`) refuses `approved` unless every sub-task is `done` or `cancelled`.
- **Derived approval exists** — `app.maybe_complete_sub_task` (`20260827100000:430-446`) already sets
  the deliverable to `approved` when the last sub-task completes.

### The two things that are actually wrong

**1. Derived approval is switched off for campaigns.** The block above is guarded:

```sql
if v_stream is null and v_state = 'in_review'
   and not exists (select 1 from sub_tasks st
                   where st.deliverable_id = v.deliverable_id
                     and st.status not in ('done','cancelled'))
then
  update deliverables set state = 'approved' where id = v.deliverable_id;
```

`v_stream is null` means **ad-hoc only**. A campaign deliverable is excluded, so somebody must drive
the transition by hand even though the system already knows the answer. Its own comment anticipates
the general case — *"belt-and-braces for a job-backed deliverable that somehow holds more than one
task: the last approval carries it"* — it is simply fenced off from the case that needs it.

**2. The artefact hangs off the deliverable, not the task.**
`media_records` is `unique (deliverable_id, version)` with `deliverable_id not null`
(`20260728110800:9,24`), and the submit gate asks:

```sql
select 1 from media_records m
where m.deliverable_id = v.deliverable_id and m.round = v_round
```

**Any** version on the deliverable at this round satisfies it. So with six sub-tasks under one
deliverable, one person uploads one file and all six tasks pass their gate. Six reels, six
approvals, **one artefact** — and five of the approvals are of something nobody looked at.

That is the real defect. It is a gap in the upload path, not a property of the model.

### Why the previous drafts got this wrong

Reading `unique (deliverable_id, version)`, an earlier analysis concluded that "review is anchored to
the deliverable", and therefore that six individually-reviewed reels must be **six deliverables**.
ADR-0051 d.11/d.16 and ADR-0052 d.7 were built on that: a `quantity_expands` flag, a
`default_production_type` column to drive it, a 50-per-row / 200-per-campaign cap, and an argument
about 30 social posts becoming 30 deliverables.

**All of it was working around an invented constraint.** Approval was always per task. Only the
*file* was in the wrong place. Those decisions are superseded here.

## Options weighed

**Six deliverables per six reels** — the superseded position. Rejected: it contradicts the stated
model, multiplies the deliverable list by quantity, forces an owner decision per unit, and needs a
cap, an expansion flag and a production-type column purely to manage the consequences. It also
answers a question nobody asked, since per-task approval already existed.

**One artefact per deliverable, reviewed as a bundle.** The cheapest option: change nothing. Rejected
by Edward on quality — six reels are six things and each is approved or cancelled on its own merits.

**Move `media_records` onto the sub-task entirely** — `deliverable_id` dropped, derived through the
task. Cleanest model, and rejected on blast radius: `deliverable_id` is read directly by delivery
and Library filing (`20260817100000:83,156,210`), archive residency (`20260817100100:85,111`), the
version-stamping trigger (`20260818100000:26`) and the round backfill (`20260824150000:50`). Those
are about the *deliverable* and should stay that way.

**Add `sub_task_id` alongside, keep `deliverable_id`** — chosen. Additive, leaves every
deliverable-level consumer working, and lets version numbering and the submit gate move to the task
where they belong.

## Decision

1. **The deliverable is a container. Nothing is ever uploaded to it.** Where it holds sub-tasks, the
   files live on the sub-tasks. The deliverable-level upload control is removed from the surface.

2. **The sub-task is the unit of work *and* the unit of review.** Its own versions, its own markup,
   its own reviewers, its own approval. This is already true of everything except the file.

3. **`media_records` gains `sub_task_id`**, and it is the task that owns the version.
   `deliverable_id` is **kept** — denormalised, still `not null`, still the key for delivery, Library
   filing, archive residency and retention, none of which change.

4. **Version numbering becomes per sub-task.** The `unique (deliverable_id, version)` constraint
   becomes `unique (sub_task_id, version)`, and the stamping trigger numbers within the task. Two
   reels are each on version 1; today the second would be forced to version 2 of a shared sequence
   that means nothing.

5. **The submit gate asks for the submitting task's own version.** `app.sub_task_submit` changes
   `m.deliverable_id = v.deliverable_id` to the task's own id. This is the line that currently lets
   five people submit work nobody uploaded.

6. **Deliverable approval is derived, never driven.** Remove `v_stream is null` from
   `app.maybe_complete_sub_task`. When the last sub-task reaches `done` or `cancelled`, the
   deliverable becomes `approved` — for campaign work exactly as it already does for ad-hoc. The
   transition guard is unchanged: it already refuses the same transition while work is open, so the
   guard and the derivation now agree instead of only one of them being reachable.

7. **A deliverable with no sub-tasks keeps today's behaviour.** Derived approval needs something to
   derive from. An empty container is approved by a person, as now.

8. **Ad-hoc is unchanged in behaviour, and is the reference implementation.** `create_adhoc_deliverable`
   makes one deliverable and one sub-task; under d.3 its file moves from the deliverable to that
   task, and d.6 makes campaigns behave the way ad-hoc already does. **Every existing ad-hoc pgTAP
   assertion must still pass unmodified** — that is the acceptance test for this ADR, not a
   nice-to-have.

9. **`quantity` does not expand into deliverables.** "Instagram Reel × 6" is **one** deliverable with
   six sub-tasks. `quantity` stays a column on the deliverable, describing what the deliverable is.
   ADR-0051 d.11 and d.16 (`quantity_expands`, `default_production_type`, the 50/200 cap) and
   ADR-0052 d.7 are superseded and should be struck from those ADRs on acceptance.

10. **External review inherits this shape.** When the client portal lands (M10), a client approves or
    rejects each sub-task's artefact, and the deliverable follows by the same derivation. Nothing in
    this ADR is internal-only; it is not built here because the portal is not built.

## Consequences

**Easier.** The model the owner has described repeatedly is finally the model in the database. Six
reels are six reviews under one deliverable, with one owner, one due date and one row on the
campaign page. ADR-0051 loses three decisions and a column. The "42 tasks for a TVC" and "30 social
posts becomes 30 deliverables" problems disappear, because both were consequences of the mistake
rather than of anything anyone asked for.

**Harder.** This is the one genuinely invasive change in the set, and the earlier estimate of "one
migration and three files" was wrong. The honest list: the version-stamping trigger
(`20260818100000:26`), the submit gate (`20260824150000:79`), the round backfill, the two read/write
sites in `review-api.ts` (`:72`, `:125`), `ReviewPanel` and its four call sites, which currently take
a `deliverableId`. Delivery, Library filing and archive residency are untouched by design — that is
what d.3 buys.

**And the data migration needs care.** Existing `media_records` rows have no `sub_task_id`. They must
be attached to their deliverable's sub-task where there is exactly one — which is every ad-hoc row
and most campaign rows — and left unattached, visible and reported where there is more than one.
Guessing which of three tasks a file belonged to is not something a migration may do silently.

**Locked in.** A deliverable never holds a file. Approval is a consequence of the work beneath it, not
an act performed on it. If a future feature wants to approve a deliverable directly, it supersedes
this ADR rather than adding a second path.

## Cost

The largest single change in this ADR set, and the only one that touches the daily-use review path.
One migration (column, constraint, trigger, two function bodies, backfill), two frontend API sites,
one component and its call sites. The pgTAP is the load-bearing part: d.8 means every existing ad-hoc
review assertion is a regression test for this change, and they must pass **unedited**. If one needs
editing to pass, the change is wrong.

## Testing

- pgTAP: two sub-tasks under one deliverable — task A's version does **not** satisfy task B's submit
  gate. This is the defect; it must fail before the change and pass after.
- pgTAP: version numbering is per sub-task — two tasks each hold a version 1.
- pgTAP: the last sub-task reaching `done` approves a **campaign** deliverable (d.6); an earlier one
  does not; a deliverable with an open task is not approved.
- pgTAP: a cancelled sub-task counts as settled, so a deliverable whose remaining tasks are approved
  and cancelled is approved.
- pgTAP: **every existing ad-hoc review test passes unmodified** (d.8).
- pgTAP: cross-tenant — a version on another tenant's sub-task is invisible and cannot satisfy a gate.
- Migration test: a deliverable with one sub-task attaches its versions; one with several leaves them
  unattached and reports them rather than guessing.
- Unit: the deliverable surface offers no upload control; the sub-task surface does.

## Addendum — 14 Sep, the round of a task is the task's own counter

**Tracker:** I48.33. **Accepted** (Edward, 14 Sep: *"as per recommendation"*).

**What was found.** Writing the how-to guides, a task sent back for changes reappeared on the
maker's My Work as a fresh task — no *Changes requested*, the button reading *Deliverable* — and
the second upload was stamped **round 1**. The cause is a fact with two homes. This ADR made the
sub-task the unit of review, and `sub_task_request_changes` already counts its rounds
(`sub_tasks.revision_number + 1`, which `task_time_entries.round` uses). But four pieces still read
the **deliverable's** `revision_round`: `app.task_review_round` (`coalesce(d.revision_round,
st.revision_number) + 1` — the task's own counter only for a task with no deliverable), the
`media_records` round stamp, the media arm of the `review_feedback` round stamp, and the digital
arm of `app.sub_task_submit`'s "this round must carry a version" gate. The deliverable's round
moves only on the container's own `in_review → in_progress` transition — the tier-2 review this
ADR and ADR-0077 made unnecessary (I40.25) — which a task-level send-back never fires. So under a
deliverable every round was round 1, and **last round's file satisfied this round's submit gate**:
the rule d.5 exists to enforce was not enforced past the first round.

**Decision.**

- **d.13 — A task's review round is `sub_tasks.revision_number + 1`, always.** `app.task_review_round`
  no longer consults the deliverable. A version, a comment and a timer on a task all carry the
  same number, and the number moves when the task is sent back.
- **d.14 — A version stamps its round from its task.** `tg_media_record_stamp_round` reads
  `task_review_round(new.sub_task_id)` when the upload belongs to a task; only a version with no
  task (the legacy rows d.8 left unattached) still reads the deliverable's round. The
  `review_feedback` media arm follows the version's own round.
- **d.15 — The submit gate asks for THIS task round's version.** The task arm compares against
  `task_review_round(p_id)`; the legacy no-task arm keeps the deliverable's arithmetic so that
  history still satisfies the gate for the deliverable it belongs to.
- **d.16 — Versions and comments already misstamped are re-stamped by time**, not guessed: a task
  row created after the task's most recent `changes_requested` notification belongs to the task's
  current round. Nothing earlier is touched; those rounds are as recorded.
- **d.17 — My Work reads the task's counter.** `useMyAssignedWork` carries `revision_number`, so
  *Changes requested* and *Review feedback* appear, and the *upload this round's version* line
  shows when it is true.

**Consequences.** The deliverable's `revision_round` is left in place for the container transition
that still writes it; nothing about a task reads it any more. pgTAP 047 (the deliverable-round
trap for legacy rows) passes unedited; 115 proves the task path: send-back, submit without a new
upload refused, v2 stamped round 2, submit with it allowed.
