# Realtime Architecture Assessment — Notifications, Chat & Huddles

*Senior-architect review for Maestro (multitenant work suite on Supabase + Vercel, MENA region, 50 → 1,000+ users). Prepared to seed **ADR‑0015 (chat & notifications)** and the **Huddle spike (V1.10)**. Pricing verified against official docs, 2026.*

> **Update (ADR-0026, 2026-08-18):** the **Novu** recommendation for the notification inbox is **superseded** — the in-app inbox is built natively on Supabase (recipient-scoped `notifications` table + Realtime + in-house UI), and email goes through **Resend called directly**. The rest of this assessment stands.

---

## 0. The verdict up front (read this even if you read nothing else)

**You asked me to be skeptical about Cloudflare Durable Objects. Here it is: at 50–1,000 users, Durable Objects is the wrong first choice, and the reason you were drawn to it rests on a conflation.**

You were worried about "Supabase Realtime's cost and fan‑out model." That worry is real — but it applies to **one** of Supabase Realtime's three features, **Postgres Changes**, not to the product as a whole. Postgres Changes runs a per‑subscriber RLS check on a single thread and Supabase themselves say: *"If you expect more than ~3,000 concurrent subscribers on the same changes, use Broadcast instead."* The fix for that ceiling is **Broadcast** — which is still Supabase, still one WebSocket per user, and which Supabase have benchmarked to **250,000 concurrent clients**. You don't need to leave Supabase to escape the fan‑out problem; you need to use the right Supabase primitive.

So the honest recommendation is:

> **Phase 1–2 (50–500 users): Supabase (DB + Auth + Realtime *Broadcast*) for notifications/chat/presence, LiveKit for voice, Cloudflare R2 for recordings. No Cloudflare Workers/Durable Objects. No self‑hosted socket server.**

Cloudflare Durable Objects is a genuinely excellent technology, but adopting it here means standing up a **second backend, a second deploy target, a second realtime source of truth, and your own JWT‑validation + fan‑out + reconnection code** — to save money you are not currently spending and to raise a ceiling you are nowhere near. That is textbook premature complexity. I'll show the numbers rather than assert them.

DOs earn their place later, as a **documented escape hatch** (Phase 3+), only if you cross one of three concrete triggers (roughly: ~8k+ concurrent connections, a need for edge‑local latency across continents, or server‑authoritative room logic Supabase can't express). None of those is near.

The one place I fully agree with your instinct: **LiveKit for voice, connected only during a meeting, recordings to R2.** That part is right.

---

## 1. Architecture comparison & ranking

I compared your A–D plus two you didn't list. Scores are 1–5 (5 = best) **for your specific situation** (50→1,000 users, one region, already on Supabase, small team, cost‑sensitive). They are not universal.

| # | Architecture | Cost | Reliab. | Scale (to ~5k) | Dev cx | Ops cx | Security | Multitenancy | Debug | Lock‑in | Maint. | **Fit** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **A** | Supabase Realtime (**Broadcast**) + Supabase + LiveKit | 5 | 4 | 4 | 5 | 5 | 4 | 4 | 4 | 3 | 5 | **★ Best** |
| A₋ | Supabase Realtime (**Postgres Changes**) + Supabase + LiveKit | 3 | 3 | 2 | 5 | 5 | 5 | 5 | 4 | 3 | 4 | Trap¹ |
| **B** | Cloudflare DO/WS + Supabase + LiveKit | 3 | 4 | 5 | 2 | 3 | 3 | 3 | 2 | 2 | 3 | Premature |
| **C** | Cloudflare DO/WS + Supabase + *non‑LiveKit voice* | 2 | 3 | 5 | 1 | 2 | 3 | 3 | 2 | 2 | 2 | Worst mix |
| **D** | Self‑hosted socket server + Supabase + LiveKit | 2 | 2 | 4 | 2 | 1 | 3 | 3 | 3 | 3 | 2 | Ops sink |
| **E** | *Overlooked:* managed pub/sub (Ably/Pusher) + Supabase + LiveKit | 3 | 5 | 5 | 4 | 5 | 4 | 4 | 4 | 4 | 3 | Backup pick |

¹ **A₋ is the trap you correctly sensed.** Postgres Changes is the easiest thing to reach for (subscribe to a table, done) and it works beautifully in a demo, then falls over between a few hundred and a few thousand concurrent subscribers. Use it for *nothing that fans out widely.* It's fine for a handful of admin dashboards; it is not your chat/notification transport.

**Why A over B (the crux):** A and B do the *same job*. B replaces a managed, already‑paid‑for, RLS‑integrated WebSocket layer with one you build and operate. At your scale the CF bill and the Supabase bill are within ~$20/mo of each other (Section 11) — so B trades **near‑zero savings** for **materially more dev + ops + debugging + a second failure domain.** That's a bad trade until the savings become real (thousands of concurrent sockets).

**Architecture E (the one you overlooked): Ably or Pusher Channels.** These are purpose‑built managed realtime pub/sub with first‑class presence, history, and reconnection‑with‑replay — the exact features you're otherwise hand‑rolling on DOs. If you ever decide Supabase Realtime isn't enough, **Ably is a faster, more reliable path than Durable Objects** for a small team, because reconnection/replay/ordering are solved for you. It's a paid dependency (ADR‑0002 gate) and it's more lock‑in than DOs, but it beats B on reliability and dev‑experience. I list it as your **Plan B**, ahead of DOs, for a team your size.

**Bottom line ranking for you: A ≫ E > B ≈ D > C.**

---

## 2. Durable Objects — the honest technical assessment

You asked me not to assume "1,000 users = trivial," and to find the real bottleneck. Here it is, from Cloudflare's own docs.

**What's genuinely great about DOs**
- **WebSocket Hibernation** does what you hoped: an idle connection accrues **zero compute (GB‑s)** while hibernated. That kills the "paying for idle sockets" problem. ✅
- **Single‑threaded, single‑instance per object** gives you a natural serialization point — perfect for per‑room message ordering.
- Storage is co‑located (SQLite in the DO), so per‑room state is cheap and local.

**The four things that bite — and the pricing subtlety you had wrong**
1. **Hibernation saves duration, NOT messages.** You still pay the **request charge for every incoming WebSocket message** (billed at a 20:1 ratio — 20 inbound messages = 1 billable request; outbound and pings are free). So a chatty presence/typing feature is billed on *message volume*, and hibernation doesn't help that axis at all. This is the detail that quietly makes DOs *not* free.
2. **~1,000 requests/second soft limit per DO, single‑threaded.** A DO is one JS isolate. Everything through that object — every inbound message, every fan‑out loop — runs on one thread. If a "tenant DO" holds 300 users all typing, presence‑beaconing, and reading, you can hit that wall, and the fix is sharding your object model (more engineering).
3. **128 MB memory per object.** Bounds how many connections + how much buffered state one DO can hold. Tens of thousands of *idle hibernated* sockets are fine; thousands of *active* ones on one object are not.
4. **A DO is pinned to the datacenter near its first request and never migrates.** Create a tenant DO from Baghdad and it lives at whatever Cloudflare PoP served that first request, for its whole life. For a single‑region tenant that's fine; it means you don't get magic global locality for free, and you can't move it later.

**Undocumented / can't‑confirm (treat as risk):** Cloudflare does not publish an exact max‑connections‑per‑DO number, nor exact eviction timeout / cold‑start latency. Cold start = your constructor re‑runs, so keep it minimal. You'd be building on behaviors that are stable in practice but not contractually specified — a real consideration for a "production‑grade" bar.

**Verdict on DOs:** technically sound, and the *correct* tool if you were building a global, edge‑latency‑sensitive, hyperscale realtime product. For a MENA‑region internal suite of 50–1,000 users where Supabase already terminates authenticated WebSockets for you, it's **capability you'd pay for in engineering and operate yourself, to duplicate something you already own.**

---

## 3. Multitenant model (for whichever transport)

The tenancy model matters regardless of transport, so I'll give it in transport‑neutral terms, then the DO‑specific mapping in case you go there at Phase 3.

**Principle: the *channel/topic namespace* is the isolation boundary, and it is derived from the JWT server‑side, never from client input.** Every realtime topic is prefixed with the tenant id, and membership is authorized against Postgres before a subscription is allowed.

Topic scheme (works on Supabase Broadcast *and* on DOs):
```
tenant:{tid}:user:{uid}          # a user's private inbox (notifications, receipts)
tenant:{tid}:conv:{cid}          # one chat conversation
tenant:{tid}:presence            # tenant-wide presence (or per-conv presence)
```

- **Cross‑tenant leakage** is prevented because `{tid}` comes from the verified JWT claim (`app_metadata.tenant_id`) at subscribe time, and Supabase Realtime Authorization (RLS on `realtime.messages`) checks that the caller may join that topic. A client asking to join `tenant:OTHER:...` fails the RLS check.
- **Unauthorized subscription** (right tenant, wrong conversation) is prevented by an RLS policy that joins `conversation_members` — you can only subscribe to `conv:{cid}` if you're a member.
- **Impersonation / unauthorized delivery** is prevented because *clients never publish authoritative events.* Chat sends and notifications are written by your backend (Edge Function / server) using the service role after its own permission check; the realtime layer only carries already‑authorized fan‑out. (More in §7 and §9.)
- **Presence leakage** is prevented by scoping presence to a tenant/conversation topic the user is already authorized on.

**"Which logical unit is a DO?" (if you ever adopt DOs):** not per‑user (too many objects, no natural fan‑out point) and not per‑tenant (single‑threaded hot object — a 300‑person tenant melts one isolate). **Per‑conversation for chat rooms, plus a per‑user inbox DO for notifications** is the only model that respects the 1k‑req/s + 128 MB limits. That hybrid is more objects to reason about — another reason to defer DOs.

**Authentication flow (Supabase path — recommended):**
```
Browser has Supabase session (JWT with app_metadata.tenant_id, app_role_id).
  → supabase.realtime.setAuth(jwt)  (SDK attaches JWT to the WS)
  → client joins topic tenant:{tid}:conv:{cid}
  → Supabase Realtime checks RLS on realtime.messages for this (jwt, topic)
      → policy: caller is a member of conversation cid in tenant tid → ALLOW
  → subscription established; JWT re-checked on refresh
```
No token you issue, no Worker to write. The JWT you already mint is the whole auth story.

**Authentication flow (DO path — for completeness, Phase 3):** the browser opens `wss://rt.maestro/...` with the Supabase JWT in the connect request; a Cloudflare Worker **verifies the JWT signature against Supabase's JWKS** (fetch `…/auth/v1/.well-known/jwks.json`, cache it, verify RS256/ES256 locally — do *not* call Supabase per connection), extracts `tenant_id`/`sub`, authorizes membership (a cached read or a signed capability), then routes to the right DO. You own key rotation, clock skew, revocation, and JWKS caching. It's all doable; it's all code you don't write in Architecture A.

---

## 4. Event protocol

One envelope for everything, multiplexed over the single connection. Ephemeral vs persisted is called out.

```jsonc
{
  "v": 1,
  "type": "chat.message",        // dotted namespace
  "id": "01J...",                // ULID/UUIDv7 — sortable, idempotency key
  "seq": 84213,                  // per-topic monotonic sequence (persisted topics only)
  "tenant_id": "...",
  "topic": "conv:9af...",
  "ts": "2026-08-13T21:04:11Z",
  "actor_id": "user_...",
  "payload": { }
}
```

| type | persistence | notes |
|---|---|---|
| `notification.created` | **persisted** (source of truth = `notifications`) | carries `seq`; client reconciles on reconnect |
| `notification.read` | **persisted** (`notification_state`) | fans to the user's other devices |
| `chat.message` | **persisted** (`messages`) | `id` = idempotency key; `seq` per conversation |
| `chat.message.edited` / `.deleted` | **persisted** | tombstone, not hard delete |
| `chat.reaction.added` / `.removed` | **persisted** (small) | optional |
| `chat.read` (receipt) | **persisted** (`message_reads`) — but coalesced | store "last read seq per member," not per message |
| `chat.typing` | **ephemeral** | never persisted; TTL ~4 s; rate‑limit hard |
| `presence.state` | **ephemeral** | Supabase Presence or a heartbeat; never the source of truth |
| `conn.hello` / `conn.resume` | control | client→server: "my last seen seq per topic" |
| `conn.ack` / `conn.error` | control | server→client |

**Rule of thumb:** if losing the event would leave the UI permanently wrong, it's persisted and carries `seq`. If it's a transient hint (typing, "online now"), it's ephemeral, rate‑limited, and never reconciled. **Typing and presence are your message‑volume cost drivers** — treat them as second‑class: throttle typing to ≤1 event / 3 s / user / conversation, and beacon presence at ≥15 s, or you'll 10× your realtime message bill for cosmetics.

---

## 5. Offline / reconnection — the part that must be correct

**The database is the source of truth; the socket is a low‑latency hint.** This single principle makes reconnection robust regardless of transport.

Design: **per‑topic monotonic sequence + last‑seen cursor + DB reconciliation, with idempotent client apply.**

- Every persisted event on a topic gets a **`seq`** that is monotonic *within that topic* (per conversation, per user‑inbox). Use a Postgres sequence or `bigint` from an `identity` column on the persisted row. (A global sequence isn't needed and hurts; ordering only has to hold *within* a conversation.)
- The client tracks **`last_seq` per topic** it's subscribed to (in memory + IndexedDB).
- **On reconnect**, the client does **not** trust the socket to have buffered anything. It calls a normal Postgres/REST read: `GET messages where conversation_id=? and seq > last_seq order by seq` (and the equivalent for notifications). This "catch‑up query" is the reconciliation and it's just RLS‑protected SQL.
- **Live events** received while the catch‑up query is in flight are buffered and applied after, then deduped.
- **Idempotency / dedupe:** apply by `id` (ULID) into a client‑side set/map; a message that arrived both via the socket and via the catch‑up query is applied once. Ordering is by `seq`.
- **Gap detection:** if a live event arrives with `seq > last_seq + 1`, the client knows it missed something and triggers a catch‑up query for the gap before applying. This is what prevents "messages appearing out of order" and silent loss.

```
        ┌──────────── online ───────────┐        ┌──── reconnect ────┐
msg seq 42,43,44 applied  … socket drops … buffer live seq 47,48
                                          └─► catch-up: GET seq>44  → 45,46,47,48
                                          └─► merge+dedupe by id, order by seq
                                          └─► last_seq = 48
```

Guarantees this gives you:
- **No lost messages** — the DB always has them; reconnect reconciles from `last_seq`.
- **No duplicates** — dedupe by `id`.
- **No out‑of‑order** — apply ordered by `seq`, with gap‑fill before applying ahead.

**Crucially, this is identical work on Supabase Broadcast or on DOs.** Neither transport gives you exactly‑once for free; both need this DB‑reconciliation pattern. So "reconnection robustness" is **not** a reason to pick DOs — you build the same thing either way. (Ably/Pusher *do* give you replay‑on‑reconnect out of the box — that's the one place Architecture E genuinely saves you code.)

---

## 6. Chat database schema (Postgres/Supabase, RLS‑ready)

Tenant‑scoped, indexed for the two hot queries (a conversation's recent messages; a user's unread notifications). `tenant_id` is denormalized onto every table so RLS is a fast indexed predicate, not a join.

```sql
-- everything is tenant-scoped; tenant_id denormalized for RLS speed
create table conversations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  kind         text not null check (kind in ('dm','group')),
  title        text,                          -- null for DMs
  created_by   uuid not null references user_profiles(id),
  created_at   timestamptz not null default now(),
  last_message_at timestamptz                 -- denormalized for inbox sort
);
create index on conversations (tenant_id, last_message_at desc);

create table conversation_members (
  conversation_id uuid not null references conversations(id) on delete cascade,
  tenant_id       uuid not null references tenants(id),
  user_id         uuid not null references user_profiles(id),
  role            text not null default 'member' check (role in ('member','admin')),
  joined_at       timestamptz not null default now(),
  last_read_seq   bigint not null default 0,   -- read receipts, coalesced (not per-message)
  muted           boolean not null default false,
  primary key (conversation_id, user_id)
);
create index on conversation_members (tenant_id, user_id);   -- "my conversations"

create table messages (
  id              uuid primary key default gen_random_uuid(),   -- also the idempotency key
  tenant_id       uuid not null references tenants(id),
  conversation_id uuid not null references conversations(id) on delete cascade,
  seq             bigint not null,             -- monotonic PER conversation (see trigger)
  sender_id       uuid not null references user_profiles(id),
  body            text,
  attachments     jsonb not null default '[]', -- [{r2_key,name,size,mime}] (future)
  edited_at       timestamptz,
  deleted_at      timestamptz,                 -- tombstone
  created_at      timestamptz not null default now(),
  unique (conversation_id, seq)
);
-- THE hot query: a conversation's messages newest-first, and catch-up seq>N
create index on messages (conversation_id, seq desc);

create table message_reads (      -- optional granular receipts; last_read_seq covers most needs
  conversation_id uuid not null,
  user_id         uuid not null,
  seq             bigint not null,
  read_at         timestamptz not null default now(),
  primary key (conversation_id, user_id)        -- one row per member: their high-water mark
);

create table message_reactions (
  message_id uuid not null references messages(id) on delete cascade,
  tenant_id  uuid not null,
  user_id    uuid not null,
  emoji      text not null,
  primary key (message_id, user_id, emoji)
);

-- notifications: DB is source of truth; realtime just nudges
create table notifications (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  user_id     uuid not null references user_profiles(id),  -- recipient
  seq         bigint generated always as identity,          -- per-user inbox ordering (global identity ok; filter by user)
  type        text not null,        -- 'booking.approved', 'task.assigned', ...
  title       text not null,
  body        text,
  entity      text,                 -- 'bookings' | 'sub_tasks' | ...
  entity_id   uuid,
  read_at     timestamptz,          -- null = unread (state inline; no separate table needed at this scale)
  created_at  timestamptz not null default now()
);
create index on notifications (tenant_id, user_id, id desc);              -- inbox
create index on notifications (tenant_id, user_id) where read_at is null; -- unread badge (partial)

-- meetings (metadata only; media is LiveKit)
create table meetings (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  room_name     text not null unique,          -- LiveKit room = 'tenant_{tid}_{id}'
  title         text,
  created_by    uuid not null references user_profiles(id),
  started_at    timestamptz,
  ended_at      timestamptz,
  created_at    timestamptz not null default now()
);
create table meeting_participants (
  meeting_id uuid not null references meetings(id) on delete cascade,
  tenant_id  uuid not null,
  user_id    uuid not null references user_profiles(id),
  joined_at  timestamptz,
  left_at    timestamptz,
  primary key (meeting_id, user_id)
);
create table recordings (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  meeting_id  uuid not null references meetings(id) on delete cascade,
  r2_key      text not null,                   -- object storage location
  duration_s  integer,
  size_bytes  bigint,
  status      text not null default 'processing' check (status in ('processing','ready','failed')),
  created_at  timestamptz not null default now()
);
```

**Per‑conversation `seq` trigger** (keeps ordering monotonic per conversation without a global bottleneck):
```sql
create function app.assign_message_seq() returns trigger language plpgsql as $$
begin
  select coalesce(max(seq),0)+1 into new.seq
  from messages where conversation_id = new.conversation_id;
  return new;
end $$;
create trigger message_seq before insert on messages
  for each row execute function app.assign_message_seq();
-- (contention is per-conversation only; for very hot rooms switch to a per-conversation
--  advisory lock or a dedicated sequence table row locked FOR UPDATE.)
```

Indexing summary (the two queries that must stay fast at 1,000 users):
- **conversation view / catch‑up:** `messages (conversation_id, seq desc)` → both "latest 50" and "seq > N" are index range scans.
- **unread badge:** partial index `notifications (tenant_id,user_id) where read_at is null` → counting unread is O(unread), not O(all).

---

## 7. RLS & security

**The database must be safe even if the browser is fully compromised.** That means: browser gets *read* + *narrow write* directly via RLS; anything authoritative goes through a backend function with the service role.

Tenant isolation (every table): `tenant_id = app.current_tenant_id()` in every policy — the same pattern Maestro already uses. `tenant_id` is denormalized so this is an indexed predicate.

| Table | SELECT | INSERT/UPDATE |
|---|---|---|
| `conversations` | member of it (`exists` in `conversation_members`) | create via backend; rename by conv admin |
| `conversation_members` | members see co‑members | add/remove via **backend only** (authorization + side effects) |
| `messages` | members of the conversation | **INSERT via backend** (assigns seq, fans out, updates `last_message_at`); no client UPDATE except own edit within window |
| `message_reads` / `last_read_seq` | self | self (advance own high‑water mark) |
| `notifications` | `user_id = auth.uid()` | **INSERT via backend only**; UPDATE only `read_at` for self |
| `meetings` / `participants` | tenant members (or invited) | create/join via backend (mints LiveKit token) |
| `recordings` | meeting participants / admins | **service‑role only** (written by the egress webhook) |

**What must go through the Cloudflare Worker / Edge Function (backend), not browser→Supabase directly:**
- **Sending a chat message** — needs to assign `seq`, update `last_message_at`, and trigger fan‑out atomically. (You *can* let the client INSERT and do it all in triggers; I still prefer a thin `send-message` function so the fan‑out/outbox is server‑controlled and rate‑limited.)
- **Creating notifications** — always a side effect of a business event (booking approved, task assigned); never a client action.
- **Adding/removing conversation members** — authorization + notifications + presence implications.
- **Minting LiveKit tokens** — the token grants media access; it must be signed server‑side with the LiveKit API secret after a membership check.
- **Writing recordings** — only the egress/webhook path (service role).

Clients get: read their conversations/messages/notifications, advance their own read cursor, toggle their own notification read state, publish ephemeral typing/presence on authorized topics. Nothing else.

**Realtime authorization specifically:** with Supabase Broadcast you enable **Realtime Authorization** and write RLS on `realtime.messages` so that a client may only *join* `tenant:{tid}:conv:{cid}` if they're a member. This is the check that stops a compromised browser subscribing to another conversation or tenant. (With DOs, this is code in your Worker instead of a policy — more surface area to get wrong.)

---

## 8. Notification architecture (event → realtime, without split‑brain)

**The danger:** you write the notification row, then publish the realtime event, and one of the two fails — now DB and delivery disagree. The fix is to make **Postgres the single trigger point** so there's nothing to keep in sync.

**Recommended: DB is the source of truth, and realtime is emitted *from* the DB commit — via Supabase "Broadcast from Database."**

```
Booking approved (business logic, in a transaction)
   └─► INSERT into notifications (...)         ← same transaction as the state change
          └─► AFTER INSERT trigger: realtime.broadcast_changes('tenant:{tid}:user:{uid}', ...)
                 └─► Supabase Realtime fans out to that user's socket(s)
   client receives nudge → (optionally) reconciles unread via GET notifications where read_at is null
```

Why this is correct:
- The notification row and the business state change commit **in one transaction** — if the booking approval rolls back, so does the notification. No orphan notifications.
- The broadcast is fired **by a trigger on the committed row**, so you cannot have "delivered but not persisted." If the transaction commits, the row exists; the broadcast is a best‑effort nudge on top of a durable row.
- If the broadcast is *missed* (user offline, transient drop), it doesn't matter — the row is in `notifications`, and the client's reconnect/catch‑up query (`§5`) picks it up. **Delivery is allowed to be lossy because the DB isn't.**

**Do you need an outbox table?** For **Supabase Broadcast‑from‑DB: no** — the trigger *is* the outbox, firing inside the same transaction. An explicit `outbox` table + worker is the right pattern **only if** you push to an external system that can't be triggered from Postgres (e.g., you go the Durable Objects route, where you'd write an `outbox` row in the txn and a Worker/Queue consumer relays it to the DO). That extra table + consumer + at‑least‑once dedupe is, again, complexity that Architecture A avoids entirely. **This is one of the strongest arguments for staying on Supabase for realtime: the outbox is free because the trigger runs in‑transaction.**

Push/email fan‑out (for offline users) is a separate, slower lane: same trigger (or a `pg_cron` sweep of unread‑and‑old notifications) enqueues web‑push/email. Don't block the realtime path on it.

---

## 9. Chat message flow — persist‑first, always

You asked which of persist‑first / deliver‑first / outbox I recommend. **Persist‑first (write to Postgres, then fan out from the commit).** Same reasoning as notifications, and it directly answers your "lost vs duplicate vs out‑of‑order" trilemma.

```
Alice sends "hi"
  └─► send-message Edge Function (or RLS INSERT + trigger)
        1. INSERT into messages (seq assigned by trigger)   ← durable, ordered
        2. UPDATE conversations.last_message_at
        3. AFTER-INSERT trigger: realtime.broadcast_changes('tenant:{tid}:conv:{cid}', msg)
  └─► Supabase fans out to Bob's socket(s)  → Bob applies by seq, dedupes by id
  Bob offline? → row is in messages; Bob's reconnect catch-up (seq > last_read_seq) delivers it.
```

- **Deliver‑first (option 2) is wrong** for you: if delivery succeeds but the DB write fails, you've shown a message that doesn't exist — the worst UX (it vanishes on refresh). Never do this for chat.
- **Persist‑first (option 1)** means the only failure mode is "persisted but delivery lagged," which your reconnection strategy already handles gracefully. Messages can't be lost (DB has them), can't duplicate (dedupe by `id`), can't reorder (apply by `seq`).
- **Outbox (option 3)** is persist‑first with an extra relay hop; you need it only for the DO/external‑transport variant. On Supabase, the in‑transaction broadcast trigger gives you persist‑first without the extra table.

Optimistic UI is still fine: Alice's client shows the message immediately with a client‑generated `id` and a "sending" state, then confirms when the persisted echo returns (matched by `id`). That's presentation, not truth.

---

## 10. Voice meetings — LiveKit assessment

**LiveKit is the right call.** It handles multi‑party voice today and video / screen‑share / large rooms later with no architecture change — it's an SFU, which is exactly what scales to those. Your instinct to connect **only during a meeting** (not on login) is correct and is how LiveKit is meant to be used.

**Cloud vs self‑host — for you, Cloud, and it's not close *on total cost of ownership*.**

| | LiveKit Cloud | Self‑hosted |
|---|---|---|
| Software | managed | free (OSS) |
| You operate | nothing | SFU + Redis + **TURN/coturn (public IP, TLS)** + Egress (headless Chrome) |
| Restricted‑network traversal (your OD 28) | handled | **you must prove coturn works from Iraqi/UAE/Egypt corporate nets** |
| Cost at your scale | ~$0–50/mo (below) | ~$30–80/mo VMs *+ your ops time* + bandwidth |
| Data residency (your OD 27) | media transits a 3rd party | you control location |

At 50–1,000 users the **compute you'd save self‑hosting is dwarfed by the ops burden of running coturn + egress reliably**, and the money difference is roughly a wash. The only reasons to self‑host are the two Open Decisions you already flagged: **OD 27** (client voice recordings on a third party across Iraq/UAE/Egypt — a data‑residency/consent question) and **OD 28** (does TURN traverse the corporate networks). Those are *policy/compliance* deciders, not cost deciders. **Recommendation: start on LiveKit Cloud for the pilot; keep self‑host as the fallback if OD 27 forces residency.** LiveKit's API is identical either way, so this is not a lock‑in trap — you can move the same code to self‑hosted later.

**Auth / tokens:** meetings are metadata in Postgres; media auth is a **short‑lived LiveKit access token minted by your backend**. Flow: user clicks Join → `join-meeting` Edge Function checks tenant + meeting membership → signs a LiveKit token (room = `tenant_{tid}_{meetingid}`, identity = user id, grants = join/publish‑audio) with your LiveKit API secret → returns it → client connects to LiveKit with that token. The token is the isolation boundary (a user can only get a token for a room in their tenant), and it expires, so it can't be replayed.

**Recording → R2:** LiveKit Egress records a composite (audio‑only = cheap) and writes to **any S3‑compatible endpoint — R2 is explicitly supported** (`endpoint`, `force_path_style: true`). An egress webhook then writes the `recordings` row (service role). **R2 is the right store: $0.015/GB‑month and — the killer feature — zero egress fees**, so playback/download never costs bandwidth. (Audio‑only recording is ~$0.30/hr on Cloud egress + trivial R2 storage.)

**Future‑proofing:** video, screen‑share, larger rooms, and recording are all native LiveKit features — no re‑architecture. Audio‑first just means you enable the audio tracks now and turn on video later.

---

## 11. Cost model (realistic, not flattering)

Assumptions (deliberately *not* rosy): 40% of registered users online in a working hour; 6 h online/day; **30 chat messages/user/day**; **15 notifications/user/day**; presence beacon every 20 s while online; typing throttled to 1/3 s; **concurrent meetings = ~2% of users in a meeting at peak**, audio‑only, 30‑min average; **10% of meeting‑minutes recorded.**

Concurrent connections ≈ registered × 40%. Realtime messages/mo ≈ (chat fan‑out + notifications + presence + typing) × users × 22 workdays.

**Fixed vs usage split, per scenario (USD/month):**

| Users | Concurrent conns | Supabase (Pro base) | Supabase Realtime overage | LiveKit | R2 | **Total** | Dominant driver |
|---|---|---|---|---|---|---|---|
| **50** | ~20 | $25 (fixed) | $0 (under 500 conns / 5M msgs) | $0 (Build free ≤5k min) | ~$0 | **~$25** | fixed base only |
| **100** | ~40 | $25 | $0 | $0–50 (near Build cap → Ship) | ~$1 | **~$25–75** | LiveKit tier step |
| **500** | ~200 | $25 | ~$0–10 (approaching 5M msgs) | $50 (Ship) | ~$2 | **~$77–87** | LiveKit base + messages |
| **1,000** | ~400 | $25 | ~$10–25 (msgs >5M, conns <500) | $50 (Ship) | ~$5 | **~$90–105** | realtime **messages**, not connections |
| **5,000** | ~2,000 | $25 + must disable spend cap | ~$150–300 (conns 2k→ +$10/1k; msgs 20–40M → +$2.50/M) | $50–150 (Ship + WebRTC overage) | ~$20 | **~$250–500** | realtime **messages** ≫ connections |

Read that table against your fear: **at 1,000 users the realtime bill is ~$35–50/mo, and the thing driving it is message *volume* (chat fan‑out + presence + typing), not the number of connections.** Connections stay cheap on Supabase until ~500 concurrent (then +$10 per 1,000). This is the same axis that would cost you on DOs (per‑message request charge), so **switching to DOs does not dodge the actual cost driver** — it just moves the same message‑volume cost to a different vendor while adding ops.

For comparison, the **Architecture B (DO) realtime bill** at 1,000 users lands around **$5 (Workers) + a few dollars of DO requests/duration** — call it ~$10–15/mo — *below* Supabase's ~$35–50. So B is **~$25/mo cheaper at 1,000 users.** That's the whole prize. Ask yourself if a second backend + JWKS validation + your own reconnection/outbox/fan‑out is worth **$25/month.** At 5,000 users the gap widens to maybe $150–250/mo — *that's* when the DO conversation becomes real, and Phase 3 is where it belongs.

---

## 12. The cost killer (ranked — the actually‑useful answer)

What gets expensive first, in order:

1. **Realtime *message volume* — presence + typing fan‑out.** This is #1 by a wide margin and it's the sneaky one: every presence beacon and typing event is a message × every recipient. On Supabase it's metered messages; on DOs it's the per‑message request charge. **Mitigation is the same on any transport: throttle typing hard, beacon presence slowly (or use "last seen" from the DB instead of live presence), and never fan chat read‑receipts per message (use `last_read_seq`).** Get this wrong and it dominates everything below.
2. **LiveKit participant‑minutes** — a step function: $0 (Build) → $50 (Ship at 150k min). One all‑hands with 60 people for an hour = 3,600 participant‑minutes; a dozen of those a month is fine on Ship. Recording (transcode‑minutes) is a smaller second meter. Watch *concurrent* meeting minutes, not headcount.
3. **LiveKit bandwidth** (only if you enable **video**) — audio is trivial (~40 kbps); 720p video is ~1–2.5 Mbps × subscribers and blows past the included 250 GB fast. Audio‑first keeps this near zero; turning on video is the real cost cliff, not user count.
4. **Supabase concurrent connections** — only bites past ~500 concurrent (+$10/1,000). At 1,000 users (~400 concurrent) you're still under the included 500.
5. **Supabase egress** — realtime traffic + reads count toward 250 GB; comfortable until a few thousand active users.
6. **R2 storage / ops** — effectively a rounding error for audio recordings; **R2 egress is free**, which is exactly why it's the right recording store.
7. **DO duration (GB‑s)** — a *non‑issue* thanks to hibernation; if you ever adopt DOs, this is the one thing you *don't* pay much for. Their cost is the per‑message request charge (= driver #1 again).

**The one‑line takeaway:** your cost enemy is **chatty ephemeral events (presence/typing) and video bandwidth**, not connections and not your choice of socket vendor. Optimize those two and the transport choice barely moves the bill.

---

## 13. The architecture I'd actually deploy

### Component diagram
```
┌───────────────────────── Browser (React) ─────────────────────────┐
│  Supabase JS (Auth + Postgres + Realtime[Broadcast])   LiveKit JS  │
└──────┬───────────────────────────┬──────────────────────┬─────────┘
       │ HTTPS/WSS (one WS, JWT)    │ REST/RPC             │ WebRTC (only in a meeting)
       ▼                           ▼                      ▼
┌──────────────────┐   ┌────────────────────────┐   ┌──────────────────┐
│ Supabase Realtime│   │ Supabase Postgres (RLS) │   │  LiveKit Cloud   │
│  (Broadcast)     │◄──┤  source of truth        │   │  (SFU, audio)    │
│  tenant/conv/    │trg│  + Edge Functions:      │   │  room=tenant_{t} │
│  user topics     │   │  send-message,          │   └─────┬────────────┘
└──────────────────┘   │  create-notification,   │         │ egress webhook
                       │  join-meeting(token),   │         ▼
                       │  update-user, ...       │   ┌──────────────────┐
                       └─────────────────────────┘   │ Cloudflare R2     │
                                                      │ recordings (egress-free) │
                                                      └──────────────────┘
```

### Flows (compact)
- **Auth:** Supabase JWT (`tenant_id`, `app_role_id`) → `realtime.setAuth(jwt)` → RLS on `realtime.messages` authorizes topic joins. No custom token service.
- **Notification:** business txn INSERTs `notifications` → AFTER‑INSERT trigger `broadcast_changes(user topic)` → client nudge → reconcile unread by query. (Outbox = the trigger, in‑transaction.)
- **Chat:** `send-message` INSERT (seq via trigger) → broadcast to conv topic → recipients apply by seq/dedupe by id → offline users catch up on reconnect.
- **Reconnect:** client sends last_seq per topic → catch‑up query `seq > last_seq` → merge/dedupe → resume live. (Gap detection triggers a fill.)
- **Voice:** `join-meeting` checks membership → mints LiveKit token (room = `tenant_{tid}_{id}`) → client joins LiveKit → participant events update `meeting_participants`.
- **Recording:** LiveKit Egress (audio composite) → R2 (`force_path_style`) → egress webhook writes `recordings` row (service role).
- **Multitenant isolation:** `tenant_id` on every row + in every RLS policy; realtime topics prefixed `tenant:{tid}:` and join‑authorized against membership; LiveKit room names tenant‑scoped; tokens minted only after tenant/membership check.
- **Deployment:** Vercel (web) + Supabase (DB/Auth/Realtime/Functions) + LiveKit Cloud + R2. Zero servers you operate.

### Roadmap (avoiding premature complexity *and* dead‑ends)

**Phase 1 — 50‑user production (now → next module)**
- Chat + notifications on **Supabase Realtime Broadcast** (not Postgres Changes). Persist‑first, in‑transaction broadcast triggers. The §6 schema + §5 reconnection from day one (cheap to build, expensive to retrofit).
- Presence/typing **throttled hard** from the start (this is the forward‑compatible decision that matters most for cost).
- Voice on **LiveKit Cloud Build (free)**, audio‑only, tokens via `join-meeting`. Recordings to **R2**. ← gated by **OD 27/28** (draft the huddle spike first).
- **No Cloudflare Workers/DOs.** No self‑host.

**Phase 2 — 100–500 users**
- LiveKit **Ship ($50)** when you cross 5k participant‑minutes.
- Add web‑push for offline notifications (same trigger, slow lane).
- Move read‑receipts to `last_read_seq` if you prototyped per‑message. Watch the realtime **message** meter.
- Still no Cloudflare. Re‑evaluate presence cost; consider "last seen from DB" instead of live presence if it's a top‑3 line item.

**Phase 3 — 1,000+ / if a trigger fires**
- **Only then** consider moving the realtime transport off Supabase, and even then evaluate **Ably (Architecture E) before Durable Objects** — it gives you replay/ordering/reconnection managed, which is 80% of why DOs looked attractive.
- Adopt **Durable Objects** only if you specifically need: (a) >~8k concurrent sockets where Supabase message pricing hurts, **and/or** (b) multi‑region edge latency, **and/or** (c) server‑authoritative room logic Supabase can't express. Model it as **per‑conversation DOs + per‑user inbox DOs**, JWT verified against Supabase JWKS in the Worker, `outbox` table relayed via **Cloudflare Queues**. Keep Postgres as source of truth so the migration is transport‑only and your schema/reconnection code is unchanged.

**The forward‑compatibility guarantee:** because the DB is the source of truth and reconnection is DB‑reconciliation, **swapping the realtime transport in Phase 3 touches only the delivery layer** — the schema (§6), the RLS (§7), the event protocol (§4), and the reconnection logic (§5) are all transport‑agnostic. So Phase 1 on Supabase does **not** lock you out of DOs later; it just declines to pay for them early. That's the whole point: start simple, and the simple start is *not* a dead end.

---

## 14. Guaranteeing every message is delivered (the reliability spec)

**First, the honest framing a senior engineer owes you: you cannot guarantee exactly‑once *network delivery*. It's mathematically impossible over an unreliable network (the Two Generals problem).** Anyone who tells you their socket layer "guarantees delivery" is either wrong or is quietly doing what I'm about to describe. What you *can* guarantee — and what "reliable chat" actually means in production — is:

> **Every message that is accepted (persisted) is eventually delivered to every recipient, exactly once, in order — as long as the recipient's device eventually reconnects. Any message that was *not* persisted is surfaced to the sender as "failed," never silently lost.**

That guarantee lives in **Postgres**, not the socket. The socket is allowed to be lossy. You reach the guarantee by making both directions reconcile against the durable log. There are two paths, and most people only think about one.

### Direction 1 — the RECEIVE path (server → recipient) — covered in §5, restated as the guarantee
- Per‑conversation **monotonic `seq`**; recipient tracks **`last_seq`**.
- Live events applied **ordered by `seq`**, **deduped by `id`**.
- **Never trust the socket to have buffered anything.** On reconnect *or* on gap detection (`incoming seq > last_seq + 1`), the client pulls `messages where conversation_id=? and seq > last_seq` — a plain RLS‑protected read. That query *is* the delivery guarantee: every persisted message is eventually pulled, exactly once, in order.

### Direction 2 — the SEND path (sender → server) — the half people forget
This is the half that actually breaks "guaranteed delivery," because a message can die *before* it's ever persisted (Alice's network drops between tap and commit). The fix is a **client‑side outbox with idempotent retry**:

1. Client generates the message **`id` (ULID) locally** and renders it optimistically as **"sending."**
2. Client calls `send-message` and **retries with the *same* `id`** until it gets a persisted ack (exponential backoff; the message sits in a local IndexedDB outbox across reloads/offline).
3. Server does an **idempotent insert**:
   ```sql
   insert into messages (id, conversation_id, tenant_id, sender_id, body)
   values ($id, ...) on conflict (id) do nothing
   returning seq;
   -- if 0 rows (already inserted by a prior retry), SELECT the existing row's seq
   ```
   The client‑generated `id` as primary key makes **every retry idempotent** — a message delivered twice by a flaky network is persisted once.
4. Server returns the assigned **`seq` + server timestamp**; client marks the message **"sent"** and clears it from the outbox.
5. If the client never gets an ack (gave up after N retries / still offline), the message stays in the outbox marked **"failed — tap to retry."** Honest, not lost.

### Why this closes the trilemma
- **No lost messages** — persist‑first means a "sent" message is in Postgres; recipients reconcile from `last_seq`; a *never‑persisted* message is visibly "failed," never silently dropped.
- **No duplicates** — sender side: `on conflict (id) do nothing`; recipient side: dedupe by `id`. The transport can deliver twice; the system applies once. (Formally: transport is at‑most‑once + DB reconciliation makes it at‑least‑once + idempotency makes *apply* exactly‑once.)
- **No out‑of‑order** — apply by `seq`; a gap triggers a catch‑up fill *before* applying anything ahead of it.

### What you do NOT need (and shouldn't build)
- **Per‑recipient delivery ACKs.** You don't need Bob's client to ACK every message back to the server for the guarantee — Bob's own `last_seq` cursor already guarantees he reconciles everything. (Per‑recipient *read* receipts are a separate UX feature via `last_read_seq`, layered on top — not part of the delivery guarantee.)
- **A "reliable" socket layer.** The guarantee is a property of *persist‑first + idempotent send + cursor reconciliation*, and it is **identical on Supabase Broadcast, Durable Objects, Ably, or SpacetimeDB.** So — critically — **"I need guaranteed delivery" is not a reason to change transports.** It's a reason to build the outbox + cursor pattern, once, on whatever transport you pick. This is the single most important point in this whole document: reliability is an application‑layer property you own, not a feature you buy.

Presence and typing are explicitly **excluded** from the guarantee — they're ephemeral by design (§4). Guaranteeing "Alice is typing" is pointless; guaranteeing her *message* is the job.

---

## 15. SpacetimeDB — the evaluation I owe you (you were right to raise it)

I skipped it and shouldn't have — it's a serious, genuinely innovative system and its quickstart chat app is exactly the kind of thing that makes you think "why am I building cursors by hand?" So here's the real assessment, and then why it's still a **no for Maestro specifically** (not a no in general).

**What it is, and what it does beautifully.** SpacetimeDB is a *database and application server fused into one*: you write server logic as transactional **reducers** (Rust/C#) that run *inside* the DB, and clients **subscribe to SQL queries** and receive live row deltas over a persistent WebSocket, maintaining a local cache of the subscribed subset. For a **realtime‑native, greenfield** app — a game (its flagship is the BitCraft MMO), a collaborative editor — this is a legitimately elegant model that collapses "DB + backend + realtime + sync" into one thing. The chat example is real and it's slick. If you were starting Maestro from scratch as a realtime‑first product, SpacetimeDB would deserve a hard look.

**Why it's the wrong fit for Maestro — three structural disqualifiers, in priority order:**

1. **It is a *second source of truth*, and it cannot front your Postgres.** This is the killer. SpacetimeDB **owns its own storage** (in‑RAM + commit log); there is no first‑party path to run it as a sync layer over an external Postgres. So adopting it for chat means Maestro now has **two authoritative databases**: Postgres (tenants, users, bookings, RLS, audit, 30+ migrations, pgTAP) and SpacetimeDB (chat). A chat message references a user and often a booking — now those references cross a database boundary with **no transactional integrity between them**. This *re‑introduces the exact split‑brain problem* §8 and §9 were designed to eliminate. My entire recommendation is "one source of truth, realtime is a lossy hint on top" — SpacetimeDB asks you to move a slice of the truth *out* of Postgres. That's backwards for your app.

2. **License: BSL 1.1 — restrictive, and it fails your own rule (ADR‑0002).** SpacetimeDB is **Business Source License 1.1**, *source‑available, not permissive*. The free‑use grant is capped at **"no more than one SpacetimeDB instance in production"** and forbids using it as a **"Database Service."** Your standing policy is *permissive licenses only; no restrictive or paid dependency without explicit sign‑off* (ADR‑0002). BSL is precisely the category that policy excludes — HA/multi‑region beyond a single instance would need a commercial license, and it converts to AGPL only in 2031. **On licensing alone this is a hard stop under your own governance** without a deliberate ADR‑0002 exception.

3. **Immature multitenant isolation + operational gaps, for a system where a leak is catastrophic.** Its row‑level security is **explicitly experimental** (opt‑in `unstable` flag) with a **documented bug where RLS silently stopped enforcing** (GitHub #2854). Multitenant leakage is the one failure Maestro cannot have, and betting it on experimental RLS is not acceptable at a pilot, let alone at 1,000 users across tenants. Add: **no documented backup/PITR**, data is **RAM‑bound** ($10/GB‑month list storage because it's in memory), and the ecosystem/talent pool is a rounding error next to Postgres.

**And the twist on your actual question — reliability.** The reason SpacetimeDB looks attractive right now is that you want guaranteed delivery and its live‑query sync seems to hand it to you. But the research is clear that its **reconnect/offline behavior is "inconsistently implemented across SDKs,"** and it does **not document gap‑free delta replay after a disconnect** — the docs tell you to implement your own reconnection logic if reliability matters. So it does **not** actually give you the offline‑reconciliation guarantee for free at the one boundary you care about most. You'd be building §14's cursor/outbox pattern *anyway* — just against a BSL‑licensed, RAM‑bound, second source of truth with experimental tenant isolation.

**Verdict:** SpacetimeDB is the right tool when it gets to *be* the database. Maestro has already, deliberately, made Postgres the database — with tenancy, RLS, audit, and a body of ADRs that depend on it. Bolting SpacetimeDB on buys you a packaged version of a pattern you can implement on your existing stack (§14), at the cost of a second source of truth, a restrictive license, and immature isolation. **No for Maestro.** Keep the guarantee where it belongs — persist‑first + idempotent send + cursor reconciliation on Postgres — and you get SpacetimeDB's reliability property without any of its structural costs.

*(If you ever do want the "subscribe to a query, get live deltas" developer experience specifically, the lower‑risk way to get it on your stack is Supabase Realtime Broadcast‑from‑DB, or a managed pub/sub like Ably — both keep Postgres as the single source of truth, which SpacetimeDB by design does not.)*

---

## 16. Prior art — what to build on (license‑vetted for ADR‑0002)

A GitHub sweep, filtered to your permissive‑only rule. **BUILD‑UPON** = permissive (MIT/Apache/BSD/ISC) and directly usable; **GUIDANCE** = read it, don't vendor the code (restrictive/absent license, or partial fit); **SKIP** = flagged.

**Two findings that change the plan slightly (both good):**

1. **Supabase now has native "Broadcast Replay."** `supabase/realtime` (Apache‑2.0) ships a **reconnect catch‑up primitive for Broadcast** — the client can replay messages it missed during a disconnect, natively. This is exactly the reliability gap you pressed on in §14, and it means **less hand‑rolled catch‑up code**: you still keep Postgres as the source of truth and the DB reconciliation as the ultimate backstop, but Broadcast Replay handles the common short‑blip case for you. Read its docs before building the reconnection layer. *(This makes Architecture A's reliability story stronger than when I first wrote §5/§14.)*
2. **For notifications, don't hand‑roll the inbox — build on Novu.** Its core + `@novu/react` in‑app Inbox is MIT (only the `enterprise` packages are commercial). Saves you the notification‑center UI and state.

### Chat & notifications
| Build target | Repo | License | Use it for |
|---|---|---|---|
| **Chat transport/UI** | **Supabase UI "Realtime Chat"** (in `supabase/supabase`) | Apache‑2.0 / MIT | Closest match — it's **Broadcast‑based** and deliberately unpersisted, so you wire our persist‑first DB write + `seq` + idempotency `id` around it. **Fork this.** |
| **Schema + RLS baseline** | **`supabase/supabase` → slack‑clone** (`full-schema.sql`) | Apache‑2.0 | Copy‑safe reference for conversations/members/messages + RLS. (It uses postgres_changes; we swap the transport for Broadcast — keep the schema.) |
| **Reconnect/replay** | **`supabase/realtime`** (Broadcast Replay) | Apache‑2.0 | The native catch‑up primitive — read before hand‑rolling §5. |
| **Notification inbox** | **Novu** (`@novu/react`) | MIT (core) | In‑app notification center + realtime; skip the enterprise packages. |
| **Outbox / offline‑send patterns** | **Zero** (rocicorp/mono), **ElectricSQL**, **PowerSync‑js**, **RxDB** | Apache‑2.0 / MIT | Reference implementations of client outbox + idempotent send + reconcile (§14). Guidance, not dependencies. |
| **Ordering/merge (only if needed)** | **Yjs** | MIT | CRDT ordering — only if you add collaborative editing; overkill for plain chat. |

### Voice (LiveKit — all Apache‑2.0 unless noted)
| Build target | Repo | License | Use it for |
|---|---|---|---|
| **Meeting app scaffold** | **`livekit-examples/meet`** | Apache‑2.0 | Fork as the huddle app (join, mute, screen‑share, recording). |
| **UI components** | **`@livekit/components-react`** | Apache‑2.0 | Room/participant/controls UI — a dependency, not a fork. |
| **Token minting** | **`livekit-server-sdk`** (node‑sdks) | Apache‑2.0 | The `join-meeting` function mints tokens with this after a Supabase‑JWT check. |
| **Audio‑first UI patterns** | **`livekit-examples/agent-starter-react`** | MIT | Audio‑only frontend patterns. |
| **Recording → R2** | **`livekit/egress`** | Apache‑2.0 | Set the S3 output `endpoint` to R2; no fork needed. |
| **Full production reference** | **`suitenumerique/meet`** (French govt "La Suite") | MIT | Best end‑to‑end example (Django backend — read for patterns, not to copy into our stack). |
| **Self‑host (later)** | **`livekit/livekit-helm`** | Apache‑2.0 | Guidance if OD 27 forces self‑host; LiveKit's embedded TURN is the first lever before standalone coturn. |

### Alternative "pipes" (your Plan B, if Supabase ever isn't enough) — updates my earlier note
- **Centrifugo** (Apache‑2.0, ~10k★, active) — a mature, **permissive, self‑hostable** realtime server. **This is a better Plan‑B pipe than Ably for a permissive‑only shop** (I flagged Ably earlier; Centrifugo respects ADR‑0002 where Ably is a paid SaaS). Same §14 pattern sits on top.
- **PartyKit** (ISC) — only relevant if you ever go the Cloudflare route.
- **SKIP: Soketi** (AGPL‑3.0 + stalled). **Flag: PowerSync *server* is FSL** (source‑available, non‑permissive — clients are fine). **Flag: `dikshantrajput/supabase-multi-tenancy` and `anguzo/livekit-self-hosted` have no license** → read‑only, don't copy.

**Net effect on the recommendation:** unchanged in shape, but concretely de‑risked — you're forking the **official Supabase Broadcast chat component + slack‑clone schema**, layering our persist‑first + idempotency + Broadcast‑Replay on top, using **Novu** for the notification inbox, and forking **`livekit-examples/meet` + `livekit-server-sdk` + `livekit/egress`** for voice. Every one of those is MIT/Apache. The build is mostly assembly of permissive, maintained parts — not greenfield.

---

## Appendix — sources (verified 2026)
- Cloudflare Workers/DO/R2/Queues pricing & limits: developers.cloudflare.com (workers/platform/pricing, durable-objects/platform/pricing, /limits, best-practices/websockets, r2/pricing, queues/platform/pricing).
- Supabase pricing, realtime limits, postgres‑changes ceiling (~3,000 subscribers), broadcast benchmarks: supabase.com/pricing, supabase.com/docs/guides/realtime/{limits,pricing,postgres-changes,benchmarks}.
- LiveKit pricing, participant‑minute metering, egress/recording, R2 endpoint support, Opus bitrate: livekit.com/pricing, docs.livekit.io/home/cloud/billing, /home/egress/overview.
- SpacetimeDB architecture, BSL 1.1 license (single‑instance grant, Database‑Service restriction), experimental RLS (+ enforcement bug #2854), reconnect/SDK caveats, Maincloud metered pricing, chat quickstart: github.com/clockworklabs/SpacetimeDB/blob/master/LICENSE.txt, spacetimedb.com/docs/{intro/key-architecture,rls,clients/subscriptions/semantics,clients/connection}, spacetimedb.com/maincloud, spacetimedb.com/docs/tutorials/chat-app.
