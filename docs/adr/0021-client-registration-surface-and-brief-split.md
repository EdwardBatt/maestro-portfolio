# ADR-0021: Client Registration as a Client-Services surface; general vs performance-brief split

- **Status:** accepted (Edward, 2026-08-16)
- **Date:** 2026-08-16
- **Relates to / amends:** ADR-0020 (Campaign Builder / Brief Wizard) — **supersedes ADR-0020 §2**
  (clients registered via Admin → Organization). ADR-0009 (Account Manager = Client Services, scope
  `account`). ADR-0008 (grants are data). Source: the agency performance-marketing brief template (client-supplied, not included)
  (Meridian 21-question performance intake).
- **Task(s):** L1.5 (clients), V1.7 (brief system)

## Context

Two things surfaced once clients existed. First, client registration was folded into Admin →
Organization (ADR-0020 §2), gated by the broad `organization:manage` grant — held only by Power Admin.
But **Client Services owns client relationships**, not IT admin; they should register and maintain clients
themselves, and the offices/departments/teams admin grant is the wrong key for that.

Second, Meridian's performance-marketing intake (the 21-question deck) mixes two very different kinds of
information: durable facts about the **business** (what they sell, their economics, their sales process)
and choices that belong to a **specific campaign** (objective, budget, this flight's targeting). Captured
as one flat form it would be re-entered every campaign and drift. The design already has the right shape
for this — ADR-0020's "strategy authored once, inherited by campaigns." The client profile is the same
idea one level up: **authored once on the client, inherited by every brief.**

Decisions taken with Edward (2026-08-16): Client Services owns registration via a **new `clients:manage`
grant**; audience / geography / platform preferences are **campaign-level only** (not client defaults); a
**required core + optional** intake (registering a client shouldn't demand the whole profile).

## Decision

### 1. Client Registration becomes its own surface, owned by Client Services

Clients + brands move **out of Admin → Organization** onto a dedicated **Client Registration** surface
(`/clients` working area; registration form + list). Admin → Organization keeps offices / departments /
teams only. This supersedes ADR-0020 §2. Reads stay tenant-wide at the DB (the wizard's client picker is
unaffected); the two grants below govern the *surface*, per ADR-0008 (grant-driven visibility, RLS beneath).

Two grants, split view from write:

- **`clients:view`** — sees the Client Registration surface (nav item + route) and the client list,
  **read-only**. Seeded to the roles that already touch clients — Account Manager, Scheduler, Power Admin —
  and, being a grant (ADR-0008), **handed to anyone else via the Roles screen** (e.g. Department/Team Leads,
  CEO/COO/CFO for oversight). This is the "so others can be added" hook.
- **`clients:manage`** — registers/edits clients + brands. The write controls (add / edit / delete forms)
  render only for holders; everyone else with `clients:view` gets a clean read-only table. Replaces
  `organization:manage` on the `clients` and `brands` **write** policies. Seeded to **Account Manager
  (Client Services) + Power Admin**. Holding `clients:manage` implies `clients:view` (managers are seeded
  both).

Gating the surface on `clients:view` and the controls on `clients:manage` also removes the ADR-0020 rough
edge where view-only C-suite roles saw client write buttons that failed at the database — they now see the
list without the controls.

### 2. The intake splits into a client profile and a performance brief

**General information → the client profile** (authored once, inherited by all campaigns):

- Business name *(existing column)*; what they sell — short description (Q1); what makes them special / USP (Q2)
- Best-selling products or services (Q3)
- Economics — value per new customer: avg spend & profit (Q5); daily capacity — new customers/leads handled (Q6)
- Seasonality — peak & quiet months (Q9); past advertising lessons (Q12)
- Digital presence — website & social links (Q13); sales process after contact (Q14)
- **E-commerce specifics** (shown when the client is e-commerce): AOV (Q15), product count (Q16), returns % & reasons (Q17), catalog↔ads connection (Q18)
- **App specifics** (shown when the client has an app): primary in-app action (Q19), user counts (Q20), app/tools access contact (Q21)

**Performance-marketing specific → the campaign brief** (per campaign, on the `paid_media` brief type):

- Campaign objective — what *this* advertising should achieve (Q4)
- Advertising budget / range for this flight (Q10)
- Target audience (Q7), geography & language (Q8), platform preferences & exclusions (Q11) — **campaign-level only** (Edward), captured per brief, not stored as client defaults

### 3. Storage

Client general info is a **`clients.profile jsonb`** column (mirrors ADR-0020's `campaigns.brief jsonb`):
flexible, conditional sections (e-commerce / app) without per-field migration. A small **`business_types`**
marker in the profile (e.g. `["ecommerce","app","services"]`, multi-valued — a client can be several)
drives which conditional sections show. **Required core** to save a client: name + what-they-sell +
business type(s); everything else optional and completable over time.

The performance-brief fields extend the wizard's existing `campaigns.brief jsonb` for the `paid_media`
brief type — objective, budget, audience, geography, platforms — surfaced as extra Strategy-step fields
when that brief type is chosen. No new campaign columns.

### 4. Scope / RLS

`clients:manage` is a tenant-scoped write grant (like `organization:manage`): tenant-fenced, audited by
the existing triggers. Account Manager holds it in addition to their `account`-scoped `projects:manage`;
registering a client is a tenant-level act (a client isn't "owned" the way a campaign is), so no
per-record scope on client writes. `clients:view` is a surface-visibility grant only — the DB read policy
(`clients_tenant_select`) is already tenant-wide, so `clients:view` never widens data access, only which
roles see the surface. RBAC changes: add `clients:view` + `clients:manage` to the catalog, seed them per
§1, and repoint the `clients`/`brands` write policies from `organization:manage` to `clients:manage`.

## Consequences

Easier: Client Services registers and maintains their own clients without a Power-Admin bottleneck; the
business profile is entered once and every brief inherits it; the performance brief stays lean (objective +
budget + this flight's targeting) because the durable facts already live on the client; conditional
e-commerce / app sections keep the form short for clients they don't apply to.

Harder / deferred: one additive migration (`clients.profile jsonb` + `clients:manage` grant + repoint the
two write policies); the Clients UI moves surface (Admin → Organization loses its Clients section); the
performance-brief fields are a `paid_media`-specific extension of Step 2. A later Finance-gated Odoo field
remains separate (ADR-0020). Per-discipline brief templates and pulling client-profile defaults into other
brief types are follow-ups.

Locked in: client viewing is governed by `clients:view` (tunable to any role) and writes by
`clients:manage` (Client Services + Power Admin), not `organization:manage`; the general/performance split
above is the canonical mapping of the intake deck;
general info is a `clients.profile jsonb` with a required core; performance-specific fields (incl. audience/
geo/platforms) are campaign-level in the brief, never client defaults; no new tables.
