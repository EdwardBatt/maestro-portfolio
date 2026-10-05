# ADR-0046: Ad-hoc work has no campaign, so its chat authorizes on its people

- **Status:** **superseded by [ADR-0062](0062-a-conversation-is-readable-by-the-people-accountable-for-the-work.md)** (2026-08-31) — never built. Its `contextMembers` mechanism, its ad-hoc participant set (assignee ∪ reviewers ∪ assigner) and its per-`open()` recomputation are all carried forward. What changed: this ADR left campaign membership *"unchanged"*, and campaign membership turned out to be the larger defect — it admitted no reviewers, walked only `streams`, and locked out the CEO, the CCO and every Team Member. ADR-0062 therefore replaces the campaign/ad-hoc branch with **one membership rule for every anchor**.
- **Date:** 2026-08-27
- **Open Decision:** — (raised by Edward, 27 Aug — "opened an ad-hoc task and there is no chat window")
- **Task(s):** I15 (new). Relates to ADR-0027 (contextual chat scope), ADR-0015/0026 (transport +
  inbox), ADR-0042 d.6 (the assigner + account-manager pair — the membership precedent), ADR-0043
  (`sub_task_reviewers` — reviewers are now a set), ADR-0034/0035 (ad-hoc work is a task / a
  reviewable deliverable), and ADR-0023/`I11.4` (Library filing, the *sibling* campaign-null gap —
  see §Non-goals).

## Context

Contextual chat shipped and is CI-green (I4), but it is reachable **only on campaign-anchored work**,
and checking the code says why — this is a real capability gap, not a rendering bug.

- **Frontend.** `DeliverableDetail` (`src/features/deliverables/DeliverablesPage.tsx`) has two return
  paths. The campaign-deliverable path renders `<ChatPanel contextType="deliverable" …>` (line ~464).
  The **ad-hoc path** (`if (isAdhoc)`, ~304–317) renders only `ReviewPanel` + `TaskResources` and
  **omits `ChatPanel` on purpose.**
- **Backend.** Even if it were mounted, the `chat` Edge Function `open()` calls `resolveCampaign()`,
  which walks `deliverable → stream/job → campaign`. An ad-hoc deliverable has `stream_id = null` and
  no `job_id` campaign, so `resolveCampaign()` returns `null` and `open()` replies
  `404 "Context has no owning campaign"`. Membership (`onCampaignTeam`) is likewise a campaign-team
  query. So chat is campaign-shaped end to end: no campaign → no thread, and the frontend omission is
  the *correct* response to that (a permanently "unavailable" panel would be worse).

The omission was defensible when ad-hoc work was a fringe. It no longer is. ADR-0034 made every
scheduler assignment a task and ADR-0035 made ad-hoc work a first-class reviewable deliverable with
its own review loop; ADR-0042 gave it resources and ADR-0043 gave it several reviewers. Ad-hoc work
now has an assignee, reviewers, an assigner and a due date — everything except the one thing chat
keys on. During the alpha there are **zero campaigns in the data**, so today chat surfaces *nowhere*,
which is how the gap was noticed.

### The people are knowable without a campaign

Chat authorization asks one question — *is the caller entitled to this thread?* — and for ad-hoc work
the answer does not need a campaign. The relevant people are already named on the work item:

- the **assignee** (`sub_tasks.assignee_id`),
- the **reviewer(s)** (`sub_task_reviewers`, ADR-0043 — a set now, some mandatory),
- the **assigner** (`sub_tasks.created_by`) and the owning **manager** — the same
  *assigner + account-manager* pair ADR-0042 d.6 already sends a resource clash to, and the same pair
  ADR-0045 escalates a stall to. Using a third, different ladder here would be a contradiction to
  maintain.

So the fix is not "invent a fake campaign for ad-hoc work" (that would corrupt `resolveCampaign`, the
campaign KPI rollups, and the Library lookup). It is to recognise that **membership is a property of
the work item, and a campaign is only one way to compute it.**

## Decision

1. **Split the resolver from the membership.** `resolveCampaign` + `onCampaignTeam` become one
   `contextMembers(ctxType, ctxId)` that returns the set of user ids entitled to a context, computed
   from the anchor:
   - **campaign / campaign-anchored deliverable·sub_task·review** — unchanged: the campaign team
     (manager grants, the AM, anyone assigned under the campaign). Existing behaviour, existing tests.
   - **ad-hoc deliverable·sub_task·review** (no owning campaign) — the assignee ∪ the task's
     `sub_task_reviewers` ∪ `created_by` (assigner) ∪ the owning PM / account manager of the "Ad-hoc"
     internal job (ADR-0029/0035). No campaign required.
   `open()` authorizes on membership of that set and 404s only when the context truly resolves to
   nobody (a deleted or cross-tenant item), never merely because there is no campaign.

2. **Mount the panel on ad-hoc work.** The ad-hoc branch of `DeliverableDetail` renders
   `<ChatPanel contextType="deliverable" contextId={deliverableId} />` for **live** ad-hoc work.
   **Finished** ad-hoc work (`approved`/`archived`) keeps the review chain read-only as today and
   shows the thread history read-only — a record, not a dead composer.

3. **Membership is recomputed at `open()`, every call.** It is already service-role and cheap, and
   ad-hoc membership legitimately changes — a reassignment (ADR-0039), a reviewer added/removed
   (ADR-0043). No membership is cached into `conversation_members` and trusted forever; the upsert
   there stays a *join record*, not the authorization.

4. **No self-review, no leakage rules are touched.** Chat membership ≠ review authority; a person can
   be in the thread and not a reviewer. Tenant isolation and the client-portal fence are unchanged —
   ad-hoc threads are internal-only, exactly like campaign threads (cross-tenant stays → M8).

## Non-goals

- **Library filing (`I11.4`) is *not* solved here.** It shares the root — `deliver_deliverable_version`'s
  `coalesce(stream.campaign_id, job.campaign_id)` is null for ad-hoc work — but filing is a
  storage-tree decision (give the "Ad-hoc" job its own folder tree, or a tenant "Ad-hoc / Unplanned"
  folder), separate from who may talk on a thread. This ADR scopes **chat only**; `I11.4` keeps its
  own entry and stays not-required-for-UAT. Flagging the shared root so both are fixed with one mental
  model when the time comes.
- **Typing/presence, offline outbox, cross-tenant threads** remain deferred (ADR-0015/0027), for
  ad-hoc exactly as for campaign work.

## Consequences

- Ad-hoc tasks — a growing majority of alpha work — gain a working thread, and chat stops being
  invisible while there are no campaigns. The assignee, reviewers and assigner can talk *on the task*
  instead of out-of-band.
- Chat authorization is no longer campaign-only; "who is in this thread" is now answered by the work
  item, which is the more durable model and the one every later anchor (M8 joint projects) will need.
- A small cost: `contextMembers` is a slightly larger query with a branch, and it must stay in step
  with reassignment/reviewer changes — mitigated by recomputing per `open()` rather than caching.
- Test surface: new pgTAP for ad-hoc conversation isolation (a non-member is refused; assignee,
  reviewer and assigner are admitted; a removed reviewer loses access on the next open) alongside the
  existing `020_chat_isolation` campaign cases.
- Locks in that contextual membership is derived from the work item. If a future change reintroduces a
  campaign-only assumption in chat, that CI/pgTAP set is what catches it.

## Status note

**Proposed — awaiting Edward's decision.** Nothing is built. On acceptance: `I15` implements
`contextMembers` in `_shared` + the `chat` function, mounts the panel on the ad-hoc branch, adds the
pgTAP, and this ADR flips to `accepted` with the index/OD-gate/task updates.
