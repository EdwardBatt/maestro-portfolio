# ADR-0022: Client asset filing structure + company reference library (cloud-first R2/B2, local Iraq archive later)

- **Status:** accepted (Edward, 2026-08-16 — Backblaze B2 storage; recommended subfolder taxonomy)
- **Date:** 2026-08-16
- **Relates to:** design draft v15 §8.1 (shared brand assets at the **brand** level, referenced not copied), §8.3 (media records are provider-swappable), §8.4 (object-key hierarchy). ADR-0016 (cloud-first + tenant-local archive residency pattern — same shape reused here). ADR-0021 (Client Registration — provisioning hooks). Advances the parked **storage-residency Open Decision**.
- **Task(s):** L1.5 (clients), new asset/library module

## Context

On client creation Maestro should provision a **filing structure** for that client's assets — brand
assets and project/campaign assets — and the same material should also be browsable as a **company-wide
reference library**, not just within one client.

The design already frames this and we extend it rather than invent:

- **Brand assets** (logos, fonts, guidelines, key visuals) live at the **brand** level — owned once,
  referenced by campaigns/streams/deliverables (§8.1). Cross-tenant, an invited tenant sees only assets
  shared into a joint project, never the host's whole library.
- **Project assets** hang off the **campaign → stream → deliverable** hierarchy; `media_records` already
  models a stored file (provider-swappable: `b2`/`r2`/`supabase`/`external`, tiers, retention), but it is
  currently deliverable-scoped and versioned for review media.
- The **reference library** is browsing that same asset store *across* clients.

Decisions taken with Edward (2026-08-16): storage is **cloud-first on Cloudflare R2 / Backblaze B2**, with
a **later local backup to the company server in Iraq** (residency); the filing structure is an **explicit
folder tree** (`Client → Campaign/Project → Asset Type …`, plus brand assets); and this pass delivers
**full asset management** (upload, preview, versioning, download, organise).

## Decision

### 1. An explicit folder tree, auto-provisioned

A new **`asset_folders`** table holds a real, browsable tree (visible even when empty) — `id, tenant_id,
client_id, parent_id, name, kind, brand_id?, campaign_id?, system`. On **client creation** a trigger seeds
the standard skeleton:

```
<Client>
├─ Brand Assets/            (one per brand: Logos · Fonts · Guidelines · Key Visuals)
└─ Projects/                (one folder per campaign)
   └─ <Campaign>/           Working Files · Deliverables · Final Assets · References
```

Creating a **brand** adds its Brand-Assets subtree; creating a **campaign** adds its Projects subtree —
same trigger family. `system` folders (the seeded skeleton) can't be renamed/deleted; users add their own
subfolders freely. The default taxonomy is data, so it's tunable later.

### 2. Assets model — referenced, not copied

A new **`assets`** table: `id, tenant_id, folder_id, name, provider, object_key, content_type, size_bytes,
storage_tier, retention_state, current_version, uploaded_by, …`. An asset lives in exactly one folder but
can be **referenced** by campaigns/streams/deliverables (design §8.1) via a light join
(`asset_references`), so a brand logo is owned once and reused everywhere. Versioning reuses the
`media_records` shape (version per asset); `media_records` stays the deliverable-review-media view and can
point at an asset. No copies — references.

### 3. Storage: cloud-first R2/B2, Iraq local archive later

Bytes live in **Backblaze B2** (S3-compatible; R2 remains a drop-in alternative); the app never proxies file bytes. Uploads/downloads use
**short-lived signed URLs** minted by an Edge Function holding the bucket credentials (Supabase secrets),
so keys never reach the browser and RLS still gates *who* may request a URL. `provider` is recorded per
asset (already supported). The **local Iraq backup** is a **later additive sync** (a scheduled mirror to
the on-prem server), reserved for now via `retention_state`/archive fields — exactly the cloud-first +
tenant-local archive pattern ADR-0016 set for recordings. Nothing about the model changes when it lands.

### 4. Company reference library + access

Two new grants:

- **`assets:view`** — browse a client's folders **and** the company-wide library (cross-client). Seeded to
  internal roles that need reference access; tunable via Roles (ADR-0008). Per-client asset reads still sit
  under tenant-wide RLS; `assets:view` governs the surfaces.
- **`assets:manage`** — upload, version, move, rename, delete (soft), organise folders. Seeded to Client
  Services + creative/production roles; tunable.

The **Library** surface offers two lenses over the same store: *by client* (drill the folder tree) and
*company-wide* (search/filter all assets by brand, type, tag, client). External `client_portal` is
excluded.

### 5. Full asset management (this pass)

Upload (signed PUT → R2), preview (image/PDF/video thumbnails), versioning, download (signed GET), folder
create/rename/move, soft-delete. Large-file and thumbnail generation follow the provider-swappable path;
no bytes through Postgres.

## Consequences

Easier: every client gets a consistent filing cabinet the moment they're registered; brand assets are
authored once and referenced everywhere; the company gets one reference library across all clients; storage
stays vendor-swappable and residency-ready.

Harder / new: a Backblaze B2 **bucket + application key** must be provisioned (Edward — as Supabase secrets)
before uploads work; a new Edge Function for signed URLs; new tables + auto-provision triggers; thumbnail
generation. The **Iraq local archive** is a documented follow-up (a sync job), not in this pass. Advances
the storage-residency OD: cloud-first now, on-prem mirror later.

Locked in: explicit folder tree auto-provisioned per client (Client → Campaign → Asset Type, plus brand
assets); assets referenced not copied; bytes on Backblaze B2 via signed URLs (never through the app), Iraq
mirror later; `assets:view` / `assets:manage` govern the library; no file bytes in Postgres.

## Settled (2026-08-16)

- **Bucket provider: Backblaze B2** (Edward, 2026-08-16) — ~2.5× cheaper at-rest ($6 vs $15 /TB/mo); at
  pilot download volumes egress stays inside B2's free tier (3× stored/mo), so the cheaper storage wins.
  S3-compatible, so if egress ever dominates at scale, switching to R2 (zero egress) is a credentials +
  config change, not a rewrite. Edward creates the bucket + an S3-compatible application key and stores it
  as Supabase secrets before uploads go live.
- **Subfolder taxonomy: the recommended defaults** — brand: Logos / Fonts / Guidelines / Key Visuals;
  project: Working Files / Deliverables / Final Assets / References. Seeded, and tunable later.
- **Iraq local backup:** planned as a later additive sync to the on-prem server; reserved in the model now.
