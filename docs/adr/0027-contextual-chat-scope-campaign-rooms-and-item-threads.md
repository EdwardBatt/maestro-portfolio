# ADR-0027: Contextual chat scope — campaign rooms + work-item threads (conversation context anchor)

- **Status:** accepted (Edward, 2026-08-18)
- **Date:** 2026-08-18
- **Refines / amends:** **ADR-0015 §6** (the `conversations` schema gains a context anchor) and **ADR-0024 §6** (contextual chat is not only work-item threads — campaigns get a first-class room). Transport, reliability contract, RLS approach and cost discipline from ADR-0015 are **unchanged**; ADR-0026 (native inbox, Resend-direct) is unaffected.
- **Relates to:** ADR-0020 (campaign → stream → deliverable), ADR-0010 (sub-tasks), ADR-0025 (reviews), ADR-0008 (grant/RLS).
- **Task(s):** `I4.1`, `I4.2` (V1.6.1–6.5).

## Context

ADR-0015 specified the chat transport (Supabase Broadcast), the persist-first reliability contract, and a **generic** `conversations` schema — `kind in ('dm','group')` with a `title`, and **no link to any business entity**. ADR-0024 §6 then described Phase-I chat as "threads attached to deliverables / sub-tasks / reviews" plus a client-side "per-project channel" rollup. That left an unresolved question: **is a campaign a first-class chat room, or only a filtered view over work-item threads?**

Resolved with Edward (2026-08-18): **option A — a campaign gets its own group room *and* focused threads on individual work items.** Example: on campaign *Zeta Ramadan*, the account manager posts "client moved go-live to the 20th" in the campaign room (whole team sees it), while the designer and lead discuss "make the logo bigger" in a thread pinned to the *Hero Key Visual* deliverable. This is how agencies actually coordinate: a campaign channel for the team, plus discussion that stays next to the specific work.

The generic ADR-0015 schema can't express "which campaign / which deliverable a conversation belongs to," so this ADR adds the missing anchor and defines how context-scoped rooms are provisioned and secured.

## Decision

### 1. Conversations carry a context anchor
Add to `conversations` (amending ADR-0015 §6):

- `context_type text not null default 'group'` — one of `campaign` · `deliverable` · `sub_task` · `review` · `dm` · `group`.
- `context_id uuid` — the anchored entity's id (the `campaigns`/`deliverables`/`sub_tasks`/`media_records`-review id); `null` for plain `dm`/`group`.
- **Unique** `(tenant_id, context_type, context_id)` where `context_id is not null` — exactly **one** conversation per campaign and per work item (a partial unique index; DMs/ad-hoc groups are exempt).

The existing `kind` (`dm`/`group`) is retained for people-shaped conversations; `context_type`/`context_id` is the orthogonal "what this room is about." A campaign room is `kind='group', context_type='campaign', context_id=<campaign>`.

### 2. Campaign room — auto-provisioned, team-membered
A campaign's group room is **created on demand** (first open / first message) rather than eagerly for every campaign. Its `conversation_members` are the **campaign team** — the people assigned to the campaign's deliverables/sub-tasks plus its leads and Account Manager — kept in step as assignments change (added on assignment; removal deferred, low-risk internally). One room per campaign (§1 uniqueness).

### 3. Work-item threads — lazily created, membership inherited from the campaign
Each deliverable / sub-task / review has **at most one** thread (`context_type` = the item kind, `context_id` = its id), created lazily on first message. **Membership inherits the item's campaign team** — a member of the campaign may read and post in any of its item threads. (Rationale: internal review is already collaborative and reads are tenant-wide; gating item threads more tightly than the campaign room would fragment the conversation for no security gain in a single tenant. Tighter per-thread membership can come later if a real need appears.)

### 4. Rollup view
A campaign view surfaces the campaign room **and** a rolled-up list of its item threads (by walking `context_type/context_id` for the campaign's streams → deliverables → sub-tasks/reviews). This is presentation over the same rows — not a separate store.

### 5. Unchanged from ADR-0015 / ADR-0026
Transport (Broadcast, never Postgres Changes), persist-first + ULID + per-conversation `seq` + outbox + reconnect catch-up, Realtime Authorization (RLS on `realtime.messages`) gating topic joins by `conversation_members`, the notification inbox (native Supabase, ADR-0026), and the cost discipline (throttle typing/presence, `last_read_seq`, prefer DB "last seen" internally) all stand. Cross-tenant threads remain deferred to **M8**.

## Consequences

**Easier:** chat maps to how work is actually organised — one channel per campaign for coordination, focused threads on each deliverable/review — with a single schema addition (two columns + a partial unique index + membership provisioning) and no change to transport or the reliability contract. One conversation per context keeps threads canonical (no duplicate rooms for the same deliverable).

**Harder / new:** campaign-room membership must track the campaign team (an assignment-time sync); item-thread lazy creation needs a get-or-create on first message (race-safe via the unique index + `on conflict`); the rollup query walks the campaign hierarchy. All modest and contained in I4.

**Locked in (if built as specced):** `conversations` is context-anchored (`context_type`/`context_id`, one per entity); a campaign has a first-class room membered by its team; each deliverable/sub-task/review has at most one thread whose membership inherits the campaign; DMs/ad-hoc groups still supported via `kind`; everything else per ADR-0015/0026.

## Bookkeeping (applied in this change set; git is Edward's)

- Row **0027** added to `docs/adr/README.md`; **ADR-0015 §6** and **ADR-0024 §6** annotated *amended by 0027*; `docs/TASKS.md` `I4.1`/`I4.2` reference this ADR; `chat-notifications-model` memory note updated.
- Proposed commit: `docs: ADR-0027 contextual chat scope — campaign rooms + work-item threads [I4]`
