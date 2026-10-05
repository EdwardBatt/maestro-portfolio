# ADR-0142: A re-opened task goes back to the person who made it; a client amendment is counted

- **Status:** accepted (Edward, 3 Oct) — records Edward's answers of 3 Oct
- **Date:** 2026-10-03
- **Open Decision:** none
- **Supersedes:** ADR-0121 d.1–d.2 (a re-opened task went back with nobody on it)
- **Amends:** ADR-0103 d.2 (the reason gains a kind)
- **Task(s):** I74.18–I74.20

## Context

Figma L's Block time (SC-22) offers "Amend on delivered work": hours booked against a client and a delivered piece, and
on the fourth amend of a month Inas is "asked to add amends to the campaign". Nothing counts amends today, and there is
no allowance; the only route for a fix on delivered work is re-opening the task (ADR-0103), which since 27 Sep sends it
back with nobody on it (ADR-0121).

Edward, 3 Oct: *"None of the options track the amendments visibly. The task should be reopened and tracked as client
amendments. Once we implement the client portal and client flow we can redefine the process."* And on who does it:
*"Of course A. It is up to the team lead to reassign."* — and for every re-open: *"Reopen reopens of the original
assignee."*

| Question | Chosen | Rejected |
|---|---|---|
| How an amend is recorded | **Re-open the task, tracked as a client amendment** | block time with a count; block time with a monthly allowance; re-open with nothing counted |
| Who gets it | **A: the person who made it; the team lead may reassign** | the same person only if free; unassigned |

## Decision

1. **A client amendment re-opens the delivered piece's task** (ADR-0103's route: a reason and a new date required),
   marked **Client amendment**. The piece goes back to in progress and closes again when the task is approved.
2. **Every re-opened task goes back to the person who made it** — a client amendment or not — with the same
   reviewers, the reason and the new date, and is booked on their week as any assignment is (warnings, never a block).
   The team lead may give it to someone else. This reverses ADR-0121 d.1–d.2 (27 Sep); d.3 (reviewers stay and are
   told) stands, and the maker is now told too.
3. **It is counted and shown**: the piece carries its amendment count ("Amend 2"); the campaign and the client show
   their amendments and hours for the month; the account manager sees them. No allowance and no limit — that is
   redefined with the client portal (M10).
4. **Block time offers Leave and Internal work only**; "Amend on delivered work" is removed from it.

## Consequences

- **Easier:** amends are visible where the client's work is, against the person who made it.
- **Harder:** a re-open now carries a kind; the count needs a read per piece, campaign and client.
- **Locked in:** an amend is a task on the piece, not loose time; the allowance waits for the portal.
