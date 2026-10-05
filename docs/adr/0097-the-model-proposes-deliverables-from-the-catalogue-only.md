# ADR-0097: The model proposes deliverables from the catalogue only, and never invents a name

- **Status:** accepted (Edward, 20 Sep: *"accept all, proceed"*)
- **Date:** 2026-09-20
- **Open Decision:** none — Edward, 20 Sep: *"The LLM does not select deliverables based on the
  deliverables defined — it proposes its own; users then need to select type etc. This is confusing
  to the user and with more than 260 deliverables most certainly will cause issues."*
- **Task(s):** I53.2 (this), I53.3 (the searchable type picker it relies on), I53.4 (generating
  new deliverables on a promoted campaign runs through the same door), ADR-0096 d.8 (the phase
  suggestion rides on the same call)
- **Depends on:** [ADR-0051](0051-a-deliverable-has-a-type-and-a-specification.md) (the
  vocabulary: `deliverable_types`, code is the key), [ADR-0052](0052-a-deliverable-type-implies-a-list-of-unassigned-tasks.md)
  (a type materialises the task list — which is why an untyped row is a dead row),
  [ADR-0050](0050-a-brief-belongs-to-a-department-and-a-deliverable-has-an-owner.md) d.6 (the model
  proposes what, never who — unchanged), [ADR-0044](0044-briefs-are-ingested-by-a-model.md) /
  [ADR-0049](0049-brief-ingestion-runs-on-openai.md) (the model boundary and provider).
  **Amends [ADR-0054](0054-the-model-proposes-a-type-from-the-tenants-own-list.md)** — d.1, d.2,
  d.4 and d.6 are replaced below; d.3 (legend grouped by category), d.5 (a missing vocabulary is
  said, not hidden), d.7 (no breach of ADR-0050 d.6) and d.8 (channel by extraction) stand.

## Context

`generate-deliverables` (ADR-0048 d.4, ADR-0054) proposes the deliverable list a brief implies.
As built it runs **two passes**: pass 1 reads the brief and lists what it asks for **in the
model's own words** (*"Launch teaser"*, *"Weekly engagement post"*); pass 2 is handed those names
and asked which of the tenant's type codes each one is. Pass 2 *"can never cost a row"* — a
failure, a timeout, a malformed answer or a code the tenant does not have leaves the row untyped,
and ADR-0054 d.6 made an untyped row legal and permanent.

That design was the answer to a real failure (29 Aug): putting the 240-code enum on the
extraction schema, required on every row under `strict`, made `{"deliverables": []}` the cheapest
schema-valid answer, and a brief plainly listing four deliverables came back with none. Splitting
the passes protected extraction. It also produced what Edward saw on 17 and 20 Sep:

- A campaign on production whose deliverables **had no type** — so no task list ever
  materialised, nothing could be assigned, and the page looked broken (`I52.18`, `I52.21`).
  The proposals had arrived untyped and nobody had noticed the *"no type set"* mark on rows that
  otherwise looked complete.
- Rows whose names are the model's prose, not the catalogue's — so the same thing is called
  *"Social post"*, *"Static post"* and *"Instagram static"* on three campaigns, and the user's job
  is to work out which of 260 types the model meant.
- A plain `<select>` of 260 rows as the only way to fix it (`BriefWizard.tsx`,
  `DeliverableDialog.tsx`).

The catalogue is the tenant's own, seeded and then edited (ADR-0051 d.3): 16 categories, 240
codes at seed, 260-odd in use. It is the vocabulary the whole system runs on — a type decides the
task list (ADR-0052), the review shape, the specification fields. A proposal outside it is not a
proposal the system can act on.

### What was weighed

**A — Propose from the catalogue only.** The model is shown the catalogue as a menu grouped by
category and answers with a **code** and a quantity per row; the row's name defaults to the
type's name; a code that is not in the catalogue is refused by the function and the row is
flagged, never given an invented name. Chosen — Edward, 20 Sep: *"A"*.

**B — Keep the two passes; drop any row that does not classify.** Simpler than A, but a brief
that asked for something gets silently shorter, which is the failure ADR-0054 d.5 forbids in
another form.

**C — Keep everything; add the searchable picker.** Fixes the picking, not the confusion; the
prose names stay and so do the untyped rows.

### Why A does not re-open the 29 Aug failure

The 29 Aug answer went empty because the **schema** demanded one of 240 enum values on every row,
and an empty list satisfied it for free. A does not put the enum in the schema. The code is a
**free string in the schema, validated server-side after the answer** (ADR-0054 d.4 already
revalidates; this makes that check the *only* check). The catalogue reaches the model as text — a
menu, grouped by category, `CODE  Name` — which is the shape ADR-0054 d.3 chose for the legend
and which the same function already builds. A menu in the prompt does not make the empty list
cheaper; an enum in the schema did. `I24.1` (the enum ceiling) stops mattering.

## Decision

1. **One pass.** `generate-deliverables` reads the brief with the tenant's catalogue in front of it
   and returns rows of `{ type_code, quantity, channel?, note? }`. There is no extraction pass and no
   classification pass; the two-pass shape and its `classify*` prompt are removed.

2. **The row is named by its type.** A proposed row's `name` is the catalogue name of `type_code`
   (`deliverable_types.name_en`, in the tenant's edited form). The model does not return a name
   and cannot invent one. The person may rename the row in the wizard (as today) and on the
   campaign page (`rename_deliverable`, `I52.13`). Where the model quotes something worth keeping
   from the brief — *"the 20-second animation in the reference style"* — it goes in `note`, shown
   under the row, never as its name.

3. **The catalogue is a menu in the prompt, the code is a free string in the schema.** The system
   prompt carries every active type of the caller's tenant, grouped by category, `CODE  Name`
   (ADR-0054 d.3's legend, now the whole vocabulary). The JSON schema's `type_code` is a string
   with a pattern, not an enum. `strict` stays on for the shape; the vocabulary is enforced in
   d.4.

4. **A code outside the catalogue is refused, and the row is kept and flagged.** Server-side, every
   `type_code` is checked against the tenant's active list. One that is absent, inactive or
   malformed makes the row **`type_code: null` with `needs_type: true`** and the model's `note`
   preserved so the person can see what was meant. The wizard shows such a row with the searchable
   type picker open on it (I53.3) and the words *"choose a deliverable"*; **release is refused while a row
   needs a type.** This replaces ADR-0054 d.6's *"a row with no type is a legal row … nothing blocks
   submission on it"* for rows that come from the model. A person may still create an untyped row
   by hand (ADR-0051 d.7) — and since `I52.21` may set the type later — but the model may not hand
   one over as finished.

5. **The person is told how the proposals were made.** The response says how many rows were
   proposed, how many needed a type, and — as ADR-0054 d.5 already requires — whether the
   vocabulary could be offered at all. A tenant with no active types gets no proposals and a
   sentence saying why; it never gets prose rows.

6. **Phases (ADR-0096 d.8).** When the campaign has phases, the call carries the phase list (number,
   name, dates) and each row may carry a `phase_number`. A number that is not in the list is
   dropped from the row (the row is kept); the wizard then places the row by the fallback in
   ADR-0096 d.8. This is a suggestion of *when*, marked as proposed until touched; it is not
   *who* (ADR-0050 d.6 stands, and the prompt rule that enforces it stays verbatim).

7. **Every field that selects a type is a searchable picker (I53.3), and on screen it is called
   "Deliverable".** Edward, 20 Sep: *"Why are we picking type? If we pick a deliverable a type is
   already mapped."* — the 260 catalogue rows ARE the deliverables as the team names them; the code's
   `deliverable_types` is that catalogue and a campaign's `deliverables` row is one of them with a
   quantity, an owner and a date. So the field is labelled **Deliverable**, never *Type*; the row's
   free-text name is a *label* beside it (*"Post 4"* — the sheet's *Content piece* next to its
   *Format*). One component (`DeliverablePicker`, the shape of `PersonPicker`): type to filter on
   code, name or category, results grouped by category, keyboard-navigable, the current value shown
   as a chip. It replaces the plain `<select>` in the wizard's rows, in *Add / edit deliverable* on
   the campaign page, and anywhere else one of the 260 is chosen. The picker is what makes d.4's
   *"choose a deliverable"* usable with 260 rows.

8. **Proof.** The function's unit tests cover: a brief with four plain deliverables → four typed
   rows (the 29 Aug case, now against the menu); a code the tenant deactivated → flagged, note
   kept; a tenant with no types → no rows and the reason. The wizard's coverage spec drives a
   real brief through the local stack and asserts typed rows, one flagged row with the picker
   open, and release refused until it is set (ADR-0095: one who may release, one who may not).

## Consequences

**Easier.** Every proposed deliverable is one the system can act on: typed, so its task list
materialises on insert (ADR-0052), named consistently across campaigns, and searchable when it
needs a hand. The untyped-deliverable class of production defect (`I52.18`/`I52.21`) cannot arrive
from the model any more. One model call instead of two — cheaper and faster, and the failure
budget simpler (ADR-0044 d.9).

**Harder.** The model can only propose what the catalogue has. A brief asking for something the
tenant has no type for comes back as a flagged row with a note, and the person adds the type in
Admin first (ADR-0051 d.3) — that is the intended pressure: the catalogue is the vocabulary. Prose
names disappear; anyone who liked *"Launch teaser"* renames the row.

**Locked in.** The catalogue is a menu in the prompt, never an enum in the schema — the 29 Aug
lesson stays written down here. A model-proposed row is never released untyped. The picker is the
one way to choose a type.

**Superseded in ADR-0054:** d.1 (the shape now has no `name` from the model), d.2 (no enum in the
schema), d.4 (a refused code flags the row rather than leaving it a quiet legal one), d.6 (release
blocks on a model row without a type). ADR-0054 is marked *amended by ADR-0097* on acceptance; it
stays accepted for what it still says.

**Money.** One call per proposal instead of two; the prompt is longer by the catalogue (~260 short
lines, ~3,000 tokens) — a smaller bill per brief than today's two calls. No new dependency.
