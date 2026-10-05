# ADR-0104: A promoted job asks for its campaign brief; a single job's brief is edited by hand

- **Status:** accepted (Edward, 25 Sep — built on `running-it`)
- **Date:** 2026-09-25
- **Open Decision:** none
- **Task(s):** `I57.40`, `I57.41`
- **Amends:** ADR-0100 (a campaign has one brief) · I53.20 (a promoted job keeps its words)

## Context

ADR-0100 retired department briefs on campaigns: a campaign has **one** brief, and after approval
each piece's owner approves its task list. Two places still behave as if department briefs were
alive:

- **Promotion** (`promote_single_job`, last in `20260923110000`) re-opens the job's one
  department brief and **empties** it, "so the department writes its own brief for the campaign"
  (ADR-0072 d.6). Nothing asks for that brief any more, so it leaves an unapproved, empty legacy
  row behind (`I57.41`, found by the job-to-campaign walk). It also copies the job's words into the
  campaign brief's background and task — seven of the campaign brief's nine fields stay empty.
- **A single job's brief** is locked once the job is released, and the only way back was a
  **Re-open** that no screen offers (`BriefApproval` is rendered with `canApprove={false}`) —
  dead code (`I57.40`).

Edward, 25 Sep: *"the department briefs are no longer required, promotion to campaign requires a
new campaign brief to be generated. Any legacy dept briefs remain read only"*; and of the dead
Re-open: *"there should be the option to update the brief… manually"*.

## Decision

**d.1 — Promotion leaves the job's department brief alone.** It is not re-opened, not emptied and
not deleted; it stays approved and read-only, as every legacy department brief is (ADR-0100). Its
values stay available to the campaign under `promotedJobBrief`, as now.

**d.2 — A promoted campaign asks for its brief.** After promotion the campaign's Brief view opens
with **Generate the campaign brief**: the model fills the campaign brief's fields from the job's
words and the job's brief (the same reading the wizard's step 2 does from a file), and the account
manager reads, edits and saves it. **Edit the brief** stays beside it for writing it by hand. Until
it is saved, the Brief view says what is missing — the existing "N fields are empty" panel — and
nothing is blocked: the job's work carries on, and Propose more is offered once the brief has a
proposition.

**d.3 — A single job's brief is edited by hand after release.** The dead Re-open and its confirm
are removed. In their place a single job's released brief has **Edit**, for the same people who may
edit a released campaign's brief (the campaign's approval authority, I53.4). Saving it changes the
words, never the deliverable, its tasks or its dates; the edit is audited.

**d.4 — Legacy department briefs stay read-only.** No screen writes one; no function re-opens one.

## Consequences

- **Easier:** a promoted campaign starts with a real brief, not two fields and an empty legacy row;
  a single job's brief can be corrected after release without a back door.
- **Harder:** promotion is now two steps for the account manager — promote, then generate (or
  write) the brief. The Brief view says so the moment the page opens.
- **Locked in:** the campaign brief is the only brief a campaign has; a department brief is never
  written again.
- **Cost:** one migration (promotion), the Generate action on the Brief view (the ingest function
  already reads free text), a single job's Edit, and their tests. No licence or money dimension.
