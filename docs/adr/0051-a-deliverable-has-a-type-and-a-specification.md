# ADR-0051: A deliverable has a type, and a type carries its specification

- **Status:** accepted
- **Date:** 2026-08-28
- **Open Decision:** — (specified by Edward, 28 Aug)
- **Task(s):** **I18** (new) — the taxonomy tables, the seed, the Admin screen, the wizard step and
  the read-across. The earlier three-way collision on I18 is resolved: **ADR-0053 now names I20 and
  ADR-0054 takes I24** (I23 is ADR-0057), leaving I18 to this ADR alone. `docs/TASKS.md` is edited **on acceptance**.
  Relates to ADR-0020
  (Brief Wizard), ADR-0024 (deliverable lifecycle), ADR-0029 (SLA profiles), ADR-0048 (brief
  templates as tenant data, and the EN/AR precedent), ADR-0050 (owner, and why a seeded list must
  not be structural)
- **Forward dependencies, decided elsewhere:** workflow templates (ADR-0052), retiring
  `work_types` (ADR-0056), the model proposing a type code (ADR-0054)

## Context

Edward, 28 Aug:

> _"the current set up is still quite rigid and would not serve well as a true multi-tenant
> system. one issue is the deliverables taxonomy, which is somewhat limited at the moment… 2 we
> have one flow at the moment (brief to creative). We have not done anything yet with regard to
> the production team which is a pipeline flow."_

### Today a deliverable is a sentence

`deliverables` carries `name`, `state`, `due_at`, `owner_user_id`, `department_id`, plus the
revision counters. That is all. "60-second hero film" is free text in the `name` column.

The rest of the specification **is** collected — the wizard asks for quantity and a commence date
— and then filed into a JSON blob on the campaign. The comment at
`src/features/campaigns/api/campaign-api.ts:158` says so, deliberately and in as many words:

> _"Persists the full deliverable spec (quantity, load, commence date) inside the brief jsonb —
> the deliverables table is intentionally minimal (name/state/due) — and materialises a
> deliverable row per line so scheduling and the dashboards see them."_

So `create_campaign_from_brief` receives `quantity` in `p_brief` and writes a deliverable row
without it. Nothing is lost, and nothing is reachable either. A value inside
`campaigns.brief -> 'deliverables'` cannot be filtered on a list screen, counted in a report,
constrained by a check, joined to an SLA profile, or used to decide what work a deliverable
implies. It can only be read back by the wizard that wrote it.

That was a reasonable call when a deliverable was a line on a brief. It stops being one the
moment the deliverable is the thing the system schedules, reviews, bills and ships.

### The reference document

`docs/reference/Agency Deliverable Taxonomy.md` — **16 categories, 240 codes**, both counted from
the file rather than taken from its headings. Each category has exactly one three-letter code
prefix (`STR`, `IDN`, `GUI`, `CAM`, `ADV`, `SOC`, `CNT`, `VID`, `PHO`, `DIG`, `PRT`, `PAC`, `ENV`,
`PRE`, `MER`, `EVT`), verified one-to-one against the sixteen headings.

It also states the system principle this ADR is the first half of:

> A user should ideally select **Category → Deliverable → Channel → Format → Quantity → Due
> Date**. The system then determines **Workflow → Required stages → Required approvals →
> Required team roles → Required files → Production requirements → Final delivery requirements.**

The left-hand side is this ADR. The right-hand side is ADR-0052. They are separated because they
are separately wrong-able: a taxonomy with no workflow is merely a tidy dropdown, but a workflow
engine keyed to a taxonomy nobody agreed on is a rebuild.

**What the document does and does not say about the attribute lists.** It marks **Format** and
**Channel** with the word "Examples". It marks Orientation, Production Type, Complexity and Client
Approval with nothing at all — it neither says they are exhaustive nor says they are examples.
An earlier draft of this ADR read that silence as "complete" and built four Postgres enums on it.
That was an inference stated as a fact, and it is corrected in d.10.

### Why a seeded taxonomy is safe when seeded disciplines were not

ADR-0050 threw out a seeded list — the six `work_types` — because it was **organisational
structure**, and no vendor can seed an agency's org chart. Edward's Social & Content is a team
inside Creative; the seeded list had it as a sibling. The shape was wrong, not just the names.

A deliverable taxonomy is a different kind of thing. A TVC is a TVC in Baghdad and in Berlin.
"Billboard", "Reel", "Annual Report" are the industry's shared vocabulary for **what is being
made**, and they describe the artefact, not the people. Nothing about `VID-001 TVC` asserts who
makes it, which department owns it, or how the tenant is organised.

That distinction is the whole licence for seeding this list, and it is the line to hold in every
later decision: **seed vocabulary, never structure.** The moment a seeded row names a department,
a team or a role, it has become the `work_types` mistake wearing a new table name.

### The names are not unique — the codes are

Twelve deliverable names appear in more than one category. Verified against the file:

| Name                 | Codes            |
| -------------------- | ---------------- |
| Billboard            | ADV-006, ENV-010 |
| Bottle               | PAC-007, MER-006 |
| Campaign Strategy    | STR-012, CAM-001 |
| Event Branding       | ENV-006, EVT-010 |
| Event Video          | VID-013, EVT-012 |
| Label                | PRT-020, PAC-011 |
| Long-form Video      | SOC-006, VID-010 |
| Newsletter           | CNT-015, PRT-009 |
| Print Advertisement  | ADV-001, PRT-016 |
| Reel                 | SOC-004, VID-008 |
| Short-form Video     | SOC-005, VID-009 |
| Social Advertisement | ADV-003, SOC-009 |

These are not errors in the document. A Reel produced by the social team from existing assets and
a Reel cut from a shoot are genuinely different pieces of work with different specifications, and
the taxonomy is right to distinguish them. But it means **the name is not a key**, in the
database, in a picker, or in anything a model returns. Every mechanism this ADR touches keys on
the code.

It also means the **category** has to be a key too, not a caption. `Reel` is only unambiguous once
you know whether you are in Social Media or Video & Motion, and ADR-0054 leans on exactly that to
disambiguate `SOC-004` from `VID-008`. A category held as free text under a seed-then-edit regime
would let "Social Media" and "Social media" coexist in one tenant and split the picker down the
middle. d.5 closes that.

### What the four ADRs all forgot: Arabic

`AGENTS.md` §5 requires EN + AR on every user-facing string, and ADR-0048 d.2 already set the
pattern for tenant-owned reference data: `brief_templates.fields` carries `{key, en, ar, …}` and
the seed migration ships real Arabic labels for every field of every template. None of
ADR-0051–0054 mentioned i18n at all, and this ADR proposes seeding 240 English deliverable names
plus roughly 50 attribute labels per tenant. Discovered in review; closed in d.6 rather than left
for a translation pass that would then have to alter three tables.

### Options weighed

**A — Vocabulary only.** `deliverable_types` and a FK from `deliverables`; the specification stays
in the jsonb. Cheapest, and it delivers the clean dropdowns and the closed list a model can be
constrained to. Rejected as _insufficient_, not as wrong: the type alone tells you a deliverable
is a Reel and still cannot tell you whether it is 9:16 or square, or how many, or whether the
client has to sign it off. Half the questions a producer asks are attributes, not type.

**B — Vocabulary plus attributes on the row.** _Chosen._ The type and the specification both become
columns. Costs a wider table and a migration that reads the existing jsonb.

**C — Everything in one ADR** — taxonomy, workflow templates, `work_types` retirement and the model
change together. Rejected on the skill's own rule: one decision per ADR. It also fails the
practical test — this ADR can be accepted, migrated and shipped on its own and leaves the system
better; a combined one cannot be partially accepted.

**Within B, sub-question one: attributes on the row, or attributes in jsonb?**

jsonb is tempting because `campaigns.brief` already holds them and the shape may still move. It is
rejected because every use the taxonomy document describes is a _query_: "show me everything
awaiting client approval", "how many 9:16 versions did we make last quarter", "this type always
needs legal sign-off". A jsonb blob on the parent campaign answers none of those without a scan
and a cast, and a value nothing can query is a value nobody maintains — which is exactly what
happened to `quantity`. `brief_templates.fields` stays jsonb for the opposite and correct reason
(ADR-0048 d.2): an ordered document edited whole, never filtered.

**Within B, sub-question two: are any of the six attribute lists Postgres enums?**

The earlier draft made four of them enums. Rejected on three grounds, and the reasoning is worth
keeping because it applies to every future list this product is tempted to close:

1. **A Postgres enum is global, not tenant-scoped.** This is a multi-tenant database with one
   schema. "Closed" does not mean "closed for tenants who should not extend it" — it means closed
   for every tenant, forever, and only Edward can ever reopen it.
2. **Extending one is a two-migration job.** `20260817110000_add_blocked_deliverable_state.sql`
   says so in its own header: Postgres will not let a newly-added enum value be _used_ in the
   transaction that adds it, so the value lands in one migration and everything that reads it in
   the next. That is the real price of a seventh approval level, and it is paid by a release, not
   by an Admin screen.
3. **Nothing branches on these columns yet.** Across ADR-0051–0054 there is no code path that
   reads `orientation`, `production_type`, `complexity` or `client_approval` and does something
   different per value. The rigidity would be bought today for a consumer that does not exist.

The one place an enum is honest is the `attribute` discriminator itself (d.10): a seventh
_attribute_ means a seventh column on `deliverables`, which is a migration whatever we do.

**Within B, sub-question three: does "× 6" mean one deliverable or six?**

The earlier draft stored 6 as an attribute of one row and sent the question to ADR-0052; ADR-0052
sent it back ("a question about what a deliverable _is_, which belongs with the taxonomy in
ADR-0051"). It is closed here, in d.11, and the constraint that closes it is already in the
schema: `media_records` is `unique (deliverable_id, version)`
(`20260728110800_create_media_and_review_records.sql:24`). One deliverable holds **one file per
version**. Six Reels under one deliverable cannot be six files, cannot be six review threads, and
cannot be approved one at a time. Individual review of six items is not merely awkward under one
row — it is impossible.

## Decision

1. **`deliverable_types` is a new tenant-scoped table.** Columns: `code`, `category_code`,
   `name_en`, `name_ar`, `is_active`, the per-type settings named in **d.12**, and
   `default_workflow_template_id` (d.15). Unique on `(tenant_id, code)`. Standard tenant columns per
   `AGENTS.md` §4. (`quantity_expands` and `default_production_type` were added by d.11 and are
   **withdrawn with it** — ADR-0058 removes the expansion they existed to control.)

2. **It is seeded from the reference document — 16 categories, 240 codes — per tenant, by
   `app.seed_tenant_deliverable_types(uuid)`**, folded into the `public.seed_tenant_roles`
   provisioning wrapper exactly as `app.seed_tenant_brief_templates` was
   (`20260827200000_brief_templates.sql`). The same function seeds `deliverable_categories` (d.5)
   and `deliverable_attribute_values` (d.10), in that order, because the types reference the
   categories. Idempotent and non-destructive throughout: `on conflict … do nothing`, so
   re-running never overwrites an edited row.

3. **Seed-then-edit.** A tenant owns its lists outright: rename any row, deactivate what they do
   not do, add codes of their own. The seed is a starting point, not a contract. Written under
   `organization:manage` — the authority that already edits roles, offices and brief templates —
   and readable by everyone in the tenant, because a picker that cannot read the list cannot
   render.

4. **The code is the key; the name is not.** Twelve names are ambiguous across categories (listed
   above). `(tenant_id, code)` is unique; `name_en` carries no constraint beyond non-empty. Any
   lookup, import, or model output resolves on code. A tenant adding its own rows chooses its own
   codes; the only rule is uniqueness within the tenant.

5. **A category is a code, not free text.** New `deliverable_categories (tenant_id, code, name_en,
name_ar, sort_order, is_active)`, unique on `(tenant_id, code)`, seeded with the sixteen
   three-letter prefixes the taxonomy already carries. `deliverable_types.category_code` is
   `not null` and references it on `(tenant_id, category_code)`.

   A category is the first level of the wizard's Category → Deliverable path and the grouping
   ADR-0054 uses to tell `SOC-004 Reel` from `VID-008 Reel`. Held as free text under seed-then-edit,
   two spellings of "Social Media" would silently split that picker in two.

   **A tenant-added type must name an existing active category** — there is no "Uncategorised" and
   no null, because a type in no category cannot be reached by the wizard's own navigation. A
   tenant wanting a category the seed does not have creates it first, under the same
   `organization:manage` authority. Matching the type's code prefix to its category code is the
   **seeding convention** (all 240 seeded rows satisfy it) and deliberately **not a constraint**:
   a tenant's own codes are its own business, and the FK, not the spelling, is what holds the
   grouping together.

6. **Every name and label is EN + AR from the first migration.** `deliverable_types` carries
   `name_en` / `name_ar`; `deliverable_categories` carries `name_en` / `name_ar`;
   `deliverable_attribute_values` carries `label_en` / `label_ar`. `name_en` and `label_en` are
   `not null`; the Arabic columns are nullable and fall back to English at render time.

   **The seed ships English only, and that is recorded as an outstanding debt, not a design.**
   Translating 240 deliverable names and ~50 attribute labels is work for a native Arabic speaker
   who knows the trade — "Prepress", "Key Visual" and "Wordmark" are not dictionary lookups — and
   this ADR does not have one. The Admin screen shows which rows are untranslated so the gap is
   visible rather than discovered by an Arabic-speaking user. ADR-0048's seed is the model to
   follow when the translations arrive: real Arabic, in the migration, per row.

7. **`deliverables.deliverable_type_id` is nullable and stays nullable.** Every deliverable that
   exists today has no type, and each must keep working untouched — on the list screens, in
   review, in scheduling, in the dashboards. An untyped deliverable is a legal, permanent state,
   not a migration failure waiting to be cleaned up.

8. **A missing type is shown, never swallowed.** Surfaces render "no type set" and offer to set
   one. Nothing filters an untyped deliverable out of a list it would otherwise appear in, and no
   code path treats "no type" as "no deliverable". Edward, 27 Aug: _"ANYWHERE AN ERROR COULD OCCUR
   IT SHOULD NOT FAIL SILENTLY"_ — and an item vanishing from a list because a column is null is
   the same failure as the empty deliverables table was.

9. **`deliverables` gains the specification as columns**, sourced from the document's DELIVERABLE
   ATTRIBUTES section: `quantity`, `channel`, `format`, `orientation`, `production_type`,
   `complexity`, `client_approval`. The six attribute columns hold the **code** of a
   `deliverable_attribute_values` row, as text. The existing `campaigns.brief -> 'deliverables'`
   values are read across in the same migration so nothing already captured is lost.

10. **All six attribute lists are tenant data in one editable table — none of them is an enum.**

    `deliverable_attribute_values (id, tenant_id, attribute, code, label_en, label_ar, behaviour,
sort_order, is_active, created_at, updated_at)`, unique on `(tenant_id, attribute, code)`,
    seeded per tenant from the reference document and then owned by the tenant on exactly the
    seed-then-edit terms `deliverable_types` gets (d.3).

    **The ordering column is `sort_order` on both tables, never `sequence`.** `sequence` is a
    Postgres keyword: legal unquoted, but it reads as DDL in every query that mentions it and has to
    be quoted the moment anything builds SQL around it. ADR-0052 d.2 uses `sort_order` on
    `workflow_steps` for that reason; the two are aligned here rather than reconciled later.

    | `attribute`       | Seeded values                                                                                              |
    | ----------------- | ---------------------------------------------------------------------------------------------------------- |
    | `channel`         | Instagram, Facebook, TikTok, YouTube, LinkedIn, Website, Email, TV, Radio, Print, OOH, DOOH, Retail, Event |
    | `format`          | JPG, PNG, SVG, PDF, AI, EPS, PSD, INDD, MP4, MOV, HTML, PPTX                                               |
    | `orientation`     | Portrait, Landscape, Square, Custom                                                                        |
    | `production_type` | Digital, Print, Physical Production, Video Production, Photography, Audio, Installation, Hybrid            |
    | `complexity`      | Simple, Standard, Complex, Major Production                                                                |
    | `client_approval` | Not Required, Internal Only, Client Review, Client Approval, Legal Approval, Regulatory Approval           |

    `attribute` **is** a Postgres enum (`deliverable_attribute`, six values), and that is the one
    place an enum is the right instrument: a seventh attribute needs a seventh column on
    `deliverables`, so it is a migration no matter how the values are stored. The _values_ are
    rows, for the three reasons in Options, sub-question two.

    **`behaviour` is the escape hatch that makes this safe to extend.** It is a nullable text key
    drawn from a small closed set defined per attribute by whichever ADR first branches on that
    attribute. A tenant adding a seventh `client_approval` level — say "Shariah Board Review" —
    gives it `behaviour = 'client_approval'` and it takes the branch the existing level takes.
    Nothing writes or reads `behaviour` today and every seeded row ships it null; the column
    exists so that the first code path needing a bounded set has somewhere to put the mapping
    instead of reaching for an enum and closing the list for every tenant.

    **The six columns on `deliverables` carry codes and no FK.** They are labels, not
    relationships: the read path is one row, and a value that has been deactivated still renders.
    Values are deactivated, never deleted (d.13 applies to this table too), and if a code has no
    matching row the surface shows the raw code rather than a blank — the d.8 rule, applied to
    attributes. `deliverable_type_id` is a real FK, because that one carries settings and a
    workflow and the relationship is the point.

11. **SUPERSEDED by ADR-0058 — a quantity never expands into separate deliverables.**

    This decision said six Instagram Reels become six deliverables, reasoning from
    `media_records unique (deliverable_id, version)` that one deliverable can hold only one
    reviewable artefact.

    **The premise was wrong.** Approval has always been per sub-task (`sub_task_reviewers`,
    `app.maybe_complete_sub_task`), and a deliverable already cannot be approved until every
    sub-task is `done` or `cancelled`. Only the *file* was in the wrong place — the submit gate
    accepted any version on the deliverable rather than the submitting task's own.

    ADR-0058 fixes that and restates the model: **the deliverable is a container, the sub-task is
    the unit of work and of review.** "Instagram Reel × 6" is one deliverable with six sub-tasks,
    each with its own artefact, reviewers and approval, and the deliverable approves itself when
    the last one lands.

    `quantity` stays a column on `deliverables` (d.9) describing what the deliverable is. The
    `quantity_expands` flag and the `default_production_type` column this decision introduced are
    withdrawn with it.

12. **Four of the five `work_types` settings move onto the type; accountability stays behind.**
    `deliverable_types` carries `lead_time_hours`, `default_load_pct`, `revision_limit` and
    `sla_profile_id`.

    Lead time and default load are _more_ useful per type than per discipline: "a billboard takes
    five days" is a fact about billboards wherever they are made, whereas "Creative takes five
    days" is not a fact about anything. `revision_limit` is the one with a reader waiting for it —
    `deliverables.revision_limit` is already read and displayed as "2 / 3" on
    `src/features/deliverables/DeliverablesPage.tsx:197`, and
    `20260817110100_deliverable_lifecycle_engine.sql:17` promises "Effective limit = coalesce(this,
    work_type)" in a comment that no code has ever honoured. `sla_profile_id` is genuinely live:
    `app.effective_sla` reads `work_types.sla_profile_id` at tier 4 of its six-tier chain
    (`20260819180000_sla_profiles.sql`).

    **`accountability_profile_id` is deliberately left on `work_types`.** Accountability is about
    people and departments, which is precisely the thing this table is forbidden to describe
    (d.14) — and ADR-0050 has already moved accountability to the named owner. Its consumer is
    `P2.2`, which is ⚠️-gated on **OD 7** and still open, so moving it now would be relocating a
    column for a design that has not been decided.

    **Verified, so the honest state of the four is on the record:** `lead_time_hours` and
    `default_load_pct` are read by nothing anywhere in `src/` or `supabase/functions/` — they exist
    only in the DDL that created them. `work_types.revision_limit` is read by nothing either,
    despite the comment. Only `sla_profile_id` has a live reader. So this decision carries two dead
    columns, one half-dead one and one live one — dead here meaning _not yet consumed_, which is
    why they are worth carrying rather than dropping.

    **This ADR copies those columns; it does not cut them.** `work_types` keeps its own, every
    existing reader keeps reading them, and the new columns are written but **not yet read by
    anything** — `app.effective_sla` is untouched here. Which of the two wins is ADR-0056's
    decision, and until it is taken there is a deliberate, documented overlap.

13. **Deactivation is soft and never orphans a deliverable.** `is_active = false` removes a type,
    category or attribute value from every picker and leaves every deliverable already pointing at
    it working and displaying its name normally. The FK blocks deletion of a referenced type
    outright; a tenant that wants one gone deactivates it. A deliverable's type is a record of what
    was agreed, and rewriting history to tidy a dropdown is not a trade this system makes.

14. **Nothing in these three tables names a person, a department, a team or a role.** The taxonomy
    describes artefacts. Accountability stays exactly where ADR-0050 put it: the owner the Account
    Manager names, and the department derived from that person.

15. **`default_workflow_template_id` is added here with no foreign key; ADR-0052's migration adds
    the constraint.** The column is nullable `uuid` and nothing writes or reads it until ADR-0052.
    It cannot carry a FK today because `workflow_templates` does not exist — ADR-0052 d.2 is what
    creates it — and ADR-0052 as written never mentions this column. So, explicitly: **the
    migration that creates `workflow_templates` also runs `alter table deliverable_types add
constraint fk_deliverable_types_workflow_template foreign key (default_workflow_template_id)
references workflow_templates(id)`**, in the same migration, and ADR-0052 is amended to say so
    before it is accepted. If ADR-0052 is not taken, this column is dropped rather than left as an
    unconstrained uuid that looks like a reference and is not.

16. **SUPERSEDED by ADR-0058 — there is no expansion, so there is nothing to cap.**

    This capped d.11's expansion at 50 rows per line and 200 per campaign. With d.11 withdrawn a
    quantity produces sub-tasks under one deliverable rather than deliverables, so the multiplication
    it guarded against does not occur.

    One finding from it is worth keeping and is **not** superseded: `MAX_PROPOSED_DELIVERABLES = 25`
    and `MAX_DELIVERABLE_QUANTITY = 99` (`src/lib/brief/deliverables.ts:19,25`) bound only what the
    *model* may propose, enforced by Zod in `deliverables-generate-api.ts:45,48`. The wizard's own
    quantity input is `min={1}` with **no maximum** (`BriefWizard.tsx:664`) and Add Row has no
    ceiling. Whether a hand-typed quantity should be bounded is now a question about how many
    sub-tasks one deliverable may hold, and it belongs to ADR-0058's task list.

## Consequences

**Easier.** The specification becomes queryable for the first time — "everything awaiting legal
approval", "every 9:16 asset this quarter", "how many Reels did we ship" are `where` clauses
rather than impossibilities. Wizard step 3 gains real structure (Category → Deliverable → Channel →
Format → Quantity → Due) in place of a free-text box. Six Reels become six things a producer can
actually track, review and sign off one at a time. A closed, tenant-owned list is the thing
ADR-0054 needs to constrain the model to, and this ADR is what makes that possible. And a tenant
whose vocabulary differs edits its own data — all of it, including the attribute lists — instead of
asking for a release.

**Harder.** `deliverables` grows eight columns and the system grows three tables, 240 seeded types,
16 seeded categories and ~50 seeded attribute values per tenant. Step 3 of the wizard asks more of
the Account Manager than a name and an owner — honestly more work, in exchange for the row meaning
something afterwards. The AM can leave every new field blank: nothing here is mandatory except a
type's category, and d.7/d.8 exist so that a blank one is visible rather than fatal. The Admin
surface is bigger than one screen: types, categories and attribute values are three lists.

**Expansion multiplies, and the numbers are worth saying out loud.** A wizard row becomes as many
deliverables as its quantity, each deliverable becomes a template's worth of tasks under ADR-0052,
and the two multiply. A thirty-post social calendar is thirty deliverables and, at eight steps a
piece, two hundred and forty unassigned tasks — every one of which the Account Manager is asked to
read before approving the campaign. That is the _realistic_ case, not the pathological one, and it is
a genuinely worse review surface than the single row it replaces. d.16 bounds the pathological end
(one submit could otherwise have created 2,475 deliverables and tens of thousands of tasks in one
transaction); ADR-0052 d.11's unassigned count is what makes the realistic end legible. Neither makes
240 rows small. The trade is deliberate: six Reels that can each be reviewed and signed off is the
whole point of expanding, and the price of it is a longer list on day one.

**Arabic is owed, not done.** The seed ships 240 English type names, 16 English category names and
~50 English attribute labels with `name_ar` / `label_ar` null. Every surface falls back to English
until a native speaker supplies the translations. This is a known, visible gap against `AGENTS.md`
§5 rather than an oversight, and it is the largest single piece of outstanding work this ADR
creates.

**A deliberate temporary overlap.** After this ADR, lead time, load, revision limit and SLA settings
exist in two places (`work_types` and `deliverable_types`) and only the old ones are read. That is
an untidy state and it is chosen over the alternative, which is bundling a rewrite of
`app.effective_sla` into a migration whose subject is a taxonomy. ADR-0056 closes it. If ADR-0056
is not taken, this ADR has left four unread columns behind — a small, visible cost, recorded here
so it cannot be discovered later as a surprise.

**Locked in.** Code is the key, not name — for types, for categories and for attribute values. The
taxonomy is tenant data, seeded and then owned, and **no part of it is a Postgres enum except the
`attribute` discriminator**. Category is mandatory and is a code. The ordering column is
`sort_order`, matching ADR-0052. Every name and label has an EN and an AR column from the first
migration. `deliverable_type_id` is nullable forever. A quantity does **not** expand into separate deliverables
(d.11, d.16 — superseded by ADR-0058): "Instagram Reel × 6" is one deliverable holding six
sub-tasks, each separately reviewed, and `quantity` simply records what the deliverable is. The
specification lives on the deliverable row, and `campaigns.brief` stops being the only place it can
be found.

**Still open, deliberately.** What workflow a type implies (ADR-0052). Whether `work_types` retires
into this table and `departments` (ADR-0056). Whether the model proposes a code (ADR-0054). Whether
a deliverable can have more than one channel — the column is singular here, following the document,
and multi-channel is a different question about what an asset _is_ rather than about the taxonomy.

**Cost.** No dependency, no service, no money. One migration: three tables (`deliverable_types`,
`deliverable_categories`, `deliverable_attribute_values`), **one** enum type
(`deliverable_attribute`), one seed function, eight columns on `deliverables`, and a read-across
from the existing jsonb. Three Admin lists. One wizard step reshaped, including the expansion
preview and the expansion cap on each row (d.16), plus the same cap re-asserted inside
`create_campaign_from_brief`. One FK constraint deferred to ADR-0052's migration (d.15). Translation
of ~300 strings, unpriced and unscheduled, requiring a native Arabic speaker.

**Testing.** pgTAP: RLS allow and deny including cross-tenant on all three tables;
`organization:manage` required to write and plain members can read; the seed is idempotent and does
not overwrite an edited row; `(tenant_id, code)` is unique on types and categories and
`(tenant_id, attribute, code)` on attribute values; a type cannot be inserted with a
`category_code` that does not exist in its tenant; a deactivated type keeps its existing
deliverables intact and cannot be deleted while referenced; a tenant can insert a seventh
`client_approval` value without a migration. Unit: a deliverable with a null type renders and is
never filtered out of a list (the d.8 guard, written as a regression test rather than a comment); an
attribute code with no matching row renders as the raw code and never as blank; a null `name_ar`
falls back to `name_en`; the read-across preserves every `quantity` currently in `campaigns.brief`
and splits no existing row; a name that maps to two codes resolves by code and is never resolved by
name. Quantity (d.11 and d.16, superseded by ADR-0058): a deliverable with quantity 6 is created as
**one** row carrying `quantity = 6` and is never split, asserted against `create_campaign_from_brief`
directly and not only through the wizard; the six sub-tasks beneath it, and the per-sub-task review
that makes them individually approvable, are ADR-0058's to assert.

**Tracker.** A new **I18** section covers the migration, the seed, the three Admin lists, the wizard
step, the expansion behaviour and cap, and the read-across. `docs/TASKS.md` and `docs/adr/README.md`
are edited **on acceptance**, per the ADR process — not now, while this is `proposed`. The earlier
I18 collision is already resolved in the headers: ADR-0053 names I20 and ADR-0054 names I24, so each
gets its own section at that edit.
