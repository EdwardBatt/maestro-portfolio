# ADR-0062: A conversation is readable by the people accountable for the work

- **Status:** accepted (Edward, 2026-08-31)
- **Date:** 2026-08-31
- **Open Decision:** — (raised by Edward, 31 Aug, testing `/deliverables`: *"there is a chat section
  that shows 'No messages yet'. This is there for some users, for other users it shows Chat isn't
  available here."*)
- **Supersedes:** **ADR-0046** (proposed, never built) — the same mechanism, but one membership rule
  for every anchor instead of a campaign branch and an ad-hoc branch.
- **Amends:** **ADR-0027 §2/§3** (campaign-room and item-thread membership).
- **Task(s):** `I15` (inherited from ADR-0046), new `I31`. Relates to ADR-0043
  (`sub_task_reviewers`), ADR-0050 (`deliverables.owner_user_id`), ADR-0036 (per-user grant
  overlay), ADR-0055 (the precedent for holding a job title as a *permission*, not a role name),
  ADR-0037 (the primitive runs on the caller-scoped client).

## Context

Contextual chat is built and CI-green (I4). In use it is close to unusable, and the reason is the
authorization gate rather than the panel.

### What the gate actually admits

`onCampaignTeam` (`supabase/functions/chat/index.ts:85`) returns true for exactly four kinds of
person: a holder of `project_tasks:manage`, a holder of `projects:manage`, the campaign's
`account_manager_id`, or someone with `assignee_id = uid` on a sub-task under the campaign.
Everything else gets `403 forbidden`.

Grep the function for `reviewer` or `sub_task_reviewers`: **no match.** A reviewer is not on the
team. The one surface where two people most need to talk — a review — is the one the gate refuses.

Measured against the live tenant's users (counts omitted from this public copy):

| | |
|---|---|
| Admitted by role grant alone | Power Admins, Department Leads, Team Leaders, Deputy Team Leaders, Account Managers, Traffic Manager |
| Refused | the **CEO**, the **CCO**, and **every Team Member** |

Team Members are the assignees and the reviewers. They see a thread only where they personally hold
an assigned task; everywhere else, an error. The CEO and CCO see none at all. That is the reported
symptom, and it is not intermittent — it is deterministic per person, per deliverable.

### Three further defects of the same family

1. **The assignee path walks only `streams`.** The membership query embeds
   `deliverables!inner(streams!inner(campaign_id))`, while `resolveCampaign` twelve lines above
   correctly follows **either** `stream_id` **or** `job_id`. So the function resolves a campaign
   through a job and then denies the assignee of that same work.
2. **Ad-hoc work 404s.** Ad-hoc deliverables hang off the `Ad-hoc assignments` job
   (`bb0d0d3a-…`), whose `campaign_id` is **NULL**. `resolveCampaign` returns null and `open()`
   answers `404 not_found`. This is ADR-0046's finding, re-confirmed in the live data.
3. **Ad-hoc work can reach the panel at all.** `DeliverablesPage.tsx:337` computes
   `isAdhoc={tab === 'adhoc'}` — a property of *which tab was clicked*, not of the deliverable. Any
   other route in (a deep link `?open=`, a notification link, the wrong tab) skips the ad-hoc early
   return, mounts `ChatPanel` on ad-hoc work, and lands on defect 2.

And every one of them renders the same sentence. `chat.unavailable` — *"Chat isn't available
here."* — is shown for 403, 404, 500 and a network failure alike, so a permission refusal, a
structural gap and a broken call are indistinguishable to the person looking at them. This is the
ADR-0061 family again: the system knows precisely what happened and says nothing useful.

### Nothing has been lost

Four `conversations` rows exist, all `context_type='deliverable'`, created lazily 29–30 Aug when
someone opened a campaign deliverable. **Zero messages have ever been sent. Zero campaign rooms
exist.** One conversation is orphaned — its deliverable was deleted on 29 Aug and there is no
cascade. The gate can therefore be rewritten without migrating any history.

### Why the accepted ADRs do not already cover this

ADR-0027 §2 says a campaign room is membered by *"the people assigned to the campaign's
deliverables/sub-tasks plus its leads and Account Manager"*, and §3 says item threads inherit that
membership. **"Its leads" was never implemented** — the built gate has no notion of a lead over the
people doing the work, only of a blanket `projects:manage` grant. So the implementation is narrower
than the accepted decision in one direction, and the accepted decision is narrower than what the
agency needs in another: neither admits reviewers, and neither admits oversight roles.

ADR-0046 proposed `contextMembers(ctx)` to fix the ad-hoc half and explicitly left campaign
membership *"unchanged"*. Since campaign membership is itself the defect, that ADR is superseded
rather than accepted.

### Edward's rule (31 Aug)

> *"All C SUITE users, Traffic Manager, Power Admin, Department Leads and Team Leaders for all
> assignees, all assignees and reviewers should have access to each chat."*

Two distinct entitlements sit inside that sentence, and they must be built differently. Oversight
roles get **every** conversation in the tenant. Leads get the conversations of **the people they are
accountable for** — which is a scope question, not a role question, and the project already has a
primitive for it.

### Why role names must not appear in code

`roles` is tenant data. ADR-0055 settled this precedent when the same question arose for
reassignment: *"held as a permission because `roles` is tenant data and another agency names that
job differently."* This tenant happens to call them CEO/COO/CFO/CCO and Traffic Manager; the next
one will not. The entitlement is therefore a **permission**, seeded to those roles here.

## Decision

1. **One membership function for every anchor.** `resolveCampaign` + `onCampaignTeam` are replaced
   by a single `contextMembers(ctxType, ctxId)` in `supabase/functions/_shared/`, which resolves an
   anchor to its **participants** and answers *may this caller read this conversation?* — never
   *does this have a campaign?*. `open()` returns `404` only when the anchor resolves to nothing at
   all (deleted, or another tenant), and `403` only when the caller is genuinely not entitled.

2. **A participant is a person named on the work.** For a `campaign` anchor, the participants of
   every deliverable beneath it; for a `deliverable`/`sub_task`/`review` anchor, the participants of
   that item. The set is: the **assignee** of any sub-task under the anchor · every appointed
   **reviewer** (`sub_task_reviewers`, ADR-0043 — not the dropped `sub_tasks.reviewer_id`) · the
   **assigner** (`sub_tasks.created_by`) · the deliverable's **owner** (`owner_user_id`, ADR-0050) ·
   the campaign's **account manager** where one exists.

3. **A lead reads the conversations of the people they are accountable for.** The caller is
   entitled if `app.in_write_scope(p.department_id, p.team_id, campaign.account_manager_id)` holds
   for **any** participant `p`. This is deliberately the existing accepted primitive and not a new
   one: it already encodes tenant / department / team / account scope, it already covers a
   department's teams, and it already inherits the **ADR-0036 per-user overlay** — so a Department
   Lead granted a second department in the Permissions editor gains those conversations with no
   further work. "Department Leads and Team Leaders for all assignees" is thereby expressed without
   naming a single role.

4. **Oversight is a permission, `chat:oversight`, and it makes its holder a FULL PARTICIPANT in
   every conversation *attached to work* — not merely a reader, and not every conversation.** A
   holder reads, posts, and adds people exactly as a participant does (d.6). **Edward, 31 Aug:**
   *"Oversight only readers are full participants in the chat, and as such can contribute to the
   conversations and add users as they deem fit — they are after all the management layer."* There
   is no observer tier: the management layer is in the room, not behind glass. A new
   `permission_catalog` entry, seeded to `power_admin`,
   `scheduler` (Traffic Manager) and the four C-suite roles (`ceo`, `coo`, `cfo`, `cco`). It is
   checked with `app.has_permission` on the **caller-scoped** client (ADR-0037 — the service-role
   client has no `auth.uid()` and would resolve every grant to false, which is the exact bug that
   migration fixed once already).

   **The fence is the point of this clause, and it is deliberate (Edward, 31 Aug).** The permission
   admits its holder to `campaign`, `deliverable`, `sub_task` and `review` anchors **only**. It
   confers nothing on a `dm` or `group` conversation — the two `kind` values ADR-0015 §6 has always
   carried and which no surface exposes today (the `chat` function's `CONTEXTS` list rejects them
   before anything else runs, so a private message is currently impossible to create).

   Written as *"every conversation"*, this permission would silently swallow private messages the
   day anyone builds them, and nobody would have decided that. Reading a discussion about a key
   visual is oversight; reading two colleagues' private exchange is surveillance, and the two must
   not be governed by one sentence. **Whether Maestro gains private messaging at all is left open
   and is a separate decision** — this clause only guarantees it can be taken freely when it comes,
   rather than having been pre-empted here.

5. **Derived membership is recomputed on every `open()`, never cached.** Ad-hoc and campaign
   membership both change legitimately — a reassignment (ADR-0039/0061), a reviewer added or removed
   (ADR-0043). A row in `conversation_members` written by that path stays a **join record for
   realtime topic authorization and the read cursor**, and is never the authorization itself.
   Carried from ADR-0046 d.3, narrowed by d.6 below.

6. **A work conversation can have people added to it explicitly (Edward, 31 Aug).** Derivation
   answers *who is obviously entitled*; it cannot answer *who else should be in this discussion* —
   the retoucher who is not assigned yet, the strategist who wrote the brief, the second opinion.
   Without this the only way to include someone is to assign them work they are not doing.

   - **A conversation's readers are therefore the union of** the derived set (d.2 · d.3), oversight
     (d.4, work anchors only), **and people explicitly added.**
   - **`conversation_members` gains `added_by uuid null`.** Null means the row was written by
     derivation and carries no entitlement of its own — it is the join record of d.5. Non-null means
     an explicit grant, server-stamped with the actor, following the `granted_by` precedent set by
     `user_grants` (L6.1). The two kinds of row are then distinguishable, which is what makes d.5
     and this clause able to coexist in one table.
   - **Who may add:** anyone entitled by **participation** (d.2), by **scope** (d.3), or by
     **oversight** (d.4) — that is, everyone with a standing claim on the work. The single
     exception is that a person who was themselves explicitly added may **not** add a third, so an
     invitation cannot fan out on its own: every membership traces back to somebody accountable for
     the work. If that proves too tight in use, it is one line to relax and should be relaxed
     deliberately rather than by drift.
   - **Who may be added:** any active in-tenant user. **Never `client_portal`** (d.9), and never
     across tenants (**M8**).
   - **Removal** is by the same people, and is a *revocation of the explicit grant only*. Removing
     someone who is derived-entitled achieves nothing, and the surface must say so rather than
     appearing to succeed — otherwise it reads as a way to exclude a reviewer from their own review.
   - **Adding somebody tells them**, in-app *and* by email, per the standing rule in `I30`: every
     action on a task reaches people by email, not only in-app. Being pulled into a discussion is
     exactly such an action, and `notify-email` needs copy for it in both languages.
   - **Both operations are Edge Function ops** (`add_member` / `remove_member`), never client
     writes — ADR-0015 §6 already requires this: *"authoritative writes (send message, create
     notification, add/remove members) go through Edge Functions"*. This is the first time that
     clause is implemented.
   - **Audited**, both directions, like every other grant in the project.

7. **Ad-hoc work has a thread, mounted from the deliverable it belongs to.** `isAdhoc` is derived
   from the **deliverable** (no stream, and its job carries no campaign), never from the open tab.
   Live ad-hoc work gets a composer; finished ad-hoc work (`approved`/`archived`) shows the thread
   read-only — a record, not a dead composer. Carried from ADR-0046 d.2.

8. **The surface distinguishes refusal from breakage.** `chat.unavailable` splits into at least
   *not entitled*, *nothing to talk about yet* (the anchor resolves to nobody) and *the call
   failed*. One string for four causes is what made this look random.

9. **The client portal is fenced, unchanged.** Chat stays internal-only; `client_portal` receives
   neither `chat:oversight` nor participant status, and cross-tenant threads remain deferred to
   **M8**. Chat membership is still not review authority — being in a thread never implies being
   able to approve (ADR-0043's no-self-review and `reviews:moderate` gates are untouched).

10. **Test surface, required before merge (`AGENTS.md` §7).** pgTAP: a non-participant outside scope
    is refused · assignee, reviewer, assigner and owner are each admitted · a **removed** reviewer
    loses access on the next `open()` · a Team Leader is admitted to their own team member's thread
    and refused another team's · a Department Lead reaches every team in their department · an
    overlay scope-grant admits exactly the granted department and no other · `chat:oversight`
    reaches a work-anchored thread its holder has no other connection to, **and may post in it and
    add a person to it** · **`chat:oversight` alone does NOT admit its holder to a `dm`/`group`
    conversation** · an **invited** member reads a thread they have no other claim on · an invited
    member **cannot invite** a third person · removing an invitation revokes access on the next
    `open()` · removing a *derived* participant's row does **not** revoke access · `client_portal`
    is refused everywhere and can never be invited · cross-tenant is refused. Plus the existing
    `020_chat_isolation` cases, unmodified.

## Consequences

**Easier.** Reviewers can talk to makers on the item under review, which is the point of the feature
and has been impossible since it shipped. Ad-hoc work — the majority of alpha work — gains a thread.
Leads see their own people's conversations without anyone administering a member list. An exception
becomes a grant in the Permissions editor rather than a code change.

**Harder.** `contextMembers` is a wider query than the one it replaces, and for a `campaign` anchor
it walks the whole hierarchy; it runs on every `open()`, so it wants an index-conscious
implementation and an `explain` before it ships. Two entitlement paths — participant-or-scope, and
oversight — mean two families of pgTAP rather than one.

**The cost, stated plainly.** `chat:oversight` gives **full participation in every work conversation
in the tenant**, including a two-person ad-hoc thread about somebody's own task — read, post, and
add whoever they think should be there. Six people hold it here. That is a deliberate management
choice and it belongs in writing rather than being discovered later by someone who assumed a thread
was theirs. **It is made visible rather than left implicit:** ADR-0063 d.8 requires every
conversation to show its members and the reason each one is there, management included, on the
conversation itself. Without that, a holder who only reads leaves no trace and the observer tier
this ADR declines to build exists anyway, unenforced and unannounced. With it, the transparency runs
both ways — which is the only version of this that is defensible to the people being read. What the
fence in d.4 buys
is that the cost stops at work: it does not quietly extend to private messages that do not exist
yet. **Edward's call, made knowingly, 31 Aug.**

**A second, smaller cost.** Explicit membership (d.6) is the first entitlement in chat that is
*stored* rather than derived, so it is the first that can go stale — a person added to a thread in
March is still in it in September unless somebody removes them. The `added_by` split keeps that
visible (an explicit row is legible as a decision someone made), and the no-onward-invitation rule
keeps it from spreading, but nothing expires it. Reviewing stale memberships is a surface concern,
deliberately out of scope here.

**Locked in.** Entitlement to a conversation is **derived from the work item and the caller's
scope, plus a named exception someone took responsibility for** — never a member list that is the
only record of why a person is there, and never a role name in code. Any future anchor (M8 joint
projects, a portal thread) must answer the same question the same way, which is what makes it
portable. Oversight is bounded to work anchors, so private messaging remains a free decision. If
someone later reintroduces a campaign-only assumption, the pgTAP in d.10 is what fails.

## Status note

**Accepted 31 Aug. Nothing is built yet.** `I31` implements:
`contextMembers` in `_shared` plus the `chat` function · the `chat:oversight` catalog entry and role
seeding, and `conversation_members.added_by` (one migration each, ADR-0033 `search_path` pinned) ·
the `add_member` / `remove_member` ops and their surface · `notify-email` copy for being added to a
conversation, EN and AR (`I30.2`) · the `isAdhoc` derivation fix · the split error surface · the
pgTAP in d.10. ADR-0046 flips to *superseded by 0062*; the index and task rows follow.
