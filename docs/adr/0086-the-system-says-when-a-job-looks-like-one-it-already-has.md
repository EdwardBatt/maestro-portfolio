# ADR-0086: The system says when a job looks like one it already has, and a job can grow into a campaign

- **Status:** accepted (Edward, 11 Sep)
- **Date:** 2026-09-11
- **Open Decision:** none
- **Task(s):** I44 (SJ-A1, SJ-A2, SJ-A3)

## Context

**Three pop-ups sit beside the single-job flow, and Edward placed each of them** (10 Sep): *"SJ-A1 to
SJ-A3 are popup modals… the add brand pops up from the brand selection dropdown, the Turn this into
a campaign modal is triggered by an action button on the campaigns list… For SJ-A1… probably the
approve button triggers this check."* ADR-0085 d.3 fixed the last of those: the duplicate check fires
on Approve and the approval waits on its answer. This ADR is what each modal does.

**SJ-A3 needs no decision, and that is worth saying before the other two.** `AddBrandDialog`
(`src/features/campaigns/components/`, I35.3, 3 Sep) exists for precisely this — Edward's own brief
for it was *"the brand dropdown should offer the option to add the brand… open a modal to enter the
Brand/IP details."* SJ-02's brand dropdown reuses it. Recorded here so nobody rebuilds it.

**SJ-A1: the only duplicate check today refuses, and checks the wrong thing.** `uq_campaigns_tenant_name`
raises `23505` on an exact name match anywhere in the tenant, and the wizard renders it as
*"duplicateName"*. That catches *Ramadan teaser posts* twice for the same client and lets *Ramadan
teaser post* through; it refuses rather than asks; and it treats the same name for two different
clients as a collision, which it is not. The mock wants the opposite shape: *"Same client, same
subject, open job"*, a similarity score, and a choice — *"add it to that job as another deliverable
instead of starting a second one"*, or keep them separate. The reason it gives is the one that
matters: *"Attaching keeps one evidence trail and keeps the clock on the original start, which is
the part people get wrong when they create a second job to be safe."* The five "Al Waha KV"
jobs ADR-0080 found — one piece of work created five times in fourteen minutes — are this failure
mode measured.

**SJ-A2: promotion is almost nothing, because of ADR-0083 d.3.** A single job IS a campaign row.
Its client and brand, its receipt with both timestamps, its brief, its deliverable and that
deliverable's owner are all already on a campaign. The mock's list of *"what comes with it"* is a
list of things that do not move. What the campaign *adds* — strategy, more deliverables, timing,
review — is the existing wizard from step 2 onward. So promotion is: open the wizard on this
campaign at Strategy. Nothing is copied, nothing is retyped, and the clock keeps its start because
the receipts never left.

**What has to exist for promotion to mean anything: the system must know which campaigns are single
jobs.** After ADR-0083 d.3 nothing structural distinguishes them. A single job could be inferred —
*"a campaign with no strategy brief"* — but that is a null carrying meaning, the fail-silent shape
ADR-0079 refused for closures, and it would make every single job look promoted the moment somebody
typed a proposition.

**Similarity needs a tool.** `pg_trgm` is not enabled (measured: `pg_extension` holds none of
`pg_trgm`, `fuzzystrmatch`, `unaccent`). It is a standard Postgres extension Supabase ships, and
trigram similarity is the ordinary way to say *"92% name match"* explainably.

## Decision

### SJ-A3 — add a brand

1. **Reuse `AddBrandDialog` from the brand dropdown on SJ-02.** No new component, no new decision.

### SJ-A1 — a similar open job on this client

2. **The check runs on Approve, over this client's open jobs only — never across clients.** "Open"
   is a campaign of any `kind` whose status is not `archived` and which has at least one deliverable
   not `done`/`cancelled`. A finished job is not a duplicate risk; a job for another client is not
   the same work however it is named.

3. **Similarity is trigram similarity on the title, with `pg_trgm` enabled for it**, and the score
   is SHOWN as the mock shows it (*"92% NAME MATCH"*). A number the person can see is a number they
   can disagree with; a hidden heuristic is one they learn to distrust. **The threshold is a
   constant, 0.4, deliberately loose**: this is a prompt, not a verdict, and a miss costs more than a
   false alarm — a false alarm is one dismissal, a miss is a second job with a second clock.

4. **It warns and offers; it never refuses.** Two choices, exactly the mock's: **add as a deliverable
   on that job**, or **keep them separate**. Keeping them separate proceeds with the approval
   unchanged. This replaces nothing — `uq_campaigns_tenant_name` still refuses an EXACT duplicate
   title, because two campaigns with literally the same name is a data error, not a judgement call.

5. **"Add as a deliverable" moves the new work onto the existing job and discards the draft.**
   Specifically: the new deliverable, its brief (`campaign_briefs`, department from SJ-02) and its
   attachments are re-parented to the existing campaign; the receipt from SJ-02 is added to that
   campaign's receipts, **so both proofs sit on one evidence trail in arrival order**; and the draft
   campaign row created on SJ-02 is deleted. The deliverable keeps its own due date, its own
   department and its own owner — a job may hold work for two departments, which is what a campaign
   is for.

6. **The clock does not restart.** The existing job's earliest confirmed receipt remains its start;
   the new receipt is a later event on the same trail. This is the mock's *"the response clock stays
   on the original 4 Sep start"* and it is not a choice this decision makes — it falls out of d.5,
   because the receipts are what the clock is read from (ADR-0066). Stated so nobody adds a
   "restart" button.

7. **The owner is told once, about a job growing — not twice, about two jobs arriving.** The existing
   deliverable owner receives one notification that a deliverable was added; the new deliverable's
   owner (who may be a different department's lead) receives the release notification ADR-0085 d.4
   already sends. Nothing else fires.

### SJ-A2 — promote to a campaign

8. **`campaigns.kind`, `single_job | campaign`, `not null`, set at creation and never inferred.** One
   column, one check constraint, backfilled `campaign` for every existing row. It is what the
   campaigns list filters on, what the Promote action is offered for, and what the wizard reads to
   know it is being opened mid-way. A derived flag was rejected for the reason in the Context.

9. **Promote is a row action on the campaigns list, offered for `kind = 'single_job'` only, behind
   `projects:manage` in scope** (ADR-0073). Not on SJ-04 — Edward moved it, and ADR-0085 d.6 removed
   it from there.

10. **Promotion sets `kind = 'campaign'` and opens the existing wizard at step 2, Strategy, with
    step 1 read as done.** Nothing is copied: the row, the receipt, the brief, the deliverable and
    its owner are already there. The wizard's step 1 (Job Type) shows the values it finds and is
    marked complete. The single-execution brief stays as that department's brief (ADR-0084 d.3);
    other departments added at step 3 generate their own under ADR-0072, unchanged.

11. **Promotion is one-way.** The mock: *"This cannot be undone once approved."* Stricter here: it
    cannot be undone at all, because a campaign that has gained a strategy and a second department
    has no honest way back to being one deliverable for one department. The modal says so before the
    press.

12. **The response clock is untouched by promotion.** Same reason as d.6: the receipts do not move.

## Consequences

**Easier.** Two of the three modals are assembly — the brand dialog exists, and promotion is a column
plus opening a wizard that exists at a step that exists. The duplicate check turns the one refusal
in the system into a question, and it is asked at the last moment rather than while typing. The
"create a second job to be safe" habit that produced five Al Waha jobs now gets a screen
that says what it costs and offers the alternative.

**Harder.** d.5 is a real re-parenting — deliverable, brief, attachments and receipt all move
between campaigns in one transaction, and the RLS on each has to admit the move; that is the one
piece of genuinely new server work in this ADR and it wants its own pgTAP suite. `pg_trgm` is a new
extension and a new index. And d.8 is a schema change on `campaigns`, which every reader of that table
now has to be honest about — a list that does not filter by `kind` will show single jobs and
campaigns as if they were the same thing, which after ADR-0083 they are, and after this ADR they are
not quite.

**Locked in.** That a duplicate is a question, not a refusal — and that the question names the cost
(a second clock, a split evidence trail). That the clock is always read from the receipts and never
restarted by any action. That a single job and a campaign are told apart by a stored fact, not by
which fields happen to be empty. And that promotion happens to a job that exists, from the list, one
way.

## Addendum — 11 Sep, from the independent review

**d.10 does not open the wizard; promotion opens the campaign page.** Promote is only ever
pressed on a RELEASED job — drafts sit in their own section of the list with their own resume
link — and the wizard resumes drafts only (`useCampaignDraft` filters on status); its submit would
also write a second stream and re-insert the deliverables. The first build flipped `kind` and then
sent the person into a screen that said "cannot pick it up here". A promoted job now opens as the
campaign it is, on the campaign page, where an approved campaign gains departments and
deliverables. Whether the wizard should learn to resume a released campaign at Strategy is a
separate piece of work (`I44.12`).

**`campaigns.kind` is fenced.** d.8 said "set at creation and never inferred" and d.11 "one way";
`campaigns_tenant_write` has no scope, so a department lead the RPC had refused could flip `kind`
both ways by PATCH — and `kind` is what the assignment gate branches on (ADR-0090). A trigger now
refuses any change of `kind` that is not `promote_single_job` (`20260911130600`).

**`useSaveBriefReceipt` takes an `id`.** The 0066 addendum said the hook updates by id; it did
not — it re-queried the earliest receipt, which after an attach is ambiguous. It now updates the
row it is given and falls back to the earliest confirmed receipt when it is given none.

## Addendum — 22 Sep, recording 21 Sep: what a promoted job keeps and asks for; attaching tells the new owner only

**Edward, 21 Sep, on the inspection walk's findings (`I53.20`, `I53.18`).**

**d.10a — The job's words become the campaign's brief.** A single job's request (the words as
asked, ADR-0083) and its six-field brief's task are the campaign's `background` and `task` after
promotion, each only where the field is empty; the whole job brief is kept under
`campaigns.brief.promotedJobBrief` as a record. The campaign brief tab never reads "Nothing has
been written here yet" for a promoted job.

**d.10b — The department writes its campaign-scale brief before any NEW assignment** (option C).
The job's `single_execution` brief, approved with the job (ADR-0084 d.4), had stood as the
department's campaign brief after promotion — locked, no Generate — so every deliverable added
later was assignable on the strength of a brief that never described it. Now promotion re-opens
that row through `reopen_department_brief` (audited) and empties it: the department tab offers
Generate, the assignment gate (ADR-0072 d.6) holds new assignments until the department approves,
work already assigned stands, and My Work says the brief is owed (ADR-0070 addendum, 22 Sep).
Audited as `department_brief_reset_on_promotion` with what the row held. `20260921120000`; pgTAP
138.

**Editing the campaign brief on its page MERGES.** `update_campaign_brief` used to replace the
document, and the page sends only the string fields — an edit dropped the request record, phases
and deliverables. It keeps them now (same migration).

**d.7 narrowed — attaching tells the NEW deliverable's owner only.** Edward, 21 Sep: *"existing
owners should only be notified of changes to their existing deliverables."* The one-line notice to
the other owners on the job is gone; the new owner's message (Action 15, ADR-0028 addendum) is
unchanged. `20260921140000`; pgTAP 106.
