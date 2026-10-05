# ADR-0100: A campaign has one brief, and no department briefs

- **Status:** accepted — **d.7 superseded by [ADR-0119](0119-unapproved-task-lists-reach-the-leads.md) (27 Sep): no campaign is exempt from the task-list gate**
- **Date:** 2026-09-23
- **Open Decision:** none — this arises from the v3 Figma (section C)
- **Supersedes:** ADR-0072 in part; amends ADR-0050 d.3/d.4/d.5 and ADR-0070
- **Task(s):** `I56.2` (this ADR), gating `I56.3`–`I56.13`

## Context

Edward, 22 September, relaying the designer: *"no department level briefs required… one brief fits
all on a campaign brief."*

Today a campaign has a **master brief** plus **one brief per department**, and the department brief
is not a document — it is a **gate**. Three things hang off it:

- **ADR-0072 d.6** — *"the department generates, edits, reviews its tasks, and approves to issue →
  only then are that department's tasks assignable."* Assignment is refused until the department has
  approved its own brief.
- **`I53.22`** — an unwritten department brief appears on My Work as something owed: *"Write
  Creative's brief for LUMA Season 2."*
- **ADR-0070** — who may approve one, computed in Postgres from grants and scope
  (`department_brief_approvers`), narrowed twice after Edward read the list live.

So removing department briefs is not deleting a screen. It is **removing a gate that currently
stops work being handed out**, and the ADR has to say what stands in its place — otherwise the
answer is "nothing", and a campaign's work becomes assignable the moment it is approved, whether or
not anybody has written down what is wanted.

### What is actually on production

Measured 23 September on the seeded local copy of the tenant's shape: **216 department briefs, 203
of them written, 164 approved.** These are not empty rows. They are the record of who accepted what,
and several of them are the only written statement of what a department was asked to do.

### Why the department brief existed at all

ADR-0050 d.3/d.4 split the brief by department because the *type* differed: *"a shoot needs the
Production brief, a month of posts needs the Social brief."* One document could not be both.

Section C removes that premise. `I56.5` fixes the campaign brief as **always the 360 Creative
Brief, 17 fields, no picker** — and `I56.5`'s parts mechanism (Q7) lets one template carry sections
for different kinds of work. The reason for splitting is gone, so the split goes with it.

### Options weighed

**A. Keep the department brief as an optional document, drop only the gate.** Rejected: an optional
document that gates nothing is a document nobody writes, and the tab stays on the screen implying
work that nobody owes. Half a feature is worse than either whole.

**B. Remove the department brief and let campaign approval be the ONLY gate.** This was the draft's
recommendation and Edward rejected it: *"The assigned deliverables owner has to review and approve
the tasks before the tasks can be assigned. This is now the second gate."* He was right to. Campaign
approval is the account manager's act, taken before the work is created; it says the campaign is
agreed, not that anybody has read what they are being asked to make. Leaving it as the only gate
would have removed a check rather than moved one.

**C. Replace it with a per-workstream acceptance** — the group's owner accepts the work before it is
assignable. Considered and not taken: it invents a new gate, and there is already one that does the
same job at a finer grain (option D).

**D. The deliverable's owner approves its task list — the gate single jobs already use.** Chosen.
Edward, 23 September: *"The assigned deliverables owner has to review and approve the tasks before
the tasks can be assigned. This is now the second gate."*

This is not a new idea and not new code. ADR-0090 built exactly this for single jobs, and
`app.deliverable_work_acceptance_refusal` already forks on it:

```
when c.kind = 'single_job' then   -- the owner approved the task list?
else                              -- the department approved its brief?
```

Taking option D deletes the second branch. One rule for all work: **the person accountable for a
deliverable reads its task list and accepts it before anyone is assigned.** It is also a *better* gate than
the one it replaces — per deliverable rather than per department, and answered by the named person who
owns the work rather than by whoever in a department happens to hold `briefs:approve`.

## Decision

**d.1 — A campaign has exactly one brief.** The campaign brief, always the `360` Creative Brief
template, no type picker (`I56.5`). `campaign_briefs` stops being written to for new campaigns.

**d.2 — There are still two gates. The second one changes hands.** The campaign's approval by its
account manager stays exactly as it is (**ADR-0072 d.7 untouched**). ADR-0072 d.6's second gate — the
department approving its brief — is replaced by **the deliverable owner approving its task list**,
which is ADR-0090's gate extended from single jobs to all work. `deliverable_work_acceptance_refusal`
loses its `kind` fork and applies one rule everywhere.

So the ordering becomes: the account manager approves the campaign → the work is created and owned →
**each owner reviews their deliverable's task list and approves it** → that deliverable's tasks are assignable.
The acceptance moment is not lost; it moves from a department to the named person accountable for
the deliverable, and from one-per-department to one-per-deliverable.

**d.3 — Existing department briefs are KEPT and set aside** (Edward, 23 September). Every one of the
216 rows stays exactly where it is. They no longer gate anything, they are never asked for again,
and nothing is written to them. They remain readable on the campaign as a record of what a
department was asked to do and who accepted it. **Nothing is deleted and nothing is migrated into
the campaign brief** — merging 216 briefs into 216 campaign briefs would be a guess at what belonged
where, made by a script, over the only written record of several campaigns.

**d.4 — "Write your department's brief" stops being owed.** `I53.22`'s `department_brief_unwritten`
and `department_brief` rows leave `my_pending_approvals`. Nobody is asked for a document that no
longer exists. (This also removes the branch that `I54.25` found was scanning every task in the
tenant — but that is a side effect, not a reason.)

**d.5 — The department tab becomes the workstream's, not the brief's.** The campaign page keeps one
tab per department (`I40`'s layout survives), showing that department's workstreams and their
deliverables. Where a campaign carries an old department brief, the tab shows it, marked plainly as the
record it now is — not as something to act on.

**d.6 — ADR-0070's approver machinery is retired, not deleted.** `department_brief_approvers`,
`approve_department_brief` and `reopen_department_brief` stop being called. They stay in the schema
until a later, separate change removes them, because fifteen pgTAP suites drive that state and
tearing them out in the same migration that moves the gate would make a failure impossible to
attribute. This is the same reasoning as `I40.25`.

**d.7 — Work already running is not stopped, and nothing pretends a person approved it.**
Measured 23 September: **115 campaign deliverables on approved campaigns, none with an approved task
list** — they never needed one. Applying d.2 to them would make every one unassignable on the day it
ships. So the gate applies to campaigns approved **after** this change: `approved_at` before the
cutover is exempt, by date, and no approval is written for anybody. Stamping `tasks_approved_at` on
115 rows would be quicker and would put a lie in the record — a deliverable marked approved by nobody, in
the audit trail, for ever.

**d.8 — Every deliverable has an owner, and the database enforces it.** The second gate is answered
by the owner, so a deliverable with no owner is work nobody can accept and nobody can start. This was
already decided — `I22.5`, **28 August**: *"the PM is now required — a campaign cannot be created
without an owner per deliverable either"* — and it was built as a **screen rule only**. The wizard
refuses to submit without one; `deliverables.owner_user_id` is still nullable, with no constraint and
no trigger. It holds today (0 of 115 rows unowned) because one screen asks nicely. Edward, 23
September: *"it should be mandatory to assign a deliverable an owner when the am sets up the
campaign.. this is now the second time I have had to mention this."*

So: `owner_user_id` becomes **NOT NULL**, and every create path supplies one or is refused by the
database rather than by a dialog. The model's proposal (ADR-0097) still returns no owner — it
proposes what to make, never who makes it (ADR-0050 d.6) — so the account manager fills it in before
the rows are written, which is what the wizard already makes them do.

**d.9 — The approval surface does not change shape: one page, review everything, approve all or
selected.** Today a campaign's department tab carries **one** Approve button, and that single act
releases every deliverable of that department. That shape is right and it stays. What changes is
what is being approved — the department's task lists rather than the department's brief — and that
approval can now be **partial**: approve all of them, or tick the ones that are ready and leave the
rest.

Edward, 23 September: *"The deliverable owner is typically going to be one .. max 2 people per
department, they can review all tasks for all deliverables on one page … then they can approve all
or selected ones."*

So the number of people and the number of passes do not change. A department's work is still
released by one or two people in one sitting on one page. **It is not a button per deliverable**, and
ADR-0090's per-deliverable block on a single job's page stays as it is — a single job has one
deliverable, so one is all there is.

**d.10 — The campaign brief may be edited after approval, as it can today.** ADR-0072's editing rule
(`projects:manage`, mirroring the RLS) applies to the one brief. Removing the department brief must
not remove the ability to correct the words.

**d.11 — Nothing here changes who may assign.** ADR-0060's addendum of 22 September stands: any lead
assigns any task on an approved campaign to a person within her reach. This ADR removes a gate; it
does not widen a reach.

## Consequences

**Easier.** One brief, one approval, one place the words live. A department stops being asked to
restate what the campaign brief already said — which, read honestly, is what the department brief
had become. The campaign path loses a whole gate, and with it a class of "why can nobody assign
this?" that has cost several days.

**Harder — and less than the first draft of this ADR claimed.** That draft said this multiplied the
approvals, one per deliverable instead of one per department, and called it a real cost. It is not:
owners are one or two people per department (d.9), they review on one page as they do now, and they
approve all or selected. Same people, same sitting, same page. The draft's arithmetic assumed a
different owner per deliverable, which is not how the agency works.

What genuinely gets harder is smaller: **the approval is no longer a single yes/no for a
department**, so a partly-ready department is a real state — some task lists accepted, some not, some
work assignable and some not. The screen has to say which, and "why can nobody be booked onto this
one?" has to be answerable at a glance. That is a display problem, and `I56.3` owns it.

d.8 closes the hole that made this possible to get wrong: an unowned deliverable would have been work
nobody could accept, permanently unassignable, and nothing in the database would have stopped one
being created.

**Locked in.** One brief type for every campaign. A campaign spanning Production and Social is
written in one 360 brief with parts, or not written at all. If a tenant ever needs a genuinely
different campaign brief, `I56.5`'s no-picker rule is what has to give, and that is a new ADR.

**Kept, deliberately.** 216 rows of history that nothing reads. They will look like dead schema to
whoever finds them next; d.3 is why they are there, and the migration comment must say so.

## Addendum — 4 Oct (Edward): who approves a deliverable's task list

Edward, 4 Oct: *"the deliverables owner, other team leads from the same department and the department lead"* — and,
asked, yes to keeping the Traffic Manager and the Power Admin as the failsafe for an absent owner (ADR-0070, 3 Sep),
and yes to a Deputy Team Leader counting as a team lead. So a task list is approved by:

- its **owner**;
- the **department lead, team leads and deputy team leads of the deliverable's department**;
- the **Traffic Manager and the Power Admin**, the failsafe.

Never the account manager, the Account Director, another department's leads, a C-level role, or a team member who is
not the owner. Found 4 Oct (`I74.51`): the campaign page offered the account manager "Approve N tasks" and the server
refused her; and the server's rule — `deliverable_owner:manage` within the department — let the Account Director in and
kept every team lead out (the role does not hold that grant).

Built in `app.may_approve_deliverable_tasks` (`20261004180000`): the owner, or a role that books (`bookings:create`,
ADR-0139's mark of a lead) whose reach is the organisation, a department or a team, inside the deliverable's
department. No role is named (ADR-0073/0074). The button reads the server's own answer (`can_approve_tasks`), and every
"waiting for you" list that offers a held task list filters on the same predicate, so the leads who may approve are
the leads who are asked. pgTAP 231.

**"Approve all mine" means what she owns** (Edward, 5 Oct, A). With the leads able to approve a colleague's list, the
campaign page's bulk "Approve all mine (N)" took every list she may approve — a team lead clearing her own queue
approved the department lead's "Social statics" too. It now takes only the lists she owns; a colleague's list is
approved by a deliberate tick ("Approve selected") or its own Approve (`TaskListsApproval.tsx`, `isMine`).

