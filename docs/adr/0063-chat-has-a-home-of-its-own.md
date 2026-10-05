# ADR-0063: Chat has a home of its own, and it lists work rather than conversations

- **Status:** accepted (Edward, 2026-08-31)
- **Date:** 2026-08-31
- **Open Decision:** — (raised by Edward, 31 Aug: *"there should be a dedicated chat panel, with
  campaign level chats listed with sub-chats on deliverables... is that a sensible layout?"*)
- **Extends:** **ADR-0027 §4** (the rollup view), which decided this shape but scoped it to a
  campaign page. Depends on **ADR-0062** for who may see what.
- **Task(s):** new `I32`. Relates to ADR-0015 (transport, `last_read_seq`), ADR-0026 (the
  notification inbox, the nearest existing surface), ADR-0058 (the sub-task is the unit of work),
  ADR-0059 (the manual-review thread), ADR-0057/0025 (anchored review comments).

## Context

Chat today has no home. It appears as a panel at the foot of a deliverable and nowhere else, so a
conversation is reachable only by remembering which deliverable it was attached to and navigating
back to it. There is no way to see that somebody wrote to you, no unread count, and no list.

Edward's proposal — a dedicated panel listing campaign-level chats with deliverable sub-chats
beneath — is the right shape, and it is not a new idea: **ADR-0027 §4 already decided it**
(*"a campaign view surfaces the campaign room and a rolled-up list of its item threads … this is
presentation over the same rows — not a separate store"*). What was never decided is that the
rollup gets its **own** surface rather than living inside a campaign page. That is the decision
here, plus the three things the naive version of it gets wrong.

### Three things the obvious implementation gets wrong

**1. A list of conversations is nearly empty.** A conversation is created lazily on first `open()`.
In the live tenant that means **four rows and zero messages** after a month. A chat surface that
lists `conversations` would show four deliverables and no campaigns, which reads as a broken screen
rather than an empty one. The list must be built from **the work the caller is entitled to talk
about**, not from the rows that happen to exist.

**2. Ad-hoc work has no campaign, so a strictly campaign-first tree hides it.** Ad-hoc is the
majority of alpha work. A tree rooted only in campaigns repeats the exact failure ADR-0062 is fixing
— the thing exists, and the surface cannot reach it.

**3. A third message box on a task is one too many.** A sub-task already carries two surfaces:
anchored review comments on a version (pins and timecodes, ADR-0025/0057) and the manual-review
thread between maker and reviewer (`TaskReviewThread`, ADR-0059 d.9). Both are `review_feedback`,
both are part of the review record, and both are round-scoped. Adding a general chat thread at
sub-task level would give one task three places to type, with different retention and different
meaning, and no signal about which to use. `context_type='sub_task'` stays **permitted by the schema
and unused by the product**, exactly as it is today.

## Decision

1. **Chat gets its own route, `/chat`**, in the main navigation with an unread badge, alongside the
   notification inbox rather than inside it — an inbox is a list of events that happened to you, a
   chat surface is a list of places you can speak.

   **The reference layout is Discord's three-column shape** (Edward, 31 Aug), which the decisions
   below already describe piece by piece: a **left rail** of groups and the channels inside them
   (campaigns and their deliverable threads, d.3), a **centre pane** of messages, and a **right
   pane** listing who is in the room, grouped by why they are there (d.8). Unread reads the way it
   does there too — the channel emboldens, the group carries a count (d.5). It is a good reference
   because it is the widely-understood answer to *many rooms, nested, with a visible membership*,
   which is exactly this problem.

   **What is deliberately NOT taken from it:** a campaign is not a server you join or leave —
   membership is derived from the work (ADR-0062), never self-service; there is no `@everyone`, no
   voice, no reactions-as-a-feature-set, no server discovery, and no social surface. The resemblance
   is structural, and stops at structure. Maestro's own visual language (skill: `maestro-design`)
   governs type, colour, density and RTL — the layout is borrowed, the look is not.

2. **The list is built from entitled work, not from existing conversations.** The left rail is
   assembled from the anchors `contextMembers` (ADR-0062) admits the caller to, and a row is shown
   whether or not a `conversations` row exists yet. Opening a row does what the panel does today:
   get-or-create, then join. Lazy creation from ADR-0027 §2 is therefore **kept** — nothing is
   provisioned eagerly, and no empty rooms accumulate for campaigns nobody discusses.

3. **Two tiers, and a third top-level group for work that has no campaign.**
   - **Campaign** → its **deliverable** threads beneath it.
   - **Ad-hoc** → a flat list of ad-hoc deliverable threads.
   Sub-task threads are **not** surfaced (see Context 3). Two tiers is the whole hierarchy.

4. **The in-context panel stays exactly where it is.** The panel at the foot of a deliverable and
   the row in `/chat` are the **same conversation**, not a copy — ADR-0027 §4's *presentation over
   the same rows* is binding. A person reading a deliverable should not have to leave it to reply.

5. **Ordering is unread first, then most recent.** `conversation_members.last_read_seq` against the
   conversation's max `seq` gives the unread count; `conversations.last_message_at` — already
   maintained by the trigger added in `20260818120000`, and commented *"keep hot for inbox sort"* —
   gives the tiebreak. A row with no conversation yet sorts last and shows no count.

6. **A conversation does not outlive its anchor.** One of the four live conversations points at a
   deliverable deleted on 29 Aug; there is no cascade, and the row is unreachable and permanent. The
   anchor gains `on delete cascade`, and the existing orphan is deleted in the same migration.

7. **The rail shows threads you were added to, including ones you would not otherwise reach.**
   ADR-0062 d.6 lets a participant add someone explicitly, so a person can hold exactly one thread
   under a campaign they have no other claim on. The grouping must render that campaign as a header
   with only the threads they may see beneath it — never the whole campaign, and never an orphan row
   with no context. The people currently in a conversation, and the control to add or remove one,
   live on the conversation itself (both surfaces, d.4), not in a separate admin screen.

8. **Every conversation shows who is in it, and why (Edward, 31 Aug).** The member list is
   **visible on the conversation itself, not behind a menu**, on both surfaces (d.4). It is the
   answer to *who can read what I am about to write*, and a person is entitled to that answer before
   they write, not after.

   - **The list is computed, not stored.** It is `contextMembers` (ADR-0062 d.1) materialised rather
     than merely tested, so it reflects the entitlement rules exactly. If the list and the gate ever
     disagree, the list is wrong and it is a bug — there is only one source.
   - **Each person carries the reason they are there:** the assignee · a reviewer · the assigner ·
     the owner · the account manager · *a lead over this work* (ADR-0062 d.3) · *management*
     (`chat:oversight`, d.4) · or **added by <name>** (d.6). Without the reason the list answers the
     wrong question — "who is here" is far less useful than "why is the CFO here", and the reasons
     are what makes ADR-0062's rules legible to the people they apply to instead of folklore.
   - **This is what closes the lurking gap.** ADR-0062 declines to build an observer tier, but a
     manager who only reads leaves no trace, so one exists in practice. Making membership visible by
     default is the honest fix: nobody is hidden, and nobody has to be told they are being watched
     because they can see it.
   - **Read receipts are NOT part of this.** `last_read_seq` exists and would make "who has seen
     this" trivial, and it is deliberately left out — visible *entitlement* is transparency, visible
     *reading* is monitoring, and they are not the same feature. Deferred, and to be decided on its
     own terms if ever.

9. **Deferred, explicitly:** typing indicators and presence, read receipts (d.8), the offline
   outbox, search across conversations, reviewing memberships that have gone stale (ADR-0062
   Consequences), and cross-tenant threads (**M8**). This ADR is a list, a hierarchy, a member
   control, a member list and an unread count.

10. **Private messaging is not in scope and is not implied.** `kind` has carried `dm` and `group`
   since ADR-0015 §6, and the `chat` function has never accepted either — so no private message can
   exist today. Whether Maestro should have them is a **separate, open decision**, kept genuinely
   open by ADR-0062 d.4's fence on `chat:oversight`. Nothing in this ADR should be read as the first
   half of building them.

## Consequences

**Easier.** Chat becomes discoverable — the first time it will be possible to see that somebody
wrote to you without opening the deliverable they wrote on. Because the rail is built from entitled
work, it also doubles as an honest picture of what ADR-0062 admits you to, which makes an
authorization mistake visible rather than silent.

**Harder.** The rail is a hierarchy query per user over campaigns → deliverables, filtered by
entitlement, and it is not the same query as "conversations I am a member of" — it is more work and
it must be paginated once a tenant has real volume. Unread counts against rows that may not exist
need care not to produce a phantom badge.

**The judgement recorded, so it can be revisited deliberately.** Two tiers is a decision to keep the
task's existing review surfaces as the only place task-level conversation happens. If people start
using deliverable threads to discuss one specific task, that is the signal to reconsider — and the
fix would be to enrich the review thread, not to add a third box.

**Locked in.** One store, several presentations. A conversation is anchored to a work item and
reachable from both the item and the list; the product surfaces two anchor tiers while the schema
keeps supporting more.

## Status note

**Accepted 31 Aug. Nothing is built yet.** `I32`, and it should follow `I31` (ADR-0062) rather than
run beside it: a list of conversations the caller cannot open is not worth building first.
