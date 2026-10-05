# ADR-0131: A deliverable's status follows its least advanced open task, in one set of words, with its numbers on hover

- **Status:** accepted (Edward, 30 Sep) — records Edward's answers of 30 Sep
- **Date:** 2026-09-30
- **Open Decision:** none
- **Amends:** ADR-0077 (the status words; "Done" for a finished task is kept) and ADR-0118 (a deliverable follows its tasks)
- **Task(s):** I67.3, I67.4

## Context

Edward, 30 Sep: *"Throughout the site status is inconsistent… status need to be consistent throughout the site…
Not Started, In Progress, In Review."* He then asked: *"how do we reflect the real progress of a deliverable when
some tasks are not started, some in progress and some in review?"*

Three problems:

- **The words differed.** The same status was written in several ways:

  | Status | Words in use |
  |---|---|
  | A task not yet started | "To do" and "Not started" |
  | A task in review | "Review" and "In review" |
  | A finished task | "Done" and "Approved" |
  | A finished deliverable | "Approved", "Complete" and "Finished" |
  | Work nobody is on | "Unassigned" and "Nobody on it" |
  | Work sent back | "Changes requested" and "Changes to fix" |
  | Work held up | "Waiting" and "Blocked" |

- **The rule overstated progress.** A deliverable read "In review" if any one task was in review, even with others
  not started. The rule lived in four copies: `work-phase.ts`, the dashboards' `figures.ts` (twice) and
  `views.tsx`.
- **The Team timeline's bars were coloured by workstream,** and its key listed workstreams, not status.

Edward's answers, one question at a time, 30 Sep. For the rule he chose A after seeing the mock
`Claude outputs/mocks/deliverable-progress.html`, and asked for a hover card with the numbers.

| Question | Chosen | Rejected |
|---|---|---|
| What colours a timeline bar | A: the task's status | B: Figma L3's key as drawn |
| A finished task | A: Done | B: Approved |
| A finished deliverable | A: Approved | Complete; Finished |
| How a deliverable's word is decided | A: follows the least advanced open task, with a bar and a hover card | B: most advanced task wins, plus the bar; C: bar only |
| Where the bar and card go | A: every row or card | B: only the Deliverables and campaign pages |
| Work nobody is on | A: Unassigned | B: Nobody on it |
| Work sent back | A: Changes requested | B: Changes to fix |
| Work held up | A: Blocked | B: Waiting; C: both, with different meanings |

## Decision

1. **A deliverable's word follows its least advanced open task:**
   - **Not started** while nothing has begun;
   - **In progress** once anything has begun, until every open task is in review;
   - **In review** only when all the open work is waiting on review;
   - **Approved** when signed off; **Blocked** when something it needs has not arrived.

   One rule, `src/lib/deliverables/work-phase.ts` (moved from the deliverables feature), read by every view,
   dashboards included.
2. **One set of words.**
   - Tasks: Not started · In progress · In review · Changes requested · Done · Cancelled.
   - Deliverables: Not started · In progress · In review · Approved · Delivered · Blocked.
   - Unassigned for work nobody is on.
   - Capitals stay where the Figma frames draw them; only the words changed.
3. **The numbers behind the word.**
   - Wherever a deliverable is a row or card, a bar shows its tasks by status (done, in review, in progress, not
     started) with "2 of 8 done".
   - The status pill opens a card on hover or keyboard focus: the status word, then one line per status that
     has tasks, "x of y – status" ("2 of 8 – Done", "1 of 8 – In review"…). Edward, 30 Sep, on the first cut:
     *"The hints repeat information e.g. 2 done 2 of 2 done… one line per applicable status."*
   - The season map's squares get the card only, and the dashboards' counts stay numbers.
4. **The Team timeline's bars take their task's status colour,** and the key is the status:
   - Not started · In progress · In review · Changes requested · Blocked · Unassigned · Done;
   - colours from L3 and L3c, plus plum for Changes requested;
   - a blocked bar says what it waits on;
   - the workstream becomes a filter only.
5. **Arabic:** one form each for delivered (مُسلَّم) and blocked (متوقف). A native speaker still has to check them
   (I18.8).

## Consequences

*Easier:* the word never claims more progress than the work has made, the numbers are one hover away, and every
view gives the same answer because they share one rule.

*Harder:* a deliverable with one task left not started reads "In progress" even when most of it is in review, so
anyone looking for work awaiting review needs the bar or the card. The campaign board's "Blocked" column now
shares its word with the maker's "I'm blocked".

*Locked in:* "Approved" is the word for a finished deliverable, and "Waiting" is retired as a status.

*Cost:* no migration. Changes to the rule and its tests, the locale files (EN and AR), a shared
`DeliverableProgress` component, and the views that show a deliverable's status.
