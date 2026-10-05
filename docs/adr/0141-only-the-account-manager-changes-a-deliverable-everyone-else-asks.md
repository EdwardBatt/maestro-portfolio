# ADR-0141: Only the account manager changes a deliverable; everyone else asks through one form

- **Status:** accepted (Edward, 3 Oct) — records Edward's answers of 3 Oct
- **Date:** 2026-10-03
- **Open Decision:** none
- **Amends:** ADR-0132 d.2, d.3 and the 30 Sep addendum (the owner and the department's leads changed a piece directly)
- **Supersedes:** ADR-0088 d.1–d.10 (a task's deadline extended by a per-task request)
- **Task(s):** I74.13–I74.17

## Context

Edward, 3 Oct: *"confirm only the account manager can change the deliverable"* — and on asked dates: *"Any change
should use and call the one form..which can be called from two places. If the request is from a drag and drop..why
would the user ask twice?"*

Today the piece's owner, its department's leads, the account manager, the account director and Traffic all change a
deliverable directly — name, type, quantity, due date, channel, language, brief lines (ADR-0132 d.2–d.3, 30 Sep
addendum; `edit_piece_directly`, `change_deliverable_type`, `update_piece_details`). Separately, a task moved past its
own deadline offers ADR-0088's extension request, which Inas answers and which moves only that task's commitment.
Figma N draws a third thing: "Ask Inas to change it" on the piece (CP-06–CP-09).

A type change is not a date change: it cancels the old type's open tasks, frees their bookings and generates the new
list (ADR-0132 d.3), which waits for the owner when anyone else made it (d.4). That mechanism stays; only who may
trigger it changes.

| Question | Chosen | Rejected |
|---|---|---|
| Who changes a deliverable | **B: the account manager, with the account director, Traffic and the Power Admin as cover** | the account manager alone |
| One way to ask, or two | **One form, opened from two places — the piece, and a move past the due date (filled in)** | keep the per-task extension beside it |

## Decision

1. **The account manager changes a deliverable** — its name, type, quantity, due date, hours, channel, language and
   brief lines. The **account director, Traffic and the Power Admin** may too, as cover. The owner and the department's
   leads no longer change a deliverable directly.
2. **Everyone else asks through one form**, "Ask Inas to change it" (CP-06): what isn't right (hours, due date, format
   or size, language, quantity, the brief is missing something, something else), the new values, and why. It opens
   **from the piece**, and **from any move of a task past the piece's due date** — a drag on the Schedule or the Team
   page, or the task's Edit — already filled in with that date, so nobody asks twice.
3. **While it waits** the piece shows "Waiting on Inas", the booked tasks keep their dates, and the asker may withdraw
   (CP-07). **Unanswered after 4 working hours** it goes to the account director (ADR-0108's clock).
4. **Inas answers**: **accept** (the change applies, the assignees are told — CP-08), **change it** (her version
   applies), or **keep it as it is**, with her reason (CP-09). An accepted type or quantity change goes through the
   existing warn-first change (ADR-0132 d.3): the old open tasks cancelled, the new list waiting for the owner's
   approval (d.4).
5. **The per-task extension is retired into this form.** No new extension request is raised; one already pending is
   answered as today. A maker who needs more time asks her own lead (the Schedule's Asks, "Lujain wants Wednesday too" —
   SC-01); if the lead's yes runs past the piece's due date, it opens this form, filled in.
6. **The client asking for something different** keeps ADR-0110's change request and its revision round, now raised
   only by the account manager.

## Consequences

- **Easier:** one question per piece reaches the person who made the promise to the client; the promise cannot move
  without her.
- **Harder:** owners lose the direct date and type change they have had since 30 Sep; the three edit functions are
  re-gated; the extension dialog, its Needs-you card and its emails are retired or redirected; the specs that drive
  them are rewritten.
- **Locked in:** the deliverable belongs to the account manager. ADR-0088's `committed_due_at` stays as the task's
  commitment, moved now only by an accepted change.
