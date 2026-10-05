# ADR-0084: A single job has one brief, and the account manager writes it

- **Status:** accepted (Edward, 11 Sep)
- **Date:** 2026-09-11
- **Open Decision:** none — amends ADR-0072 and ADR-0048 d.9 for single jobs only
- **Task(s):** I44 (SJ-03)

## Context

**SJ-03 is the second screen behind the door: what the department needs to know.** The Figma calls
it *"the department-specific screen"* and shows two columns — a left one prefilled *"FROM THE ZETA
PROFILE"* (objective, key message, audience, mandatories, language) and a right one marked *"what
only you know"* — with the promise that switching the department on the previous step swaps the whole
list. It also shows attachments, *"reference material, not proof"*.

**Two of those three promises cannot be kept, and Edward has replaced them.**

*The client-profile prefill.* Edward, 10 Sep: *"it is not possible to fill the brief fields from the
client's profile — the details in the concept are mostly campaign or job specific."* `clients.profile`
exists as a column and nothing populates it with brief content; an objective and a key message belong
to a piece of work, not to a client.

*The per-department field set.* Edward, 11 Sep: *"for now we will use the Single Execution template,
for a single job. This will be the only brief for this style of work."* `brief_templates` already
holds `single_execution` with **six fields** — Deliverable Type, The Task, Reference / KV, Specs, Copy /
Message, Restrictions — bilingual, each with guidance. SJ-01's own copy promised *"six fields plus a
proof screenshot"*, so the door and the schema agreed before the detail screen did.

**The third promise is a rule change, and it is the substance of this ADR.** Every brief in this
system is written by a department, after the campaign is approved, and approved by that department —
ADR-0048 d.9, ADR-0070, and ADR-0072, which exists because a Creative lead was able to write
Production's brief on a campaign they had nothing to do with. On SJ-03 the **account manager** writes
the department's brief, at creation, **before anything is approved**. That is the opposite order, and
it has to be said plainly rather than arrived at.

**Why the opposite order is right here and wrong for a campaign.** A campaign has several
departments, each of which knows its own work better than the account manager does, and each of
which must not be able to write the others' — that is what ADR-0072 protects. A single job is one
deliverable to one department, and the person who took the request is the only person who has heard
it. There is nobody else to write the brief and nobody else's brief to protect. Making the department
generate a second one afterwards would produce two records of one request, which is the drift this
repo keeps paying for.

**"Mandatory" has no existing mechanism.** Edward's original brief: *"once all mandatory details are
finished, the next step is the review page."* No brief template field anywhere carries a `required`
flag — measured across all twelve templates, 144 fields, zero. So which of the six must be filled is
a decision, not a lookup.

**Dependencies have a home already.** The mock's *"Dependencies — what could stop this"* is a
free-text field. ADR-0069 built the structured version: a task states what it is waiting for, as
`sub_task_dependencies` and external inputs, declared on the department's tab after approval. A
free-text copy of it on SJ-03 would be a second, weaker record of the same fact.

## Decision

1. **A single job carries exactly one brief, and its template is `single_execution`.** The six
   fields it already defines, in both languages, with their guidance. No other template is offered
   on this screen, and the department chosen on SJ-02 does not change the field list. *"For now"* —
   Edward's words — is recorded: if departments later need different single-job fields, that is a
   template per department mapped through `department_brief_templates`, which exists, and a new ADR.

2. **The account manager writes it, at creation, before approval.** For single jobs this amends
   ADR-0048 d.9 and ADR-0072, which stand unchanged for campaigns. The reasoning is the Context's:
   one department, one person who heard the request, nothing to protect.

3. **The department does not generate a second brief.** Edward: *"the only brief for this style of
   work."* The row is a `campaign_briefs` record with `brief_type = 'single_execution'` and the
   department from SJ-02 — the same table, the same shape, so `/campaigns/:id`'s department tab reads
   it with nothing written. **Nothing on that tab offers to generate one** for a single job.

4. **It is approved with the job, not separately.** ADR-0070 gives a department brief its own
   approval; a single job's brief is approved when the job is, on SJ-04, in one act, by the account
   manager — Edward, 11 Sep: *"for this flow, the AM approves it for release."* The department is not
   cut out of the brief: *"most of the workflows include Creative Brief as a task, so it is covered"* —
   the lead's engagement with the brief is a TASK in the generated list they review, not a second
   approval gate. The `approved_at`/`approved_by` columns are stamped by the release. What SJ-04 is
   and who may press it is that screen's ADR; this decision only says there is not a second gate.

5. **Nothing is prefilled from the client.** The mock's left column is gone. What the screen shows
   is the six fields, empty, with their guidance — and the request's own words from SJ-02 visible
   above them, because the brief is written *from* that line and it should not need scrolling back.

6. **A document can be uploaded and ingested into the six fields, and the person reviews before
   moving on.** Edward, 11 Sep: *"add the same text ingestion for the brief, upload and ingest… the
   prompt designed to address the fields actually available… it should enter facts only, not invent,
   so if information is lacking on a field the AM has to enter."* The mechanism is `ingest-brief`
   (ADR-0044/0049) and its fact-only rule is already in the prompt — *"fill a field only from what the
   document actually says; never invent."* **What changes is the target.** Today's ingestion is built
   against a fixed list of fourteen campaign-strategy fields (`BRIEF_FIELD_KEYS`), of which only
   `task` overlaps this template. So the prompt and the output schema are **derived from the brief
   template's own field definitions** — every template field already carries a `key` and `guidance`,
   which is exactly what a prompt needs — rather than from a second hand-written list. That makes
   ingestion work for any template, and it means a template edit changes what ingestion asks for
   without touching the function. **After ingestion the fields are shown filled and editable, and
   Next is not available until the person has been through them** — the model's reading is a draft
   to correct, never the record. A field the document did not answer is left empty, and the account
   manager fills it.

6a. **"The Task" is mandatory. The other five are not.** Decided here because no mechanism exists to
   decide it from — no template field anywhere carries a `required` flag. The Task is the brief and a
   job without it cannot be briefed to anyone; the others sharpen it and a lead can ask. Ingestion
   does not change this: a document that does not say what is wanted leaves the one required field
   empty, and the screen says so. **This is the line most likely to change** once real jobs have run
   through, and changing it is a template edit — `required` becomes a field property honoured by the
   screen — not a migration.

7. **Attachments are reference material through the existing asset path**, into the job's own
   References folder — the same folder the proof went into on SJ-02, because a single job is a
   campaign row (ADR-0083 d.3) and campaigns already have one. Library pick or upload, both existing.
   *"Reference material, not proof"* stays as copy: the proof is the receipt, and this is everything
   else.

8. **"What could stop this" stays as a free-text field — as a REMINDER, not as the record.**
   Edward, 11 Sep: *"keep it as a text field and so it acts as a reminder for the person editing the
   task list to add the dependency to the appropriate task."* This ADR's first draft dropped the
   field in favour of ADR-0069's structured dependencies alone; Edward's reading is better because it
   names the hand-off. The account manager writes *"waiting on the client's logo"* here, at the
   moment they know it; the deliverable owner, reviewing the generated task list later, sees that
   note and attaches the dependency to the right task using ADR-0069's mechanism. **The text is
   never itself a dependency** — nothing reads it, nothing waits on it — so there is one structured
   record and one prompt to make it, not two records. The field is carried forward to the task-list
   review screen and shown there; that screen's ADR says how.

9. **The screen is titled for the department, and that is all "department-specific" means today.**
   *"What Creative needs to know"* is true because Creative was chosen and its lead will read it; the
   fields are the same six. The title says who; the template says what.

## Consequences

**Easier.** SJ-03 is a form over a template that exists, writing to a table that exists, filing into
a folder that exists. The department tab on `/campaigns/:id` shows a single job's brief with no
change, because it is already reading `campaign_briefs`. One brief per single job means one record
to approve, one to read, one to argue about.

**Harder.** Two ADRs now have a stated exception, and exceptions are what a later reader trips on:
ADR-0072's rule — the department writes its own — is true for campaigns and false for single jobs,
and the reason has to travel with the rule or it will look like a bug. The `/campaigns/:id` department
tab must not offer "Generate brief" on a single job, which is a conditional that did not exist. And
d.6 puts a required-field concept into brief templates that they have never had; the first one is
easy and the discipline of keeping it in the template rather than in the screen is the work.

**Locked in.** That a single job has ONE brief written by the person who took the request. That
"department-specific" is a template mapping, never a hard-coded field list per department — the
mock's *"switch to Production and the list changes"* becomes true by mapping a template, not by
branching code. And that a job's tasks declare their dependencies the structured way, so there is
one place to ask what work is waiting for.

## Not decided here

SJ-04 (review and approve — who may press it, what it does), the duplicate check (SJ-A1),
promotion (SJ-A2), adding a brand (SJ-A3), and the deliverable owner's review of the generated task
list. Each in turn.
