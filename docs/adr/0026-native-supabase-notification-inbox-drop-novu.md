# ADR-0026: In-app notification inbox is native Supabase — drop Novu

- **Status:** accepted (Edward, 2026-08-18)
- **Date:** 2026-08-18
- **Supersedes (in part):** **ADR-0015** §4/§8 and `V1.6.6` (the "inbox UI built on Novu / `@novu/react`" choice) and **ADR-0024** §notifications / `I4.3` / `I5.2` (the "in-app (Novu)" wording). The **notification transport** those ADRs define is unchanged.
- **Relates to:** **ADR-0002** (permissive licenses only; no paid dependencies without authorization), **ADR-0015** (chat + notifications on Supabase Broadcast, persist-first), **ADR-0024** (Phase I — notifications I5). `docs/realtime-architecture-assessment.md` (the original Novu recommendation).
- **Task(s):** `I4.3`, `I5.1`, `I5.2`, `V1.6.6`, `V1.4.1`.

## Context

Novu appears in the plan (ADR-0015 §4/§8, ADR-0024, TASKS) but **nowhere in the code** — there is no `@novu/*` dependency in `package.json`, and nothing in `src/` or `supabase/`. It entered as a *convenience*: `docs/realtime-architecture-assessment.md` recommended `@novu/react` (MIT core) as ready-made prior art so we wouldn't hand-roll a notification centre, and ADR-0015 adopted that for the inbox **UI only**. It was never a transport or storage choice.

Revisiting it against **ADR-0002** (no paid dependencies without authorization): the npm SDK is MIT, so it passes the license gate — but **Novu-the-service is open-core freemium.** Using it means either **Novu Cloud** (free tier, then paid by volume) or **self-hosting** the OSS stack (Novu API + worker + **MongoDB + Redis**). Either way it adds an external dependency — a paid SaaS tier or a second datastore-heavy service to run — for what is, in our architecture, a **small table-backed inbox**.

Crucially, ADR-0015 already owns the hard part. Notifications are an in-transaction `notifications` row written in the same transaction as the state change, with an `AFTER INSERT` trigger calling `realtime.broadcast_changes()` on the recipient's inbox topic (persist-first; the reconcile query covers a missed broadcast). Novu was only going to render the list. Given that, Novu earns its keep only if hand-rolling the inbox UI is expensive — and a recipient-scoped list with an unread badge, live updates, and mark-read is not.

## Decision

**Drop Novu. Build the in-app inbox natively on Supabase, on the notification transport ADR-0015 already defines.**

1. **Transport & storage — unchanged (ADR-0015).** A business event inserts a `notifications` row in the same transaction as the state change; the `AFTER INSERT` trigger broadcasts to the recipient's inbox topic. Postgres is the source of truth; the client reconciles on reconnect. This ADR changes **only the inbox UI**, not the transport.
2. **Inbox UI is in-house.** A small React component in a `notifications` feature: a TanStack Query read of the caller's own `notifications` rows (RLS scopes to `recipient_user_id = auth.uid()` within tenant), a Realtime subscription to the recipient's inbox topic for live inserts (the ADR-0015 Broadcast channel), an **unread badge** backed by a partial index (`where read_at is null`), and a **mark-read** mutation (single + mark-all). Per-event-type rendering (assigned / review-requested / changes-requested / due-soon / blocked / signed-off) maps to a small icon+copy table.
3. **Email stays Resend, called directly.** ADR-0024 had Resend as "Novu's email provider"; instead the transition Edge Function / in-transaction path calls **Resend directly** (already configured). One fewer indirection.
4. **No new dependency or service.** Nothing added to `package.json` beyond what Supabase Realtime already provides; no MongoDB/Redis; no Novu Cloud account or paid tier. This keeps notifications entirely within the permissive/no-paid-dependency rule by construction (ADR-0002).

## Consequences

**Easier:** the stack stays Supabase-only — one datastore, one realtime layer, no vendor account, no freemium ceiling to watch, no second service to operate or secure; licensing is a non-issue; the inbox reads the same `notifications` table our triggers already write, so there's a single source of truth and nothing to sync to an external system.

**Harder / new:** we build and own the inbox UI — list, unread badge, mark-read, per-type rendering — rather than importing a component. This is modest (a feature folder + a hook + RLS + a partial index) and it's under our control and design system, but it is code we maintain instead of a dependency.

**Locked in (if accepted):** the in-app inbox is native Supabase (a recipient-scoped `notifications` table + Realtime inbox topic + in-house UI); Resend is called directly for email; **Novu is not part of the stack.** ADR-0015 §4/§8 and ADR-0024's notification wording are amended accordingly; the notification **transport** (in-transaction row + broadcast trigger, persist-first) is retained exactly as ADR-0015 specifies.

## Open — confirm with Edward

1. Confirm dropping Novu in favour of the native Supabase inbox (my recommendation).
2. Confirm **Resend is called directly** from the notification path (no third-party notification orchestrator).
3. Nothing else — transport is unchanged from ADR-0015; there is no code or dependency to remove, only plan/ADR wording to amend.

## Accepted (2026-08-18)

Edward: **drop Novu and call Resend directly.** Both open items confirmed as recommended. No code or dependency to remove (Novu was never wired in); the ADR-0015 notification transport is retained unchanged.

- **Bookkeeping applied:** row **0026** added to `docs/adr/README.md`; ADR-0015 and ADR-0024 headers annotated *superseded-in-part by 0026* (Novu → native inbox); `docs/TASKS.md` (`I4.3`, `I5.2`, and the notification banner lines) re-worded from "Novu inbox" to "native Supabase inbox"; `docs/realtime-architecture-assessment.md` Novu recommendation annotated superseded.
- **Proposed commit (git is Edward's):** `docs: ADR-0026 native Supabase notification inbox, drop Novu [I5]`
