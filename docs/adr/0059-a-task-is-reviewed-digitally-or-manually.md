# ADR-0059: A task is reviewed digitally or manually

- **Status:** accepted
- **Date:** 2026-08-29 (revised 30 Aug — the template carries the default)
- **Open Decision:** — (specified by Edward, 29 Aug, after the workflow templates reached the production team)
- **Task(s):** **I19.15** (new). Amends ADR-0058 d.5 (the submit gate) and extends ADR-0025 (anchored feedback).
- **Depends on:** ADR-0038 (a task is approved), ADR-0043 (a task may have several reviewers), ADR-0052 (the workflow template), ADR-0058 (the sub-task is the unit of review).

## Context

The review loop this system runs is good and it is finished: a task is assigned, started,
submitted, read by its **appointed** reviewers, and either approved or sent back — and sending it
back reopens the task so the next round is timed (ADR-0030, ADR-0038, ADR-0043). Approving the last
live task approves the deliverable, with no human driving a transition the system has already
decided (ADR-0058 d.4).

Every part of that assumes **a file**.

`app.sub_task_submit` refuses without one, and ADR-0058 d.5 tightened it deliberately — it must be
*that task's own* version, because the old predicate let six sub-tasks pass their gate on one
upload. That was the right fix for the defect it addressed and it closed the door on work that has
no upload at all:

```
  if v.deliverable_id is not null then
    ...
    raise exception 'attach this round''s version before submitting for review'
```

Since 29 Aug every deliverable type materialises a task list, so this is newly reachable rather
than theoretical. The templates now name real production work: **Shoot**, **Proof**,
**Production**, **Installation**, **Physical Media**, **Archive**. None of those produces a file to
upload, and the person holding one of those tasks therefore cannot submit it, cannot have it
approved, and cannot let the deliverable complete. **The task is a dead end**, and a deliverable
containing one can never reach `approved`, because the guard refuses while any sub-task is open.

This blocks the **production** team specifically. Creative work is unaffected — its output is a
file, and the digital path is exactly right for it. That asymmetry is why this is one decision
about *tasks* rather than a change to how review works.

### What Edward specified

> _"when we assign a task can we add a toggle for digital review or manual review. digital routes
> to the existing upload, manual routes to a comment field, with request changes or approve"_

And on 30 Aug, having read the first draft of this ADR:

> _"I would prefer that the toggle sit on the task and the template. The template presents the
> default setting, which can be over written for individual tasks."_

The shape of that matters: **it changes what submitting requires, and nothing else.** Reviewers,
rounds, the request-changes loop that reopens a task, derived deliverable approval, notifications,
timers, and `unassigned_at_signoff` all stay exactly as they are.

### The one thing that does not fit today

`review_feedback.media_record_id` is **`not null`** (`20260728110800:51`). Every comment in the
system hangs off an uploaded version. A manually-reviewed task has no version, so there is nowhere
to put the comment the reviewer writes — which is the whole of the manual path.

That is the only schema obstacle. Everything else Edward described already exists.

### Options weighed

**A. A `review_mode` on the task, set at assignment.** ✅ Chosen, as the authority. One column, read
by one gate. The reviewer's screen branches on it; nothing else in the loop knows or cares.

**B. Infer it from the workflow step.** ✅ Chosen **as the default only**, per Edward's revision.
The first draft rejected B outright, and that was wrong in one direction and right in the other. It
is right that a *rule the system enforces* is a rule nobody can override at the moment they discover
it is wrong — a shoot *can* be reviewed on selects, and a hand-added task has no step at all
(I19.3). It was wrong to conclude the template should therefore say nothing. A template that knows
"Installation" produces no file and declines to mention it makes every person set the same toggle
by hand on work whose mode was never in doubt, which is the complaint that produced I19.14 — *"we
might as well let the user define every task list themselves, which is what is being done poorly
now."* The template proposes; the person disposes. **B is a prefill, A is the truth.**

**C. Let the reviewer approve without submitting.** Smallest change — skip the gate entirely for
some tasks. Rejected: it removes the timed round-trip. `sub_task_submit` closes the time entry and
stamps the round; bypassing it loses the timing ADR-0030 exists for and makes "how long did this
take?" unanswerable for exactly the physical work where it is most expensive.

**D. Require evidence — a photo of the install, a delivery note — as a normal upload.** Rejected as
the *default* and, on this revision, rejected as an option too until production asks for it. It
sounds tidy and it is a lie about what the file is: a photograph of a billboard is not the
billboard, and filing it as the deliverable's version puts it in the Library, in delivery and in
archive residency as though it were the work. **The first draft of this ADR said a team that wanted
to attach one still could, which contradicted its own d.7 — that clause hides the upload control on
a manual task, so in practice it cannot. The contradiction is resolved here in favour of hiding
it:** a manual task has no upload control, and a separate evidence slot that never becomes the
deliverable's version is an additive change if production asks for one.

## Decision

1. **A sub-task carries a review mode: `digital` or `manual`.** New
   `sub_tasks.review_mode text not null default 'digital'`, checked against those two values.
   `digital` is the default because it is right for most work and because every existing row is
   digital. **This column is the only thing the submit gate reads.**

2. **A workflow step carries the default.** New
   `workflow_steps.review_mode text not null default 'digital'`, same CHECK. It is a *proposal
   about a kind of work* — "Installation produces nothing to upload" is a fact about installation,
   not about any particular task — and it lives at the level where the agency states such facts
   once. Editable on the Admin screen like every other field of a template (I19.12).

3. **The materialiser stamps the step's mode onto the task it creates, and copies rather than
   reads through.** `app.materialise_deliverable_workflow` writes `sub_tasks.review_mode` from the
   step. It is **not** a null-inheriting reference, for two reasons. The gate must read one non-null
   value on every row including hand-added tasks that have no step at all. And a template edited in
   March must not silently change how a task assigned in January is submitted — that is the
   ADR-0052 d.14 class of surprise, the same reason resequencing never touches a date. Changing a
   template changes the *next* deliverable materialised from it, and nothing already live.

   This is deliberately different from `default_hours`, which ADR-0052 d.4 keeps *out* of the task
   and offers as a prefill at assignment. That column is not stamped because `sub_tasks.sla_hours`
   is tier 1 of `app.effective_sla` and writing a template guess there would short-circuit every
   tier beneath it. `review_mode` sits in no such hierarchy: it is a plain flag with one reader, so
   stamping it costs nothing and buys a non-null invariant.

4. **The person assigning can change it, at any time.** `public.save_sub_task` and
   `public.update_task_assignment` gain the parameter, on the same surfaces that already name the
   assignee and the reviewers. It can be changed after assignment by anyone who could assign the
   task; discovering at the shoot that there is nothing to upload is normal, and a mode that could
   only be set once would be a second dead end. **A task's own mode always outranks the template's**
   — the seed-then-edit rule ADR-0051 d.3 states for the taxonomy, applied to the same class of
   problem.

5. **`digital` is exactly what happens today.** Submit requires that task's own version for this
   round, unchanged from ADR-0058 d.5. This ADR adds a branch; it does not soften the existing one.

6. **`manual` requires a comment instead of a version.** `app.sub_task_submit` skips the version
   check and instead requires at least one `review_feedback` row on this task for this round —
   written by the person submitting, saying what they did. *"Shot 4 setups, all approved on set"* is
   the artefact. **Submitting with nothing at all is refused in both modes**, because a reviewer
   asked to approve nothing is being asked to rubber-stamp.

7. **`review_feedback` can anchor to a task instead of a version.** `media_record_id` becomes
   nullable, a nullable `sub_task_id` is added, and a CHECK requires **exactly one** of them. Every
   existing row keeps its `media_record_id` and is untouched. Comments on a manual task are
   first-class in every other respect: same `round` stamping, same `resolved` state, same authorship
   rules, same RLS.

8. **The reviewer's actions are identical.** Approve and request-changes are the same RPCs
   (`sub_task_approve`, `sub_task_request_changes`) with the same authority checks. Requesting
   changes reopens the task to `todo` and clears approvals exactly as it does for a file. **Nothing
   about ADR-0043's mandatory-reviewer arithmetic changes.**

   One clause is needed to keep them identical rather than to make them differ. Requesting changes
   requires an unresolved comment — the mandatory change description (ADR-0030) — and on a manual
   task the submission *is* an unresolved comment. Counted naively, every manual task would arrive
   already satisfying its own send-back gate and a reviewer could reopen the work without saying
   why. So the task arm of that predicate ignores comments authored by the task's own assignee. The
   media arm needs no equivalent, because uploading a file writes no comment.

9. **The review surface branches on the mode, and says which it is.** A manual task shows the
   submitted note and a comment box, and does not show an upload control or an empty version rail
   — which would read as a missing file rather than a task that never had one. A digital task is
   untouched. The mode is visible on the task list, because "why can I not upload here?" must have
   an answer on screen.

10. **The seed ships a mode on every step, and 32 of the 97 are `manual`.** A column no seed writes
    is a feature nobody can find — the I19 failure, where `default_workflow_template_id` was read by
    the materialiser and written by nothing for a day. The seeded values, by template:

    | Template | `manual` steps |
    |---|---|
    | WF-02 Social Content | Scheduling |
    | WF-03 Video Production | Production, Delivery |
    | WF-04 Photography | Shoot |
    | WF-05 Print | Proof, Production, Delivery |
    | WF-06 Packaging | Proof, Production, Delivery |
    | WF-08 Campaign | Deployment |
    | WF-09 OOH / Environmental | Production, Proof, Installation, Delivery |
    | WF-10 Long-form Physical Production | Production, Physical Production, QA, Delivery |
    | WF-11 Long Form | Shoot, Physical Media, Ingest, Backup, Delivery, Archive |
    | WF-12 Short Form | Delivery / Scheduling |
    | WF-13 Photography | Shoot, Physical Media, Ingest, Delivery, Archive |
    | WF-14 Adaptation / Versioning | Delivery |

    WF-01 Standard Digital and WF-07 Branding are wholly digital, correctly — neither produces
    anything physical. Three groupings carry the judgement:

    - **The physical act.** Shoot, Production, Physical Production, Installation, Proof, Physical
      Media. "Production" reads as manual in all five templates that use it because in each it *is*
      the physical event — the shoot in WF-03 and WF-10, the print run in WF-05 and WF-06, the
      fabrication in WF-09. `Prepress` stays digital in both print templates: prepress output is a
      print-ready PDF, and it is genuinely reviewable as one.
    - **Custody, not creation.** Ingest, Backup, Archive. These move existing media; they author
      nothing new, and asking for an upload would mean re-uploading what already exists.
    - **Handover.** Delivery, Delivery / Scheduling, Scheduling, Deployment. The asset was created
      by an earlier step and already has its version; delivering or scheduling it is an act, and
      *"delivered to the publisher 14 Mar, confirmed by X"* is the record worth having.

    Applied two ways, because `not null default 'digital'` cannot distinguish "never chosen" from
    "deliberately digital". For a **new tenant**, `app.seed_tenant_workflow_templates` inserts the
    mode with the step, under the `on conflict do nothing` it already has. For the **existing**
    tenant, a one-time backfill in this migration sets the mode on steps of `is_system` templates
    matched by template code and step title. A step a tenant has renamed does not match and is left
    alone, which is the correct reading: they have made it theirs. This is a migration, not a
    repeatable seed, and it runs once.

11. **The tasks that already exist are backfilled once, and that is not a breach of d.3.** A task
    materialised before this migration carries `digital` because the column did not exist when it
    was made, not because anybody decided anything — so any task that already exists would otherwise
    keep the trap this ADR removes. The migration stamps `sub_tasks.review_mode` from
    the task's own step, fenced three ways: only where `workflow_step_id is not null` (a hand-added
    task had a person choosing), only `todo` or `in_progress` (a task in `review` or `done` was
    submitted under the digital rule and its record stays true to that rule), and only where the
    mode still reads `digital`. It runs once; nothing calls it again.

    The **"Locked in"** consequence below still holds for everything after today. This is the one
    moment where "the value has never been chosen" is knowable, and using it is what stops the fix
    applying only to campaigns nobody has created yet. On the pilot tenant it may change nothing —
    the one campaign with a materialised task list was deleted on 30 Aug — but a correctly fenced
    statement that matches no rows costs nothing, and the alternative is stranding rows nobody would
    think to look for.

12. **The deliverable-level `ReviewPanel` is unchanged.** It lists versions across the tasks beneath
    (ADR-0058 d.1, read-only). A manual task contributes none, which is correct — it produced none.
    The panel is not the record of what happened; the tasks are.

13. **Nothing here decides what production sign-off *should* be.** It gives them the loop they
    already understand with the file requirement removed. Whether a shoot needs a checklist, a
    second approver, or evidence attached is a separate question, and one the production team should
    answer from use rather than in advance. **Edward is asking them; this ADR is written so their
    answer extends it rather than replacing it.**

## Consequences

**Easier.** Production work becomes possible at all: a shoot, a print run, an installation or a
media placement can be submitted, reviewed and approved, and its deliverable can complete. The
seven production templates stop being traps. Because the template carries the default, a fourteen-
step Long Form pipeline arrives with its six physical steps already marked, and nobody sets a toggle
by hand on work whose mode was never in question.

**Harder.** `review_feedback` gains a two-parent shape (a version *or* a task), which every reader
must handle. There are three today (`useVersionComments`, the round grouping, and the pgTAP suites)
and the CHECK makes the invalid state unrepresentable rather than merely discouraged. The submit
gate now has two arms, and the test for it doubles. The mode now exists in two places, and the rule
about which wins has to be stated and tested rather than assumed.

**Locked in.** The task's mode is the authority and the template's is a prefill, so a template edit
never reaches live work. That is the right default and it has a cost: an agency that corrects a
seeded mode — deciding its "Delivery" step really is digital — fixes it for future deliverables and
not for the ones already running. Those are corrected task by task. Restamping live tasks from a
template is possible later as an explicit, reported action; it is not something an edit should do
silently.

**Not decided here.** Whether evidence should be attachable to a manual task without being the
deliverable's version (option D); whether some tasks should skip review entirely; whether a manual
task's reviewer should be a different person from a digital one's. All three are production-team
questions, and none of them is blocked by this.

**Cost.** One migration (two columns, a nullable FK, a CHECK, the materialiser, `sub_task_submit`
and `sub_task_request_changes` re-emitted, the seeded modes and a one-time backfill), two RPC
signatures widened, one branch on the review surface, one column on the template Admin screen, EN and
AR strings. No dependency, no service, no money.

## Testing

- **pgTAP:** a `manual` task submits with a comment and no version; the same task is refused with
  neither; a `digital` task is still refused without its own version (ADR-0058 d.5's assertion must
  pass **unmodified**); requesting changes on a manual task reopens it and clears approvals;
  approving the last manual task approves the deliverable; the CHECK refuses a `review_feedback` row
  with both parents and with neither; tenant isolation on task-anchored feedback.
- **pgTAP, the two levels:** materialising a template stamps each task from its step; a task whose
  mode was changed by hand keeps it when the template is edited afterwards; a hand-added task with
  no step is `digital`; the seed sets a mode only where none was chosen; re-running the seed over an
  edited step changes nothing.
- **The backfill is NOT covered by pgTAP, and that is a limitation rather than an oversight.** It is
  a one-time data statement that runs during the migration, before any test transaction opens, so
  there are no rows in existence for a suite to observe it acting on. Replicating the statement
  inside a suite would test a copy that can drift from the original, which is worse than an honest
  gap. What the suite *does* cover is every rule the backfill depends on: that the materialiser
  stamps from the step, that a hand-added task is `digital`, and that a task keeps its mode when the
  template changes. The backfill's own three fences are verified by inspection.
- **Unit:** the review surface shows a comment box and no upload control for `manual`, and the
  reverse for `digital`; the task list states the mode; the assignment dialog defaults to the mode
  the task already carries.
- **Regression:** every existing ad-hoc and container-model assertion passes unmodified — the same
  bar ADR-0058 set for itself.

## Addendum — 15 Sep, a manual note can carry a link

**Tracker:** I48.29. **Accepted** (Edward, 15 Sep).

**What changed.** The manual path (d.6–d.9) was written for work that leaves nothing behind to
review — a shoot, an installation. Reviewing guide 7 against the product, Edward found a second
kind of manual work: work whose output *does* exist, but somewhere the system cannot fetch — a
Keynote on iCloud, a working file on a shared drive, a page on a staging site. Today that work
is either uploaded every round (the complaint behind I48.18) or submitted as a note that says
*"it is on the shared drive"* with the reviewer left to find it.

> *"We need to add an option on each task that requires review to switch between Digital or
> Manual … If it is manual then when it comes time to submit for review … insert a url and submit.
> Offline users will be advised this only applies to the final approved version which will happen
> offline."* — Edward, 14 Sep

The switch exists (d.1, d.4: the booking dialog and the reopened task both carry it). What is
missing is the *url* beside the note, and the sentence telling the maker what the link does and
does not do.

**What was weighed.**

- **A link on the task** (`sub_tasks.review_url`) — one value per task. Rejected: the link belongs
  to a *round*. Round 2's Keynote is a different file from round 1's, and a single column would
  overwrite the history the thread exists to keep.
- **A link on the note** (`review_feedback.link_url`) — ✅ chosen. The note is already the manual
  round's artefact (d.6), stamped with its round and its author; a link on it inherits all of that
  for free, and every round's link stays in the thread where the reviewer read it.
- **Let a link satisfy the submit gate on its own** (no note). Rejected for now: a bare URL is not
  an account of what was done, which is what d.6 asks for and what the reviewer approves. Keeping
  the note required also means `app.sub_task_submit` is **not touched** — no function re-emit, no
  backfill, one `alter table` — which after 14 Sep's two failed production pushes is worth having.
  **This is the one point Edward may want the other way**; reversing it is a later addendum that
  re-emits the gate, not a redesign.
- **Reuse `media_records.external_review_url`.** Rejected: a manual task has no `media_records`
  row, and creating a version to hold a link would make the link a version — precisely the
  confusion option D refused.

**Decision.**

- **d.14 — A task-anchored note may carry one link.** New `review_feedback.link_url text null`,
  with a CHECK that a non-null value starts `http://` or `https://`. The CHECK lives in the
  database because the note is written by a plain RLS-governed insert, not an RPC (traps.md: a
  form-only rule is no rule). The column is a property of a note, not of the manual mode: nothing
  fences it to `sub_task_id` rows, and no reader of version-anchored comments changes.
- **d.15 — The note stays required; the link is optional beside it.** d.6 and the submit gate are
  unchanged. Submit is enabled by the maker's own note on this round, exactly as today, whether or
  not it carries a link.
- **d.16 — The thread shows the link as a link, to both people.** `TaskReviewThread` renders
  `link_url` under the note's body as an anchor opening in a new tab (`rel="noopener"`), the
  display text being the URL's host and path, truncated. The maker sees it on their own note; the
  reviewer sees it on the task they are asked to approve (`AwaitingReviewPanel`). The composer
  gains one optional field, *Link (optional)*, next to the note; an empty field writes `null`.
- **d.17 — One line says what the link is not.** On the manual composer, for the maker: *"Review
  happens at your link. The final approved file is not filed here — hand it over as agreed; it can
  be its own task."* EN and AR. This is Edward's sentence to offline users, said once, where the
  link is typed. A link is never a version: it is not filed into the Library, not delivered, not
  archived, and approving the task does not fetch anything from it.
- **d.18 — The digital arm is untouched.** A digital task still needs its own version each round
  (d.5). Review-by-link for digital work with the file required only at final approval is I48.18,
  parked, and needs its own decision about who uploads that file. This addendum does not decide it.

**Consequences.** *Easier:* a manual task can point its reviewer at the work instead of describing
where it is; every round's link stays in the thread. *Harder:* nothing structural — one nullable
column, one field, one anchor, one sentence. *Locked in:* the link is metadata on a note, never a
version; anyone later wanting "the link becomes the final file" is asking for I48.18, not for this.
*Cost:* one migration (one column + CHECK), one pgTAP suite (118), the composer and thread, two
strings ×2 languages, guides 7 and 8 re-shot where the manual thread appears. No dependency, no
service, no money.

**Testing.** pgTAP 118: a task note inserts with an `https://` link; the CHECK refuses `ftp://`
and a bare word; a note without a link still satisfies `sub_task_submit` (d.15 — asserted by
reading the existing suite's manual-submit case, unmodified); tenant isolation on the new column
is the table's existing policy (no new policy, assert by a cross-tenant read returning nothing).
Unit: the composer writes `null` for an empty link and the trimmed URL otherwise; the thread
renders an anchor with `target="_blank"` and `rel="noopener"` only when `linkUrl` is set. Guides:
7 §"Manual review" gains the link and the sentence; 8 shows the reviewer's view of a linked note.
