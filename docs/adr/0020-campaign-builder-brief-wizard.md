# ADR-0020: Campaign Builder (Brief Wizard) + internal client registration

- **Status:** accepted (Edward, 2026-08-15 — chose brief-JSONB + manual timing for the pilot)
- **Date:** 2026-08-15
- **Relates to:** ADR-0010 (work breakdown: campaign → stream → deliverable; work-types/SLA), design draft v15 §8.1 (brief system), Pencil `E2EV1.pen` frames **21.1–21.5** (Brief Wizard). Enables L1.5's deferred clients/campaigns.
- **Task(s):** V1.7 (brief system / job creation), L1.5 (clients CRUD)

## Context

Scheduling is in hand, but projects can't yet be created with their real inputs, and clients can't be
registered at all (L1.5 deferred both — "Module 1 runs ad-hoc"). The work-structure schema already
exists (`clients → brands`, `campaigns`, `streams`, `jobs`, `deliverables`, `work_types`), so this is a
**UI + wizard over existing tables**, not new modelling.

The design is fixed: design draft §8.1 (Concept → Execution → Feedback; Campaign → Stream → Deliverable;
strategy authored once and inherited) and the **Brief Wizard** frames 21.1–21.5:

1. **Job Type** — client + brief type (360 Campaign, or single-discipline / single-execution / feedback).
2. **Strategy** — background, task, beautiful problem, primary/secondary audience, functional/emotional
   benefit, insight, proposition (authored once for a 360 campaign).
3. **Deliverables** — a table of deliverables (name, discipline/channel, quantity, load, dates).
4. **Timing** — parse the brief, route deliverables to disciplines (streams), derive commence-by → due
   from per-work-type SLA lead times.
5. **Review & submit** — streams + owners + dated deliverables → confirm creates the campaign.

Two forces shape the pilot build. (a) Step 2 captures ~9 strategy fields but `campaigns` only has
`audience`/`insight`/`proposition` columns. (b) Step 4's auto-routing + SLA-derived dating leans on the
work-type/SLA lead-time engine, which is not built (M9/P2 territory).

## Decision

1. **Build the Brief/Campaign Builder Wizard to frames 21.1–21.5** — the five steps above — as the way
   projects are created. It writes the existing hierarchy: on submit, one **campaign**, one **stream per
   discipline** present, and the **deliverables** within them.

2. **Clients + brands are registered internally**, via Admin → Organization (alongside offices /
   departments / teams), gated by `organization:manage`. The client **portal stays deferred**:
   `clients.portal_enabled` remains `false` (M10 flips it later); nothing client-facing ships here.

3. **The strategy brief is stored as a `brief jsonb` column on `campaigns`** (Edward's choice). It holds
   the full, possibly discipline-varying brief; `audience`/`insight`/`proposition` **remain real columns**
   (queryable, and what other surfaces read) and are mirrored from the brief on save. Flexible, no
   per-field migration, matches the org's discipline-specific brief templates.

4. **Step 4 (Timing) is manual for the pilot** (Edward's choice): the user assigns each deliverable to a
   discipline/stream and sets its commence-by / due dates. The automated version — work-type lead-time
   derivation + auto-routing to disciplines — is an **additive upgrade to the same step**, landing with
   the SLA engine (M9/P2). Nothing about the wizard's shape changes when it arrives; the manual inputs
   become pre-filled suggestions.

5. **Each campaign owns a campaign calendar by construction** (§8.1) — it is *assembled* from the streams
   and dated deliverables the wizard writes, not a separate object. The read-only campaign-calendar
   **projection** is M9; the data it reads is created here.

6. **Phased delivery.** Phase A: clients/brands CRUD (unblocks everything). Phase B: the wizard MVP
   (steps 1/2/3/5 full; step 4 manual). Jobs (ad-hoc single-discipline work) reuse the same pieces and
   can follow.

## Consequences

Easier: projects get real inputs through a guided flow that matches the design; the strategy is authored
once and can't drift; clients exist without waiting on the portal; the wizard writes exactly the
campaign→stream→deliverable structure scheduling and dashboards already consume.

Harder / deferred: one additive migration (`campaigns.brief jsonb`); Step 4 is manual until the SLA
engine lands (clearly a pilot interim, not the final design); jobs and the campaign-calendar projection
are follow-ups.

Locked in: the wizard follows frames 21.1–21.5; clients are internal-only with the portal fenced off
(`portal_enabled=false`); the brief is JSONB with the three strategic columns mirrored; timing is manual
now and automated later **without reshaping the wizard**; submit writes the existing hierarchy — no new
tables.

## Phase B implementation notes (2026-08-16)

These record how Phase B was built, consistent with the decision above (Edward directed the entry-point
and Odoo-ownership points be captured here).

- **Entry point = the Campaigns surface, gated `projects:manage`.** Client Services owns briefs (Edward),
  so `/campaigns` is their working surface — a campaign list with a persistent "+ New Brief" CTA — and
  `/campaigns/new` is the wizard. The `projects:manage` gate means exactly the roles the campaign write
  RLS admits see it: Account Manager, Scheduler, Power Admin (Team/Department Leads don't hold
  `projects:manage`, so they neither see it nor could write). Nav item added to the Main section.
  *Not changed:* the Account Manager's `default_route` stays `/schedule` — making `/campaigns` their
  landing is a one-line follow-up if Edward wants it, but that's a UX call, not required by the directive.

- **Odoo codes are Finance's remit** (Edward) — deliberately **absent** from the wizard. Clients carry
  `odoo_analytic_code` (set in Admin → Organization, Phase A); the wizard never asks for one. A later
  Finance-gated field (V1.2/V1.3) can attach the per-campaign analytic code.

- **Submit is one atomic RPC**, `public.create_campaign_from_brief` (SECURITY INVOKER): campaign → one
  stream per distinct discipline → deliverables, in a single transaction. Chosen over three sequential
  client inserts, which could orphan a campaign on a mid-way failure and then collide on the unique
  campaign name at retry. RLS is unchanged and still enforced (invoker): campaigns/streams need
  `projects:manage` + `in_write_scope`; deliverables need `project_tasks:manage`. Account-scoped callers
  get `account_manager_id = auth.uid()` stamped so the `in_write_scope` account branch
  (`campaign_account_manager = auth.uid()`) passes; tenant-scoped callers leave it null (client-AM
  fallback; their scope passes regardless).

- **Disciplines seeded as `work_types`.** Streams route to disciplines (`streams.work_type_id`), which
  weren't seeded, so the wizard would have no disciplines to route to. Seeded a starter set grounded in
  the design (`E2EV1.pen` frames 02/07/16/21.5): Creative, Social & Content, Production, Influencer,
  Activation, Paid Media. Name-only (lead-time/SLA null — manual timing per §4), idempotent, admin-tunable.
  Folded into the provisioning wrapper so future tenants get them too.

- **Deliverable spec lives in the brief.** The `deliverables` table is intentionally minimal
  (name/state/due). The wizard's richer per-line spec (quantity, load %, commence date) is persisted in
  `campaigns.brief.deliverables`; each line is also materialised as a deliverable row (name + due + stream)
  so scheduling and the dashboards see it. When the SLA engine lands, load/commence graduate to real
  scheduling inputs without reshaping the wizard.
