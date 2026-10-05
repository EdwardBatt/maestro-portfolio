# ADR-0113: Until chat works, people ask, nudge and push back by notification and email, and what asks for action chimes

- **Status:** accepted (Edward, 25 Sep — on `running-it`)
- **Date:** 2026-09-25
- **Open Decision:** none
- **Task(s):** `I59.25`, `I59.26`, `I59.28`, `I59.40`
- **Amends:** ADR-0027 (contextual chat) — its item threads are not the carrier for these, for now

## Context

The v3 Figma has short messages between people about a piece: the AM's **Nudge Fadia**, the lead's
**Chase Abeer**, the maker's **Ask Inas something**, the lead's *"Something missing? Ask Inas before you
assign it"*, and the maker's **Tell Fadia it is too much**. ADR-0027 gives every deliverable a chat
thread, the natural carrier. Edward, 25 Sep: *"The chat is not fully functional or real time at the
moment… this needs real work to fix. At the moment nudge and chase need to be notifications and
email… also note we need an alert sound when notifications are received."* A question must name who
it goes to — *"the user has to be able to select who to send the question to"* — and be answerable.

## Decision

**d.1 — A nudge is a notification and an email** to a named person about a piece, recorded against
the piece. It stops no clock.

**d.2 — A question is a notification and an email to people the asker picks** — anyone, the piece's
people listed first, its account manager pre-selected. The recipient **replies** from the
notification; the reply returns the same way; questions and replies are listed on the piece.

**d.3 — "Too much"** is a notification, an email and a Needs-you item to whoever assigned the task,
with the maker's week and an optional note; answered **Rebalance** (the Schedule, filtered) or **Keep
it with her** (the maker told). The task stays assigned.

**d.4 — Notifications that ask for action play a short chime** in any open Maestro tab; each person
has an on/off switch by the bell, stored on their device, on by default. Information-only
notifications stay silent.

**d.5 — Chat is not the carrier until it is fixed** (`I59.40`). When it is, these messages may move
into the piece's thread; the records made here stay.

## Consequences

Easier: every ask is on the record with the piece, reaches the person at once and by email, and can
be answered, without depending on chat.

Harder: one small record for questions and replies (tenant-scoped, RLS, audited), new notification
types in both languages, and a sound that browsers play only after the person has clicked on the page.

Locked in: nothing that needs an answer is lost in a chat that does not work; the chime means someone
needs you.
