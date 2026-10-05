# ADR-0048: Briefs are generated per discipline, and approved before work starts

- **Status:** accepted (Edward, 27 Aug)
- **Date:** 2026-08-27
- **Open Decision:** — (specified by Edward, 27 Aug)
- **Task(s):** I16 (new); **supersedes the scope of `I14.4`** (brief types); relates to ADR-0020
  (Brief Wizard), ADR-0021 (brief split), ADR-0044 (AI ingestion), ADR-0042 (required resources),
  ADR-0043 (reviewers), ADR-0045 (chasing), ADR-0030 (request-changes), ADR-0035 (ad-hoc work)

## Context

The Brief Wizard captures one brief and creates live work from it. ADR-0044 added AI ingestion of a
client's document into the wizard's strategy fields. Edward, 27 Aug: the AI should also **generate
the deliverables and a brief per discipline**, and the whole package should go to the **account
manager for review and approval** before any of it is assigned.

He was explicit on three points that shape the design:

- **"Whether the briefs are from hand-typed input, or ingested input the process should be the
  same."** Generation is not a feature of the AI path. It fires when the inputs are complete,
  however they arrived.
- **"There is no feedback loop on the brief generation, just review — correct — approve."** The
  account manager edits in place and approves. There is no request-changes round-trip back to the
  author, and no regeneration cycle.
- The brief type list **must include the four types he asked for** and does not. He has now said this
  twice.

### What the templates actually are — the agency brief-template deck (client-supplied, not included in this repository)

The agency's brief system is a real, bilingual (EN/AR) 8-brief master document, and **the app already
encodes its list**: `BRIEF_TYPES` in `BriefWizard.tsx` is exactly these eight, in order.

| Deck brief | Discipline (`work_types`) | Fields in the app today |
|---|---|---|
| 01 Creative (360 campaigns) | Creative | **yes** — wizard step 2 *is* this brief's page 1, field for field |
| 02 Social Media (calendar & content) | Social & Content | no |
| 03 Activation (on-ground / digital) | Activation | no |
| 04 Performance (paid media) | Paid Media | **yes** — the five fields behind the paid-media toggle |
| 05 Production (TVC / shoots) | Production | no |
| 06 Influencers (creators campaign) | Influencer | no |
| 07 Execution (single deliverable) | *any* — this is ad-hoc work (ADR-0035) | no |
| 08 Feedback (revisions) | *none* — this is the review round-trip (ADR-0030) | no |

**Six disciplines, six briefs, one-to-one.** The two leftovers already have homes in the product, and
that is why they are not campaign brief types: a feedback brief is a revision document produced
*during* review, not a way to start a campaign, and an execution brief is a single deliverable.

Two conventions carry over from the deck and are not decoration:

- Every brief ends with **"OWNERS — REQUIRED ON THIS BRIEF"** naming roles (Strategy Lead, Creative
  Lead, SM Manager, Account Manager). That is ADR-0042 required resources and ADR-0043 reviewers.
- Every brief carries **"Fill only what moves the work forward. If a field doesn't apply, write N/A —
  never leave it blank."** ADR-0044 currently has the model return an empty string for anything the
  source does not address. The agency's convention is better: blank is ambiguous between *does not
  apply* and *nobody filled it in*, and only one of those needs chasing.

Every brief also shares a header — brand/product, market(s), project name, brief date, deadline —
which is campaign-level data the wizard already collects.

### What does not exist

- **Field sets for six of the eight briefs.** The types are in the list; the fields are not in the app.
- **The four brief types Edward asked for** (`I14.4`): `creative_strategy`, `communications_strategy`,
  `brand_guidelines`, `custom`. **None are in the deck and none has a template.** This is the gap he
  has now raised twice, and it is a content gap, not a code gap.
- **Any approval state on a campaign.** `campaigns` has no status column;
  `create_campaign_from_brief` creates streams and deliverables that are live and assignable the
  instant the wizard is submitted.
- **Any AI generation of structure.** ADR-0044's model fills form fields. It does not propose
  deliverables and has no tools — deliberately.

### The forces

**Generating structure is a different risk from generating text.** A wrong sentence in a field is
read and corrected. A wrong deliverable list becomes streams, bookings and consumed capacity. The
approval gate is what makes generation safe, so it has to be a real gate.

**An approval gate on every campaign is a new bottleneck.** Edward asked for one process, which means
a campaign someone typed by hand in two minutes now waits for an account manager. That is a cost, and
it is the point — the alternative is two paths and a rule nobody remembers.

**Cost stops being one call.** ADR-0044 d.9 waived any aggregate spend cap, reasoning "one call per
ingest, initiated by a person, no path that can run away". A campaign with five disciplines is one
ingest plus one deliverables call plus five brief calls. The reasoning does not survive unchanged.

## Options weighed

**Where the per-discipline brief lives.**

- **A — a `brief jsonb` column on `streams` (chosen).** A stream is already exactly one discipline of
  one campaign, created by `create_campaign_from_brief` per distinct discipline. The brief for
  Creative on this campaign *is* the Creative stream. No new entity, no new join, no second home for
  "which discipline".
- **B — a new `discipline_briefs` table.** Rejected: it would be a table whose primary key is
  (campaign, discipline) — which is the definition of a stream. Two homes for one fact, the failure
  ADR-0043 and ADR-0037 both record.
- **C — one `briefs jsonb` blob on the campaign.** Rejected: no per-discipline RLS, so Production
  could read the Paid Media budget. Streams already carry `tenant_id` and are policy-scoped.

**Where the templates live.**

- **A — templates as tenant data, editable in admin (chosen).** One row per brief type, holding an
  ordered field list with EN/AR labels and guidance text. The deck changes; a redeploy should not be
  how it changes, and the four missing briefs need authoring by a person, not a developer.
- **B — templates compiled into the frontend.** Cheaper today. Rejected: the four new types have no
  content yet, so the first thing that happens after shipping is an edit — and every subsequent
  wording change becomes a release.

## Decision

1. **The brief type list is the deck's campaign briefs plus Edward's four.** `feedback` and
   `single_execution` leave `BRIEF_TYPES` — not deleted from the product, but relocated: feedback is
   the ADR-0030 request-changes document, execution is ADR-0035 ad-hoc work. Neither starts a
   campaign. The list becomes:

   `360`, `social_calendar`, `activation`, `paid_media`, `production`, `influencer`,
   `single_execution`, **`creative_strategy`**, **`communications_strategy`**,
   **`brand_guidelines`**, **`custom`**.

   > **Correction (27 Aug), before any of this shipped.** As first written this decision also
   > removed **`single_execution`**, and that was **my inference, not Edward's instruction** —
   > he asked only for `feedback` to go (`I14.4`). I reasoned that a single deliverable is
   > ad-hoc work (ADR-0035) and therefore never starts a campaign. He corrected it: *"put it
   > back … this and custom are the most likely ones to be used for internal ad-hoc. Removing
   > feedback was correct."* The reasoning was wrong on its own terms too — his direction is to
   > route ad-hoc work through **internal-client campaigns** (ADR-0029 already has internal
   > clients) and retire the ad-hoc surface, and on that path a single execution **is** a
   > campaign. Removing it would have deleted the type that describes the most common thing the
   > agency does. Restored, with the deck's Brief 07 field set seeded.

   `feedback` stays out, and that half was Edward's own scoping: a feedback brief is the
   ADR-0030 request-changes document, produced *during* review, not a way to start a campaign.

   **This replaces `I14.4`**, which said "drop `feedback`, add four" without the deck in view.
   Existing campaigns carrying a retired value keep their locale key (the
   `notifications.type.cancelled` lesson) — check before removing any key.

2. **A new `brief_templates` table is the single home for what a brief contains** — `tenant_id`,
   `brief_type`, an ordered `fields jsonb` (key, EN label, AR label, guidance text, `multiline`,
   `required`), `is_active`. Seeded from the deck for the six discipline briefs, whose field lists
   are transcribed from the agency brief-template deck (client-supplied, not included in this repository) — including the guidance lines,
   which are the prompt the model needs and the hint the human needs. Edited on a new
   **Admin → Brief templates** screen behind `organization:manage`.

   **The four new types are seeded empty and must be authored before they can be selected.** A brief
   type with no fields is not offered in the wizard. Shipping them as empty shells that quietly
   produce empty briefs would be worse than not shipping them.

3. **Generation fires on complete inputs, not on the AI path.** Hand-typed and ingested briefs follow
   **one** flow. When the master brief and the deliverable list are complete, the wizard generates.
   There is no "generate" button that only appears for uploaded documents, and no branch in the code
   that asks how the fields were filled.

4. **The AI proposes the deliverable list; it never creates it.** A new `generate-deliverables`
   operation returns `{name, disciplineId, quantity}[]` from the master brief, against the tenant's
   active `work_types` — it picks from a supplied list and cannot invent a discipline. It arrives as
   editable rows in step 3, marked as proposed, and a person may add, edit or delete any of them. The
   distinct disciplines in the **final, human-confirmed** list decide which briefs get generated.

5. **One brief per discipline present, generated from that discipline's template.** For each distinct
   discipline in the confirmed deliverable list, the model fills that brief type's field set from the
   master brief plus the deliverables belonging to that discipline. Stored as `streams.brief jsonb`
   (option A). A discipline with no deliverables gets no brief.

6. **`N/A` is the answer for "does not apply", and it is the model's job to say so.** Amends
   ADR-0044 d.5 for generated briefs: a field the source does not address returns the literal `N/A`,
   not an empty string. Blank means nobody has filled it in yet and is chased; `N/A` means it was
   considered and does not apply. The distinction is the agency's own, from the deck.

7. **Owners are named on every brief**, per the deck's OWNERS block. They are written through the
   existing paths — ADR-0042 `sub_task_resources` for required people, ADR-0043 `sub_task_reviewers`
   for approvers — never as free text in the brief JSON. A name in a document that no system knows
   about is how work goes unassigned.

8. **A campaign is created `pending_approval`, and nothing is assignable until it is approved.**
   `campaigns` gains `status` (`draft` → `pending_approval` → `approved`) with the transition held by
   a trigger, not only by an RPC — the ADR-0043 lesson, where "every mandatory reviewer must approve"
   lived in a function and a plain PostgREST update went round it. Streams and deliverables are
   created at submit so the package is reviewable, but a sub-task on an unapproved campaign cannot be
   assigned and no booking may be made against it.

9. **The account manager reviews, corrects and approves — there is no round-trip.** Edward, 27 Aug:
   *"There is no feedback loop on the brief generation, just review — correct — approve."* The
   account manager (`app.deliverable_account_manager`: the campaign's, else the client's) sees the
   master brief, the deliverable list and every discipline brief as one package, **edits any of it in
   place**, and approves. There is no changes-requested state on a campaign and no regeneration
   cycle: the person with the authority to approve is the person correcting it, so sending it back
   would only add a hop.

10. **Approval releases the work.** On approval: the campaign becomes `approved`, sub-tasks become
    assignable, each discipline's brief becomes visible to that discipline, and the named owners are
    notified. One notification type, `campaign_approved`, to the author and the owners.

11. **A pending campaign is chased by the ADR-0045 sweep, not by a second mechanism.** An unapproved
    campaign is stalled work, exactly like an unreviewed task. `stall-sweep` reminds the account
    manager at `review_reminder_hours` and escalates at `review_escalation_hours`, both already
    tenant-editable. No new cron entry, no new ladder.

12. **Generated briefs are bilingual.** The templates carry EN and AR labels; the model is asked for
    the language the brief was authored in, and the labels render per the viewer's locale with RTL,
    as the rest of the app does. Field *content* is not machine-translated — a translated creative
    proposition is a different proposition.

## Consequences

**Easier.** The step nobody enjoys — retyping one brief into six — stops. The deliverable list starts
populated instead of blank. Every discipline gets a brief in the agency's own format rather than a
paragraph in a chat message. The account manager sees the whole campaign in one place before it
exists as work.

**Harder — and this is the real cost.** Every campaign now waits for one person. A hand-typed
two-minute campaign waits exactly as long as a generated one, because Edward asked for one process
and two paths would be a rule nobody remembers. Whether that is right is answerable in a month by
looking at how long campaigns sit in `pending_approval`; the thresholds are already tenant-editable
(ADR-0045 d.3), so the answer is a setting, not a migration.

**Cost stops being trivial, and ADR-0044 d.9 needs revisiting.** One ingest becomes one ingest plus
one deliverables call plus one call per discipline — up to seven model calls for a six-discipline
campaign, versus one today. The "no path can run away" reasoning still holds (a person still starts
it, once per campaign) but the per-campaign figure is now roughly 5-7× a single ingest. The number to
watch is model spend per approved campaign. **No aggregate cap is added here**, deliberately and
consistently with ADR-0044 — but that decision is now carrying more weight than when it was made.

**The AI now shapes work, not just text.** A proposed deliverable that nobody deletes becomes a
stream, a booking and consumed capacity. Decisions 4 and 8 are what contain that: the human confirms
the list, and nothing is assignable until a person with authority approves. Neither is a nicety.

**Locked in.** A discipline's brief lives on its stream — one home. Templates are tenant data, so the
deck's wording changes without a release. `N/A` means considered-and-irrelevant; blank means
outstanding. Owners are real rows, never free text. There is no changes-requested state on a
campaign: the reviewer corrects rather than returns.

**Not shipped by this ADR.** The four new brief types are seeded with no fields and are unselectable
until somebody authors them. That is deliberate — the alternative is four types that generate empty
briefs and look broken.

**Cost.** No new dependency and no new service. One table (`brief_templates`), one column on
`streams`, one column plus a transition trigger on `campaigns`, one notification type, two Edge
Function operations, one admin screen, one approval surface, and six field sets transcribed from the
deck.

**Testing.** pgTAP: a sub-task on a `pending_approval` campaign cannot be assigned and no booking may
be made against it — asserted through a plain PostgREST-shaped update, not only through the RPC;
approval flips exactly one campaign and is refused to anyone who is not its account manager;
cross-tenant read and write of `streams.brief` and `brief_templates` denied. Unit: a proposed
deliverable naming a discipline outside the tenant's active `work_types` is rejected, not created; a
discipline with no deliverables gets no brief; a field the source does not address comes back `N/A`
and is not chased; a template with no fields makes its brief type unselectable. UI: the account
manager can edit every generated brief before approving; approval releases assignability; EN/AR
labels render with correct direction.
