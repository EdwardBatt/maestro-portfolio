# ADR-0130: A task or booking change reaches every open screen, through a tenant-private signal sent by a `security definer` trigger

- **Status:** accepted (Edward, 30 Sep)
- **Date:** 2026-09-30
- **Open Decision:** none
- **Relates to:** ADR-0105 (the Schedule and Team poll every 20 s); ADR-0037 d.6 (identity from the database); the notifications broadcast (`20260818140000`)
- **Task(s):** I67.2

## Context

Edward, 30 Sep: *"When a task is deleted my-work the schedule page need to be manually refreshed to update the
view, all related views should be reflected in real time."* The trace found two faults:

- **Your own change reached too few screens.** Deleting a task refreshed only the deliverables lists. Cancel,
  assign and re-open refreshed `['bookings']`, a key no screen reads.
- **Another person's change reached nobody.** The Schedule and Team polled every 20 seconds; every other screen
  waited for a reload.

The first fault is fixed in the browser. `invalidateTaskViews` refreshes every task and booking view, and 14
task mutations use it. The second needs the database to tell open screens that something changed.

AGENTS.md requires an ADR for any `security definer` function, and the signal needs one. Supabase Realtime keeps
its messages in `realtime.messages`, which has row-level security and no insert policy. A signal sent as the
signed-in person, who makes most task writes, is refused.

Options weighed:

- **(A) A `security definer` trigger sends the signal.** Chosen.
- **(B) Let signed-in users insert into `realtime.messages`.** Rejected: any browser could then broadcast on its
  own tenant's topic.
- **(C) Stream the table changes themselves (Postgres Changes).** Rejected: Realtime checks row-level security for
  every row, for every listener. On `sub_tasks`, whose policies read reach and grants, that is expensive. It also
  carries row data to the browser.
- **(D) Poll faster everywhere.** Rejected: not real time, and it multiplies reads.

## Decision

1. **Every change to `sub_tasks` or `bookings` sends one signal per statement per tenant** on the private topic
   `tenant:{tenant}:work`. Statement-level triggers read the transition tables, so approving a forty-task list
   sends one message, not forty.
2. **The signal carries no row data:** only the table and the operation (`{"table":"sub_tasks","op":"delete"}`).
   Each screen that hears it re-reads under its own row-level security, so the channel cannot show anyone what
   they may not read.
3. **The trigger function is `security definer`** (`app.tg_work_changed_broadcast`). It is safe because:
   - it takes no input from the caller (a trigger function cannot be called directly);
   - the topic is built from the changed rows' own `tenant_id`;
   - the payload is two fixed words;
   - its `search_path` is pinned.
4. **Only active members of the tenant may receive on the topic.** A select policy on `realtime.messages` checks
   the person's own profile row (ADR-0037 d.6). Another tenant's listener is refused.
5. **Sending is best effort.** A failed send is swallowed, as the notifications broadcast does. The rows are the
   truth, and the screens still reconcile through the 20-second polling and their own refreshes.
6. **The browser subscribes once per session** (`src/app/work-channel.ts`, mounted in `AppShell`). A burst of
   signals within 500 ms runs one refresh.

## Consequences

*Easier:* a task deleted, cancelled, assigned or moved by anyone shows on every open screen within about a
second.

*Harder:* every task and booking write now also sends a Realtime message. That is cheap at one per statement,
but it is load on the Realtime service that did not exist before.

*Locked in:* a second `security definer` path into `realtime.messages`, beside the notifications one.

*Known gap (local only):* on the local stack, Realtime rejects the new-style publishable key as a malformed token,
so neither this channel nor the existing notifications channel joins in the browser locally. The proof used the
local anon key and two signed-in clients: a delete by one reached the other, and a listener asking for another
tenant's topic was refused. Production uses its own keys; not yet tried there.

*Cost:* migration `20260930110000` (one function, six statement triggers, one policy); pgTAP 201 (10 tests; the
two receive checks skip in the CI harness, which has no Realtime); `src/lib/query/task-views.ts`;
`src/app/work-channel.ts`.
