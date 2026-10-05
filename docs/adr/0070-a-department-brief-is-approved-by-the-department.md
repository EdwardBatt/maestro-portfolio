# ADR-0070: A department brief is approved by the department, and work waits for it

- **Status:** accepted (Edward, 3 Sep)
- **Date:** 2026-09-03
- **Open Decision:** —
- **Task(s):** `I37.1`–`I37.4`. Extends [ADR-0048](0048-briefs-are-generated-per-discipline-and-approved-before-work-starts.md)
  d.8's approval gate with a second stage; relates to ADR-0009 (departments and lead roles),
  ADR-0050 (a brief belongs to a department), ADR-0055 (a permission is added when the job differs),
  ADR-0066 (the T+1 clock, **unchanged** by this — see d.9)

## Context

Edward, 3 Sep: *"the department level briefs are actually the responsibility of the department
leads… when the account manager approves the brief, the department level briefs need to be delivered
to assigned department leads, the department leads then approve the department level brief and only
then can the tasks be surfaced and assigned."*

Today there is **one** gate. ADR-0048 d.8 made a campaign's work unassignable until the campaign is
`approved`, and `app.tg_sub_task_assignment_gate` enforces it through a single predicate,
`app.campaign_is_approved`. The account manager approves, and every department's work becomes
assignable at once — including work for a department that has not yet read its brief, let alone
agreed it can be done.

### What does not exist yet

- **`campaign_briefs` has no approval state.** No `approved_at`, no `approved_by`, no status. The
  table has carried `values` and `brief_type` since 27 August and nothing else. This is not a field
  to set; it is a concept to add.
- **There is no *assigned* department lead.** `department_lead` is a ROLE with scope `department`
  (ADR-0009), and a person's department comes from `user_profiles.department_id`. Nobody is named
  as *the* lead of a department anywhere in the schema.

### The trap this walks towards, which this project has already fallen into once

Putting a second gate in front of every department's work means that if nobody can open it, that
work stops permanently. That is exactly what happened on 29 August: `app.approve_campaign` resolves
its approver as `coalesce(campaign, client)` account manager, and a campaign under a client with
neither **could be approved by nobody** — it sat at `pending_approval` for ever with nothing under it
assignable, and it took a migration to fix.

Rebuilding that one level down, once per department, would be worse: more gates, more ways to jam,
and the person who could fix it is not the person blocked by it.

Edward's answer has two parts. It widens who may open the gate — *"a department lead, or assigned
team lead for the department"* — so a department with no lead but a team lead can still move. And it
names an explicit failsafe: *"Power Admin and Traffic Manager have full access… in the event of being
blocked due to absence."*

That is the right shape. The 29 August deadlock existed because there was exactly one route and it
could be empty; here there are three, and the last of them belongs to people whose job is already to
keep work moving across the agency. The residual risk is not a jam but a habit — see the
Consequences.

### Which department gates a task, and it is not the task's own

`sub_tasks.department_id` is stamped **from the assignee** (ADR-0050 d.2, ADR-0060), so a task can
sit in a different department from the deliverable it belongs to — a Creative deliverable with one
step done by Production is ordinary, not an edge case.

Edward, on being asked which brief gates such a task: *"deliverables carry the brief, a task for the
deliverable should refer to the same brief."* That is the right answer and it is also the simpler
one: the gate reads the DELIVERABLE's department, so every task under a deliverable is governed by
one brief, and moving a task to another assignee cannot silently change which brief governs it.

### The T+1 clock does not move

Edward's first framing had department-brief approval closing the T+1 clock. On working it through he
revised it: *"The T+1 clock only relates to the campaign brief itself being approved, the T+1 does
not yet apply to the department brief, but no doubt we will need to add a T+ on that also."*

So **ADR-0066 d.7 is untouched** — the clock still ends at `campaigns.approved_at`. A department-level
threshold is anticipated and deliberately not built here: it would need its own answer to "from
when, and to when", and ADR-0066's own d.10 question about unevidenced work is still with leadership.

What IS wanted now is visibility without a clock: a department brief awaiting approval must be
**listed as an exception**, so a brief nobody has looked at is findable before somebody asks why the
work has not started.

## Decision

**d.1 — A department brief is approved, and the approval is a state on the brief.**
`campaign_briefs` gains `approved_at` and `approved_by`. Unapproved is the absence of a timestamp,
as `campaigns.approved_at` already does it — no parallel status column to keep in step.

**d.2 — Approval is a DIFFERENT JOB from editing, and gets its own permission.** New
`briefs:approve`, seeded to `department_lead` and `team_lead` — the people whose department it is —
**and to `power_admin` and `scheduler` (Traffic Manager) as the failsafe** (Edward, 3 Sep).

Editing a brief stays on `projects:manage`, which is what the account manager holds, so the person
who WRITES a brief is not by that fact the person who ACCEPTS it. ADR-0055's test applies: a
permission is added when the job differs, and *"is this something my department can do?"* is not
*"is this brief well written?"*.

**d.3 — And it is scoped to the department the brief belongs to, EXCEPT for the two roles that
carry the whole agency.** The approver must hold `briefs:approve` **and** be in write scope of that
department — `app.in_write_scope`, the existing primitive (ADR-0037), which already resolves a
department lead's department, a team lead's team inside it, and the ADR-0036 per-user overlay. A
team lead may approve their own department's brief; a lead of another department may not.

**Power Admin and Traffic Manager are account-scoped, so that same primitive already passes them for
every department.** No exception is written for them and none is needed — the failsafe falls out of
the scope model rather than being bolted beside it, which is why it cannot drift from it. Edward,
3 Sep: *"in the event of being blocked due to absence, this is the built-in fail safe."*

Handing approval to one named person temporarily — a stand-in while a lead is away — needs no new
mechanism either: ADR-0036's per-user grant overlay already does exactly that, and it is audited and
revocable, which a role change is not.

**d.4 — Work waits for it.** `app.tg_sub_task_assignment_gate` gains a second condition: the task's
DELIVERABLE's department brief must be approved. The gate still governs assignment only — a pending
brief's tasks can be created, renamed and re-dated, because that is what preparing work is.

**d.5 — A deliverable with no department, or a campaign with no brief for it, is NOT blocked.**
Briefs are generated per department that has deliverables, and generation is on demand: a gate that
refused work until a brief existed would stop a campaign whose briefs nobody has generated yet, with
no signal saying why. Absence is not refusal. What is absent is instead **shown** (d.7).

**d.6 — Approving the campaign DELIVERS its department briefs.** Each department with a brief gets a
notification — in-app **and** email (Edward, 3 Sep) — naming the campaign and the department, linking
to the brief, and saying plainly that work cannot start until they approve it. Sent to the people whose department it is — the
department and team leads of d.2 — and **not** to Power Admin or Traffic Manager, who can approve
anything and would therefore receive every brief in the agency. The failsafe is a capability, not a
queue. Where a department has no lead at all, nothing is sent and the exception in d.7 is the only
thing that will say so, which is precisely why d.7 is not optional.

**d.7 — A brief awaiting approval is an EXCEPTION, listed.** On the dashboard beside the other
exception panels, and on the campaign page against the department it belongs to. It carries **no
clock** (d.9), so it is a list of what is outstanding rather than a judgement about lateness — and
it lists a department with **no possible approver** distinctly, because that one cannot be fixed by
waiting.

**d.8 — Approval is reversible only forward.** A brief can be approved once; there is no un-approve.
Sending work back is what the existing brief edit is for — ADR-0048 d.9 deliberately refused a
changes-requested state on the grounds that the approver is the corrector, and that reasoning holds
here. Editing an approved brief is allowed and does not revoke the approval; the audit trail records
both.

**d.9 — The T+1 clock is UNCHANGED and still ends at `campaigns.approved_at`** (ADR-0066 d.7).
A department-level threshold is anticipated (Edward: *"no doubt we will need to add a T+ on that
also"*) and deliberately not decided here.

## Amendment — 3 September 2026: the account manager may approve

Edward, during implementation: *"the account manager can approve their own brief, even if they
created it."*

`briefs:approve` is therefore granted to `account_manager` as well. Their scope is `account`, so it
reaches the campaigns they own and no further — an AM cannot approve another AM's work.

**This overrules the writer/approver separation d.2 argued for**, and the argument is left standing
above rather than edited out, because it is the reason to watch what happens next: on an AM-owned
campaign the second gate no longer guarantees a second pair of eyes. What it still guarantees is
that approval is **recorded against a named person** (d.1) and that work does not start before
somebody accepts the brief. If the audit later shows account managers approving most department
briefs, that is the same signal the Consequences already names for the failsafe roles — not a
broken gate, but an answer to a different question about who is reading these.

`briefs:approve` remains distinct from `projects:manage` so that holding it stays a deliberate
grant rather than a side effect of being able to edit — which is what keeps a Team Member out.

## Consequences

**Easier.** The people who have to do the work get told it is coming, in the place they read, with
the brief one click away — and they say yes before their names appear on tasks. An account manager
approving a campaign stops being the moment six departments discover simultaneously that they are
committed to something.

**Harder, and this is a real operational change in a live pilot.** There is now a second gate in
front of **all** campaign work: a slow approval stops work rather than merely delaying a document.
**That is the intended behaviour** — it is what "only then can the tasks be surfaced and assigned"
means — and it is written here so that when it bites it is recognised as the decision rather than as
a bug.

**The failsafe's real risk is habit, not deadlock.** Power Admin and Traffic Manager can approve any
department's brief, so nothing can jam — but an approval given by Traffic on behalf of a department
that never read the brief is the whole feature defeated, quietly, one campaign at a time. Two things
guard against that and neither is a restriction: approvals record **who** gave them (d.1), and d.7
lists a department with **no possible approver** distinctly, so a missing lead is a gap to fill
rather than a permanent detour. If the audit ever shows Traffic approving most department briefs,
that is the signal — not a failure of the gate, but the answer to a different question about who is
actually reading these.

**A new notification type needs COPY in `notify-email` or it is silently in-app only** — the failure
mode that constraint's own comment records having produced six times.

**Locked in.** A deliverable's department decides which brief governs its tasks. Moving a task to an
assignee in another department changes the task's own `department_id` and does NOT change which
brief gates it — one deliverable, one brief, whoever ends up doing the steps.

**Not done here.** A T+ threshold on department approval (d.9); an un-approve path (d.8); and any
automatic reassignment or escalation when a brief sits unapproved — ADR-0045's `stall-sweep` is the
right home for that and it is still unbuilt (`I14.7`).

## Addendum — 16 Sep, an approved brief is locked; the approver re-opens it (reverses d.8)

Edward, 16 Sep, reading the audit log: a lead outside the department had edited an APPROVED
department brief, and the line said only *"Department brief · 04e20210"*. Two things were wrong,
and d.8 was one of them.

**What the code allowed.** `campaign_briefs_manage_update` was `projects:manage` and nothing else
(`20260827220000`) — no scope test, no state test. `approve` had tested scope since 3 Sep; `update`
never did. So any `projects:manage` holder could rewrite any department's brief, approved or not,
and d.8 blessed the approved half of that: *"editing an approved brief is allowed and does not
revoke the approval."*

**d.8 is reversed** (Edward: option A, over "editable after approval by that department's lead or
the AM, in scope, logged"):

- **d.8a — Approval locks the brief.** `campaign_briefs_manage_update` is `projects:manage` AND
  `app.in_write_scope(department_id, null, campaign account manager)` AND `approved_at is null`.
  An approved brief refuses every edit, including its approver's.
- **d.8b — The approver re-opens it.** `reopen_department_brief(p_brief)`: the same authority test
  as `approve_department_brief` (d.2/d.3 — the department's leads by scope, the account manager,
  Traffic and Power Admin), clears `approved_at` / `approved_by`, and writes its own audit line
  `department_brief_reopened` naming who, with the previous approval in the payload. Idempotent on
  an unapproved brief.
- **d.8c — Re-opened means unapproved, with everything that follows.** d.4's gate holds NEW
  assignments on the department's deliverables until the brief is approved again. Work already
  assigned is untouched. The campaign page shows *locked — re-open it to make a change* beside the
  approval, hides Edit, and offers **Re-open** (confirmed, because of d.8c) to whoever might hold the
  authority — the server decides (d.3).
- **d.8d — Scope on update was always intended.** The addendum records the scope test as a fix,
  not a decision: the approve/update asymmetry was an omission.

Migration `20260916120000`; pgTAP `123`; `I51.3`. Also in that migration, unrelated to this ADR but
found by the same audit line: every tenant table gains `created_by` / `updated_by` (`I51.1`).

## Addendum — 20 Sep, a brief nobody has written is not approved (d.5 narrowed by ADR-0072 d.6)

Edward, 20 Sep, on LUMA Season 2 — approved, no department brief generated: *"you are making
deliverables available for assignment on the schedule when the tasks have not been approved."*

**What the code did.** `app.sub_task_brief_is_approved` (`20260903130000`) implemented d.5 as
written — *a campaign with no brief for it is NOT blocked* — so every deliverable of a campaign whose
departments had not yet generated their briefs was assignable, and the `/schedule` picker offered
them. **ADR-0072 d.6 (5 Sep) had already settled the ordering:** the account manager approves the
campaign → the department is told → the department generates, edits, reviews its tasks and approves
→ *only then* is that department's work assignable. Edward, 11 Sep, recorded in ADR-0090: *"only
once approved do they surface for selection."* d.5's reason — a gate that refused work until a brief
existed would stop a campaign *"with no signal saying why"* — was answered by d.7 and ADR-0072
d.6 together: the campaign page lists the departments still owing a brief, and the department is
notified at approval. The signal exists; the refusal may now stand on it.

**d.5 as it now reads.** A campaign deliverable whose department has **no brief on the campaign** is
held exactly as one whose brief is unapproved: missing is unapproved. The "no department" exemption
goes with it — Edward, 20 Sep: *"it is not possible for a deliverable not to be assigned an owner"*
(ADR-0083 d.8, ADR-0055 d.10; every door requires the owner and the department is stamped from it,
ADR-0050 d.2), so an exemption for a state the product cannot produce would only be a hole. Ad-hoc
work alone stays outside the gate: it has no campaign. Migration `20260920150000`
(`app.deliverable_brief_is_approved`, `app.deliverable_work_acceptance_refusal`); pgTAP 133 and 083.
The refusal message is unchanged. Nothing already assigned is touched — the gate governs new
assignments, as it always has.

## Addendum — 22 Sep, recording 21 Sep: an unwritten brief is owed on My Work (d.6 extended)

**Edward, 21 Sep, on `I53.22`.** `my_pending_approvals()` (I53.16) listed a department brief only
once a `campaign_briefs` row existed unapproved — "delivered by the campaign's approval and not yet
accepted". After a campaign's approval the department whose brief had not yet been GENERATED saw
nothing on *Waiting for you*; only the mail said anything, and it spoke of reviewing a brief that did
not exist. Edward: *"the pending should also appear with correct link on their my-work page as a
pending action."*

**d.6a — Writing the brief is owed, and shown.** An approved campaign that gives MY department work
and has no written brief for it (no row, or the emptied row a promotion leaves — ADR-0086 addendum)
is a row of kind `department_brief_unwritten` on My Work — *"Write Creative's brief for LUMA Season
2"* — for the department's own people who can write it (`projects:manage`, which Generate asks for),
in scope. The row opens the campaign on the department's tab (`?tab=<department>`); it becomes the
approval row once the brief is written and leaves once approved. Never the account manager, never
a team lead who cannot generate. `20260921130000`; pgTAP 137. A department with no lead
(Production) still has nobody in-department to write its brief — the account manager does; noted,
not changed.
