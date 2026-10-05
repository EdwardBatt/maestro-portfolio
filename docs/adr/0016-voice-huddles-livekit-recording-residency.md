# ADR-0016: Voice huddles on LiveKit; recording residency (cloud-first + local archive) and tenant ownership

- **Status:** accepted (Edward, 2026-08-13)
- **Date:** 2026-08-13
- **Analysis backing:** `docs/realtime-architecture-assessment.md` (§10 LiveKit, §11–12 cost)
- **Relates to:** ADR-0002 (permissive licenses / paid-dependency sign-off), ADR-0015 (chat & notifications — separate module)
- **Open Decisions:** resolves OD 27 (recording residency + ownership) in part; **OD 28 (network traversal) remains an open spike**
- **Task(s):** V1.10 (Huddle spike + module)

## Context

Maestro needs multi-person **voice** meetings ("huddles") — presence/participant list, mute, join/leave, reliable reconnection — with **recording**, and later optionally video/screen-share. The architecture review (assessment §10) selected **LiveKit** (SFU; Apache-2.0 software) as the media layer, connected only while a user is in a meeting, with metadata in Postgres and recordings to S3-compatible object storage.

Two policy questions were open (OD 27): **where recordings live** (Iraq/UAE/Egypt data-residency and consent), and **who owns a recording** when external entities are invited. Edward resolved both (2026-08-13). A third question (OD 28: does media/TURN traverse restricted corporate networks in-region) is a **technical spike that remains open** and gates the huddle build.

## Decision

1. **Media layer = LiveKit.** The LiveKit software is Apache-2.0 (permissive, ADR-0002-clean). **LiveKit Cloud is used first** (audio-first; connect only during a meeting) — LiveKit *Cloud* is a paid managed service and therefore needs an explicit **ADR-0002 paid-dependency sign-off** before production use. **Self-hosting is the fallback** if residency/consent or the OD 28 spike require it; the LiveKit API is identical either way, so this is not a rewrite — it is a deployment change.

2. **Meeting auth & metadata.** Meetings are Postgres rows (`meetings`, `meeting_participants`, `recordings` — see assessment §6). Media access is a **short-lived LiveKit token minted by a backend Edge Function after a tenant + membership check**; room name is tenant-scoped (`tenant_{tid}_{meetingid}`). The token is the isolation boundary — a user can only obtain a token for a room in a tenant they belong to (or are invited to). Built on `livekit-server-sdk` (Apache-2.0).

3. **Recording residency = cloud-first with expiry, permanent copy to local/tenant backup (Edward, 2026-08-13).** Recordings are written first to **Cloudflare R2** (LiveKit Egress → S3-compatible endpoint; egress-free storage) as a **transient working copy carrying a TTL/expiry**. The **permanent archival copy is pushed to a tenant-controlled local/on-prem backup**, because Iraq and Egypt lack in-country cloud services we can use for permanent residency. **R2 is therefore a temporary distribution/working store, NOT the system of record for recordings** — the durable home is the tenant's own backup. The `recordings` row tracks both the (expiring) R2 key and the archival location/status.

4. **Recording ownership = the host/primary tenant (Edward, 2026-08-13).** Although external entities may be *invited* to a huddle, **the recording is owned and controlled by the primary (host) tenant.** External invitees are participants, not owners: they have no ownership claim, retention control, or export right over the recording by default. (Cross-tenant *sharing* of a recording, if ever wanted, is an explicit future grant, not a default.)

5. **Ownership ≠ consent — consent capture is still required.** Tenant ownership settles *control*, not *lawful recording*. Recording requires a **visible "this meeting is being recorded" notice and a logged acknowledgment** from every participant (internal and external), because Iraq/UAE/Egypt (and external-client) consent rules vary. **The consent-capture mechanism is a build item; per-jurisdiction legality is a legal-review item** before recording is enabled in production. This is the remaining, narrower part of OD 27.

6. **Voice MUST traverse restricted corporate firewalls — hard requirement (Edward, 2026-08-13).** This is not optional and not a "nice to have": if huddles don't connect from Iraqi/UAE/Egypt corporate/restricted networks, the feature does not ship. OD 28 is therefore a **hard gate**, resolved by escalation until it works: (1) LiveKit **embedded TURN over TLS on 443** (the port corporate firewalls almost always allow) is the first lever; (2) if that's insufficient, **standalone coturn** (public IP + TLS 443/5349); (3) if Cloud still can't traverse, **self-host the media + TURN in-region**. We keep escalating down that list until real corporate networks connect — there is no "accept failure" branch. The `V1.10.0` spike proves which rung is needed; **no huddle feature ships until audio reliably joins from those real networks.**

7. **Build on permissive prior art:** fork **`livekit-examples/meet`** (Apache-2.0) for the huddle UI, `@livekit/components-react` for components, `livekit-server-sdk` for tokens, `livekit/egress` for recording → R2. All Apache/MIT.

8. **Future capability is native, no re-architecture:** video, screen-share, larger rooms, and richer recording are LiveKit features we enable later — audio-first now is a configuration choice, not an architectural one.

## Consequences

Easier: a clear, standards-based media stack we don't have to invent; recordings stored cheaply with free egress for distribution; ownership and residency rules are decided, so the schema and retention logic can be built; the same code runs on Cloud or self-host.

Harder: the recording lifecycle is now **two-tier** (expiring R2 working copy + durable tenant-local archive) — the egress webhook + a retention/archival job must move the permanent copy off R2 and enforce the TTL; a **consent-capture + acknowledgment** flow is required before recording is enabled; the **OD 28 connectivity spike** is a hard gate with real risk (restricted networks are exactly where SFUs struggle); LiveKit Cloud needs an ADR-0002 paid-dependency sign-off.

Locked in: LiveKit is the media layer (Cloud-first, self-host-capable, no rewrite to switch); **recordings are owned by the host tenant**; **R2 is transient, the tenant-local backup is the durable system of record for recordings**; recording is gated behind both a **consent mechanism** and the **OD 28 traversal spike**; audio-first, connect-only-in-meeting.

## Spike & task decomposition (V1.10.x)

- `V1.10.0` 🔬 **OD 28 spike (gate):** stand up a minimal LiveKit room (Cloud, embedded TURN) and prove audio join/publish **from restricted corporate networks in Iraq, UAE, Egypt**. Record pass/fail per network; decide Cloud vs coturn vs self-host. **Nothing else in V1.10 starts until this passes.**
- `V1.10.1` ADR-0002 sign-off for LiveKit Cloud (paid dependency); or self-host decision if the spike forces it.
- `V1.10.2` Meeting metadata schema (`meetings`/`meeting_participants`/`recordings`) + `join-meeting` token Edge Function (auth → LiveKit token, tenant-scoped room).
- `V1.10.3` Huddle UI (fork `livekit-examples/meet`): join, participant list, mute, join/leave, reconnection; audio-first.
- `V1.10.4` Recording: LiveKit Egress → R2 (TTL) + egress webhook writing the `recordings` row; **retention/archival job** copying the permanent record to tenant-local backup and expiring the R2 copy.
- `V1.10.5` **Consent capture:** recording notice + per-participant logged acknowledgment; block recording without it; per-jurisdiction legal review before enabling in prod.
- `V1.10.6` 🔒 Isolation tests: a token only grants rooms in the caller's tenant; external invitees get participant-only tokens with no ownership/export.
- **Video / screen-share / large rooms:** deferred; native LiveKit, no re-architecture when added.
