# ADR-0015: Realtime chat & notifications on Supabase Broadcast, with Postgres as the source of truth

> **Superseded in part by [ADR-0026](0026-native-supabase-notification-inbox-drop-novu.md) (2026-08-18):** the in-app inbox **UI** is native Supabase, not Novu (§4/§8, `V1.6.6`). The notification **transport** below — in-transaction `notifications` row + broadcast trigger, persist-first — is unchanged.
> **Amended by [ADR-0027](0027-contextual-chat-scope-campaign-rooms-and-item-threads.md) (2026-08-18):** the §6 `conversations` schema gains a **context anchor** (`context_type`/`context_id`) so a campaign has a first-class room and each deliverable/sub-task/review has a thread. Transport/reliability below unchanged.

- **Status:** accepted (Edward, 2026-08-13)
- **Date:** 2026-08-13
- **Analysis backing:** `docs/realtime-architecture-assessment.md` (full comparison, cost model, reliability spec, prior-art survey)
- **Relates to:** ADR-0002 (permissive licenses only), ADR-0008 (RLS/grant model)
- **Task(s):** V1.6 (Chat module), notifications across all modules
- **Companion:** ADR-0016 (voice huddles) — a *separate* module

## Context

Maestro needs two realtime capabilities across the suite: **in-app notifications** (booking assigned/approved, task changes, announcements) and **internal chat** (1:1 and group, typing/presence/read-receipts, history, tenant-isolated). Voice huddles are a separate module (ADR-0016).

A full architecture review (see the assessment doc) evaluated Supabase Realtime, Cloudflare Durable Objects, a self-hosted socket server, SpacetimeDB, and managed pub/sub (Ably/Centrifugo), on cost, reliability, scale (50 → 1,000+ users), complexity, security, multitenancy, and lock-in. Two findings drive this decision:

1. **The fear that pushed us toward Cloudflare/SpacetimeDB — "Supabase Realtime is unreliable / expensive at fan-out" — applies to *one* Supabase feature, Postgres Changes** (per-subscriber RLS check, single-threaded, ~3,000-subscriber ceiling per Supabase's own docs). **Broadcast** avoids it entirely (Supabase benchmark: 250,000 concurrent clients) and is one WebSocket per user carrying many topics. We don't need to leave Supabase; we need the right primitive.

2. **Delivery reliability is an application-layer property, not a transport feature.** No realtime pipe guarantees delivery over an unreliable network. The guarantee comes from *Postgres as the source of truth + persist-first + idempotent send + reconnect reconciliation* — identical on any transport. Supabase now also ships **Broadcast Replay** (native reconnect catch-up), which reduces how much of this we hand-roll. So "we can't afford a missed message" is satisfied by design on Supabase, not by choosing a premium pipe.

Cost at 1,000 users is ~$25–50/mo of realtime on Supabase; Durable Objects would save ~$25/mo while adding a second backend, JWKS validation, our own fan-out/reconnection, and a second failure domain — premature complexity rejected until a concrete trigger (see Escape hatch). SpacetimeDB is rejected outright: it is a **second source of truth** (owns its own storage; cannot front Postgres), is **BSL-1.1 licensed** (fails ADR-0002), and has experimental multitenant RLS.

## Decision

1. **Transport = Supabase Realtime Broadcast.** One authenticated WebSocket per user, multiplexing tenant-scoped topics `tenant:{tid}:user:{uid}` (private inbox), `tenant:{tid}:conv:{cid}` (a conversation), and ephemeral presence/typing topics. **Postgres Changes is not used for chat or notifications** (allowed only for tiny admin dashboards). Durable Objects / self-host / SpacetimeDB are rejected for this module.

2. **Postgres is the single source of truth; realtime is a lossy hint.** Every message and notification is a durable Postgres row before anyone is notified; the broadcast is a disposable nudge on top.

3. **Reliability contract (both directions), per assessment §5/§14:**
   - Client-generated **ULID `id`** as the message primary key → idempotent send; server insert is `on conflict (id) do nothing`.
   - **Per-conversation monotonic `seq`** → stable global ordering; clients apply by `seq`, dedupe by `id` (no reshuffle).
   - **Client outbox** (IndexedDB): optimistic render, retry send with the same `id` until a persisted ack, else surface "failed — retry".
   - **Reconnect catch-up:** on reconnect or a `seq` gap, pull `where seq > last_seq` from Postgres (Broadcast Replay handles the common short-blip case natively; the DB query is the ultimate backstop).
   - Presence/typing are **ephemeral, throttled** (typing ≤1/3s; presence beacon ≥15s) and excluded from the guarantee — they are the main cost driver if left unthrottled.

4. **Notifications = in-transaction broadcast trigger (the outbox is the trigger).** A business event inserts a `notifications` row **in the same transaction** as the state change; an `AFTER INSERT` trigger calls `realtime.broadcast_changes()` on the recipient's inbox topic. If the state change rolls back, so does the notification; if the broadcast is missed, the client's reconcile query picks it up. No separate outbox table is needed (that pattern is only required for the rejected external-transport variants). The in-app notification **inbox UI is built on Novu** (`@novu/react`, MIT) rather than hand-rolled.

5. **Chat send = persist-first.** Message flow: `send-message` Edge Function → insert (seq via trigger) → update `conversations.last_message_at` → `AFTER INSERT` broadcast to the conversation topic. Deliver-first is explicitly rejected (a shown-but-unsaved message is the worst UX).

6. **Schema & RLS per assessment §6/§7** (conversations, conversation_members, messages, message_reads/`last_read_seq`, reactions, notifications; every table `tenant_id`-scoped and indexed). **Realtime Authorization** (RLS on `realtime.messages`) gates topic joins: a client may subscribe to `conv:{cid}` only if it's a member. Authoritative writes (send message, create notification, add/remove members) go through Edge Functions; clients get read + narrow self-writes (own read cursor, own notification read state, ephemeral presence/typing).

7. **Event protocol per assessment §4** — one envelope, dotted `type`, `id`/`seq`/`tenant_id`/`topic`; persisted vs ephemeral marked.

8. **Build on permissive prior art (ADR-0002-clean):** fork Supabase's official **Broadcast chat component**; adopt the **slack-clone `full-schema.sql`** as the schema/RLS baseline (swap its transport for Broadcast); **Novu** for the inbox. All MIT/Apache.

9. **Escape hatch (documented, not built).** Move the transport off Supabase **only** on a concrete trigger: sustained >~8k concurrent connections where Supabase message pricing hurts, and/or a genuine multi-region edge-latency need, and/or server-authoritative room logic Supabase can't express. Even then, evaluate **Centrifugo** (Apache-2.0, self-hostable — the ADR-0002-clean choice) or Ably **before** Durable Objects. Because Postgres stays the source of truth and reconnection is DB-reconciliation, a transport swap touches only the delivery layer — the schema, RLS, event protocol, and reliability code are transport-agnostic.

## Consequences

Easier: one system (Supabase) we already run, with the reliability guarantee we need; no second backend, no JWKS/token service, no self-hosted sockets; the outbox is free (in-transaction trigger); most of the build is assembling official permissive parts.

Harder: we must implement the client outbox + cursor reconciliation (Broadcast Replay softens but doesn't remove this); presence/typing must be throttled from day one or they dominate the realtime bill; Broadcast requires Realtime Authorization policies (RLS on `realtime.messages`) written carefully for tenant + membership isolation.

Locked in: **Postgres is the single source of truth; realtime is a lossy hint** (never deliver-first); chat/notifications ride **Broadcast, never Postgres Changes**; delivery reliability is an app-layer contract (persist-first + idempotent `id` + per-conv `seq` + reconnect catch-up), which keeps us transport-portable; no restrictive-licensed or second-source-of-truth dependency (SpacetimeDB rejected on both counts).

## Task decomposition (V1.6.x — for TASKS.md)

- `V1.6.1` Schema + RLS: conversations/members/messages/reads/reactions/notifications (from slack-clone baseline, Broadcast-adapted); pgTAP for tenant + membership isolation.
- `V1.6.2` Realtime Authorization policies on `realtime.messages`; `setAuth` wiring; tenant-scoped topic scheme.
- `V1.6.3` `send-message` Edge Function (idempotent insert, seq trigger, broadcast) + client outbox (optimistic, retry-by-id, failed state).
- `V1.6.4` Reconnect/catch-up (Broadcast Replay + `seq > last_seq` backstop); gap detection; dedupe.
- `V1.6.5` Chat UI (fork Supabase Broadcast component): conversation list, thread, typing/presence (throttled), read cursor.
- `V1.6.6` Notifications: in-transaction broadcast trigger + Novu inbox; per-event types; unread badge (partial index).
- `V1.6.7` 🔒 pgTAP + load sanity: no cross-tenant topic join; message ordering/idempotency; presence/typing rate caps.
- **Cross-tenant chat threads wait on M8** (joint-project RLS); internal-only ships without it.
