# ADR-0032: Agency KPI matrix — comprehensive per-role SLA/KPI profiles

- **Status:** **proposed — DEFERRED (captured now, not scheduled for build)**
- **Date:** 2026-08-19
- **Relates to:** **ADR-0029** (SLA profiles + KPIs, I7 — the mechanism this fills with content: `kpi_definitions` / `kpi_targets` / `sla_profiles` / `app.kpi_rollup`), **ADR-0031** (attendance deviations as candidate signals), **ADR-0024** (P2 accountability engine — where derived signals + weighting/anti-gaming ultimately live).
- **Task(s):** noted in `docs/TASKS.md` as future work (see the I7 block). Do **not** implement yet.

> **CANONICAL FOR SLA AND ACCOUNTABILITY (recorded 2026-08-28).** This is the ADR that settles how
> SLA and accountability work in Maestro, and **it is not finalised or agreed.** It is captured, not
> decided. Anything that changes `app.effective_sla`, adds or removes a resolution tier, or defines
> what an SLA outcome means **waits for this ADR** — it does not get decided in passing by an ADR
> whose subject is something else. ADR-0053 d.2/d.4 and ADR-0056 d.4 are gated on it and say so.
>
> The open decisions underneath it are **OD 1, 4, 5, 6 and 7**, whose full text is in
> `docs/design/design-draft-v15.md` (the master table begins at line 1916; the deadline-authority
> box is at line 491). OD 1 — the full list of human-resource accountability types, per role — is
> described there as *"the single highest-leverage item"*, and it is upstream of everything here.
>
> `app.effective_sla` currently has **no callers** in `src/` or `supabase/functions/`, and the pilot
> tenant holds one profile with `is_default = false`, so nothing resolves through it today. That is
> why the gate below costs nothing to hold.

## Context

Edward's practical scorecard for an ad / branding agency: a matrix of role → metric → category (efficiency / quality / business-impact) → how to measure → why it matters, plus team metrics and usage rules. I7.3/I7.4 shipped the *mechanism* (reusable SLA profiles; individual KPI definitions + targets rolled up team→department; bounded weighting; read-restriction). This ADR captures the *content* — the concrete metric library and the rules for applying it — so it can be turned into seeded KPI definitions + default profiles per discipline later.

## The matrix (design reference)

### Individual roles

| Role | Metric | Category | How to measure | Why it matters |
|---|---|---|---|---|
| Creative | Utilization rate | Efficiency | Billable hours / available hours | Productive capacity without overfocusing on speed |
| Creative | On-time delivery rate | Efficiency | Tasks delivered by deadline / total tasks | Reliability in studio workflows |
| Creative | First-time approval rate | Quality | Approved without major revisions / total deliverables | Signal for brief quality + execution |
| Creative | Revision rounds | Quality | Avg revision cycles per asset | Lower = clearer briefs, better output |
| Creative | Client/stakeholder satisfaction | Business impact | Survey or approval score | For subjective creative work |
| Account | Client retention | Business impact | Clients retained / clients at start | Relationship health, account stability |
| Account | Upsell / cross-sell rate | Business impact | Expanded revenue / eligible accounts | Account growth |
| Account | Response time | Efficiency | Avg time to acknowledge + respond | Service quality |
| Account | On-time briefing | Efficiency | Briefs issued on schedule / total briefs | Keeps production moving |
| Strategy | Research-to-insight cycle time | Efficiency | Time from brief to usable insight | Analytical speed |
| Strategy | Recommendation acceptance rate | Quality | Accepted recs / total recs | Usefulness of strategic output |
| Strategy | Campaign lift contribution | Business impact | Measured lift tied to strategy input | Where attribution is possible |
| Strategy | Brief quality score | Quality | Internal score from downstream teams | Whether strategy is actionable |
| Media | ROAS | Business impact | Revenue / ad spend | Core paid-media efficiency |
| Media | CPA / CPL | Business impact | Cost per acquisition or lead | Cost efficiency |
| Media | CTR | Quality | Clicks / impressions | Creative + targeting signal |
| Media | Conversion rate | Business impact | Conversions / clicks or sessions | Downstream performance |
| Production | Throughput | Efficiency | Assets completed per period | Studios and editors |
| Production | Rework rate | Quality | Reworked assets / total assets | Process or brief issues |
| Production | Deadline hit rate | Efficiency | On-time milestones / total milestones | Delivery reliability |

### Team metrics

| Team | Metric | Category | How to measure | Why it matters |
|---|---|---|---|---|
| Team | Utilization | Efficiency | Billable hours / available hours | Best with quality guardrails |
| Team | Project margin | Business impact | Revenue − delivery cost | Focus on profitable work |
| Team | Client satisfaction | Business impact | Survey / NPS-style score | Service quality across roles |
| Team | Schedule reliability | Efficiency | On-time deliverables / planned deliverables | Cross-functional delivery |

### Usage rules

- Pick **3–5 metrics per role**, not all.
- **Pair output metrics with quality metrics** to avoid gaming.
- Team metrics for shared outcomes; individual metrics for direct contribution.
- Review **monthly** for execution, **quarterly** for compensation + role calibration.
- Creative roles: weight **first-time approval** and **rework** more heavily than raw volume.
- Media roles: weight **ROAS / CPA / conversion rate** more heavily than task count.

## How it maps to the shipped model (for the future build)

- Each row → a `kpi_definitions` row: `name`, `unit`, a **category** tag (efficiency/quality/business-impact — a small new column or a `formula` key), `aggregation` (avg for rates, sum for counts), `higher_is_better` (false for revision rounds / rework / CPA / cycle time), and `source` = manual now / derived later via `metric_key`.
- **Per-role default sets** (3–5) → seeded bundles applied when a person's discipline is known (via work type / team), attachable at task assignment (ADR-0029 targets model).
- **Weighting** → the bounded per-role `formula` weights (creative vs media emphasis) — the behaviour levers, admin-editable, no free-form expressions.
- **Derived metrics** (utilization, on-time %, revision rounds, throughput, rework, ROAS/CPA/CTR/conversion) → the P2 seam: `source='derived'` + `metric_key` computed from SLA/delivery/time/attendance events (and, for media, external ad-platform data).
- **Team metrics** → `app.kpi_rollup` extended with margin (needs cost/revenue) and satisfaction inputs.

## KPI-at-assignment (deferred here — decided 2026-08-19)

Edward's targets rule (ADR-0029): *"Targets are set by SLA profile … or a KPI selected when the task is assigned (if no default is available)."* The **SLA half shipped** (the sub-task assignment form carries an SLA-profile picker over the existing `sub_tasks.sla_profile_id`; manual `sla_hours` still overrides; the row shows the resolved SLA). The **KPI half is deferred into this ADR**: `kpi_targets` is keyed on `(kpi_definition, user, period)` with **no sub-task link**, and the *"if no default is available"* clause depends on the **per-discipline default-KPI bundles** captured above — which are themselves deferred. When this is scheduled, the durable form is a **`sub_tasks.kpi_definition_id`** (a task references the KPI it feeds), which also becomes the natural P2 derived-metric seam (a completed/late sub-task feeds its KPI's `actual`). Building it before the default-bundle model exists would add an immutable column the P2 engine may reshape, so it waits.

## Consequences / non-goals (for now)

Deferred in full: the derived-metric computations, external data ingestion (media platforms), margin/revenue inputs, the **KPI-at-assignment sub-task↔KPI link** (above), and any pay/ranking linkage + anti-gaming (all P2, ADR-0024). This ADR is a **captured design reference only** — nothing here is built until it is explicitly scheduled.
