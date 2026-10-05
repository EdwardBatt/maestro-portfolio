# ADR-0060: Booking a campaign task is assigning it

- **Status:** accepted
- **Date:** 2026-08-30
- **Open Decision:** — (specified by Edward, 30 Aug, from the first acceptance run)
- **Task(s):** **I28** (new). Completes ADR-0029's *"the booking becomes the assignment record"*; extends ADR-0048 d.8 (the approval gate) to the surface.
- **Depends on:** ADR-0029 (booking-based assignment), ADR-0035 (ad-hoc work is reviewable), ADR-0038/0043 (a task is approved; several reviewers), ADR-0048 (campaign approval), ADR-0050 (one stream per campaign), ADR-0059 (digital or manual review).

## Context

ADR-0029 is titled *"booking-based assignment"* and its opening line is unambiguous:

> _"the booking becomes the assignment record. A booking already ties a resource to a time; it now
> also carries the sub-task it assigns."_

`bookings.sub_task_id` carries that promise in its own column comment: *"the sub-task this booking
assigns"*. **Half of it was built.**

### What actually happens today

The New Booking dialog has two modes, and they do fundamentally different things:

- **Ad-hoc, on a person** (`BookingDialog.tsx:151`) never reaches the booking function at all. It
  calls `public.create_adhoc_deliverable(assignee, title, hours, dates, reviewer)`, which creates the
  work **with its assignee and its reviewer**, and `subtask-schedule` then materialises the booking.
  The person is assigned, notified, and the task appears in "Assigned to me". **This works.**
- **Project** — pick a campaign, pick a deliverable, optionally pick a task — falls through to
  `booking-transition`, which writes `bookings.sub_task_id` and **never touches
  `sub_tasks.assignee_id`**. The word "assignee" does not occur in that function.

So booking a campaign task onto somebody puts a block on their calendar, leaves the task unassigned
everywhere it is displayed, and notifies nobody.

**The missing notification is the proof this is a defect and not a design.** ADR-0029's own
notification trigger deliberately skips sub-task bookings:

```
  if new.sub_task_id is not null then return new; end if;   -- sub-task path carries the notification
```

with the comment *"their assignment notification is emitted by the sub-task trigger, so there's one
notification per assignment (no double-notify)"*. That trigger fires on `assignee_id` changing.
Nothing changes it, so nobody is told. One half was written expecting the other half; the other half
was never written.

**Why nobody noticed.** Until ADR-0052 (29 Aug) a campaign deliverable rarely held tasks at all, so
the project path was mostly used to reserve time against a deliverable. The first campaign to arrive
with a materialised task list was the first thing to need this, and it is exactly where the
acceptance run stopped.

### What Edward specified

> _"When a campaign is prepared and submitted for approval, it contains Deliverables and Sub-Tasks
> which are not assigned yet. Once the campaign is approved the tasks are available to be assigned
> on the /schedule … from the modal, the Assigner select + to open the modal, they select project…
> this should list all approved campaigns and filter a deliverables for that campaign. The user
> select the deliverable from the drop down to filter to that deliverables task and assign to the
> selected user… at this point they can select the reviewers etc. as per ad-hoc tasks."_

And on the two options Project mode carries today:

> _"do not allow a deliverable to be assigned to a user on /schedule… it will not work and as you
> state it could assign 14 steps to one person."_

> _"on the typing a new task name, this should be allowed but the new task should surface on the
> campaign page under the deliverable as well. so all UI surfaces that display the relevant data
> stay updated."_

### The three things standing in the way

1. **No reviewer is collected in Project mode.** A live assigned task must have at least one
   reviewer — a deferred constraint trigger refuses the transaction otherwise (ADR-0043 d.4). So the
   project branch *could not* assign, and was left booking-only. This is the root cause: a missing
   form field became a missing feature.
2. **"New task" creates the wrong thing in the wrong place.** It inserts a new **deliverable** — not
   a sub-task — into a stream literally named `General`, created on first use. Since ADR-0050 a
   campaign has ONE stream named for the campaign, so this manufactures a second one and the new row
   surfaces on the campaign page as its own section, never under the deliverable the person was
   looking at.
3. **The task's department does not follow its assignee.** `update_task_assignment` writes the
   assignee, dates, hours and reviewers, and never touches `department_id` — while the
   `/deliverables` add form passes the assignee's department explicitly. A materialised task carries
   the DELIVERABLE's department, stamped from its owner (ADR-0050). Give a Creative-owned
   deliverable's Shoot task to someone in Production today and the task stays counted under
   Creative, in every per-department metric.

## Options weighed

**A. Project mode assigns, through the same RPC the Edit modal already uses.** ✅ Chosen.
`public.update_task_assignment` writes the assignee, the reviewer list, the dates and the hours in
one transaction and reports `reschedule_needed`; the caller then invokes `subtask-schedule`, which
materialises the bookings. That is the assign-then-book direction the rest of the system already
runs, it is the path the schedule's own Edit modal uses, and it means this ADR adds **no new write
path** — it points an existing form at an existing RPC.

**B. Make `booking-transition` set the assignee.** Rejected. It is the smaller diff and the wrong
shape. The reviewer list, the no-self-review rule, the write-scope gate and the deferred
reviewer-required constraint all live around `update_task_assignment`; re-deciding them inside the
booking function makes a second home for every one of them — the failure ADR-0037 and I12.14 both
record. It would also leave two ways to assign a task that could drift.

**C. Leave Project mode as booking-only and assign from `/deliverables`.** Rejected: it is what
happens now, it contradicts ADR-0029 by name, and it means the schedule — the surface built for
handing work out — is the one place that cannot hand work out.

## Decision

1. **Project mode assigns a task; it never merely books one.** Submitting calls
   `public.update_task_assignment` (assignee, reviewers, dates, hours, review mode) and then
   `subtask-schedule`, exactly as the schedule's Edit modal does. The bare-booking path is gone from
   this branch.

2. **The campaign list is approved campaigns only.** ADR-0048 d.8 already refuses to assign work on
   an unapproved campaign, in the database, with a clear message. Listing those campaigns anyway
   offers a choice that always fails — the surface should not present work the system will refuse.
   Filtered on `campaigns.status = 'approved'`.

3. **The task list is the deliverable's UNASSIGNED live tasks.** `done` and `cancelled` are
   excluded — they are settled, and offering them is offering to schedule work that is over. **An
   already-assigned task is excluded too** (Edward, 30 Aug: *"these already surface on /schedule and
   can be reassigned from there"*). Once a task has somebody, it is a chip on the grid: drag it to
   move it, or open it to change the assignee through the Edit modal. Listing it here as well would
   be a second route to something that already has one, and would let two people hand out the same
   task from two places. The dropdown answers one question — **what work is still waiting to be
   given out** — which is what the person who opened it came for.

   *An earlier draft kept assigned tasks visible with the holder's name. Rejected on the ground
   above: the reassign path already exists and is better, because it moves the booking too.*

4. **A reviewer is required, and the picker is the same one ad-hoc uses.** Project mode collects the
   reviewer list on the same form, because a task cannot be assigned without one. Failing to collect
   it is what made this branch booking-only in the first place.

5. **The review mode is set here too** (ADR-0059 d.4): assignment is where the person deciding is,
   and Project mode is now an assignment surface. It arrives pre-filled from the task's own mode,
   which the materialiser stamped from its workflow step, so the physical steps read `manual`
   without anybody choosing.

6. **Project mode is offered on a HUMAN resource only.** Assigning work to a camera is meaningless.
   Booking equipment against a task is a real need and already has a home — the task's own resource
   requirements (ADR-0042) — so on an equipment or room resource the dialog offers a plain
   reservation and nothing else.

7. **A deliverable cannot be assigned.** Picking a deliverable and no task is removed. Edward:
   *"it will not work… it could assign 14 steps to one person."* Fanning out was the only reading
   that would have been useful, and on a fourteen-step pipeline it hands one person everything and
   consumes their capacity for all of it at once. Picking four tasks is clearer than one click that
   quietly did four things.

8. **"New task" creates a SUB-TASK under the selected deliverable.** Through
   `public.save_sub_task`, with the same assignee, reviewers and mode as any other task in this
   dialog. It therefore appears on the campaign page **under that deliverable**, in the task table,
   in the unassigned counts and in every metric — because it is an ordinary task, not a special one.
   **The `General` stream path is deleted**: both the client input and the arm of
   `booking-transition` that creates a deliverable from `campaignId + taskName`, so a second caller
   cannot reintroduce it.

9. **The task's department follows its assignee.** `update_task_assignment` stamps
   `department_id` (and `team_id`) from the person it assigns, the same values the `/deliverables`
   add form already passes. Without this, work given to Production stays counted against Creative in
   every per-department metric, and ADR-0053's whole point is that the department label is the
   truth about who does the work. **The write-scope gate is tested against the task as it stands
   BEFORE the change**, so this cannot be used to move a task out of a department the caller has no
   authority over.

10. **The requirements picker moves into Project mode too.** `StagedTaskResources` — the camera,
    the studio, the van a task NEEDS (ADR-0042 d.7, *"requirements are stated where the work is
    planned"*) — is currently offered only on the ad-hoc branch (`BookingDialog.tsx:317`). Project
    mode is now the surface where campaign work is planned, so stating a requirement has to be
    possible here or the person assigns the task and then goes somewhere else to add the camera.
    This is also what makes d.6 honest: equipment is attached to a task as a REQUIREMENT, from the
    assignee's own booking dialog, rather than by opening the modal on the camera's row.

11. **`booking-transition` keeps its plain-reservation and ad-hoc arms untouched.** Equipment, rooms,
    blackouts, series and every existing booking behave exactly as they do now. What is removed is
    the two Project arms — `deliverableId` and `campaignId + taskName` — and nothing else.

    **Verified before proposing, because "it only removes the project path" is the kind of claim
    that is wrong once and expensive.** Four checks:

    * **Ad-hoc on a person never reaches this function.** It calls `create_adhoc_deliverable` and
      then `subtask-schedule`, which writes `bookings` directly (`subtask-schedule/index.ts:159`).
    * **Ad-hoc on equipment or a room does reach it**, on the `notes`-only branch — no
      `deliverableId`, no `taskName`. Untouched by this.
    * **Exactly one place in the codebase sends either arm**: `BookingDialog.tsx:216-217`, the
      Project branch this ADR rewrites. Every other occurrence of `deliverableId`/`taskName` under
      `src/features/schedule/` is a READ shape — the chip label, the booking detail — not a caller.
    * **`bookings.deliverable_id` the COLUMN stays**, and `subtask-schedule` keeps writing it
      (`:145`, `:313`). That is what labels an ad-hoc chip (`taskName: b.deliverables?.name`). What
      is removed is the INPUT that lets a caller book against a deliverable with no task — not the
      column, not the read, not the chip.

12. **Existing deliverable-level bookings are left alone.** Rows already on the calendar with a
    `deliverable_id` and no `sub_task_id` stay, because they are somebody's real reserved time and
    deleting them would empty a week nobody agreed to empty. Removing the option stops new ones. If
    they should be reviewed, that is its own task and its own decision.

## Consequences

**Easier.** The end-to-end path a campaign was built for finally exists: approve it, open the
schedule, and hand its tasks out one at a time to real people who are then told about it. The
schedule stops being a calendar that only ad-hoc work can be assigned from. And the department a
task counts against becomes true rather than inherited.

**Harder.** Project mode grows the fields ad-hoc already has — reviewers, review mode — so the
dialog is longer. Two inputs to `booking-transition` disappear, which means the **Edge Function must
be deployed with or before the frontend**, or Project bookings fail; that is a deploy-ordering
constraint of the same shape as the ADR-0037/I21 skew.

**Locked in.** Assignment happens through `update_task_assignment` and nowhere else. That is the
point — one home for the reviewer rules, the scope gate and the department stamp — but it does mean
any future surface that wants to assign a task calls that RPC rather than writing the row.

**Not decided here.** What to do about existing deliverable-level bookings; whether a task should
be assignable to more than one person (it should not — additional people are resource requirements,
ADR-0042 d.1); whether the schedule should offer an unassigned-work queue rather than making you
navigate campaign → deliverable → task. That last one is worth revisiting once this is in use.

**Cost.** One migration (`update_task_assignment` re-emitted with the department stamp), one Edge
Function change (two arms removed), the Project branch of one dialog rewritten, EN and AR strings.
No new table, no new RPC, no dependency, no money.

## Testing

- **pgTAP:** assigning through `update_task_assignment` stamps the task's department and team from
  the assignee; the write-scope gate is evaluated against the task's PRE-CHANGE placement, so a
  caller cannot move a task out of a department they do not hold; assignment on an unapproved
  campaign is still refused with `42501` (ADR-0048 d.8, unmodified); a task assigned with no
  reviewer is still refused at commit (ADR-0043 d.4, unmodified); the assignee notification fires.
- **Unit:** the campaign picker lists only approved campaigns; the task picker excludes `done`,
  `cancelled` and anything already assigned; Project mode is not offered on an equipment
  resource; the task picker excludes an ASSIGNED task, so the dropdown is what is still waiting to
  be given out; submitting sends assignee + reviewers + review mode; the deliverable-with-no-task
  option is gone; "new task" calls `save_sub_task` with the selected deliverable and never
  `booking-transition`; the requirements picker is offered in Project mode.
- **Regression:** ad-hoc assignment is byte-for-byte unchanged — it is the half that works, and
  every existing assertion about it must pass unmodified. Explicitly including ad-hoc on EQUIPMENT,
  which does go through `booking-transition` and must keep working on its notes-only branch.

## Addendum — 22 Sep, from production (Edward)

**A lead assigns any task to someone within her reach; the deliverable's owner no longer gates
it.** A Creative team lead was refused an assignment of her own team member on an approved,
fully briefed campaign. The deliverable's owner sat in another department, so its unassigned tasks
were that department's (ADR-0050 d.2), and d.9's second sentence — *the write-scope gate is tested
against the task as it stands before the change* — held her out. Nothing about the person, the
campaign or the brief was wrong: the work belonged, on paper, to whichever department the account
manager had named an owner from. Two things were fixed the same evening — the dialog showing a
made-up sentence instead of the real refusal (I53.28), and a change of owner leaving the tasks
behind (I53.29, `20260922110000`) — and both were right and neither was the point. Edward:
*"implement the second fix where all leads can assign tasks irrespective of deliverables owner."*

**The rule now** (`20260922120000`). Assigning a task on an approved campaign needs
`project_tasks:manage` and the **assignee** within the caller's reach — the resource test already
in `update_task_assignment`, which turns a person outside it into a request that person's own lead
answers (ADR-0087). The task's department follows the assignee (d.9's first sentence, unchanged).
The gates stay: the campaign approved (ADR-0048 d.8), the deliverable's department's brief approved
(ADR-0072 d.6), a reviewer named (ADR-0043 d.4). **Editing** a task's title, dates or hours with no
change of assignee still asks that the task be within the caller's reach — a task's plan is its
own department's business until somebody takes it on.

What d.9's gate guarded against — *"a way to move a task out of a department the caller has no
authority over"* — is now the intended act: a lead pulling work onto her own people. What she still
cannot do is put it on someone she does not lead, or rewrite a task she has not taken on. d.9's
second sentence is withdrawn; the rest of this ADR stands. The RLS update policy on `sub_tasks` is
untouched — the RPC is SECURITY DEFINER and is the only door (Consequences, *Locked in*).

**Proof:** pgTAP 141 — a Creative team lead assigns a Content-owned task to her team member and the
task moves to Creative/Design while the deliverable stays Content's; a Motion-team person is a
request, not an assignment; an unbriefed department's task is still refused in the gate's words;
renaming Content's task without taking it on is refused; renaming it after taking it on is allowed;
a team member is refused for want of the grant. 140's "before: refused" step is retired to this
suite.
