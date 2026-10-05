# ADR-0023: Deliverable review-versioning ↔ Library reconciliation — internal review store vs. delivered Library assets; per-tenant archive residency

- **Status:** accepted (Edward, 2026-08-17)
- **Date:** 2026-08-17
- **Relates to:** design draft v15 §8.1 (asset hierarchy — referenced not copied), §8.2 (Tier-2 media review), §8.3 (media lifecycle, provider-swappable), §8.4 (deck versioning). **ADR-0022** (client asset filing + reference Library — `assets` / `asset_folders` / `asset_references`; `media_records` is the deliverable-review-media view and *can point at an asset*). **ADR-0016** (cloud-first active + tenant-local archive residency pattern). **ADR-0008** (grants + universal audit as data). **ADR-0020 / 0021** (campaign → stream → deliverable; brief). **M1.10** (`media_records` + `review_feedback` already exist).
- **Open Decisions:** advances **OD 25** (V1.9.4 — resolves the *forced version at client delivery* half); sets the operational intermediate policy for **OD 15/16** (P2.6.1 — the *contractual* master/intermediate policy stays open, needs legal); advances **OD 30** (INF.1 — makes archive residency **per-tenant data**, not a global choice).
- **Task(s):** V1.8.1, V1.8.3 (Tier-2 review store, version chain, rounds), V1.9.4 (version-on-save / forced version), M10.5 (approval event), M10.7 (portal signed URLs), P2.6.1 / P2.6.3 (retention / proxies), asset & library module (ADR-0022).

## Context

The creative director's rule for the Library: **only versions delivered to the client are kept as persisted Library assets.** The working rounds that circulate through internal review must be fully supported *during* iteration, but must not permanently bloat the Library.

The data model already anticipates this split, so we extend it rather than invent (M1.10, ADR-0022):

- **`media_records`** — the deliverable-scoped, **versioned review-media chain**: provider-swappable (`b2`/`r2`/`supabase`/`external`), storage tier, retention state, Frame.io link-out. This is the natural home for the **internal review store**.
- **`review_feedback`** — review **round**, **source** (client / internal), **timecode**, **x/y** anchor, **resolved** state — page-anchored / positioned feedback, attached to a version.
- **`assets` / `asset_folders` / `asset_references`** — the persisted **Library**; per-campaign the seeded tree includes **Working Files · Deliverables · Final Assets · References**. ADR-0022 established that assets are **referenced, not copied**, and that `media_records` "stays the deliverable-review-media view and can point at an asset."

So the two stores exist; what was genuinely open was the **hinge event** between them and the **lifecycle** on each side. Resolved with Edward (2026-08-17):

- **Delivery trigger** = an explicit **"Deliver to client"** action (not a passive status, not approval).
- **Persistence scope** = **every client-delivered version** is kept (each client-facing round), while internal-only rounds are not.
- **Internal-round lifecycle** = active during the project → **60 days** after delivery/supersession → **archive**; Postgres metadata permanent.
- **Archive residency** = **each tenant defines its archive store (cloud or local)**; retention on a *local* archive is the company's decision.

## Decision

### 1. Two stores, one object model — no byte copies

Internal review versions are **`media_records` rows on the deliverable — never Library `assets`.** Review rounds and page-anchored / x-y feedback (`review_feedback`) attach to these versions. The **Library (`assets`) holds only delivered versions.** When a version is delivered, no bytes are copied: the Library asset **references the same stored object** (`asset.object_key` = the delivered `media_record`'s object; an `asset_reference` links it to the deliverable), per ADR-0022 "referenced, not copied." One set of bytes, two views — the review chain and the filed asset.

### 2. Delivery trigger — an explicit "Deliver to client" action, per version, re-enterable

Delivery is a **deliberate action on a `media_records` version**, not a workflow side-effect and not approval. It is **one atomic, RLS-governed RPC** — `public.deliver_deliverable_version` (SECURITY INVOKER, mirroring `create_campaign_from_brief`) — that, in a single transaction:

1. **stamps a forced version snapshot** of the current working head (resolves OD 25's *forced version at client delivery*);
2. **marks the version delivered** (`delivered_at`, `delivered_by`, `delivery_round`) and writes an **append-only audited delivery event** (ADR-0008 universal audit; INSERT-only per §6);
3. **files the version as a Library asset in the campaign's `Deliverables` folder** (create/point an `asset` + `asset_reference` to the deliverable, referencing the existing object — no copy);
4. **exposes it to the client** via the M10.7 short-TTL, client-scoped **signed URL** (minted by the storage Edge Function; keys never reach the browser).

Because the action is **per-version and re-enterable**, delivering v3 and then — after client feedback — v5 fires it **twice**, so **every client-delivered version persists** (Edward's scope decision). Internal-only rounds between deliveries never enter the Library. When V1.8's Tier-2 review state machine lands, this action simply *becomes* the transition into the review record's "delivered / with-client" state — nothing reshapes. Crucially, it **works today** without waiting on that state machine: the action is the event.

### 3. Approval is a distinct downstream event — it promotes, it does not persist

Client **approval** (M10.5, resolved v15 as **milestone/stream-level**) records *who / which version / when* and marks the **accepted** delivered version. The version is **already persisted** by step 2, so approval **creates no new Library entry** — it **flags the accepted version and files it into `Final Assets`** (an `is_final` flag + an `asset_reference` into the Final-Assets folder). The folder story falls out cleanly: **`Deliverables`** = the in-flight client-delivered rounds; **`Final Assets`** = the client-accepted final. Approval never touches internal rounds.

### 4. Internal-round lifecycle — active → 60-day window → tenant archive → metadata permanent

During the **active project** every internal round stays in the **hot store** — the review cannot function otherwise (reviewers compare round-to-round; feedback is anchored to its specific version). The lifecycle clock only starts once a version is **delivered or superseded**:

- **Supersession** = a newer internal round exists on the same deliverable **and** this version was not itself delivered.
- On delivery-or-supersession a **60-day** clock starts (a **tunable default**, not a hardcoded constant). On expiry the working file's **bytes are moved to the tenant's configured archive store** (§5) — **relocated, not hard-deleted** by Maestro.
- **Postgres metadata is permanent regardless of byte location** — every `media_records` row and its `review_feedback` (round, source, anchors, resolved) survives archival (P2.6.3: "metadata history permanent in Postgres regardless"). A lightweight **proxy** may be retained online while the full-res archives.
- `retention_state` (reserved on the model by ADR-0022) tracks `hot | archiving | archived`.
- **Delivered versions are exempt** from this clock — they live in the Library on the standard asset lifecycle.

### 5. Per-tenant archive residency (cloud or local)

**Each tenant defines its archive storage target** — **cloud** (Backblaze B2 / R2) or **local** (the tenant's on-prem server, e.g. the Iraq company server) — as a **tenant-level, admin-only one-time setting** (`default, don't configure` — AGENTS §5.4). This reuses `media_records.provider` (already provider-swappable) and ADR-0022's retention/archive fields, and it is exactly the **cloud-first-active + tenant-local-archive** residency pattern ADR-0016 set for recordings, generalized to review media.

- The **active / hot store stays cloud-first** (B2, per ADR-0022). Only the **archive tier** is tenant-selectable.
- A **scheduled archival job** (Edge Function on a cron; privileged route holding bucket/endpoint credentials as Supabase secrets — **signed transfer, no bytes through the app**) sweeps versions past the 60-day window to the tenant's archive target and updates `retention_state`.
- Once files land on a tenant's **local** archive, **retention/deletion there is the company's decision** — Maestro's responsibility ends at archiving; it does **not** enforce purge on on-prem storage. Metadata stays in Postgres either way.

This **advances OD 30**: archive residency becomes **per-tenant data**, not a single global decision.

### 6. Security & isolation

Internal review versions are **deliverable-scoped** and reachable only by internal roles with access to that deliverable/project; they are **never portal-reachable.** The client portal exposes **only delivered Library assets of the client's own work**, via M10.7 signed URLs. This sits on the highest-risk surface (§10.2), so the **M10.8 disproportionate test suite must prove** that no internal round — and no other client's delivered asset — is ever reachable from the portal. Delivery and approval events are **append-only audit** (INSERT-only policies + `revoke update, delete`, §6). The archival Edge Function is a **privileged route**: service-role from env secrets, authenticates + authorizes the caller, signed transfer only, no dynamic SQL.

## Consequences

**Easier:** the Library holds exactly what the client received — no internal iteration bloat; internal review is fully supported (all rounds + anchored feedback retained live); every client-facing hand-off is preserved with a clean audit at both delivery and approval; approval yields a filed **Final Asset** for free; storage stays vendor-swappable and residency is a per-tenant setting, so Iraq/Egypt tenants can archive on-prem while others stay cloud — all on one object model, no byte copies.

**Harder / new:** a per-tenant archive-target setting (schema + a small admin surface); the atomic `deliver_deliverable_version` RPC; the approval → Final-Assets promotion path; a scheduled archival job with **signed cloud↔local transfer** (a **local** target needs a reachable on-prem endpoint + credentials **per tenant** — Edward/tenant provides as secrets); the delivered/internal distinction enforced in portal RLS and proven by the M10.8 suite. Bytes moved to a tenant's **local** archive leave Maestro's lifecycle control **by design**.

**Locked in:** internal review versions are `media_records` (never Library `assets`) with `review_feedback` attached; delivery is an explicit **per-version, re-enterable "Deliver to client"** action (atomic RPC) that snapshots + persists the version into **Deliverables** and exposes it via a signed portal URL; **every** client-delivered version persists; **approval** is a separate milestone/stream event that promotes the accepted version into **Final Assets** and never persists on its own; internal rounds run **active → 60 days after delivery/supersession → tenant archive**, with Postgres metadata **permanent**; **archive residency (cloud or local) is a per-tenant setting**; internal rounds are **never** portal-reachable.

## Open — resolve with Edward before implementation

- **Supersession timing:** confirm the 60-day clock counts from **the later of** last-delivery / supersession, and that a version that was *ever* delivered is exempt (lives in the Library, not the internal clock).
- **Local-archive transport contract:** how an on-prem target is registered and authenticated per tenant — assumed **S3-compatible on-prem gateway** (so the same signed-transfer path serves cloud and local). Confirm, or specify the alternative. You set the secrets.
- **Contractual retention:** the **master-retention window** and any legally-mandated **intermediate** policy remain **OD 15/16 (P2.6.1)** — agency/legal input, out of scope here. This ADR sets only the operational intermediate default (60 days → archive).

## Accepted (2026-08-17)

- **Bookkeeping applied in this change set:** row **0023** added to `docs/adr/README.md`; the **OD Gate table** in `docs/TASKS.md` updated — OD 25 → *partially resolved (ADR-0023: forced version at client delivery; per-save session-collapse still leaning)*; OD 30 → *advanced (per-tenant archive residency, cloud or local)*; OD 15/16 → annotated (operational intermediate default set here; contractual master/intermediate policy still open); affected tasks annotated with the ADR reference (V1.8.1, V1.8.3, V1.9.4, M10.5, P2.6.1, P2.6.3).
- **Proposed commit (git is Edward's):** `docs: ADR-0023 review-versioning ↔ Library reconciliation; per-tenant archive residency [V1.8.1][V1.8.3][V1.9.4][M10.5]`
- **Pre-implementation confirmations still owned by Edward** (see *Open* above): the supersession-clock timing, the per-tenant local-archive transport contract (assumed S3-compatible on-prem gateway), and that contractual retention remains OD 15/16 — none block acceptance; all are needed before the build.
