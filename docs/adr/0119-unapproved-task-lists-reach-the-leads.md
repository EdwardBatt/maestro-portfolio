# ADR-0119: A task list waiting for approval reaches the department's leads, and no campaign is exempt

- **Status:** accepted
- **Date:** 2026-09-27
- **Open Decision:** none
- **Supersedes:** ADR-0100 d.7 (the cut-over exemption); extends ADR-0090 d.4 and ADR-0108 d.2 (the `task_list` rung)
- **Task(s):** I59.61

## Context

Tracing production's 89 "unassigned" tasks (I59.59), 57 sat on task lists nobody had approved. Edward,
27 Sep: *"the tasks list that have not been approved need to be displayed as well… this should show up
for the dept and team leads as an exception on their my work page."*

What the system did with an unapproved list:

- **The owner's Needs you** had an "Approve task list" card, and nobody else's did.
- **After 24 hours** it escalated to the Traffic Manager and the account manager, not to the leads.
- **A campaign approved before the task-list gate** (`task_list_gate_from`, 25 Sep, ADR-0100 d.7) was
  left out of both. Its work could also be **assigned without its list being approved**: d.7 exempted it
  so that 115 running deliverables would not become unassignable on the day the gate shipped.

That exemption now works against Edward's rule (ADR-0118): *"Tasks from task lists that are approved and
not assigned count as unassigned… Once approved, they are real tasks."* The Team page counts only
approved lists, so unapproved older work was assignable but counted nowhere and asked of nobody.

Edward's answers, one question at a time, 27 Sep:

1. Who sees it: **the department lead and every team lead of the deliverable's department**, plus the
   owner. (Rejected: the department lead only; only the team leads whose teams have tasks on the list.)
2. Team leads approve it from the card: they hold `deliverable_owner:manage` on production (Permissions
   page), which reaches their whole department.
3. **Older campaigns show too.** (Rejected: keep them out, as d.7 did.)
4. The older ones escalate **from release day**, so the backlog gets a day on the cards before it reaches
   Traffic. (Rejected: no escalation for them; escalate them all at once.)
5. **One rule for all work.** Older work waits for its list to be approved, like new work. (Rejected:
   keep older campaigns exempt, which would have reversed 3 and 4 and needed the Team page to count their
   unapproved tasks.)

## Decision

1. **No campaign is exempt from the task-list gate.** Work on a campaign approved before 25 Sep cannot be
   assigned until its task list is approved (`app.deliverable_work_acceptance_refusal`). Work already
   assigned is not touched, and no approval is written for anybody, so ADR-0100 d.7's point about the
   record still stands.
2. **The card reaches the leads.** An unapproved task list is on the Needs you of its owner, its
   department's lead, and every team lead (a team-scope role, so deputies too, as for escalations) of a
   team in that department, where that person may approve it (`app.may_approve_deliverable_tasks`). The
   department is the deliverable's own (its owner's, when it has none).
3. **One clock for the card and the escalation.** A list waits from its campaign's approval, or, for a
   campaign approved before the gate, from the release that brought this in (`task_list_backlog_from`).
   `app.task_list_waiting_since` answers it for both, so the card's "escalates in…" and the sweep agree.
   Escalation recipients are unchanged: Traffic Manager and the account manager, 24 hours.

## Consequences

*Easier:* every unapproved list is in front of someone who can approve it, and older work joins the same
rule as new work, so Unassigned (ADR-0118 d.3) and the gate agree.

*Harder:* on release, leads see a backlog of older lists at once, and none of that work can be booked
until its list is approved. A day later, whatever is still unapproved escalates in one wave.

*Locked in:* the task-list gate has no date exemption.

*Cost:* one migration (two new helpers, three functions re-emitted, one setting), pgTAP 190. No UI change:
the card already existed.

## Addendum — 1 Oct, approving a list removes the bell notices that asked for it (I67.10)

**Accepted (Edward, 1 Oct).** Edward chose B: the notices are **removed**, not marked read.

The Needs you card goes for everyone the moment one person approves a list (`my_pending_approvals` reads
`tasks_approved_at`). The bell did not: each person's notice is their own row, so the owner's ask and the
escalations stayed unread and kept the red count up.

1. **When a deliverable's task list is approved** (`tasks_approved_at` goes from empty to set), every notice
   **on that deliverable** that asks for the approval is deleted, for every recipient:
   - `escalated` with `detail.kind = 'task_list'` — the 24-hour escalation to Traffic and the account manager
     (not the "every task was cancelled" case, which asks for something else);
   - `deliverable_added` with `detail.for_owner` — the new owner's "review its task list and approve it";
   - `deliverable_reassigned` where the list was not yet approved when it was sent;
   - `deliverable_type_changed` — "its task list was replaced; review it and approve it";
   - `campaign_approved` raised on the deliverable itself (a single job's owner).
2. **A campaign's `campaign_approved` notice** covers every piece its owner holds, so it goes only when **every**
   live piece that person owns on the campaign has an approved list. A recipient who owns nothing on it (a
   lead) keeps theirs.
3. **Kept:** `deliverable_edited` (it reports what changed, not only the ask), and every other notice.
4. **An open bell refreshes.** A deleted notice broadcasts `notification_removed` on the person's own topic, so
   the list and the red count reload without a chime.
5. **`security definer`** (AGENTS.md: an ADR is required). The approver may not delete another person's notice
   under row-level security, so the trigger function runs as its owner. It is safe because it is a trigger, not
   callable, it acts only on the deliverable whose row just changed, and only on the types above; the approval
   itself was already checked by the existing guards.

*Consequence:* nobody's bell keeps a record that they were asked; the approval itself stays on the deliverable
and in the audit log. A list re-opened later raises fresh notices as before.
