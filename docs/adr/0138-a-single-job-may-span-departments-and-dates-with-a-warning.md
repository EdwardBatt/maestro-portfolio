# ADR-0138: A single job may hold pieces for several departments and dates — with a warning — and the brief suggests them

- **Status:** accepted (Edward, 2 Oct) — records Edward's answers of 2 Oct
- **Date:** 2026-10-02
- **Open Decision:** none
- **Amends:** ADR-0083 d.18 (a single job's further deliverables shared ONE department, owner and due date)
- **Task(s):** I73.3

## Context

Edward, 2 Oct: *"in both the single job and campaign brief, the ai is not proposing deliverables"*. Traced (I73.3):
the campaign wizard asks `generate-deliverables` and shows its proposal (verified locally), but nobody has started a
campaign on production since the 26 Sep rework — every one of the six new pieces of work was a single job, and the
single job has never asked the model for its deliverables. Edward chose C: confirm the campaign on production, and
give the single job the suggestion.

A brief often implies pieces for more than one department ("two posts and a 15-second video"). ADR-0083 d.18 (27 Sep)
held further deliverables to the job's one department, owner and date. Edward's answers, one at a time:

| Question | Chosen | Rejected |
|---|---|---|
| A brief implying several departments' pieces | **Relax the rule:** allow them all, warn that it should be a campaign | suggest only the first department's; refuse until removed; suggest only the first piece |
| Who owns each piece | **A:** its own owner, from its own department | one owner for every piece |
| Due dates | **B:** each piece its own date, defaulting to the job's — again with a warning | one date for the job |

## Decision

1. **The single job asks the brief what to make.** On reaching "Who and when" with nothing chosen yet, the brief's
   words go to `generate-deliverables` (ADR-0097: the catalogue only). The first suggestion fills the job's own
   deliverable; any others become further pieces. Each is marked as suggested, every value stays editable, and the
   outcome is always stated — suggested, nothing suggested, or could not suggest — never a silent blank.
2. **A further piece may belong to another department.** It carries its own department and owner, offered from
   that department's leads as everywhere else (ADR-0128); its department follows its owner (ADR-0102), and that owner
   approves its task list, as on a campaign.
3. **A further piece may have its own due date,** defaulting to the job's.
4. **Either one is warned, never refused:** "Pieces for more than one department, or on different dates — this
   reads like a campaign." The job can still be sent.
5. Nothing changes in the database: `complete_campaign_draft` already takes each piece's owner and date.

## Consequences

Easier: the single job — what people actually start — gets the brief's help; mixed work is not forced into a campaign.
Harder: a single job no longer guarantees one owner and one date; screens that described "the job's owner" mean its
first piece's. The warning is the guard against single jobs quietly becoming campaigns.
