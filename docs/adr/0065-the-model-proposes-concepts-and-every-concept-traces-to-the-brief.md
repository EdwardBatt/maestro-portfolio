# ADR-0065: The model proposes concepts, and every concept traces to the brief

- **Status:** accepted
- **Date:** 2026-09-02
- **Open Decision:** none resolved here. Touches **OD 30** (residency) via ADR-0044 d.6 / ADR-0049
  d.6, which stay open — see d.11.
- **Task(s):** I34 (new). Related: I16.4, I14.3, I24.

## Context

**What exists.** `generate-brief` is live and writes one brief per department per campaign
(`campaign_briefs`, unique on `(campaign_id, department_id)`, ADR-0050 d.3). It is not a creative
step and was never meant to be. Its system prompt says so in three lines:

> *Fill a field only from what the master brief actually says, or from what follows from it directly.*
> *Never invent a number, a name, a date or a budget. If it is not in the brief, it does not go in.*
> *If the brief does not address a field, answer exactly "N/A".*

That is a **sorting** job: take the campaign brief, put each piece in the right box on this
department's form, and say `N/A` where there is nothing to put (ADR-0048 d.6). Edward, 1 Sep:
*"at the moment when the dept level briefs are created it is simply the same data contained in the
campaign brief. it is not generating creative concepts based on that information and the
requirements."* Correct, and by design.

**What is wanted.** A creative concept for each department that receives a brief — an approach to
the work, derived from the brief and answerable to it. Edward, 2 Sep, correcting an earlier framing
of this ADR: *"the concept must still obey the original brief and meet its requirements, not just
propose random concepts."* That correction is the whole decision. The distinction is **not**
invention versus no invention; it is:

- **Facts** are never new. Budget, dates, client name, channel list, mandatories, deliverable
  counts. Present in the brief or absent from the output. A wrong one is a falsehood people plan
  work around, which is exactly what the rule above protects against.
- **Proposals** may be new, and must be **answerable to** the brief — serving its objective, its
  audience, its tone, its mandatories, within its constraints. A concept that ignores those is not
  bold, it is off-brief, and it fails in the same way a wrong budget does, only less visibly.

So the concept call and the brief call share their rule about facts and differ only in whether they
may propose. Stating it as "one must never invent, the other must invent" — as an earlier draft of
this ADR did — is wrong and would license exactly the fabrication d.2 forbids.

**Volume.** One to two departments per campaign receive a brief; four in the worst case (Edward,
1 Sep). That number is what makes this affordable and is why the per-deliverable shape is rejected
below.

**Options weighed.**

- **A — extra fields on the existing `generate-brief` call.** Cheapest possible: the brief is
  already being sent, so only the extra output is billed. **Rejected.** It welds concepts to a
  document that is formally approved (ADR-0048 d.8) and edited by hand (`projects:manage`), so
  re-rolling a concept would regenerate — and could overwrite — an approved brief. It also means
  relaxing the fact rule inside the brief prompt itself, where it is load-bearing. And the brief
  response is already up to 40 template fields against `MAX_OUTPUT_TOKENS = 16_000`.
- **B — a separate call per department, on demand.** Chosen. Costs one short brief re-sent per
  department, one to four times per campaign; that is the entire price difference against A.
- **C — one call per campaign covering every department.** Fewest calls. **Rejected:** concepts for
  two disciplines written in one breath blur into each other, regenerating one department redoes
  them all, and the saving is negligible at this volume.
- **D — per deliverable.** **Rejected.** Ten to twenty calls per campaign for a unit that is not
  the one a brief is addressed to. A brief goes to a department; so does a concept.

**Trends were raised and set aside** (Edward, 2 Sep), first as an output of this call and then as a
weekly research job of its own writing a report into the database. Both are out of scope here and
the second was not deferred for cost — it is cheap, running weekly for the whole tenant rather than
per campaign — but because the reliability could not be assured from freely available sources. See
d.12. If it is built later it is its own ADR, and it changes nothing here: its report would reach
this call as an input.

**Cost.** ADR-0049 records `gpt-5.6-luna` at ~$0.005 per ingested brief. A concept call sends a
short document (the department brief) and returns longer prose than the brief call does, so it is
output-weighted where ingestion is input-weighted — the same order of magnitude per call, not a new
tier. Expect campaign AI spend to rise by roughly a third to a half, against a live baseline the
OpenAI dashboard already shows, because ingestion and department briefs are both in production.

## Decision

**d.1 — A separate Edge Function, `propose-concepts`.** Not additional fields on `generate-brief`.
It reads the department's own brief and returns proposals; it never writes `campaign_briefs.values`.

**d.2 — Facts are never generated.** `propose-concepts` inherits the fact rule from
`generate-brief` verbatim: no number, name, date, budget, channel or mandatory appears unless the
brief says it. What it may generate is an **approach**. A concept containing a figure or a date not
present in the brief is a defect, not a flourish.

**d.3 — Four named shapes, not one undifferentiated "concept".** The output is typed: **strategic
thinking**, **creative direction**, **pillars**, and **suggested content types**. They are different
kinds of answer and a single free-text field would collapse them into one blob that reads well and
cannot be reviewed field by field. Suggested content types are **proposed from the tenant's own
`deliverable_types`** — a closed enum of that tenant's active codes, built at call time server-side
under RLS and never supplied by the browser (ADR-0054's pattern exactly) — so a suggestion is a
thing the system can act on rather than a phrase somebody has to re-type.

**d.4 — Every proposal names the requirements it answers.** Each carries `answers`, a list of field
keys from **that department's own brief template**, given to the model as a closed enum built the
same way. Unrecognised keys are dropped and the proposal survives, as ADR-0054 does with type codes.
This is what makes *"does this obey the brief?"* a question two people can settle by looking, and it
is the reason the extra output tokens are worth paying for.

**d.5 — A concept that cites nothing is shown, marked, never hidden.** If every citation was
dropped, the concept is surfaced as unsupported rather than deleted. A proposal the model could not
tie to the brief is the single most useful thing on the screen — it is either the brief being thin
or the concept being off it, and both want a person's eyes (ADR-0057 d.2 precedent: say so plainly).

**d.6 — A concept is a proposal, not brief content.** New tenant-scoped `campaign_concepts`, keyed
by `(campaign_id, department_id)` and stored apart from `campaign_briefs`. Approving a brief does
not approve concepts, and RLS mirrors the brief's.

**d.7 — On demand, behind a button, gated on `projects:manage`** — the grant that already permits
editing that brief. No new permission: the job is the same job, and ADR-0055 says to add one only
when the job differs.

**d.8 — Regeneration is additive.** Each press stores a new set beside the previous ones rather than
replacing them. Creative work is re-rolled; losing the first idea because somebody asked for a
second is the obvious failure and the cheapest to avoid.

**d.9 — Model choice stays configuration.** Same `_shared/model.ts`, same `OPENAI_MODEL`, same
default (`gpt-5.6-luna`, ADR-0049). Moving to a stronger model or enabling reasoning effort for
concepts is a deliberate, measured config change — **not** something this ADR authorises in advance
on the grounds that creative work "deserves" it.

**d.10 — Prompt-injection stance inherited unchanged** (ADR-0044 d.2): brief text travels as
untrusted data in tags, the model gets no tools and no data access, and the answer is Zod-validated
against the same closed schema it was given. Model output is data, never instruction.

**d.11 — Residency is named, not resolved.** ADR-0044 d.6 and ADR-0049 d.6 remain open: the
no-training/retention acceptance was given against Anthropic's terms and does not transfer to
OpenAI. This adds no new *category* of data leaving the tenant — department briefs already go — but
it adds volume and frequency. Not a blocker for that reason; still owed an answer.

**d.12 — Trend claims are excluded, and the reason is commercial, not technical.** *"What is
trending now"* is a fact about the world, so d.2 already forbids the model producing one, and d.10
means it cannot look one up. But web access would not rescue it. Edward, 2 Sep: *"there is a reason
companies sell reports for trends as they are not easy to research online."* The data that would
answer the question is sold precisely because gathering it is expensive; what is freely searchable
is largely agency marketing copy — recycled, undated, and increasingly model-written. A search-
enabled call would return that material **with citations attached**, which is worse than returning
nothing, because it looks checked. Add the well-documented tendency to attach a real link to a claim
the linked page does not make, and the failure is invisible until a client asks where a number came
from. The project has already taken this position once: ADR-0054 has the model propose a channel
**by extraction only**, quoting the brief rather than inferring from the world.

**Anticipated, not forbidden.** If the tenant later holds trend material — a bought report, or the
strategy team's own point of view — it enters this call as **supplied input, exactly as the brief
does**, and d.2 is unchanged: facts come from inputs, never from the model. That path needs no
amendment to this ADR, which is why the exclusion is written as a statement about the *source* of
facts rather than about the subject of trends.

## Consequences

**Easier.** A department gets a starting point instead of a blank page, from the brief it was
actually given. Review becomes a checkable question — *does this answer the requirement it claims
to?* — rather than a matter of taste, which is what d.4 buys and the reason it is worth the extra
output tokens. Re-rolling a concept costs pennies and disturbs nothing that was approved.

**Harder.** A second AI surface to keep honest: two prompts now encode the fact rule, and they can
drift. The mitigation is that they share `_shared/model.ts` and should share the fact-rule text
itself rather than restating it — if that text is copy-pasted, expect the copies to diverge, as
ADR-0044's tidy rules did until they were imported rather than re-implemented.

**Locked in.** A concept belongs to a **department**, not a deliverable and not a campaign. Wanting
per-deliverable concepts later means a new anchor and a new ADR, not a parameter. Concepts live
outside the approved brief permanently — folding them back in later would re-create option A's
problem.

**Costs.** Roughly a third to a half more AI spend per campaign, on a base of about half a cent per
brief. One new table, one new Edge Function, one button. No change to the brief flow, the approval
gate, or anything downstream of it.

**Not decided here.** Whether concepts feed anything automatically — deliverable proposals, task
descriptions, the Library. They do not, in this ADR. A concept is read by a person and that is all.

## Addendum — 13 Sep, one refined concept, not a history of sets

Testing, Edward redefined how concepts are used: *"The prompt should not suggest deliverables as
these were already defined… once a proposed concept is created the user should be able to select
delete or keep in individual fields, and if propose another set is selected it should only
regenerate those fields that were removed."* Confirmed direction: **the single refined concept** —
deleted items are gone for good, regeneration fills only the gaps.

This reverses d.3's fourth shape and d.8's "sets accumulate, nothing is overwritten, the model never
reproduces a discarded idea."

**Decided (amends d.3 / d.8):**
- **d.9 — no content types.** The proposal is strategic thinking, creative direction and pillars
  only. Deliverables/content types are already defined on the campaign, so the model no longer
  suggests them. (`propose-concepts` drops the `content_types` shape from its schema and prompt.)
- **d.10 — one working concept, refined in place.** Instead of append-only sets, there is one
  current concept. Each item can be **kept or deleted** individually.
- **d.11 — regeneration fills only what was removed.** "Propose another set" becomes "regenerate the
  deleted items": the kept items are passed to the model as fixed context and it generates only the
  missing slots, which replace the deleted ones in the same concept. The per-press audit (who/when)
  is kept; the "every set retained" history is not.

**Build (I48, in progress):** `propose-concepts` handler + schema + prompt (drop content types;
accept kept items; generate only gaps); the concept store becomes a mutable working concept with
per-item delete (migration + pgTAP); `ConceptsPanel` gains per-item Keep/Delete and the button
becomes "Regenerate removed". Done as its own tested change, not bundled, because it is a data-model
+ model-call redesign that wants in-browser verification.
