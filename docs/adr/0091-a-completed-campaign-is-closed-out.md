# ADR-0091 — A completed campaign is closed out

**Status:** accepted (Edward, 13 Sep 2026)
**Tracker:** I48

## Context

`campaigns.status` is `draft | pending_approval | approved` (`20260827210000`). There is no terminal
state: once a campaign is approved it stays approved forever, so the campaigns list grows without
bound and a campaign whose work is all finished looks identical to one still in flight. ADR-0077
closes the *container* — a deliverable closes when its tasks are done — but nothing closes the
CAMPAIGN, and there is no action a person can take to say "this one is finished."

Edward, testing 13 Sep: *"Currently there is not close out procedure for a campaign when it is
completed."*

## Decision

- **d.1 — a campaign has a terminal `closed` status.** The check constraint gains `'closed'`
  (`draft | pending_approval | approved | closed`). No new table; the lifecycle the rest of the app
  already reads simply gains its end.
- **d.2 — close-out is a deliberate action, by the people who run the campaign.** A security-definer
  RPC `close_out_campaign(p_campaign)` authorised exactly as approval is (ADR-0073/0074:
  `projects:manage` within `in_write_scope` of the campaign, or its account manager / Traffic /
  Power Admin). No role is named.
- **d.3 — it is refused while work is unfinished, and the refusal says what is outstanding.** A
  campaign cannot be closed while any deliverable under it still has live work (a deliverable not yet
  `approved`/`delivered`/`archived`, or a sub-task that is neither `done`, `approved`, nor
  `cancelled`). The message names the count and the first blocker in plain words — it is a gate, not
  a warn-and-proceed, because "closed" is a claim that the work is done.
- **d.4 — it is reversible.** `reopen_campaign(p_campaign)` returns a closed campaign to `approved`,
  same authority. Closing is a statement, not a deletion; withdrawal and hard-delete remain I26,
  untouched.
- **d.5 — a closed campaign leaves the active list.** The campaigns list shows open campaigns by
  default with a filter/section for closed ones; a closed campaign stays fully readable. Closing
  touches nothing under the campaign — the work is already done, by d.3 — so no cascade.
- **d.6 — single jobs close the same way.** `kind = 'single_job'` is a campaign row (ADR-0083 d.3);
  the same RPC and the same gate apply.

## Consequences

One migration: the constraint change, `close_out_campaign` / `reopen_campaign`, and a paired pgTAP
suite (the gate refuses an open campaign naming the blocker; a manager in scope closes a finished
one; a team member cannot; reopen restores `approved`; cross-tenant refused). The campaigns list
gains a Close-out action in its Actions column and an open/closed filter. `campaigns.status` is read
in several places (the list badge, the status filter, RLS read scope) — all already switch on the
value, so `closed` flows through; the one deliberate change is the list's default filter.

## Not decided here

Withdrawal of an *unfinished* campaign and hard-delete while there is no history (I26) — a different
action with different authority. Whether a closed campaign's chat room is archived (ADR-0062 left
campaign rooms never archived; unchanged here). Automatic close-out when the last deliverable closes
— deliberately manual: a person states that the campaign is finished.
