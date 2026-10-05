# ADR-0116: The campaign wizard has no switches — phases are used when one is added, and every piece is in a workstream

- **Status:** accepted
- **Date:** 2026-09-27
- **Open Decision:** none
- **Task(s):** I60.1, I60.2 (supersedes ADR-0096 d.1's toggle and ADR-0101 d.9; narrows ADR-0099 d.1 for campaigns)

## Context

Step 1 of the campaign wizard carries two switches side by side: **Phases** (ADR-0096 d.1, *"Phases are
optional, per campaign — a toggle"*) and **Workstreams** (ADR-0101 d.9, *"Workstreams are a switch …
on by default"*). ADR-0099 d.1 made grouping optional: a piece may sit "Not in a workstream", and the grid,
the drawer and the move dialog all offer that.

The approved frame **CB-v3-01** shows neither switch. Its *The phases* card is a sentence and
**+ Add a phase** — nothing to turn on first.

Edward, 27 Sep:

> *"we need to remove the toggle so that the phases section displays as it does for figma frame CB-v3-01.
> if the user adds a phase this means phases are being used. The toggle for workstreams is not required,
> all campaigns will automatically use workstreams."*

Asked whether a piece could still sit outside every workstream (A, keep "Not in a workstream") or not (B),
he chose **B**: *"Single jobs is for one off pieces."*

Options weighed for the workstream rule: keep ungrouped pieces as a legal state (A, recommended — quicker
for one-offs), or require a workstream on every campaign piece (B, chosen — a one-off is a single job, so a
campaign's pieces are always grouped). For where B is enforced: in the screens and the wizard's write only,
or also as a table constraint. A table constraint would refuse every existing ungrouped campaign piece on
production and every single job (which is a campaign row, ADR-0083 d.3, and never grouped), so the rule is
held where campaign work is created and moved.

## Decision

1. **No Phases switch.** Step 1's *The phases* card is the frame's: a line of explanation and
   **+ Add a phase**. A campaign **uses phases when it has at least one**; removing the last one means it
   no longer does. `campaigns.has_phases` is written from that, never from a switch. Everything else in
   ADR-0096 stands (a phase has a start and an end; a piece due after its phase ends is warned and allowed;
   single jobs never have phases).
2. **No Workstreams switch.** Every campaign uses workstreams. The model is always asked for groups
   (ADR-0101), and the work step always shows them.
3. **Every piece of a campaign is in a workstream** (supersedes ADR-0099 d.1 for `kind = 'campaign'`).
   - The work step does not go on to timing while any kept piece is ungrouped, and says which.
   - "Not in a workstream" is no longer offered: not as a section of the work step, not in the piece dialog,
     not as a choice in *Move to workstream*.
   - After approval, a piece added on the campaign page names its workstream, and a move is between
     workstreams only.
   - `app.write_campaign_content` refuses a campaign piece with no `workstreamKey`, by name.
4. **Not retroactive.** Campaign pieces already ungrouped keep their state and their codes (`WS-…`); they
   can be moved into a workstream and not back out. Single jobs are untouched — they are never grouped.
   A single job promoted to a campaign (ADR-0086) passes the same work-step gate.

## Consequences

*Easier:* step 1 matches the frame; nobody decides up front whether a campaign "has phases"; every campaign
piece has a group, owner-list and code letters, so the open question of what an ungrouped piece is coded
(`I59.53`) no longer arises for new work.

*Harder:* a one-off piece inside a campaign must be given a workstream (or be a single job). The screens
that offered "Not in a workstream" change, and the browser tests that exercise ungrouped campaign pieces
must be brought to the rule.

*Locked in:* the rule lives in the wizard's write and the campaign page's add and move, not in a table
constraint, because single jobs and legacy campaign pieces are legitimately ungrouped.

*Cost:* one migration (the write's refusal; `has_phases` from the phases written); the wizard's step 1 and
work step; the campaign page's add-a-piece and move; pgTAP for the refusal; unit and browser tests brought
to the rule.

## Addendum 30 Sep: a promoted job gets a workstream (Edward, A — I68.16)

A single job's piece is in no workstream (d.3), and promotion used to leave it that way, so the campaign it became could not
take "Propose more" — found by the job-to-campaign walk. Edward chose A over asking for a workstream in the Promote dialog (B)
or leaving it (C): promotion now puts the job's ungrouped live pieces into one workstream per department, named after the
department and owned by the first piece's owner when that person is a lead (ADR-0101 d.8), with letters by the existing rule and
the pieces' codes kept. Campaigns promoted before this were grouped once by the same migration (`20260930130000`).
