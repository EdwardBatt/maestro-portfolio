# ADR-0083: A request is captured with its evidence, and the clock starts when the client asked

- **Status:** accepted (Edward, 11 Sep)
- **Date:** 2026-09-10
- **Open Decision:** advances `I35.6` — see d.4
- **Task(s):** I44 (SJ-02)

## Context

**This is the first screen behind the one door** ADR-0082 created: who asked, when they asked, the
proof, and what is being made. It is where a request becomes a record, and almost everything on it
already exists somewhere in the system — the value of the decision is in saying which existing thing,
because the Figma proposes new ones in three places where a built answer is already there.

**The design is a proposal, not a specification** (Edward, 10 Sep: *"the designer reports to me and I
am not waiting for him to change the designs… we will adapt the proposed design to suit. We need to
fix the actual work flow"*). Three of the decisions below overrule the mock, and they are recorded as
overrules rather than as descriptions so nobody later reads the Figma and thinks the build drifted.

**What exists and is being reused.** `campaign_brief_receipts` (ADR-0066) already carries `source`,
`received_at`, `received_tz`, `captured_at`, `model`, `confirmed_by` and `confirmed_at` — a model
reads the uploaded screenshot, proposes when the request arrived, and a person confirms it. The
screenshot is filed into the campaign's References folder by the ordinary asset path. Deliverable
types are a 269-row catalogue across 19 categories, seeded per tenant, searchable by name.
`app.tg_deliverable_stamp_department` records a deliverable's department from whoever owns it.
`useTeamLoad` computes capacity per resource with the department attached, and `CapacityBadge`
renders it at all three tiers (ADR-0018).

**What does not exist**: a client-contact entity, and any lead time to compute a due date from —
**0 of 269 deliverable types carry `lead_time_hours`**, measured on the seeded catalogue.

## Decision

1. **"Who asked" is free text.** Edward, 10 Sep: *"free text as it could be an internal request."*
   No contacts table. A contact worth keeping is a client-relationship feature; this field's job is to
   name whoever asked, and half the time that is somebody down the corridor.

2. **The evidence path is ADR-0066's, reused whole — including the model reading the screenshot and
   the person confirming what it read.** Edward: *"on the receipt all of it including human
   confirmation."* **This overrules the Figma**, which has the account manager type the arrival date
   and time by hand and labels the file *"Stored as proof, never read."* Two records of the same
   moment, one typed and one extracted, is how they drift; and the confirmation step already exists
   precisely so the machine's reading is never the last word.

3. **A single job is a campaign row.** Edward: *"as far as I am concerned a campaign is a project… the
   only difference is no campaign strategy, and a single job is typically one deliverable to one
   department."* So `campaign_brief_receipts.campaign_id` needs no change, and neither does anything
   else keyed to a campaign — chat, assets, the audit trail, the approval gate. **This is what makes
   the rest of the flow small**, and it is the same insight ADR-0082 d.8 rests on.

4. **Asking the client for written confirmation is a MANUAL step and nothing is built for it.**
   Edward: *"the request WhatsApp or email is a manual step, not a programmed step."* The account
   manager asks outside Maestro; when the reply arrives it is uploaded as evidence like any other.
   **This is what became of "Took it on a call"** (ADR-0082 d.5) — the mock offered to draft the
   confirmation, and Edward refused it: *"we cannot draft a confirmation message based on nothing."*
   **It advances `I35.6` without closing it**: the verbal brief now has an honest route to evidence,
   but a job still exists un-evidenced while the reply is awaited, and what that state costs is the
   leadership question ADR-0066 d.10 parked. It is no longer blocking, because the answer no longer
   has to be invented — it can be observed.

5. **Source is a fixed list**: WhatsApp · Email · Phone call · Meeting · Internal request · Other.
   *Internal request* is there because d.1 is: the requester may not be a client at all.

6. **The client's own words are recorded verbatim, separately from any summary.** The mock is right
   about this and the reason is worth keeping: *"Their words, not your summary. This is the line
   everyone reads back later."* A summary is a second, lossier record of the same thing, and the one
   people quote in an argument must be the one nobody edited.

7. **The due date is typed by the person creating the job. There is no proposed date.** Edward, 10
   Sep. The mock offers *"SLA proposes Thu 11 Sep"* and the system cannot honour it: **0 of 269
   deliverable types carry a lead time**, so any proposal would be invented. The moment those are
   populated the suggestion becomes possible; it belongs with `I41.10`, which is already the item for
   admin-adjustable scheduling numbers. Building a guess now would teach people to trust a number
   that means nothing.

8. **A department is chosen, never a person — and the department's LEAD becomes the deliverable's
   owner.** Edward, 10 Sep. This is not a workaround for the existing trigger, it is the same shape:
   `tg_deliverable_stamp_department` records the department from the owner, so naming the lead makes
   the department correct with no schema change, and the screen already says *"she picks the person."*

9. **Deliverables are owned by LEADS only. Team members are never owners; they are assigned tasks.**
   Edward, 10 Sep, correcting an earlier reading. A department lead may reassign to one of their team
   leads and no further. This is the rule that makes the later step unambiguous: whoever holds the
   deliverable — department lead or team lead — is the person who reviews and approves the generated
   task list before anyone is assigned anything.

10. **Capacity is shown beside the lead, for the week the work is DUE — not the current week.**
    Reuses `useTeamLoad` and `CapacityBadge` (ADR-0018), which already aggregate by department. The
    change of week is the whole substance: the mock reads *"team at 62% this week"*, and on an intake
    screen the due date is usually not this week, so this week's number answers a question nobody
    asked.

11. **Quantity does not split the deliverable** (ADR-0058 d.9, ADR-0071 d.8, unchanged). Three
    statics are ONE deliverable whose creation step becomes three tasks. Restated only because the
    mock's *"Ramadan teaser posts ×3"* invites the other reading.

## Consequences

**Easier.** The screen is mostly assembly: the receipt, the asset path, the type catalogue, the
department stamp and the capacity badge all exist and are being pointed at, not rebuilt. Because a
single job is a campaign row (d.3), everything already keyed to a campaign works on day one — a job
has a chat thread, an assets folder, an audit trail and an approval gate without a line being written
for any of them.

**Harder.** d.2 keeps a model in the intake path, which means the screen depends on an external
service being up and on somebody actually checking what it read — the confirmation step is doing real
work, not ceremony. d.7 ships a screen that visibly lacks something the design promised, and the
honest reason ("we don't know how long this takes yet") has to be legible, or it reads as unfinished.
And d.8 makes every department lead an owner of record on work they may never touch, which will show
up in any count of what a lead owns.

**Locked in.** That there is ONE record of when a request arrived, extracted and confirmed rather
than typed twice. That the client's own words are never overwritten by a summary. That a job and a
campaign are the same row at different sizes — so anything built for one is available to the other,
and promotion is a change of degree rather than a migration. And that ownership stops at team lead:
a deliverable is held by someone who assigns, never by someone who executes.

## Addendum — 11 Sep, after acceptance

**SJ-02 carries a job title, and it is required.** Edward, 11 Sep: *"there needs to be a job title —
all campaigns have a title; technically speaking the single job is still a campaign."* An omission
from the decisions above rather than a reversal of any, so it is appended, dated, and not folded in.
It follows directly from d.3: a single job is a campaign row, `campaigns.name` is `not null` and
unique per tenant, and the mock's own review screen shows one (*"Ramadan teaser posts ×3"*) without
ever asking for it. The title is what appears in the campaigns list, in the duplicate check
(SJ-A1 matches *"by client and name"*), and on everything the department lead sees.

## Not decided here

The department-specific detail screen (SJ-03), the duplicate check (SJ-A1), promotion to a campaign
(SJ-A2), adding a brand from the dropdown (SJ-A3), and the deliverable owner's review of the
generated task list. Each is its own step and is being specified in turn.

## Addendum — 11 Sep, from the independent review: d.9 gets its mechanism

**d.9 was accepted with no enforcement.** SJ-02 offered department leads only, and nothing else
did: `tg_deliverable_owner_guard` (ADR-0055) tests the caller's authority over the incoming owner
and says nothing about who the owner may be; the reassign picker on `/deliverables` offered every
user; the campaign wizard's owner picker did too. Edward chose to enforce it everywhere, campaigns
included (option A of three put to him).

**The rule, held by Postgres (`20260911130700`, test 107), in the scope model and never by a role's
name:** an owner is somebody whose role reaches beyond themselves — `roles.scope <> 'self'`. A team
member (and a portal user) is `self`; a department lead, a team lead and a deputy are not; neither
are the account manager, Traffic and Power Admin, who may hold a deliverable as the failsafe
ADR-0090 d.4 relies on. And a department- or team-scoped actor hands a deliverable on **within the
department it sits in** — "to one of his team leads"; a tenant- or account-scoped actor may move it
to another department's lead, being the people who could have placed it there.

**Campaign work only.** Ad-hoc deliverables are owned by their assignee by design
(`create_adhoc_deliverable`, a path ADR-0082 d.9 retires) and an internal project's deliverables by
its PM; both are job work with no stream, and the rule reads `stream_id`. **Existing rows are not
rewritten** — a deliverable a team member owns today keeps them until it is reassigned, and the
migration reports the count per tenant so the live ones can be handed to a lead by hand. The two
pickers offer only leads; a department lead's is narrowed to their own department.

## Addendum — 12 Sep, a deliverable always has an owner, and names a team lead when there is no lead

Testing the reassign control, Edward hit a **"Nobody"** option in the owner picker: *"Who the hell
decided no-one is a valid option?"* No one had — `deliverables.owner_user_id` is nullable and the
picker exposed the null as a choice; `tg_deliverable_owner_is_a_lead` (d.9, `20260911130700`) even
wrote "clearing the owner is the other guard's business" and let it through. This closes that, and
replaces the passive "the job will wait until an owner is named" with an active prompt.

**Decided (extends d.9; applies to campaign work — `stream_id` set — including single jobs and full
campaigns):**

- **d.11 — a campaign deliverable always has an owner.** "Nobody" is never offered in any owner
  picker, and the database **refuses to clear an owner that is already set** on stream work
  (`tg_deliverable_owner_is_a_lead`, amended). A deliverable may still be *born* without one (a
  department with no lead yet — born-null is allowed); a person may never strip one.
- **d.12 — no department lead → name a team lead, with the reason shown.** Where the deliverable's
  department has no lead, the picker does not fall silent: it offers that **department's team
  leads**, with a line explaining there is no department lead so a team lead must be named, and the
  assigner (the account manager at release; anyone with the reach afterward) chooses — **one if
  there is one, a choice where there are several.** Team members are still never owners (d.9 §1).
- **Where.** Both the **single-job release** (SJ — the AM names the team lead then, instead of
  releasing ownerless) and the **"Change owner"** control on the deliverable, and the **full-campaign**
  wizard's per-deliverable owner — the same rule everywhere (Edward: *"Both, same rules on full
  campaign"*).

Ad-hoc and internal-project deliverables keep their own owners (d.9 header) and are untouched.
Migration extends `20260911130700`; pgTAP `107` gains the clear-refusal and the team-lead fallback.

## Addendum — 15 Sep, whoever captures a request captures all of it; the account manager approves

**Tracker:** I48.38, I48.40. **Accepted** (Edward, 15 Sep, option A).

**What happened.** A real user, not the client's account manager, opened a single job on production.
The draft was created and the request text saved — but the receipt (the arrival and its screenshot)
was refused, with *"the evidence could not be saved"*, and at Approve they were refused again with
*"outside your reach. Its account manager can"* — naming nobody. Three screens in, nothing had said
who the account manager was, and the evidence was gone.

The cause is a stale copy. `campaign_brief_receipts`' write rule (`20260903100200`) was written as
*"the campaign's own write rule, verbatim"* — and five hours later `20260903150000` replaced the
campaign's rule, on Edward's instruction (*"anyone with project:manage can create, edit and
delete… we have audit tracking anyway"*), because the same person-is-not-the-AM refusal had just hit
the campaign wizard. The receipts table kept the old rule. `TASKS.md` notes that widening *"has no
ADR yet"*; this addendum is its record as far as capture is concerned.

> *"In such an instance everything should save until either the AM changed or the existing AM
> approves."* — Edward, 15 Sep

**Weighed.** (A) Capture follows the job: whoever may open a request may record its evidence;
approval stays the account manager's, and the refusal names them. (B) Stop the non-account-manager at
the first screen, before anything is typed. Edward chose **A**: capturing a request is clerical and
a colleague does it on the account manager's behalf; approving is the accountability point.

**Decision.**

- **d.13 — Capture is governed by `projects:manage`, not by account scope.** The receipt's write
  rule becomes the campaign's current one (`campaigns_tenant_write`, `20260903150000`): tenant +
  `projects:manage`. Whoever could create the draft can record its arrival and file its screenshot.
  Reading is unchanged. The audit trail (`captured_by`, `confirmed_by`, the trigger's stamps) is the
  control, as it is for the campaign row itself.
- **d.14 — Approval is unchanged and stays the account manager's** (ADR-0085 d.2, ADR-0073 d.4):
  `projects:manage` **and** `in_write_scope` over the campaign's responsible account manager.
- **d.15 — The refusal names the account manager.** `app.approve_campaign`'s 42501 carries the
  responsible account manager's name in its `detail` (or says none is set), and the screen says
  *"Only this client's account manager, {name}, can approve this job. It is saved for them."* When
  no account manager is set on client or job, the sentence says that instead and points at the
  client record.
- **d.16 — The job is left whole for the account manager.** A refused approval leaves the draft
  exactly as ADR-0085 d.8 already does — resumable from the campaigns list, with its request,
  evidence and brief intact — so the account manager's press is the only thing still owed.

**Consequences.** *Easier:* a request can be captured by whoever receives it, in full, and handed
to the account manager to approve. *Harder:* nothing structural — one policy re-emitted, one
function re-emitted with one line changed, one sentence. *Locked in:* the receipts table is no
longer a second copy of the campaign rule; if the campaign rule moves again, this one is named to
move with it. *Cost:* one migration, pgTAP (the receipts fence for a non-AM with `projects:manage`;
the approval refusal's detail), one string ×2, the retest.

**Testing.** pgTAP: a `projects:manage` holder who is not the client's AM inserts and updates the
receipt row; one without `projects:manage` still cannot; tenant isolation unchanged; the approval by
the non-AM is refused 42501 with the AM's name in `detail`, and by the AM succeeds. Retest B: the
request-step actor becomes `am2` (not Northwind's AM) for one run of B4, and the approval refusal
names `am`.

## Addendum — 27 Sep, the owner is chosen from the department's leads

**Amends d.8. Edward, 27 Sep:** *"the which team section defaults ownership of the deliverable to the
dept lead of the dept selected. it should offer a drop down choice of the dept lead and all team
leads so the user can select the owner."* Asked whether the choice starts on the department lead or
empty, he chose the department lead (option A).

- **d.17 — The owner is chosen, and starts on the department lead.** Step 3 of the single job shows,
  under the department, a drop-down of **all that department's leads** — its department lead, team leads
  and deputy team leads (Edward, 27 Sep: *"the list should include All leads"*, then option A: the chosen
  department's, not the company's) — each shown as *name · Department lead* or *name · Team lead*. The department lead is chosen until somebody picks another, so a job nobody
  touches is owned exactly as d.8 had it. Changing the department starts the choice again.
- **d.12 folds in.** With no department lead the same drop-down starts on "Choose a team lead…" and the
  job is not released until one is picked, as before.
- **Unchanged.** d.9 — only leads own deliverables, never team members; `tg_deliverable_owner_is_a_lead`
  already accepts a team lead, so nothing changes in the database. The person who does the work is still
  never picked here: the owner reviews the task list and assigns it.

- **d.18 — A single job may have more than one deliverable, on ONE department, owner and due date.** Edward, 27
  Sep: *"we need to be able to add a deliverable as only one is generated"*; asked, he chose one team and owner for
  the whole job, and one due date. d.3's "typically one deliverable to one department" keeps its second half: work
  for several departments is still what promotion to a campaign is for (ADR-0086). Tracked as `I54.33`.

*Built:* `WhoAndWhenStep.tsx` (the drop-down under the lead row), `SingleJobWizard.tsx` (the pick, kept
across Back and restored when a saved job is resumed). Tracked as `I54.30`.
