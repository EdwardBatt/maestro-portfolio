# ADR-0137: A live campaign or job is renamed on its page by its approval authority

- **Status:** accepted (Edward, 2 Oct, A)
- **Date:** 2026-10-02
- **Open Decision:** none
- **Amends:** ADR-0067 (a name could change only while a draft)
- **Task(s):** I73.2

## Context

Edward, 2 Oct: *"Is there any way to change the campaign name?"* Traced: only while a draft — the wizard's
name field through `update_campaign_draft`, which refuses anything else. A live campaign's header was
read-only. And the "drafts only" rule lived in that RPC alone: a PATCH of `campaigns.name` by anyone
holding `projects:manage` went through at any status, unseen.

Options put: **A** — rename on the campaign page, by the campaign's account manager and whoever may approve
it (the people who already edit a live brief, I53.4); **B** — a Power Admin only; **C** — no rename once
sent, and the database refuses it. Edward chose **A**.

## Decision

1. **A live campaign or single job is renamed on its page** — a pencil beside the name opens "Rename".
2. **Who:** its approval authority — `app.is_campaign_authority`: its account manager, Traffic, an Account
   Director, a Power Admin. Others are refused in words.
3. **A closed one is reopened first; a draft's name stays the wizard's** (ADR-0067).
4. **The rule is held in Postgres** (`campaign_name_guard`, before update of name), so `rename_campaign`
   and a direct PATCH are governed identically (ADR-0037) — closing the gap above.
5. **The name is trimmed; an empty one is refused; a look-alike is refused** by ADR-0135's index, in the
   wizard's words. **The campaign's Library folder follows** (`campaign_folder_follows_name`).

## Consequences

Easier: a mistyped name is corrected where it is seen; the Library follows. Harder: nothing new to run;
`app.tg_campaign_name_guard` is `security definer` like the brief's guard, reading only the campaign row.
Locked in: names change only by the campaign's approval authority once it is live; never while closed.
