# ADR-0024: Internal Delivery Loop — prove the single-tenant work→review→sign-off path (with chat + notifications) before portal & multitenant

- **Status:** accepted (Edward, 2026-08-17)
- **Superseded in part by [ADR-0026](0026-native-supabase-notification-inbox-drop-novu.md) (2026-08-18):** the in-app notification inbox is native Supabase, not Novu (`I4.3`/`I5.2`); email is Resend called directly. Everything else stands.
- **Amended by [ADR-0027](0027-contextual-chat-scope-campaign-rooms-and-item-threads.md) (2026-08-18):** §6 contextual chat is not only work-item threads — each **campaign** gets a first-class group room (team-membered) alongside per-deliverable/sub-task/review threads (conversation context anchor).
- **Date:** 2026-08-17
- **Relates to / sequences:** design draft v15 §5 (accountability/SLA — *manual subset now*), §6 (dashboards), §7 (chat/huddles — chat only), §8.1/§8.2 (brief hierarchy, Tier-2 review). Builds on **ADR-0010** (deliverable→sub-task, scoped write authority), **ADR-0020/0021** (brief wizard, client profile), **ADR-0022/0023** (Library + delivery hinge), **ADR-0015** (chat/notifications transport), **ADR-0018** (grant-driven dashboard/surfaces). A deliberate **phase-ordering** decision in the spirit of **ADR-0007** (team-launch deviation): prove internal end-to-end before the two highest-risk surfaces.
- **Task(s):** new **Phase I** module (deliverable/sub-task lifecycle + work surfaces); draws in M6.1/6.2/6.3, L1.16, V1.4.1, V1.6.1–6.5, V1.7.3/7.4, V1.8.1–8.3. Explicitly **defers** M8, M10, P2 accountability engine, V1.9, V1.10.

## Context

Three internal pillars are real and in production: client registration (ADR-0021), the campaign brief wizard (ADR-0020), and scheduling (ADR-0006 day-cell grid + capacity/booking engines). The schema is complete and accountability-ready. But the loop that turns *"a deliverable row exists"* into *"work is produced, reviewed, signed off, and everyone was notified"* has no engine and no surface, and there is currently **no deliverable/sub-task work surface at all** (`L1.16` is blocked "no task surface yet").

Decision taken with Edward (2026-08-17): **make the whole internal path work end-to-end within one tenant before opening up the client portal (M10) or joint-project multitenancy (M8).** Those are the system's two highest-risk surfaces (§10.2/§10.4); hardening a security boundary around an internal loop that isn't proven is backwards. ADR-0023 already shaped the delivery hinge so the portal slots in later without rework, so deferring it is free structurally.

Two forces shape the scope. (a) The relevant schema mostly exists: `deliverables.state` (`draft·in_progress·in_review·approved·delivered·archived`), `deliverables.due_at`, `deliverables.revision_round`; `sub_tasks.status` (`todo·in_progress·blocked·review·done·cancelled`), `sub_tasks.sla_hours/starts_at/due_at`; `media_records` version chain + `review_feedback` (round/source/x-y/timecode/resolved); append-only `sla_events`. So this phase is mostly **transitions + surfaces + the two channels**, not new tables. (b) The full SLA/accountability engine (pausable clock, attribution, rewards, auto-deadline derivation — Phase 2) is **not** required to prove the loop; manual deadlines + simple revision counting suffice, provided states/events are shaped so the engine drops in later.

## Decision

### 1. A named phase: the Internal Delivery Loop, sequenced before M8/M10
Introduce **Phase I — Internal Delivery Loop** as the next build phase, ahead of joint projects (M8) and the client portal (M10). Its exit criterion: within a single tenant, a campaign's deliverable can travel **brief → assign (sub-tasks) → produce → internal review (rounds) → internal sign-off → done**, with contextual chat and notifications throughout, exercised as a role walkthrough. **Deferred, explicitly:** client portal & client-facing approval/feedback capture-at-source (M10), joint-project cross-tenant sharing (M8), the full accountability/SLA engine + attribution/rewards (P2), collaborative deck editing (V1.9), and voice huddles (V1.10, also gated on the OD-28 firewall spike).

### 2. Deliverable & sub-task lifecycle = a caller-run state machine over the EXISTING enums
No new state tables. Define the legal transitions and run them through a new **`deliverable-transition` Edge Function**, mirroring `booking-transition` exactly: runs **as the caller** (RLS + ADR-0010 scoped write authority enforced end-to-end), a pure table-driven state machine in `src/lib/deliverables/state-machine.ts` (tests over the full from→to matrix, legal and illegal), optimistic-concurrency guard, and an **audit + `sla_events`** row on every transition.

- **Deliverable path:** `draft → in_progress → in_review → approved → (delivered) → archived`, plus a **`blocked`** state (Edward, 2026-08-17) reachable from and returning to `in_progress` for work stalled internally. `blocked` is a new `deliverable_state` value added in **its own migration** (naming rule: an enum extension is a standalone migration). The **revision loop** is `in_review → in_progress`, which **increments `revision_round`**. `delivered` stays reserved for the ADR-0023 client-delivery hinge (unused until the portal ships; internal sign-off stops at `approved`). *(This `blocked` is internal; the attributed, clock-pausing `blocked_on_client` is Phase 2 / portal.)*
- **Sub-task path:** the existing `todo → in_progress → (blocked) → review → done/cancelled`; `assignee` progresses their own (ADR-0010), leads/AM manage within scope.
- **Sub-tasks are scheduled and consume capacity (Edward, 2026-08-17):** a sub-task carrying an assignee + hours + dates (`sla_hours`, `starts_at`/`due_at`) **materialises as a booking on the assignee's linked resource** via a new `bookings.sub_task_id` link, so **every sub-task defined under a deliverable appears on the scheduling grid** and consumes load through the existing capacity engine + `booking-transition` path (warn-and-allow; exclusive/pooled rules unchanged). This realises ADR-0010's "capacity-consuming sub_tasks"; the deliverable and scheduling surfaces stay in sync because they read the same bookings. Editing the sub-task's assignee/hours/dates reschedules the linked booking; completing/cancelling it releases the capacity.
- **Deliverable state rolls up from its sub-tasks** where present (all sub-tasks `done` ⇒ deliverable eligible for `in_review`; any sub-task `blocked` surfaces on the deliverable); deliverables with no sub-tasks transition directly.

### 3. Internal sign-off is `in_review → approved`, gated and audited
The internal QA/sign-off step (the "audited sign-off" in the E2E flow) **is** the `in_review → approved` transition, gated on **`reviews:moderate`** (already seeded to Team Lead, ADR-0009/0021) — distinct from, and a prerequisite to, the client milestone/stream approval deferred with M10. Recorded as an `sla_events` `approved` event + audit (who / which deliverable version / when). Rejecting back to the maker is `in_review → in_progress` with a required reason (an `sla_events` `revision_requested` event) and `revision_round++`.

### 4. Tier-2 internal review UI on the existing review schema (V1.8.1–8.3)
Build the review surface on `media_records` (per-deliverable version chain) + `review_feedback`: upload a version → **pinned x/y on images, timecoded on video**, resolved-state → maker **jump-to-comment** → new version → re-review; the round ties to the deliverable's `revision_round`. **Source = `internal` only** this phase (`client` source arrives with the portal). Upload-format (OD 17) and Frame.io coupling (OD 18) stay open — default to web-playable + a link-out field, no transcoding pipeline yet.

### 5. Per-role work surfaces — the "swimlanes" (M6.1/6.2/6.3, L1.16)
The deliverable/sub-task surfaces, grant-driven (ADR-0008/0018), rendering the same rows by state:
- **Creative "My Work"** (M6.2): assigned deliverables/sub-tasks grouped Needs-attention / In-revision / Coming-up → deliverable detail (versions, rounds, review).
- **Per-discipline stream pipelines** (the swimlane/board views): a deliverable's stage columns per discipline (e.g. Production stage pipeline, Influencer stages) — a board view over `deliverables.state` + sub-task status within a stream.
- **Team Lead** (M6.3): deliverable → **sub-task breakdown**, assign owner + hours/dates (**unblocks `L1.16`**), plus the interim Team Health already shipped.
- **Account Manager**: campaign → streams → deliverables status.
Reads stay tenant-wide (existing RLS); surfaces are grant-gated. Sub-task assignment writes use the ADR-0010 scoped policies already in place.

### 6. Contextual chat — INCLUDED (ADR-0015), single-tenant only
Threads attached to deliverables / sub-tasks / reviews, on Supabase **Broadcast** with Postgres as source of truth and persist-first reliability, Novu inbox (ADR-0015, tasks V1.6.1–6.5). **Cross-tenant threads are deferred with M8** — this phase ships tenant-internal threads only.

### 7. Notifications engine — INCLUDED (V1.4.1)
In-app (Novu) **+ email from day one** on the events that move internal work: **assigned to you, review requested, changes requested, deliverable due soon (manual `due_at`), blocked, signed off.** Email goes through **Resend** (already configured for the tenant) as Novu's email provider; in-app is the Novu inbox. Emitted from the transition Edge Function / in-transaction triggers (ADR-0015 pattern). Single-tenant.

### 8. SLA depth: manual now, engine-ready
Deadlines are the existing **manual `due_at`** (deliverable and sub-task). Revision bounding is **`revision_round` vs a per-work-type default limit (overridable per deliverable), warn-and-allow** (inform, never block; no renegotiation) — the limit lives on the work type, where SLA lead times will also land in Phase 2. **No pausable clock, no attribution, no rewards** this phase. But every transition writes `sla_events` (`delivered`/`approved`/`revision_requested`/`blocked_flagged` already exist), so the Phase-2 engine (auto-deadline derivation from work-type lead times, pausable/attributable clock, breach handling, SLA→rewards) drops in **without reshaping states or events**. Dashboards' SLA-driven rows stay stubbed "pending engine" (as today), capacity signals stay live.

## Consequences

**Easier:** the entire internal value chain works and is demonstrable in one tenant; the portal and multitenant layers are later built onto a *proven* core rather than concurrently with it; the deliverable/sub-task lifecycle reuses the `booking-transition` pattern and the existing enums, so new schema is minimal (mostly transition rules, surfaces, and the ADR-0015 chat/notification stack); `L1.16` unblocks; the review surface finally exists for the schema that's sat ready since M1.10.

**Harder / deferred:** client portal, client feedback capture-at-source, and client milestone approval (M10); joint projects (M8); the full accountability engine + attribution/rewards (P2) — so fair "blocked-on-client" attribution and SLA-driven dashboard rows remain pending; deck editing (V1.9) and huddles (V1.10). Bringing chat + notifications forward pulls the ADR-0015 stack (Broadcast wiring, Novu, outbox/catch-up) into this phase.

**Locked in:** internal-first sequencing ahead of M8/M10; the deliverable/sub-task lifecycle as a **caller-run `deliverable-transition` Edge Function** state machine over the existing enums, audited to `sla_events`; internal sign-off = `in_review → approved` gated on `reviews:moderate`, separate from client approval; review is **internal-source only** this phase; **manual deadlines + warn-and-allow revision counting** now, with events recorded for the future engine; **chat + notifications in-scope (single-tenant)**, cross-tenant threads out.

## Settled (2026-08-17)

1. **Revision limit** — a **per-work-type default, overridable per deliverable** (§8).
2. **Notifications** — **in-app (Novu) + email from day one**, email via **Resend** (already configured) (§7).
3. **Sub-tasks link to bookings/capacity** — every sub-task under a deliverable materialises as a booking on the assignee's resource and shows up in scheduling (§2).
4. **Deliverable-level `blocked`** — a new `deliverable_state` value, its own migration (§2).

## Accepted (2026-08-17)

- **Bookkeeping applied in this change set:** row **0024** added to `docs/adr/README.md`; **`docs/TASKS.md` restructured** — a new **Phase I — Internal Delivery Loop** section with ordered task IDs (deliverable/sub-task lifecycle + `deliverable-transition` Edge Function + the `blocked` enum + `bookings.sub_task_id`; work surfaces M6.1/6.2/6.3 + discipline pipelines; review V1.8.1–8.3; internal sign-off; chat V1.6; notifications V1.4.1 via Resend); M8 / M10 / P2 / V1.9 / V1.10 marked sequenced-after; drawn-in tasks annotated with the ADR reference.
- **Proposed commit (git is Edward's):** `docs: ADR-0024 internal delivery loop (single-tenant work→review→sign-off, chat + notifications) [Phase I]`
