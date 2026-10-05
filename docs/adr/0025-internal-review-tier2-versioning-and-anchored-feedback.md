# ADR-0025: Internal review (Tier-2) — version chain, anchored feedback, rounds tied to the revision loop

- **Status:** accepted (Edward, 2026-08-18)
- **Date:** 2026-08-18
- **Relates to:** **ADR-0024 §4** (Phase I named the Tier-2 internal review UI on the existing schema — this ADR is its detailed design), **ADR-0023** (review-versioning ↔ Library reconciliation — owns *client delivery*, Library filing, archive residency; I3 stops at internal sign-off and does **not** touch delivery), **ADR-0022** (assets are *referenced, not copied*; `media_records` is the deliverable-review view that can point at an asset), **ADR-0008** (grant-driven RBAC + universal audit as data), **ADR-0010** (scoped write authority), **ADR-0016** (cloud-first-active storage pattern). Schema exists since **M1.10** (`media_records` version chain + `review_feedback` anchors). Design draft v15 §8.2 (Tier-2 media review), §8.3 (media lifecycle, provider-swappable).
- **Open Decisions touched:** **OD 17** (canonical/normalised upload format) stays **open** — this phase accepts-and-plays, no transcoding pipeline. **OD 18** (Frame.io coupling) stays **open** — loose link-out default, no API integration.
- **Task(s):** **I3.1** (version upload + web playback over `media_records`), **I3.2** (pinned x/y + timecoded comments, resolved-state on `review_feedback`), **I3.3** (rounds tied to `revision_round`, maker jump-to-comment, internal source only) → fulfils **V1.8.1–8.3** (internal source only).

## Context

Phase I's loop is *brief → assign → produce → internal review (rounds) → internal sign-off → done*. Everything except **review** is now built and CI-green: the lifecycle engine + guard (I1), the four work surfaces (I2), and the role-scope audit (I2.6). The `in_review` state exists and the reviewer can already sign off (`in_review → approved`, gated `reviews:moderate`) or send back (`→ in_progress`, `revision_round++`) — but there is **nothing to review**: no way to put a version in front of a reviewer, no anchored comments, no round history. I3 builds that substrate and its surface.

The schema is already shaped for it (M1.10):

- **`media_records`** — per-deliverable **versioned** review-media chain: `version` (unique per deliverable), `provider` (`b2`/`r2`/`supabase`/`external`), `object_key`, `content_type`, `size_bytes`, `storage_tier`, `retention_state`, `external_review_url` (Frame.io link-out), `uploaded_by`.
- **`review_feedback`** — `round`, `source` (`client`/`internal`), `body`, `timecode_ms` (video), `pos_x`/`pos_y` (normalised 0–1, images), `resolved`, `author_user_id`.

So I3 is mostly **transport + surface + a small amount of glue**, not new tables. Three things are genuinely open and this ADR settles them: **(a)** how bytes get in and out without passing through the app or leaking storage keys; **(b)** how a `review_feedback.round` stays aligned with the deliverable's `revision_round`; **(c)** a debt to pay — both tables still carry **pre-ADR-0008 RLS** (`app.jwt_role() in ('admin','team_lead','booker','creative')`), which must move to grant-driven policies as part of touching them.

What is **not** in scope (owned elsewhere, deferred): client delivery, the `deliver_deliverable_version` RPC, Library/`Final Assets` filing, portal signed URLs, and the 60-day archive job — all **ADR-0023 / M10**. I3 is internal-only and ends at internal sign-off (the existing I1 `approved`). No new `deliverable_state` values (I1 owns the graph).

## Decision

### 1. Scope — the internal review *substrate*, on the existing states
I3 adds the version chain, playback, anchored comments and round history that the **existing** `in_review` state operates over. It introduces **no new deliverable states and no new transitions** — submitting for review, signing off and requesting changes remain the I1 transitions. The review UI fills the "versions · rounds · review" panes of the deliverable detail that I2.1 left pending. Client delivery stays deferred to ADR-0023/M10.

### 2. Version chain — one `media_records` row per uploaded version, monotonic per deliverable
Uploading a new cut creates a **new `media_records` row** with `version = max(version)+1` for that deliverable (the existing `uq_media_records_deliverable_version` guarantees monotonicity; a race retries). `object_key` follows the campaign/stream/deliverable hierarchy (§8.4): `tenant/<campaignId>/<streamId>/<deliverableId>/v<N>/<filename>`. `provider` = the tenant's hot store (`b2`, per ADR-0022), `storage_tier='hot'`, `retention_state='active'`. Version creation writes an **append-only audit** row (ADR-0008 §6). Uploading does **not** change the deliverable's state — putting it in front of a reviewer is the existing `in_progress → in_review` transition.

### 3. Transport — a privileged, caller-authorised Edge Function mints short-TTL presigned URLs; bytes never touch the app
A new caller-run Edge Function (working name **`review-media`**) is the only path to storage:
- **Upload:** the browser asks for a presigned **PUT**; the function authorises the caller against the deliverable (must hold the version-write grant, §7), reserves the next `media_records` row, and returns a **short-TTL presigned PUT** to B2. The browser uploads **directly to B2**.
- **Playback / view:** the function returns a **short-TTL presigned GET** for a given `media_records` row after a tenant-scope read check. The browser plays/views straight from B2.

Storage keys/credentials are **Supabase secrets set by Edward** (never handled here) and never reach the browser; no bytes pass through the app or Supabase. This is the same provider-swappable, signed-transfer pattern ADR-0022/0023 set for the Library and portal, applied to internal review, and it is the piece of new infrastructure this phase needs.

### 4. Anchored feedback — image pins, video timecodes, on the existing columns
Comments use the columns already present: **images** carry normalised `pos_x`/`pos_y` (0–1, resolution-independent); **video** carries `timecode_ms`; a plain comment carries neither. `resolved` toggles; `author_user_id = auth.uid()`. The maker's **jump-to-comment** is pure UI — clicking a comment seeks the `<video>` to `timecode_ms` or scrolls/flashes the pin at `pos_x/pos_y`. A new cut is a new version (§2); its round advances (§5) and the previous round's comments stay attached to their own version, so round-to-round comparison is intact.

### 5. Rounds tied to the revision loop — server-stamped, never client-set
`review_feedback.round` is **server-stamped** by a `BEFORE INSERT` trigger to the parent deliverable's **`revision_round + 1`** (derived `media_record → deliverable`; 1-based, matching the column's `default 1 / check >= 1`). So round 1 is the first review pass (`revision_round = 0`), and each `in_review → in_progress` rework (which increments `revision_round` in I1) rolls subsequent comments into the next round automatically. The client never sends `round`. **`source` is forced to `internal`** this phase (the `client` value is reserved for the portal capture-at-source path, M10).

### 6. Playback policy — web-playable inline, everything else link-out; no transcoding
Web-native types (`image/*` jpg·png·webp·gif; `video/mp4`·`webm`; `application/pdf`) render inline via the signed GET (`<img>`/`<video>`/`<embed>`). Anything else (ProRes, PSD, AI, …) offers **download** via the signed GET and/or an **external link-out** using the existing `external_review_url` (e.g. Frame.io). This keeps **OD 17** (a canonical/normalised upload format + proxy transcoding) and **OD 18** (deep Frame.io integration) open — we store the link, we don't integrate an API, and we run no transcoding pipeline this phase.

### 7. RLS modernisation — retire `jwt_role`, move to grant-driven + audit (own migration)
Touching these tables means paying the ADR-0008 debt. In its own migration, the legacy `app.jwt_role() in (...)` policies on `media_records` and `review_feedback` are **dropped and replaced**:
- **`media_records` write** (version upload/manage): `tenant_id = app.current_tenant_id() and app.has_permission('media','manage')`. `media:manage` is already seeded to the working roles (scheduler, team lead, deputy, team member, account manager). Write **scope stays grant-only for now**, consistent with the documented deliverable-transition interim (ADR-0009/0010 follow-up) — tightening to the deliverable's team/AM is a later refinement, noted not silently skipped.
- **`review_feedback` insert:** `tenant_id = current and author_user_id = auth.uid() and source = 'internal'`.
- **`review_feedback` update** (resolve/edit): author, **or** `app.has_permission('reviews','moderate')`.
- Reads stay tenant-wide (unchanged). Version-create and resolve are covered by the universal audit trigger.

### 8. Where it lives, and how sign-off uses it
The surface is the **deliverable detail** (reached from every I2 surface via `/deliverables?campaign=&open=`): a version rail (thumbnails/rounds), the current version's player/viewer with its pins/timecodes, and the round's comment list with resolve + jump-to-comment. The reviewer's **sign-off** (`in_review → approved`) and **request-changes** (`→ in_progress`, `revision_round++`) remain the **I1 transitions** — I3 only supplies the version + comments they act over. **No hard DB constraint** ties `in_review` to a version existing (a deliverable may be reviewed off-platform); the UI simply surfaces "no version uploaded yet."

### 9. Security & isolation
Internal review media is **deliverable-scoped and internal-only — never portal-reachable** (ADR-0023 §6; the portal exposes only *delivered Library assets*, M10). The `review-media` function is a **privileged route**: it authenticates + authorises the caller, mints signed URLs from secrets, and does signed transfer only — no dynamic SQL, no bytes through the app. Version-create and delivery-adjacent events are **append-only audit**.

## Consequences

**Easier:** the `in_review` state finally *means* something — a reviewer sees the actual cut and pins feedback to it; makers get precise, positional comments and jump straight to them; rounds line up with the revision loop for free because the round is derived, not entered; the whole thing rides schema that already exists, so it's transport + surface, not a data-model change; and it pays down the last `jwt_role` RLS debt on these tables.

**Harder / new:** the `review-media` Edge Function with presigned PUT/GET (Edward provides the B2 bucket + credentials as secrets); a viewer/player component with an image-pin overlay and a video-timecode scrubber; the round-stamping trigger; the RLS rewrite migration. Non-web-playable formats degrade to download/link-out until OD 17 is settled.

**Locked in (if accepted):** internal review versions are `media_records` rows (monotonic per deliverable), reached only through signed URLs minted by a privileged Edge Function — no keys or bytes in the app; comments are anchored (`pos_x/pos_y` image, `timecode_ms` video) with `round` **server-stamped to `revision_round + 1`** and `source` forced `internal`; playback is inline for web-native types and link-out/download otherwise (no transcoding, Frame.io stays a stored link); `media_records` + `review_feedback` RLS becomes grant-driven (`media:manage`, `reviews:moderate`), retiring `jwt_role`; **no new deliverable states**, and **client delivery/Library/archive stay ADR-0023/M10.**

## Open — resolve with Edward before implementation

1. **Upload transport & storage:** confirm **presigned direct-to-B2** (browser↔B2, keys server-side) over routing bytes through Supabase Storage. This needs a **B2 bucket + credentials as Supabase secrets that you set** — confirm the bucket (reuse the ADR-0022 hot store?) and that you'll provision the secrets.
2. **Round mapping:** confirm `review_feedback.round = deliverable.revision_round + 1` (1-based; round 1 = first pass), server-stamped.
3. **Who may comment internally:** open to **any internal authenticated user** who can see the deliverable (reads are tenant-wide), or gate authoring behind a grant (e.g. `reviews:moderate` or `media:manage`)? Proposed: **open to any internal user**, since internal review benefits from collaborators commenting; reviewers/leads additionally get resolve-any.
4. **Version-write scope:** confirm **grant-only (`media:manage`) now**, with team/AM scope tightening deferred (consistent with the deliverable-transition interim pinned in `017`).
5. **`in_review` needs a version?** Proposed **no** hard constraint (UI nudges only). Confirm.
6. **OD 17 / OD 18 stay open:** confirm **no transcoding pipeline** and **Frame.io = stored link-out only** this phase.

## Accepted (2026-08-18)

All six Open items resolved with Edward as proposed: **(1)** presigned direct-to-B2 confirmed — **B2 bucket + credentials already set as Supabase secrets**; **(2)** `round = revision_round + 1`, server-stamped; **(3)** internal comment authoring open to any internal authenticated user (reviewers/leads additionally resolve-any); **(4)** version-write grant-only (`media:manage`) for now, team/AM scope deferred; **(5)** no hard constraint tying `in_review` to a version; **(6)** OD 17 / OD 18 stay open — no transcoding pipeline, Frame.io link-out only.

- **Bookkeeping applied:** row **0025** added to `docs/adr/README.md`; `docs/TASKS.md` I3.1–I3.3 annotated with this ADR; OD 17 / OD 18 noted as open (link-out + no-transcode interim).
- **Proposed commit (git is Edward's):** `docs: ADR-0025 internal review Tier-2 — version chain, anchored feedback, revision-linked rounds [I3]`
- **Build order:** I3.1 (version chain + `review-media` presigned transport + `media_records` RLS modernisation + upload/playback UI) → I3.2 (anchored comments + `review_feedback` RLS) → I3.3 (round-stamping trigger + jump-to-comment).
