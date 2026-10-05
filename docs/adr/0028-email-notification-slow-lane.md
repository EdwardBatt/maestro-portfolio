# ADR-0028: Email notifications are a per-event, high-signal slow lane (Resend, pg_net-triggered)

- **Status:** accepted (Edward, 2026-08-18)
- **Date:** 2026-08-18
- **Relates to:** **ADR-0026** (native Supabase inbox; "email stays Resend, called directly"), **ADR-0024** (`I5.2` — in-app + email from day one), **ADR-0015** (persist-first; Postgres is the source of truth, the second channel is best-effort), **ADR-0002** (permissive/no-paid-dependency — Resend is a paid SaaS the tenant already pays for; the API client is `fetch`, no SDK).
- **Task(s):** `I5.2` (email lane), `I5c`, `V1.4.1`.

## Context

ADR-0026 settled *that* email is sent (Resend, called directly) but not *how often*, *on which events*, or *by what mechanism*. The in-app inbox (I5b) is already live and instant: the bell lights up the moment a `notifications` row is written. Email is the **second channel** — its only job is to reach a recipient who is **not looking at the app**. So the design question is purely one of eagerness and cost, not correctness: a missed email is never a lost notification, because the row persists and the inbox shows it (ADR-0015).

Two things had to be decided:

1. **Cadence** — how eagerly email fires relative to the inbox. Options considered: (a) per-event on high-signal types only; (b) per-event on *all* types incl. `due_soon`; (c) a batched digest on a schedule; (d) "only when the recipient is away" (suppress if they've seen the inbox recently).
2. **Trigger mechanism** — what turns a new `notifications` row into an outbound email, given the row is written **inside** the business transaction by `SECURITY DEFINER` emission triggers (ADR-0024/I5a), and migrations must stay **CI-clean** (plain Postgres, no Supabase-only extensions).

Cost discipline (the standing constraint for chat + notifications): email volume, like realtime message volume, is the cost driver — so the cadence must track **real work events**, not timers or every state tick.

## Decision

**Email is a per-event, high-signal slow lane, fired by a guarded `pg_net` trigger that invokes a `notify-email` Edge Function, which sends via Resend directly.**

### 1. Cadence — per-event, high-signal only (Edward, option a)
Email fires immediately, one per recipient, for the high-signal types: **`assigned`, `review_requested`, `changes_requested`, `signed_off`, `blocked`**. It does **not** email `due_soon` — deadline reminders are inherently a digest concern (nobody wants an email per approaching deadline) and the scheduled sweep that would emit them isn't built (no `pg_cron` yet). The actor is already excluded upstream (the emission triggers never notify `auth.uid()`), so the email lane inherits actor-exclusion for free.

Rejected: **all types** (noisiest/costliest for the least-loved emails — `due_soon` repeats as a deadline nears); **digest** (needs a scheduler we don't have, and can't demonstrate an email landing in an end-to-end test *now*); **away-only** (humane and cheap, but needs presence/last-seen tracking). Per-event-high-signal is the smallest reliable thing that lets the loop be tested end to end, and **digest and away-only are clean upgrades on top of it, not rewrites** — the email lane can later consult a "last_seen" or defer to a batch without changing the emission side.

### 2. No opt-out yet (Edward)
Every recipient gets email per the cadence above; there is **no per-user or per-type email preference** in this slice. A single on/off toggle (and later per-type) is a deliberate follow-up (`I5-follow`), not part of I5c. Documented as a known gap so it isn't mistaken for "done."

### 3. Trigger mechanism — guarded `pg_net` → `notify-email` Edge Function
An `AFTER INSERT` trigger on `notifications` (`app.tg_notification_email`, FOR EACH ROW) skips `due_soon`, then **best-effort** `net.http_post`s the notification `id` to the `notify-email` function. This mirrors the notification **broadcast** trigger's shape exactly (best-effort, wrapped in a swallowing `EXCEPTION` block) and the realtime-authorization migrations' **guard** pattern: if `net.http_post` is absent (plain Postgres / CI) the trigger returns cleanly and the insert still commits — so the row persists and the migration is a no-op in CI. `pg_net` is async (it queues and the background worker sends **after commit**), so the business transaction is never blocked or slowed, and the row is committed and visible by the time the function reads it.

The function URL and the bearer used to call it are read from **Vault** (`vault.decrypted_secrets`), not hardcoded in migration source — the same store Supabase's own Database Webhooks use. This is one **one-time bootstrap** (two `vault.create_secret` calls) documented in the runbook below; everything else is versioned migration + a versioned function. We chose this over a **dashboard Database Webhook** so the whole lane — which types email, actor exclusion, the guard — lives in versioned SQL and a reviewed function, not in unversioned dashboard config.

### 4. `notify-email` Edge Function — Resend direct, idempotent, localized
Runs as **service role**. Given `{ id }` it: loads the `notifications` row (skips if missing or `due_soon`); resolves the **recipient email** (`auth.users`) + **display name & locale** (`user_profiles`) and the **actor name**; renders subject + body from a compact **bilingual (en/ar) copy map** keyed by `type` in the **recipient's own locale**; builds a deep link mirroring the inbox (`deliverable → /deliverables?open=…`, `campaign → /campaigns/…`, `sub_task/other → /my-work`); and `POST`s to `https://api.resend.com/emails` with `Authorization: Bearer RESEND_API_KEY` and **`Idempotency-Key: <notification id>`** so a retried trigger/webhook never double-sends. A Resend failure is logged and swallowed (the row is the source of truth). No Resend SDK — plain `fetch` (ADR-0002).

## Consequences

**Easier:** the loop is testable end to end today — a real email lands seconds after a state change, with the app closed. Cost tracks real work events, not timers or per-tick state. The lane is entirely in versioned SQL + one function (no dashboard config to drift), and it's CI-clean by the same guard the realtime work already uses. Actor-exclusion and recipient-scoping are inherited from the emission side, so there's nothing new to get wrong there.

**Harder / new:** a one-time Vault bootstrap on the hosted project (two secrets) and three function env vars (`RESEND_API_KEY`, `NOTIFY_EMAIL_FROM`, `APP_BASE_URL`) — captured in the runbook. Email copy is a small map maintained in the function (not the app's i18n bundle), so a new notification type needs a copy entry in two places (inbox i18n + email map); acceptable for six types.

**Known gaps (deliberate, tracked):** no email opt-out yet (`I5-follow`); `due_soon` email deferred with its scheduled sweep (no `pg_cron`); away-only suppression and digest are future upgrades the lane is shaped to accept without an emission-side change.

**Locked in (if accepted):** email is a best-effort per-event slow lane on the five high-signal types, actor-excluded, fired by a guarded `pg_net` trigger into a service-role `notify-email` function that sends via Resend directly with the notification id as idempotency key, localized to the recipient. Postgres remains the source of truth; email never gates correctness.

## Runbook — one-time bootstrap (hosted project only; git/secrets are Edward's)

1. **Vault** (SQL, once): `select vault.create_secret('https://<ref>.supabase.co', 'project_url');` and `select vault.create_secret('<service_role_key>', 'notify_email_bearer');`
2. **Function env** (once): set `RESEND_API_KEY`, `NOTIFY_EMAIL_FROM` (e.g. `Maestro <notifications@your-domain>`), `APP_BASE_URL` (e.g. `https://app.…`). `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform.
3. **Deploy:** `supabase functions deploy notify-email`.
4. CI needs none of the above — the trigger guard no-ops when `net.http_post`/Vault are absent.

## Accepted (2026-08-18)

Edward: **cadence = per-event, high-signal only (option 1); no opt-out yet.** Trigger mechanism (guarded `pg_net` → `notify-email`, Resend direct, idempotent, localized) accepted as recommended.

- **Bookkeeping applied:** row **0028** added to `docs/adr/README.md`; `docs/TASKS.md` `I5.2` re-worded to name the per-event high-signal cadence + the no-opt-out gap; follow-up `I5-follow` (email preferences) noted.
- **Proposed commit (git is Edward's):** `feat(notifications): email slow lane — guarded pg_net → notify-email (Resend) [I5c]`

## Addendum — 22 Sep, recording 17 and 21 Sep: who each mail is for, and what it says

**The words are not here.** Edward decided every notification one action at a time on 17 Sep —
recipient, then the exact sentence, with real names, days and what is now required of the reader —
and the record is `docs/reference/notification-email-copy.md`, *Decided one action at a time*
(Actions 1–15; `I52.8`; migration `20260917110000`; `notify-email` rewritten around a
fact-gathering step; pgTAP 125; `coverage/notification-mails.spec.ts`). This addendum records the
DECISIONS that amend earlier ADRs, so the ADRs and the reference cannot disagree; the reference
holds the sentences.

**Standing rule (Edward, 17 Sep):** every message says *who* it is for, *what* happened and *what
is now required of them*; the actor is never told about their own act; nobody is told by role
where a named person exists.

**Decisions that amend other ADRs.**

- **ADR-0070 d.6 — an approval tells the deliverable OWNERS only** (Action 1): not department leads
  by role, not reviewers. `brief_awaiting_approval` is retired — a brief never exists at approval
  time (ADR-0072). **21 Sep (`I53.19`):** ONE mail per owner, on the campaign — *"Approved: <campaign>
  — you own N deliverables"* — listing each of theirs on its own line with its **phase and due
  date**, then what to do (`20260921110000`, `20260921150000`; pgTAP 136). Not one per deliverable:
  the Design lead had four identical mails on the 21 Sep walk.
- **ADR-0096 d.7 (the mail names the phase)** — kept, in that list rather than the facts line.
- **ADR-0087 d.6 / ADR-0088 d.9 / ADR-0089 d.9** — the booking request, the extension and the
  last optional reviewer's answer each carry their facts (person, days, hours; dates and reason;
  who answered how) read at send time from the request row, `sla_events` and `sub_task_reviewers`
  (Actions 9–11).
- **ADR-0069 d.4 (dependency ready)** names the task that was approved; to the deliverable's owner
  when nobody is assigned (Action 6b).
- **`blocked` is removed** — nothing ever raised it (ADR-0069 replaced it with a named input).
- **Two types added:** `deliverable_owner_removed` (the old owner, Action 2) and
  `task_reassigned_away` (the person work was taken from, Action 3b); `feedback_requested` for an
  optional reviewer (Action 4).
- **A deliverable added to a released campaign tells its new owner, and nobody else** (Action 16,
  `I53.18`, 21 Sep, `20260921100000`): *"Added to <campaign>: <deliverable>"*. The other owners on the
  campaign hear only about changes to their own deliverables — which also **drops ADR-0086 d.7's
  one-line notice** to them when a request is attached (`20260921140000`).
- **The person's remembered language decides the mail's language** (`I53.21`, 21 Sep): the same
  profile setting the screens read.

**Why recorded here.** ADR-0028 is the lane; the recipients and words live with it so a new
type is added in one place with its constraint entry, its EN and AR copy and its inbox strings —
`src/test/notification-copy.test.ts` holds the three together.
