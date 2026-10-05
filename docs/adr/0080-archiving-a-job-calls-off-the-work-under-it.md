# ADR-0080: Archiving a job calls off the work under it

- **Status:** accepted
- **Date:** 2026-09-09
- **Open Decision:** none — raised from the pilot, not from §11
- **Task(s):** I42.1, I42.5

## Context

Fadia Wael Amin reported that tasks assigned to her and since approved were still sitting in her
"Tasks for today". Three separate readings of the cause were wrong before the data settled it; the
measurement is a one-off production diagnostic query (not included), run against the live tenant on 9 Sep.

**What is actually there.** "Al Waha KV" is five separate ad-hoc jobs, one task each, created
by one person inside fourteen minutes on 27 Aug. Edward, 9 Sep: *"the only real one is the approved
one"*, and the duplication itself is *"a glitch created some time ago which has been resolved"* — so
the duplicates are not what this ADR is about. What matters is what happened to them afterwards.
One was cancelled properly. **Three were archived by hand while a live task was still assigned
underneath**, and those three tasks are still `todo`, still on Fadia's list, and she has no way to
remove them: an assignee may Start and Submit, not cancel.

**The gap is narrow and precise.** `public.sub_task_cancel` (latest `20260830150000`) archives an
ad-hoc job only when no live task remains — it counts first, and it did exactly the right thing for
the one job that was cancelled properly. But the container's own transition is unguarded in the
other direction: `20260908150000`'s state machine makes `archived` reachable from `draft`,
`in_progress`, `blocked`, `approved` and `delivered`, and nothing on that path looks at the tasks.
On the Ad-hoc tab, `allowedTransitions` is filtered to Archive only (`DeliverablesPage.tsx:439`), so
for an `in_progress` ad-hoc job **Archive is the single action offered**, and pressing it strands
whoever was assigned.

**The system already calls this state wrong, and guards only one route into it.**
`20260903120000` refuses `sub_task_reinstate` on ad-hoc work whose job is archived rather than
*"produce a live task under a dead container"*. That sentence is the rule; it has simply never been
applied to the door people actually walk through.

**And the working list cannot see the problem either.** `isFinished`
(`src/features/deliverables/lib/my-work.ts`) is `status = 'done' or deliverableState = 'approved'`.
It does not know `archived`, and it does not know `delivered`. So a task under either is open work
forever, in every panel and every count that shares the definition.

**Measured blast radius: 6 tasks, 4 people** — Fadia Wael Amin ×3 (Al Waha KV),
Basheer Mathai ×1 (Harmony B2B Animation), plus one each on two test accounts. Small today,
and small is why it is worth fixing now: the same press is available on every ad-hoc job in the
tenant, and 131 of this tenant's deliverables are ad-hoc.

**Edward's decision, 9 Sep,** put to him as three options — refuse the archive, archive and cancel
together, or allow it and stop displaying the work: *"archive and cancel together"*.

**The other two options, and what they cost.** *Refusing* while live work exists was rejected
because it makes tidying up a two-step chore that has to be done in the right order, and the person
pressing Archive has already decided the job is off — on the Ad-hoc tab, where Archive is the only
action offered, a refusal leaves no way forward on screen at all (the "no dead ends" rule).
*Display-only* was rejected because it leaves the database saying somebody is assigned to work on a
job that was called off: every later reader inherits that, including ADR-0075's at-risk arithmetic,
which would count hours nobody is ever going to work as capacity somebody owes.

## Decision

1. **Archiving a deliverable cancels every task under it that is not already `done` or
   `cancelled`.** One act. There is no state in which a job is archived and live work hangs off it.

2. **Enforced in the database, on the transition itself** — not in `deliverable-transition` and not
   in the surface. The guard is the front door (ADR-0055, ADR-0068): a UI that declines to strand
   somebody is a decision about a screen, and this needs to hold for the Edge Function, a future
   surface, and a migration that writes the state directly. The 8 Sep migrations wrote
   `state = 'archived'` straight to the table; a rule that lives above SQL would not have applied.

3. **A task cancelled this way is cancelled exactly as `public.sub_task_cancel` cancels one** —
   `status = 'cancelled'`, its `bookings` deleted so it stops consuming the assignee's capacity, and
   a `cancelled` notification to the assignee where that is not the actor. Same record, same
   release, same message. There is no second kind of cancellation, because a second kind is how the
   two would drift.

4. **The assignee is told.** d.3 makes this fall out of reusing the existing path, and it is stated
   separately because it is the point: this rule exists so that work vanishing off somebody's list
   is something the system did on purpose and said so, rather than something that quietly stopped
   being true. `cancelled` has carried email copy since `I30.2`.

5. **Campaign deliverables as well as ad-hoc.** The dead end is identical and the person assigned is
   equally stranded; that the container is part of a plan does not change what it is like to be the
   one holding the task. Scoping to ad-hoc was weighed — `20260908170000` deliberately scoped its
   own sweep that way — and rejected: that sweep was an irreversible one-off correction to existing
   rows, where narrowness is a virtue, while this is a rule about what an action means.

6. **The archiver's authority carries the cancellations** — Edward, 9 Sep, choosing this over
   refusing the archive when any task is out of reach. Archiving is one act by one person, and
   the alternative — requiring `project_tasks:manage` plus `in_write_scope` over every live task, as
   `sub_task_cancel` does per task — was weighed and rejected: it would refuse a Traffic Manager
   archiving a job holding a Creative task, which is the ordinary case, and turn one press into a
   negotiation — and a Traffic Manager tidying up IS the ordinary case, so the stricter rule would
   block what people do daily to prevent something nobody has yet done. **This is the one clause
   that widens an authority, it was put to Edward as its own decision rather than carried inside the
   ADR, and it stays flagged rather than buried:** whoever may archive a container may, by that act, call off work they could not have
   cancelled one task at a time. It is made safe by being loud, not by being narrow — d.3's
   notification and d.7's confirmation mean nobody finds out by noticing.

7. **It always warns, and the warning scales to the cost.** Edward, 9 Sep: *"on adhoc it should
   say cancel and warn."* With one task, that it cancels the work and tells the assignee; with
   several, the people by name. Never silent, on either tab — `archived` is terminal (ADR-0024:
   `when 'archived' then array[]`), so this is the last moment anybody can be told, and ad-hoc
   cancellation additionally cannot be reinstated (`20260903120000`). Reuses ADR-0068 d.2's pattern
   exactly: `fetchCancelImpact` already fetches the cost before the dialog opens, because the
   wording depends on it. What was rejected is a warning of FIXED weight — the ad-hoc case is 131 of
   this tenant's deliverables and is always exactly one task with one owner, so a ceremony sized for
   the ten-task campaign case is friction on the ordinary path, and friction on the ordinary path is
   how a dialog stops being read.

8. **`isFinished` learns that `archived` and `delivered` are settled**, in the same change set. This
   is a safety net, not the fix, and it is worth having *because* d.1 exists rather than instead of
   it: it clears rows that predate this rule, it covers `delivered` — which d.1 says nothing about —
   and it means a future path that writes the state directly produces a stale row rather than an
   unclearable one. Deliberately in the shared classifier, so every panel and count moves together.

9. **The six existing rows are corrected in the same migration**, under `app.system_op`, by the
   general condition rather than by id — the shape `20260908170000` established, so it cannot matter
   how many there are by the time it runs. **This is not tidying-up; it is the only route those rows
   have.** Edward, 9 Sep: *"they are in complete marked completed — how am I supposed to cancel them
   now?"* He cannot, and neither can anyone: `DeliverablesPage.tsx:819` wraps every task control in
   `{!done && …}` where `done` is `approved || archived` (`:801`), so a finished row's modal shows
   the review record read-only and offers no Cancel; the assignee has no authority to cancel her own
   work; and `archived` is terminal, so the job cannot be reopened to get at the task. A row that
   reaches this state today is unreachable by every surface the product has — which is the sharpest
   statement of why d.1 exists, and why d.8's safety net is not sufficient on its own. **The
   migration sends the `cancelled` notification** (d.4) with a null `actor_id`, because no person
   pressed anything and the inbox already renders that as the system.

10. **On the Ad-hoc tab the row action follows the row's state: `Cancel` on live work, `Archive`
    on finished work.** A first draft of this decision said something else — that Archive should be
    withdrawn from live ad-hoc rows altogether, because `Cancel task` inside the modal already does
    the job properly. **Edward overrode it, 9 Sep: *"on adhoc it should say cancel and warn"*, and
    that is the better answer**, because withdrawing it would leave the Ad-hoc tab's Live group with
    no row action at all — no dead ends. The two doors are acceptable precisely because d.1 makes
    them one act with one result: *a second door into the same action, not a second implementation
    of it* (`I40.27`'s phrasing, applied again). What is NOT acceptable is what stands today —
    `DeliverablesPage.tsx:434` says in its own comment *"ad-hoc is an approved-only archive, so the
    only thing to do here is tidy a finished item away"*, while the graph allows
    `draft → archived` and `in_progress → archived`, so the button appears on Live rows and is the
    ONLY button there. **That is the press that stranded Fadia's three tasks:** somebody wanting
    rid of a row used the one action offered, and it archived the container and left the work.

11. **On the Ad-hoc tab the word is "Cancel", not "Archive"** — Edward, 9 Sep, deciding it.
    After d.1 the action calls off live work and notifies a person; *archive* says something was
    filed away quietly, which is the opposite promise. The Campaigns tab keeps Archive, where a
    container genuinely is a separate thing from its tasks. Naming is not cosmetic here — the wrong
    word on the only button offered is how this happened.

12. **`approved → delivered` is NOT given the same rule.** Delivering a container with live tasks
    under it is the same shape of problem and is left open rather than decided here: nothing in the
    pilot has produced one, `I11.4` means nothing calls the delivery path at all yet, and d.8 covers
    the display either way. One decision per ADR.

## Consequences

**Easier.** Archiving becomes a complete act rather than half of one: the job goes off the list, the
work goes with it, and the person holding that work is told. The three-step ritual nobody performed
— cancel each task, then archive, in that order — stops being something to remember. `I42.5`'s
cleanup gets smaller, because d.9 does most of it. And the "live task under a dead container" state
that `20260903120000` already refuses becomes genuinely unreachable rather than refused at one door
and open at another.

**Harder.** Archiving is now destructive, and irreversibly so — `archived` is terminal and
`sub_task_reinstate` refuses ad-hoc work under it, so a mis-press cannot be walked back and d.7's
confirmation is load-bearing rather than polite. The blast radius of one press is larger than it
looks on a campaign deliverable holding six tasks across two departments, which is precisely why d.7
names them and d.3 tells their owners. d.6 leaves a real edge: somebody can call off work they could
not have cancelled directly, and if that turns out to matter in practice the answer is a new ADR
narrowing it, not a quiet check added later.

**Simpler, which was not expected.** The first draft of this ADR was a rule and a migration and
nothing else, because it took the Archive button on a live ad-hoc row as a legitimate action to be
made safe. It is not one: the code's own comment says it should never have been there, and the
correct path was already built next to it. d.10 deletes a path instead of hardening it, and the
database rule underneath (d.1–d.6) stops being the whole fix and becomes what it should be — the
guarantee that holds when a screen, an Edge Function or a migration does something a screen cannot
prevent.

**Locked in.** That the archive of a container is a statement about its contents, not only about
itself — the same principle ADR-0077 settled from the other end, where a container closes when its
contents are done. That there is exactly one cancellation in this system, with one record, one
capacity release and one notification, and any second route to calling work off goes through it.
That `isFinished` is the single definition of settled work, and that adding a deliverable state
means asking what it means for the person assigned underneath.
