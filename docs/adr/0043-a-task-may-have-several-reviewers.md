# ADR-0043: A task may have several reviewers

- **Status:** accepted (Edward, 27 Aug)
- **Date:** 2026-08-26
- **Open Decision:** — (specified by Edward, 26 Aug)
- **Amends:** ADR-0038 (which appointed exactly one reviewer per task)
- **Task(s):** I14.1 (new); relates to ADR-0030 (review round-trip), ADR-0035 (ad-hoc reviewer)

## Context

ADR-0038 made review personal on purpose: *"THIS task's reviewer, not the deliverable's owner and not
any moderator at large"*. That is enforced in four places today, all keyed on a single column:

- `sub_tasks.reviewer_id`, plus `chk_sub_tasks_reviewer_required` — a task may not be **assigned**
  without a reviewer — and `chk` no-self-review (`reviewer_id <> assignee_id`).
- `public.sub_task_approve` refuses anyone but that person: `if v.reviewer_id is distinct from auth.uid()`.
- `tg_subtask_notify_reviewer` notifies them on submit; the "Awaiting my review" inbox on My Work
  queries `reviewer_id = me`.
- `public.update_task_assignment` accepts a reviewer and checks they hold `reviews:moderate`;
  `deliverables.reviewer_id` (ADR-0035) carries the same for ad-hoc work.

Edward, 26 Aug: **a task needs to be able to name more than one reviewer.** Real work is reviewed by
whoever is available — an art director and a copywriter on the same execution, or a stand-in when the
named person is on leave. Today the only way to express that is to change the reviewer, which loses
the record of who was originally asked.

### What is genuinely open

Two things, and the second matters more than the first.

**Where the list lives.** A join table, or an array column on `sub_tasks`.

**What "approved" means with several reviewers.** Any one of them, or all of them? These are
different products. "Any" is a pool of people who *may* sign off; "all" is a sign-off *chain* where
each person's verdict is tracked separately and the task is not done until the last one agrees.

Edward, 26 Aug, resolving it: **neither, per task — mark which reviewers are mandatory.** That is the
real shape of agency review. A legal or brand-compliance sign-off is not optional and a second pair
of creative eyes usually is, and which is which changes from job to job. A per-task flag says that;
a global rule cannot.

### Options weighed

- **A — keep `reviewer_id` as the lead, add a table of ADDITIONAL reviewers.** Cheapest: the
  constraint, the RPC and the inbox all keep working untouched. Rejected: two homes for one fact.
  Every query then has to remember to union the column with the table, and the ones that forget are
  silently wrong — the same shape as the bug where the schedule read a task's reviewer from the
  deliverable instead of the task (`I12.14`), and as the per-user grant overlay that eight Edge
  Functions ignored because authorization had two homes (ADR-0037).
- **B — `reviewer_ids uuid[]` on `sub_tasks`.** No join, no extra table. Rejected: no referential
  integrity (an array can hold a deleted user, or another tenant's), the no-self-review rule becomes
  a trigger anyway, and the project has no precedent for a FK array.
- **C — a `sub_task_reviewers` join table as the single home, `reviewer_id` dropped (chosen).**
  One place to ask "who reviews this". Costs the most up front, because five call sites move.

## Decision

1. **New table `sub_task_reviewers`** — `tenant_id`, `sub_task_id` (FK, cascade), `user_id` (FK),
   **`is_mandatory boolean not null default false`**, **`approved_at timestamptz`** (null until that
   reviewer acts), `created_by`, `created_at`. Unique on `(sub_task_id, user_id)`. Composite
   `(tenant_id, …)` foreign keys, as ADR-0042 established, so a reviewer cannot be another tenant's
   user. RLS enabled and forced; writes gated by `app.can_manage_sub_task` — the same authority that
   assigns the task. `approved_at` is written only by the approve RPC, never client-writable, exactly
   as `sub_tasks.approved_by` is today.

2. **`sub_tasks.reviewer_id` is dropped**, its values backfilled into the new table first. One home.
   The five call sites above move with it, in the same migration.

3. **Every named reviewer must hold `reviews:moderate`**, checked on write as
   `update_task_assignment` checks it today. **No reviewer may be the task's assignee** — the
   no-self-review rule from ADR-0038 applies to each row, not just to a first among equals.

4. **A live task must have at least one reviewer.** `chk_sub_tasks_reviewer_required` cannot express
   this once the fact lives in another table, so it becomes a deferred constraint trigger: assigning
   a task with no reviewer is refused, and removing the last reviewer from an assigned task is
   refused. The rule is unchanged; only its mechanism is.

5. **A reviewer is mandatory or not, and that decides when the task is done.**

   - **Every mandatory reviewer must approve.** The task completes when the last of them does.
   - **If no reviewer is marked mandatory, the first approval completes it** — the pool behaviour,
     which stays the default because `is_mandatory` defaults to false.
   - An **optional** reviewer's approval is recorded on their row and is a real part of the record,
     but it never completes a task that still owes a mandatory approval.

   `sub_tasks.approved_by` / `approved_at` keep meaning what they mean today: **who completed it, and
   when.** With mandatory reviewers that is the last one to agree — the moment the work became
   accepted. The per-reviewer detail lives on `sub_task_reviewers`, so nothing is lost.

6. **Anyone appointed may request changes, and doing so clears every approval.** The task reopens to
   `todo` for a fresh round (ADR-0030), and all `approved_at` stamps on that task are cleared.

   Approvals are approvals **of a version**. Once changes are requested the work is different, so an
   earlier approval no longer applies to it — carrying it forward would let a task complete on the
   strength of somebody agreeing to a draft they never saw. This applies to optional reviewers too: a
   second pair of eyes that spots a problem must be able to stop the job.

7. **All named reviewers are notified on submit.** "Awaiting my review" shows the task to a reviewer
   until **they personally** have acted, or the task leaves review — not until *somebody* acts. A
   mandatory reviewer whose approval is still owed must keep seeing it after a colleague has agreed,
   or the one thing that gates the task is the one thing that disappears from the queue.

8. **A task in review says whom it is waiting for — to everyone, the reviewer included.**

   The reviewer's own queue already exists and is unchanged: `AwaitingReviewPanel` on My Work, and
   the exceptions strip counts it. Decision 7 keeps a mandatory reviewer in that queue until *they*
   act rather than until somebody does, which is the part multiple reviewers breaks.

   What is added is the other direction: wherever a task in `review` appears — the assignee's My Work
   row, the Deliverables task table, the exceptions strip — it **names the reviewers still
   outstanding, marking which are mandatory**. With one reviewer, "waiting on review" had exactly one
   name against it and everybody knew who to ask. With three, "who is holding this up?" has no answer
   on screen, and a task can sit for a week while each person assumes another is looking. An ADR that
   creates an ambiguity closes it. No new data: `sub_task_reviewers where approved_at is null`.

   The exceptions strip also **splits its `inReview` count**, which today adds "my work being
   reviewed" to "work awaiting my review" and reports one number. Those are opposite problems — one
   is waiting on somebody else, one is waiting on you — and a reviewer holding up three mandatory
   sign-offs should see that as its own figure, not folded into a total.

9. **Ad-hoc work follows the same table.** `deliverables.reviewer_id` (ADR-0035) stays as the
   deliverable-level record for the review stack, and `create_adhoc_deliverable` writes the chosen
   reviewer to both it and `sub_task_reviewers`, so the two never disagree. Making ad-hoc
   deliverables multi-reviewer at the *deliverable* level is out of scope here.

## Consequences

**Easier.** Cover for leave without rewriting who was asked. Two disciplines can review one
execution. A compliance or brand sign-off that genuinely cannot be skipped is now expressible, per
task, instead of being a convention somebody has to remember.

**Harder.** Five call sites change at once: the approve RPC, the notify trigger, the "Awaiting my
review" query, `update_task_assignment`, and the reviewer picker (now multi-select with a mandatory
toggle per person). The "required" invariant moves from a CHECK constraint to a trigger, which is
strictly weaker — a CHECK cannot be disabled by accident and a trigger can, as this project has
already done deliberately during a data repair. The pgTAP suites for ADR-0038 all change.

**A task can now stall on one person.** That is the point of a mandatory reviewer and also its risk.
Decision 8 handles the half that can be handled here: the work always says whom it is waiting for, so
the stall has a name and somebody can go and ask.

**Chasing is a separate decision, and it is being made.** Visibility does not make anyone act: a task
can still sit in review while everyone is content to leave it. Reminders and escalation are
**ADR-0045**, which builds on the cron-invoked Edge Function pattern this project already runs
(`archive-sweep`). Kept out of this ADR because it is a different decision with a different blast
radius — it also covers `due_soon`, deferred since `I5.1` — not because it can wait.

The manual escape hatch remains either way: **remove the mandatory reviewer**, an ordinary managed
write, audited like any other. Better than a task silently completing without a sign-off somebody
marked as required.

> **Correction (27 Aug), found by review before merge.** That escape hatch is not free, and the
> sentence above was written as though it were. Removing the last mandatory reviewer from a task
> whose other reviewers have *already approved* leaves it stuck in `review` for ever: nothing
> re-evaluates completion when the appointment set changes, and the reviewer who already approved is
> refused a second time. **So it is a requirement, not a consequence: any change to the reviewer set
> — removal, or clearing a mandatory flag — must re-run the completion check.** The same review found
> that two mandatory reviewers approving concurrently can strand a task the same way, which needs the
> completion count serialised. Both are fixed and regression-tested.

**Locked in.** Who reviews a task has exactly one home. Mandatory-ness is a property of the
appointment, not of the person or their role — the same reviewer is required on one task and
optional on the next. An approval belongs to a version: request changes and every approval on that
task is cleared, so nothing completes on the strength of agreement to a draft that no longer exists.
The no-self-review rule holds per reviewer, so a task can never be approved by the person who did it.

**Cost.** No dependency, no service, no licence. One table, one trigger, five call sites, one screen.

**Testing.** pgTAP: RLS allow + deny including cross-tenant; a non-moderator refused as a reviewer;
the assignee refused as a reviewer; assigning with no reviewer refused; removing the last reviewer
from a live task refused; removing a non-last reviewer allowed. Then the rule itself — **with no
mandatory reviewers, one approval completes the task**; **with two mandatory, the first approval does
NOT complete it and the second does**; an optional reviewer approving while a mandatory approval is
outstanding does not complete it; `approved_by` names the reviewer who completed it; an optional
reviewer requesting changes reopens the task and clears every `approved_at`, including a mandatory
one already given; a reviewer who has approved drops out of their own inbox while one who has not
still sees it. Unit: the picker's multi-select and mandatory toggle, and the waiting-on list showing
only outstanding reviewers with the mandatory ones marked.
