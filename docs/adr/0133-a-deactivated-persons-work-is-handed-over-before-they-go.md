# ADR-0133: A deactivated person loses access at once, and their work is handed over before the deactivation completes

- **Status:** accepted (Edward, 30 Sep) — records Edward's answers of 30 Sep
- **Date:** 2026-09-30
- **Open Decision:** none
- **Amends:** ADR-0014 d.3 (a person leaves the bookable pool when the deactivation *completes*, not when it starts); adds a row to ADR-0108's escalations
- **Task(s):** I70

## Context

Edward, 30 Sep, before deactivating an account manager: *"what happens to her work and who is notified"*. The code answered: sign-in is
blocked, the calendar row is switched off, and nothing else happens.

- **Nothing is reassigned.** She stays the account manager on her clients and on their campaigns and jobs, and the owner and reviewer of
  whatever she held.
- **Nobody is told.** Approvals waiting on her wait on no one, and her Needs-you items are seen by nobody.

Escalations do skip inactive people and fall back to Traffic (E9), but that only catches what escalates.

Edward: *"when I deactivate a user, 1. They lose access, and 2. their dept lead is notified and given a list of all items that need to be
reassigned. Once that is complete… the complete deactivation is executed."*

**Live data, from the 26 Sep backup:**
- The five account managers are in **Client Services / Account Management**. The Account Director is Client Services' department lead.
- Content, Accounting, Influencers, and People & Culture have no lead yet. Their leads have not been invited.

Edward's answers, one at a time, 30 Sep:

| Question | Chosen | Rejected |
|---|---|---|
| Who gets the list | the department lead; where there is genuinely none, or the person *is* the lead, the Traffic Manager and the Power Admins | the Traffic Manager always as well |
| What happens to their open tasks | **B**: they stay assigned and are listed for the lead to hand on, one by one | A, back to unassigned at once; C, only unstarted work back |
| What the list holds | **A**: everything they hold, in six groups | only responsibilities; only tasks and reviews |
| How it finishes | **A**: automatically when the list is empty | the lead presses Complete; completing early |
| If the list sits unfinished | **A**: an escalation, like the others | a daily reminder; nothing |

## Decision

1. **Deactivation has two stages.**
   - **Leaving**, from the moment an admin deactivates the person: they **lose access at once**, because sign-in is blocked and a
     session already open ends at its next token refresh.
   - **Deactivated**, when the hand-over is done.

   While Leaving, they are **offered for no new work**: no picker, owner list or assignment offers them. What they already hold stays with
   them until it is handed on.
2. **The hand-over list goes to their department lead**, the holder of the department-scope lead role for the person's department. For
   Client Services, that is the Account Director. **Where there is genuinely no department lead, or the person leaving is the department
   lead,** the list goes to **the Traffic Manager and the Power Admins**.
   - It arrives as a Needs-you card, a bell notice and an email (EN and AR).
   - It opens a page listing every item, with the new person to choose for each.
3. **The list holds everything they hold that someone must take on,** in six groups. Only the groups that apply are shown.
   1. Clients they are account manager for.
   2. Campaigns and jobs they are account manager for, including a brief waiting on their approval.
   3. Deliverables they own, including a task list waiting on their approval.
   4. Workstreams they own.
   5. Open tasks assigned to them, with their future bookings.
   6. Reviews they are appointed to on open tasks.

   **Each item is handed to a named person**, offered by the rule that already governs that field (e.g. an owner list offers the
   department's leads, ADR-0128). Handing an item on is the same write as changing it on its own page, with the same notices to the new
   person. **Open tasks stay assigned to the leaving person until handed on**; they are not released automatically.
4. **The deactivation completes itself the moment the list is empty.**
   - The person leaves the bookable pool; their calendar row is switched off, as ADR-0014 d.3 did at once until now.
   - Their status reads Deactivated.
   - The lead and whoever started the deactivation are told: *"<name>'s deactivation is complete — 14 items handed over."*
5. **An unfinished hand-over escalates** (ADR-0108), through a new row, *Hand-over not finished*.
   - Its hours and recipients are tenant settings. The defaults are **24 hours**, to the **Traffic Manager and the Power Admins**, naming
     what is still waiting.
   - The clock is real time, like the other rows.
6. **Nothing held by the person is lost or rewritten.** Finished work, reviews given and history stay theirs on the record. The audit log
   records both stages and every hand-over.
7. **Reactivating a Leaving person** stops the hand-over: they regain access, and anything not yet handed on stays theirs. Reactivating a
   Deactivated person is as today.

## Consequences

*Easier:* no work is stranded with someone who has gone. The right lead gets one list, and the deactivation cannot complete over work
still held.

*Harder:* deactivation is no longer instant. A person with a long list stays Leaving until the list is done, and every place that offers
a person for work must leave Leaving people out.

*Locked in:* a person is never Deactivated while holding open work, clients, campaigns, deliverables or reviews.

*Cost:*
- **Database:** a leaving stage on the profile; the hand-over query (the six groups); the completion trigger; the new escalation row; and
  the notice types, with pgTAP for each.
- **`update-user`:** it starts the Leaving stage and no longer switches the resource off at once.
- **Front end:** the hand-over page, the Needs-you card, and Leaving people left out of pickers.
- **Emails:** EN and AR.

## Addendum — 30 Sep, `security definer` (AGENTS.md: an ADR is required)

**Accepted (Edward, 30 Sep).** Found building I70. Some functions act on **another person's** records, which the caller cannot
do under row-level security. So they run as their owner (`security definer`), and each one checks the caller itself:

- **`start_deactivation`** marks another person's profile Leaving and notifies the recipients. It requires `users:manage` in the
  caller's tenant, the grant `update-user` already checks.
- **`handover_items`, `leaving_people`, `record_handover` and `handover_item_holder`** read or record what a person holds across the
  tenant. They answer only a recipient of that person's hand-over, or a `users:manage` holder.
- **`complete_deactivation`, `complete_deactivation_if_done` and `complete_finished_handovers`** switch the person and their calendar row
  off, and notify. They act only on a Leaving person whose list is **empty**, so a call made too early does nothing.
- **The helpers `may_hand_over`, `handover_recipients` and `is_handover_recipient`, and the list readers,** compute who may act and
  what is held.

**`hand_over_item` is not `security definer`.** Each hand-over is the caller's own write, under their own row-level security and the
field's existing guards (d.3).

As built:
- **A person who is a lead goes to the Traffic Manager and the Power Admins** (d.2), even when their department has another lead.
- **A task handed to someone outside the caller's reach becomes a request** (ADR-0087) and stays on the list until it is answered.
- **The escalation sweep also completes any list** that was emptied from the items' own pages.
