# ADR-0071: A brief orders its own work, and quantity multiplies the creation step

- **Status:** accepted
- **Date:** 2026-09-05
- **Open Decision:** — (specified by Edward, 5 Sep, against the scope table in
  `docs/reference/CampaignTypeTables.xlsx` and the mapping worked through in
  `docs/reference/DRAFT_Taxonomy_Brief_Workflow_Mapping.xlsx`, which he accepted)
- **Task(s):** **I38** (new)
- **Depends on:** ADR-0051 (`deliverable_types`), ADR-0052 (`workflow_templates`, the materialiser),
  ADR-0058 (a deliverable is a container; quantity does not expand into deliverables),
  ADR-0059 (`review_mode`, and the copied-not-referenced rule this ADR reuses).
- **Amends:** ADR-0052 d.7's *"quantity lives in sub-tasks"* — which was written and never built.
- **Relates to:** ADR-0048 (brief templates), ADR-0054 (the model proposes a type from the tenant's
  own list), ADR-0065 (proposed concepts cite the brief), ADR-0069 (a task states what it waits for).

## Context

Two rules have been written down since 28 August and neither was ever implemented, and a third
problem sat under both of them, unnamed.

### 1. Quantity produces no work

ADR-0058 d.9 says *"Instagram Reel × 6 is ONE deliverable with six sub-tasks."* ADR-0052 (line 222)
says a template runs once per deliverable and *"where a step produces N separately reviewed
artefacts, that step carries N sub-tasks."*

`app.materialise_deliverable_workflow` (`20260828220000`, reproduced whole in `20260830090000`)
inserts exactly **one** `sub_tasks` row per active `workflow_steps` row and never reads
`deliverables.quantity`. `workflow_steps` carries no column saying which step is the one that
repeats, so it could not act on quantity even if it read it. Six reels arrive as one Copy task and
one Design task.

ADR-0058 d.5 records what that costs: with six sub-tasks under one deliverable, one uploaded file
satisfied all six submit gates — *"six approvals, five of them of something nobody looked at."* The
gate was fixed; the six tasks it assumed still do not exist.

### 2. Workflow is attached by category, not by type

`deliverable_types.default_workflow_template_id` is per **type**. `20260829130000` seeded it from
the 19 **categories**, and its own comments say *"least wrong"* and *"placeholder"*. So ADV, CNT,
DIG, PRE and MED — 60 types — all ran WF-01 *Brief → Copy/Content → Design*: a media plan, a
billboard and a presentation, same three steps. Meanwhile **WF-11 to WF-14, the four heavy
production pipelines, were mapped to zero types and could never fire.**

Worse, the mapping was made by category *name*. Three categories (INF, MED, AUD) were added on 29
August, the day **after** the 14 templates were seeded, so they were pointed at whatever already
existed: influencer work at Social Content, media plans at Standard Digital. The migration admits
it — *"Creator content moves like social content, but the approval loop differs"*, *"WF-01 is a
placeholder and this is the category most likely to want a template of its own."*

### 3. Nothing said which brief may order which work

There has never been a link between a brief type and the deliverable types it produces. The wizard
offers all 269 types on every brief, sorted by category, so Bottle and Billboard sit beside Reel on
a social brief. The model proposing deliverables from brief text (ADR-0054) chooses from the whole
taxonomy for the same reason.

Edward supplied the scope table on 5 September — one line per campaign type saying what work it
covers — with three instructions: *"we should not lose what we already have in terms of the ability
to add, edit, remove campaign briefs, deliverables etc"*; *"if possible deactivate rather than
remove items not used, as the taxonomy is valuable in the long term"*; and *"the steps outlined for
each should match the work being covered and should have descriptive appropriate names for the
deliverables e.g. Prepare Static Post."*

### 4. The terminology, which is what made the rest hard to see

Working through the templates, Edward: *"the terminology is incorrect and misleading which is not
only confusing me, it will confuse all the users … 1st step is always creative direction, 2nd step
is develop concept, 3rd step create the defined content … in any case the actual creation step is
the repeat per unit step."*

He is right, and the last clause is the useful part: it gives an unambiguous test for which step
quantity multiplies. The seeded names failed it. `Copy/Content`, `Creative`, `Design` and `Artwork`
are craft labels that never say what they produce, and **"Creative Direction" existed in exactly one
template of fourteen** — Photography. Everywhere else work began at Copy, Concept or Design with
nobody having set the direction first.

### What is already right, and must not be disturbed

The system is a live pilot with **two real campaigns, one of them approved**. Four existing
properties do the work of protecting them, and this ADR leans on all four rather than adding
guards:

- **Task titles and review modes are COPIED at materialisation, never read through** (ADR-0059 d.3).
  A template renamed in September cannot change a task issued in August.
- **The materialisation trigger fires only when a deliverable has no `workflow_step_id` tasks at
  all.** An existing deliverable can never gain steps added to its template later.
- **`sub_tasks.workflow_step_id` is `on delete set null`** (`20260828190000:121`), so removing a
  step strands nothing.
- **A plan task is deletable and stays deleted** — `remove_sub_task` deletes an unassigned,
  never-started task outright (ADR-0052 d.10), and the trigger will not regenerate it.

One thing found while checking those, and worth naming here because it is load-bearing for d.9: **the
unique index ADR-0052 d.4 specified was never created.** Only the non-unique
`idx_sub_tasks_workflow_step_id` exists (`20260828190000:124`). "Never duplicates" has been held by
the materialiser's `where not exists` and nothing else since 28 August.

That last one is why this ADR proposes far less machinery than its first draft did. Edward, on
being shown a proposed split of the influencer template to handle in-house influencers: *"the
current system works...correct?"* It does. **The template proposes; the person preparing the brief
disposes.** Three "decisions" in the working session dissolved on that test and are recorded in
`docs/memory/` rather than built.

## Decision

### The brief and the taxonomy

**d.1 — A brief type declares the deliverable types it orders, and that SORTS the picker; it never
restricts it.** New tenant-scoped table:

```
brief_deliverable_types (id, tenant_id, brief_type text, deliverable_type_id uuid, created_at)
  unique (tenant_id, brief_type, deliverable_type_id)
```

RLS enabled and forced in the same migration; read by every member of the tenant (a picker that
cannot read its list cannot render), written under `organization:manage` — the same authority that
already writes `brief_templates` and `deliverable_types`. No new permission.

`brief_type` is text, matching `brief_templates.brief_type`, not a foreign key to it: a tenant may
delete a brief template and the mapping rows should not take deliverable types with them.

**Sorting, not restricting, is the whole decision here.** The brief's own types appear first in the
picker and everything else stays reachable below. A hard limit would turn every gap in the mapping
into a person unable to do their job, and the mapping is a judgement about an agency, not an
invariant about data. This also means d.1 can be wrong in production without blocking anyone.

**d.2 — Deactivate, never delete.** Nine types are set `is_active = false`; none is deleted, all
keep their codes, and Admin can switch any of them back on. Six resolve duplicate names left open on
29 August — the taxonomy filed the same thing under two categories, so it appeared twice in the
picker:

| Name | Kept | Deactivated |
|---|---|---|
| Reel | SOC-004 | VID-008 |
| Short-form Video | VID-009 | SOC-005 |
| Long-form Video | VID-010 | SOC-006 |
| Social Advertisement | ADV-003 | SOC-009 |
| Print Advertisement | ADV-001 | PRT-016 |
| Billboard | ADV-006 | ENV-010 |

The other three are `STR-001` Brand Strategy, `STR-003` Brand Architecture and `STR-004` Brand
Naming: no brief orders them, confirmed by Edward as deliberate.

**Deactivation is safe for live work and this was checked, not assumed.** The wizard filters the
picker to `isActive` (`BriefWizard.tsx:471`); `deliverables-api.ts:146` reads the type name through
a LEFT embed with **no** active filter, so a deliverable already using a deactivated type still
renders its name.

**d.3 — Brand identity items are the task list of a Brand Guidelines job, not seventeen
deliverables.** Edward: *"all of those items are required for brand guidelines."* The 17 BRAND
IDENTITY types become steps of the branding template (d.6) rather than lines on a brief. They stay
**active** so a logo can still be sold alone through a Single Execution brief.

**d.4 — One new brief template: `digital_build`.** Website, Website Design, Microsite, App Design,
UI and UX were ordered by nothing. Thirteen fields in the house style of ADR-0048 d.2 — label,
bilingual, guidance phrased as a question because that guidance is the model's prompt as well as the
person's hint. Ten fields required, three optional.

**This ships bilingual, and does not repeat the English-only debt of ADR-0051 d.6.** Edward, 5 Sep:
*"Include the Arabic we will have it checked."* All 128 new and renamed strings — brief labels,
brief guidance, every step title on all 20 templates — are drafted in Arabic on the mapping
workbook's `Arabic` sheet, with the register matched to the 28 August seed and its wording reused
verbatim wherever the concept is unchanged. **It is a first draft awaiting the agency's own
reviewer, and the migration is not written until that review is back**, so the Arabic columns land
populated rather than null.

Packaging is ordered by the **Single Execution** brief, whose scope already names 3D. One line per
pack format, quantity = the print run.

### The templates

**d.5 — Six templates are added and one is revised.** `WF-15` Influencer Engagement, `WF-16` Creator
Content, `WF-17` Media & Performance, `WF-18` Event / Activation, `WF-19` Strategy Document, `WF-20`
Digital Build; `WF-07` Branding is revised per d.3. **Every step of every one is derived from the
agency's own brief templates, field by field, and the mapping sheet records which field each step
came from.** The Influencers Brief's Timeline field — *"Creator briefing, drafts received, client
approval, go live"* — is the workflow, stated by the deck itself.

Seeded by the same idempotent pattern as ADR-0052 d.3: `on conflict do nothing` on both templates
and steps, folded into the `public.seed_tenant_roles` provisioning wrapper. A re-run adds what a
tenant lacks and overwrites nothing they have edited.

**d.6 — Every template that makes something starts Creative Direction → Develop Concept.** Creative
Direction is added as step 1 to 13 of the 14 existing templates (Photography already had it) and to
WF-16, WF-18 and WF-20. Develop Concept is added where missing (8 templates). It is **never** a
repeating step: one direction covers all six reels.

Three deliberate exceptions, confirmed by Edward: **Branding** takes Creative Direction *after*
Strategy, because research precedes direction on a branding job; **Media & Performance** and
**Strategy Document** do not take it at all, because a media plan and a written strategy are not art
directed.

**d.7 — Steps are named for what they produce, and the creation step is named `Create …`.**
`Copy/Content` → `Write Copy`; `Creative` → `Create Content`; `Design` → `Create Artwork` /
`Create Design`; `Edit` → `Create Edit`; and so on across 118 steps. The mapping sheet carries the
old name of every renamed step in its own column.

**Renaming touches only rows the seed still owns**: matched on template `code` AND exact current
`title_en`, `is_system` only. A step a tenant has renamed does not match and is left alone. This is
the guard `20260829140000` used for the lifecycle-step removal and it is reused verbatim.

### Quantity

**d.8 — `workflow_steps.repeats_per_unit boolean not null default false`.** One column, defaulting to
today's behaviour, so every existing row keeps working unchanged.

**The convention is Edward's rule — the creation step is the repeating step — and it holds in all 14
existing templates: exactly one repeating step each.** It is a convention and not a constraint,
because two of the new templates break it for good reasons, and both are stated rather than hidden:

- **WF-15 Influencer Engagement has five repeating steps** (Outreach, Contract, Briefing, Seeding,
  Go Live). Its quantity is **creators**, not artefacts, and each of those is genuinely per creator.
- **WF-16 Creator Content has two** — the content and its amplification cutdown, one of each per
  piece.
- **WF-07R Branding and WF-19 Strategy Document have none**, correctly: their quantity is always 1.

A `check` constraint requiring exactly one would therefore be wrong. The rule is documented on the
column and enforced by review, not by the database.

**d.9 — Materialisation multiplies the repeating steps by `deliverables.quantity`.**
`app.materialise_deliverable_workflow` creates one task per non-repeating step and `quantity` tasks
per repeating step. `sub_tasks` gains `unit_index integer null` — null for a step that does not
repeat, 1..N for one that does — with
`create unique index uq_sub_tasks_workflow_step_unit on sub_tasks (deliverable_id,
workflow_step_id, unit_index) where workflow_step_id is not null`.

**This index does not replace an existing one — it is the first of its kind, and finding that out
is a defect this ADR closes in passing.** ADR-0052 d.4 specified
`uq_sub_tasks_workflow_step (deliverable_id, workflow_step_id)` and said it plainly: the
materialiser's `where not exists` guard is not enough, and *"the index is what makes 'never
duplicates' true for a caller that goes round the materialiser."* **It was never created.**
`20260828190000:124` has only the non-unique `idx_sub_tasks_workflow_step_id`, and no migration
since adds a unique one. So the never-twice guarantee has been held by application code alone since
28 August. That mattered little while each step produced one task; it matters a great deal once a
step produces six, because the index is the only thing that makes re-running materialisation
idempotent rather than duplicating a unit.

**This is what makes one `quantity` column mean two things without a second column.** Where a
template has a repeating step, `Instagram Reel × 6` is six reviewable artefacts. Where it has none —
Print, OOH, Packaging — `Business Card × 500` is one artwork and a print run, exactly as ADR-0052
d.7 says. The flag is the whole of the difference.

**d.10 — A task's title is composed at creation: step · deliverable · unit number.** `Create
Artwork — Instagram Reel 3`. This is ADR-0052 d.4's copied title, extended; the template still never
names a deliverable, and a template edited later still cannot rename work already issued.

**d.11 — Influencer work is two lines on the brief, because it has two quantities.** An engagement
line carrying the creators and one content line per format carrying the pieces. Edward: *"We often
use more than 1 external influencer."* Two creators posting 1 reel + 3 stories each is three lines —
quantities 2, 2 and 6 — giving 2 contracts, 2 briefings, 1 shortlist, 1 report and 8 content tasks,
with nothing duplicated. **This needs no schema change**: a template still runs exactly once per
deliverable, and the engagement is simply its own deliverable, which `INF-001` already exists for.

### Protecting what is live

**d.12 — No backfill, ever.** The quantity behaviour applies to deliverables materialised **after**
this migration. Nothing re-materialises an existing deliverable, and the approved campaign is not
touched. The trigger already refuses (it fires only on a deliverable with no template tasks), and
this decision forbids any migration from doing by hand what the trigger will not do by itself.

**d.13 — Unassigned work is reported by campaign, with a drill-down; not as a list of tasks.**
Edward, 5 Sep: *"instead of listing all unassigned, list totals by campaign and allow a drill down."*

The tile lists campaigns and a count each — `Acme Launch · 34 unassigned` — ordered by count
descending, linking to `/campaigns/:campaignId`.

**Campaign work is the only work this tile can ever show, and that is structural rather than a
filter.** An earlier draft gave ad-hoc work its own row on the grounds that it has no campaign
(ADR-0035). Edward, 5 Sep: *"ad-hoc tasks cannot be unassigned."* Correct —
`public.create_adhoc_deliverable` refuses a null assignee (*"an assignee is required"*,
`20260820010000:35`), because ad-hoc work is **created by assigning it** on the schedule; the
assignee is the reason the row exists. So an unassigned ad-hoc task is not a state the system can
reach, and a row for it would be a heading nobody ever sees.

**This is not only cosmetic; it removes the defect that prompted it.** The tile currently caps its
query at 50 rows and then renders `rows.length` as the count, so 200 unassigned tasks report as
**50** — and the "and N more" line under the list is wrong by the same amount. Grouping makes the
row count the number of *campaigns*, which is small and bounded by how many are running, so there
is no cap to be wrong about and no exact-count query to bolt on beside a truncated list.

The grouping is computed **server-side**, in a `security invoker` view over `sub_tasks` joined
through `deliverables` and `streams` to `campaigns`, so RLS decides visibility exactly as the
current query does and the browser never fetches hundreds of task rows to count them.

**Pre-existing, and this ADR's business anyway.** ADR-0052 d.11 built the tile to answer Edward's
*"unassigned is a metric we need"*, and the cap has been harmless only because a deliverable
produced one task per step. This ADR is what makes a single 30-post calendar produce thirty
unassigned tasks, so it is this change that turns a dormant bug into a number wrong every month.

**d.14 — The two live campaigns are a test, not a hope.** A pgTAP assertion captures both campaigns'
task lists — id, title, `sort_order`, `review_mode`, status, assignee — before the migration and
asserts they are identical after it. If a rename or a reseed touches a live task, the suite fails
rather than production.

## Consequences

**Easier.** Quantity finally produces work: six reels are six tasks, six assignments, six reviews,
six approvals, and the deliverable signs off when all six do — which is what ADR-0058 designed and
never got. A brief shows its own work first instead of 269 types by category. The four heavy
production pipelines become reachable. Influencer, media, event, strategy and digital work run
processes that describe them rather than the nearest thing that existed on 28 August. Task names say
what they are.

**Harder.** Task counts rise sharply — a social calendar of 30 posts becomes 30 creation tasks plus
its shared steps, where it was 2. **That is the point, not a cost, and an earlier draft of this ADR
was wrong to call it the most underestimated consequence.** Edward, 5 Sep: *"these are genuine
individual tasks and it needs to be reflected … tasks only show in the grid when assigned. why would
it be slow?"* Checked, and he is right on all three counts: the schedule grid reads `bookings`, and a
booking exists only once a task is assigned, so unassigned materialised tasks never reach it; the
dashboard's unassigned panel already caps at 50 rows (`UnassignedWork.tsx:33`); and the one list that
does grow — a deliverable's own task table — reaches table-sized numbers, not page-breaking ones.

The genuine cost is elsewhere and smaller: **more rows to assign**. Thirty creation tasks is thirty
assignment decisions where it used to be one, which is honest work made visible rather than work
created — but it makes the bulk-assignment question, currently unasked, worth asking sooner.

**Locked in.** That quantity is a property of the deliverable and never splits it (ADR-0058 d.9,
reaffirmed). That a workflow template is chosen by deliverable type, with the brief sorting rather
than overriding — an override table was considered and rejected as unnecessary once Edward pointed
out the taxonomy already separates Creator Content from Reel, so a per-brief workflow override is
now a thing we have decided we do not need, and reversing that means a new ADR.

**Not decided here.** Whether the mapping should ever harden from a sort into a restriction. Whether
a department-level brief should carry its own deliverable-type list separately from the campaign
brief. Whether assignment needs a bulk path now that a calendar month is thirty rows rather than one.

**No licensing or money dimension.** No dependency is added. The only cost is migration and test
time; AI spend is unaffected, because nothing here changes what is sent to a model.

## Addendum — 20 Sep, a deliverable's rename reaches its tasks' titles

**Edward, 20 Sep: *"When a deliverable is renamed, the rename should cascade to all tasks."***
`I52.13` (17 Sep) let a deliverable be renamed on its campaign or job and left the task titles
composed under d.10 — *step — deliverable · unit* — carrying the old name, on the reading that a
copied title is never re-derived. That reading is reversed for the deliverable segment only.

**d.10a — On rename, every task of the deliverable whose title still carries the old name has that
segment replaced with the new one**, in the same statement as the rename (`rename_deliverable`,
`update_campaign_deliverable`, and the guard that governs a direct PATCH). The match is on the
segment d.10 composed — the text after the step name and before the unit number — so a title a
person edited by hand to something else is left alone, and the step name and unit number are never
touched. A template edited later still cannot rename work already issued (d.10 stands for the step
segment). Tracked as `I53.7`; the migration is additive (a function re-emitted, no data moved by the
migration itself — titles change only when someone renames).

## Addendum — 4 Oct (Edward), a task's title names its campaign and type, not the deliverable

**Edward, 4 Oct:** the deliverable's name is not in a task's title — *"it is already displayed at the top of the form"*.
Every task the system generates is titled:

- a step done once per deliverable: **"<Step> — <Campaign name>"** — *Creative Direction — Northwind Summer Launch*;
- a step that repeats per unit (`repeats_per_unit`): **"<Step> — <Campaign name> · <Type name> <n>"** — *Create Artwork —
  Northwind Summer Launch · Static Post 1* … *· Static Post 6*; at quantity 1 no number (*… · Billboard*); a deliverable
  with no type keeps the number alone (*… · 2*);
- the translation task: **"Translation — <Campaign name> (<languages>)"** — the deliverable's own languages, as the
  ADR-0117 addendum builds them.

The campaign name is `campaigns.name` (a single job is a campaign row — the same rule); the type name is
`deliverable_types.name_en`. A deliverable outside any campaign takes its own name in the campaign's place.

**The titles follow** a campaign rename, a type change, a quantity change (every unit numbered when there is more than
one, unit 1 included; none at one) and a languages change (the translation task; its assignee is told, as before). A
deliverable rename changes no title — its name is not in them. **A hand-named task is left alone**: a title is rewritten
only when it equals what the old values composed.

**What it replaces:** d.10's *step · deliverable · unit number* and the d.10a rename cascade (20 Sep), with their
4 Oct follow-ups `I74.31`, `I74.33` and `I74.37`. **Kept:** I57.48 — no " ×N" count anywhere. Existing tasks titled by
the old rules were rewritten once by the migration; hand-named ones were not. A quantity changed by an accepted change
request now adds and cancels the unit tasks as a direct change does (it changed only the number).

Tracked as `I74.39`; migration `20261004160000` (one builder, `app.compose_task_title`; one follower,
`app.retitle_deliverable_tasks`), pgTAP 229 (and 225, 226, 227 moved to the rule).
