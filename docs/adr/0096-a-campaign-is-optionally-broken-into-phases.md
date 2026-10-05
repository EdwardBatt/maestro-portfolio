# ADR-0096: A campaign is optionally broken into phases, and every deliverable belongs to one

- **Status:** accepted (Edward, 20 Sep: *"accept all, proceed"*)
- **Date:** 2026-09-20
- **Open Decision:** none — new functionality asked for by Edward, 20 Sep, with a client's
  spreadsheet as the evidence (the client content master sheet (client-supplied, not included))
- **Task(s):** I53.5 (this), I53.1 (the wizard step), I53.2 / ADR-0097 (the model suggests the
  phase), I53.4 (a promoted campaign starts with phases off)
- **Depends on:** [ADR-0050](0050-a-brief-belongs-to-a-department-and-a-deliverable-has-an-owner.md)
  (a deliverable's department comes from its owner — a phase changes nothing there),
  [ADR-0052](0052-a-deliverable-type-implies-a-list-of-unassigned-tasks.md) (tasks come from the type,
  untouched by a phase), [ADR-0093](0093-a-date-after-go-live-warns-and-is-recorded.md) (a date
  past a boundary warns and is recorded, never refused), [ADR-0083](0083-a-request-is-captured-with-its-evidence.md)
  addendum d.14 (the campaign's approval authority — the account manager, or `projects:manage`
  with reach over them — which is who may shape the campaign), [ADR-0037](0037-one-authorization-primitive-one-call-path.md)
  (a PATCH is governed as the RPC is), [ADR-0086](0086-the-system-says-when-a-job-looks-like-one-it-already-has.md)
  (promotion opens the campaign page).

## Context

A campaign in Maestro is departments → deliverables → tasks. It has one go-live date and no
structure in time below that. For a launch that runs over weeks that is not how the team thinks or
plans, and the evidence is that they built a spreadsheet to think in the missing shape.

**The LUMA Season 2 content master sheet** (Lantern Advertising, v2, September 2026; the team's own
attempt, kept in `docs/reference/`) is a campaign of 52 pieces across eight workstreams. Its
`Lists` tab defines the vocabulary the whole sheet hangs on:

| WEEK / PHASE | dates                 |
| ------------ | --------------------- |
| Pre-Launch   | before 18 Sep         |
| Week 1       | 18–25 Sep             |
| Week 2       | 26 Sep – 2 Oct        |
| Week 3       | 3–9 Oct               |
| Week 4       | 10–16 Oct             |
| Post-Season  | after the fourth draw |

Every piece on every workstream tab carries a **WEEK** (its phase) and a **DUE DATE** (its own
day) — two separate columns, both filled. The `Dashboard` tab's section C, *"BY WEEK · WHAT IS DUE
WHEN"*, is a phase × workstream grid of counts, and it is the view the team reads instead of the
group chat (their RULE 4). Nothing in Maestro can show it, so the sheet exists beside the product
and the product's status is wrong by however much the sheet knows.

Edward, 20 Sep, six decisions taken one at a time, then the open points:

1. **Phases are optional, per campaign** — a toggle. When on, phases are sequentially numbered,
   each with a name and dates. The campaign brief and the department briefs cover all phases;
   **every deliverable belongs to a phase.**
2. **A phase has a start and an end**, not one date — *"in the event that phases need to overlap
   or run in parallel"*. Numbering is the order they are listed; dates decide the calendar.
3. **A deliverable due after its phase ends is warned about, recorded and allowed** — the ADR-0093
   shape, *"consistent with what the team already knows"*. Not refused.
4. **Turning phases on for a campaign that already has deliverables** creates one phase holding
   all of them; the account manager renames, adds, moves. **Turning phases off is refused, in
   words, while more than one phase holds deliverables.**
5. **Single jobs never have phases; a promoted campaign starts with phases off.** Promotion stays
   one click.
6. **The campaign page shows a phase strip** (one ring per phase, like the department rings) and
   each department's table gains a *Phase* column with a filter. Edward: *"We will try A … once
   implemented I will inspect and request changes as required."*
7. On the draft's open points: **the notification emails name the phase; the schedule and the
   Pipeline page filter by it.** And the ground rules for all of it: *"everything is done locally
   until fully tested … ensure all production data is safe, so no destructive changes."*

And, from the discussion under ADR-0097: **the model suggests the phase** for each deliverable it
proposes, given the phase list; the account manager corrects. Edward's first reading of that
option was checked back and confirmed: *"That is fine."*

### What was weighed

**Phases as tabs on the campaign page** (each phase its own view). Rejected: the campaign-wide
view disappears, and a deliverable moved between phases vanishes from the tab you were on. The
sheet's own dashboard is cross-phase for the same reason.

**One date per phase** (its end; the start implied by the previous end). Rejected by Edward for
overlap — a teaser phase that runs into launch week is real, and a single date cannot say it.

**Placing deliverables by date alone** (a piece belongs to the phase whose dates contain its due
date). Kept as the *fallback* only: with overlap allowed a date can fall in two phases, and a piece
without a due date yet cannot be placed at all.

**Refusing a due date outside the phase.** Rejected: it forces the person to move the phase or
misstate the date. ADR-0093 already settled that a boundary warns and records.

**A phase as a container of streams** (departments inside phases). Rejected: the sheet's
workstreams cut across every week, and ADR-0050's department-from-owner rule would have to be
re-derived per phase. A phase is an attribute of a deliverable, not a parent of departments.

### What this does not touch

A phase never carries a brief, an approval, an owner or a department. The campaign brief and each
department's brief cover all phases (Edward). Task lists still come from the deliverable's type
(ADR-0052); assignment, review and sign-off do not know the word. A phase is where a deliverable
sits in the campaign's calendar, and a place to count.

## Decision

1. **`campaigns.has_phases boolean not null default false`.** A single job (`kind = 'single_job'`)
   is always `false`, enforced by a check; promotion (ADR-0086) leaves it `false`.

2. **A new tenant-scoped table `campaign_phases`** — `id`, `tenant_id`, `campaign_id`, `number`
   (integer ≥ 1, unique per campaign, contiguous from 1), `name` (non-blank), `starts_on date`,
   `ends_on date` (`ends_on >= starts_on`), `created_by` / `updated_by` (every tenant table carries them,
   `I51.1`). Phases of one campaign may overlap; nothing checks a phase against its neighbours.
   RLS in the same migration: read follows the campaign; write is by RPC only (d.4). A pgTAP suite
   proves the isolation, the numbering and the guards.

3. **`deliverables.phase_id uuid null` → `campaign_phases`.** A trigger guard holds the invariant
   both ways: a deliverable under a campaign with `has_phases` must name a phase **of that
   campaign**; a deliverable under a campaign without phases must name none. Ad-hoc deliverables
   (no campaign) never carry a phase. The wizard's insert, `add_campaign_deliverable`,
   `update_campaign_deliverable` and a direct PATCH are all governed by the same guard
   (ADR-0037).

4. **Four RPCs, one authority.** `set_campaign_phases(p_campaign, p_enabled)`,
   `save_campaign_phase(p_campaign, p_phase, p_name, p_starts_on, p_ends_on)` (insert when
   `p_phase` is null, at the next number), `delete_campaign_phase(p_phase)` and
   `move_deliverable_to_phase(p_deliverable, p_phase)`. Who may: the campaign's approval authority —
   its account manager, or `projects:manage` with reach over them (ADR-0083 addendum d.14, the same
   door as `add_campaign_deliverable`). A lead is offered nothing. Refusals are worded and
   reportable (ADR-0092). Every one is `security invoker`; the guard triggers do the refusing.

5. **Turning phases on** with deliverables present creates **Phase 1**, named *"Phase 1"*, from the
   campaign's creation day to its go-live day (or to creation day + 30 when go-live is unset), and
   attaches every deliverable of the campaign to it, in one statement. Turning phases on with no
   deliverables creates nothing; the first phase is entered by hand. **Turning phases off** is
   refused while more than one phase holds deliverables (*"Move the deliverables into one phase
   first — 3 are in Week 2, 4 in Week 3"*); when one phase holds everything, the phase rows are
   deleted and every `phase_id` cleared in the same statement.

6. **Deleting a phase** is refused while it holds deliverables (the refusal counts them); on
   deletion the phases after it are renumbered down so numbering stays contiguous. **Renaming or
   re-dating** a phase moves nothing and warns nothing — d.7's warning is evaluated when a
   deliverable's date is set, not when a phase's is.

7. **A deliverable's due date after its phase's end warns, records and proceeds** — the ADR-0093
   shape. `record_due_date_override` gains a boundary kind (`go_live` — today's, the default —
   or `phase_end`) and the phase's end day; the wizard, *Add / edit deliverable* and *Change
   promise* all show the same sentence: *"later than Week 2 ends (2 Oct)"*. A due date before the
   phase's start is not a warning — early is not a problem the team has.

8. **In the wizard** (I53.1): a *Phases* step sits after the brief and before the deliverables, shown
   only when the toggle is on; at least one phase before *Next*. The deliverables step gains a
   *Phase* column (a drop-down of the phases defined). The model's proposals arrive with a
   **suggested phase** (ADR-0097 d.6), marked as proposed until touched — the same rule as the
   rows themselves (ADR-0048 d.4). A row the model did not place is placed by its due date when
   that day falls inside **exactly one** phase; otherwise it lands in phase 1 and is flagged
   *"phase to confirm"*. Release is refused while a flagged row remains.

9. **On the campaign page**: a **phase strip** above the departments — one ring per phase in number
   order, *"Week 2 · 26 Sep – 2 Oct · 4 of 9 complete"*, overdue in the warn colour, the same
   `deliverableProgress` arithmetic as the department rings (`I52.10`) — and, in each department's
   table, a *Phase* column and a filter (all phases / one). The *Add / edit deliverable* dialog
   (`DeliverableDialog`) gains the phase. Managing phases (add, rename, re-date, delete, the
   toggle) is a *Phases* dialog opened from the strip, offered to d.4's authority only.
   **This layout is Edward's to inspect on the local stack and change**; the decisions above are
   the data and the rules, not the pixels.

10. **Single jobs are untouched**: no toggle, no step, no column. The single-job pages never render
    the word.

11. **A notification about a deliverable names its phase.** Where `notifications.detail`
    (`I52.8`, ADR-0028) already carries the deliverable's name, it carries the phase's name too when
    the campaign has phases, and `notify-email`'s facts line prints it: *"Instagram carousel ·
    Week 2 · due 30 Sep"*. Task mails inherit it through their deliverable. Nothing changes for a
    campaign without phases.

12. **The schedule and the Pipeline page filter by phase.** Both gain a *Phase* filter, mirrored in
    the URL like their other filters, offered only when the campaign in view has phases; a task's
    phase is its deliverable's. The My Work queue does not filter — a maker's list is theirs
    whatever the phase.

13. **Nothing here touches existing production rows, and nothing runs on production until it is
    fully tested locally** (ADR-0081). The migration is additive only: a new table, a nullable
    column, a boolean defaulting to `false`, triggers that refuse and never rewrite. No backfill, no
    data moved, no column dropped or renamed. Every campaign on production stays exactly as it is
    with phases off. The change is exercised end to end on the Docker stack — pgTAP, the coverage
    specs and Edward's own inspection — before `db push` is even proposed.

14. **Every control this adds has a browser test as one who may and one who may not**
    (ADR-0095): the toggle on a campaign with and without deliverables, the refusal to turn off,
    a phase deleted and renumbered, a deliverable moved, the wizard step and the flagged row, the
    strip's rings catching up in a second tab (`I52.9`'s class), a lead offered nothing.

## Consequences

**Easier.** The LUMA sheet's *by week* grid exists in the product: rings per phase, a filter per
department, counts that are right because they are the data. A campaign that does not need
phases sees nothing new. A deliverable is never lost between phases — the invariant in d.3 holds
at the database, whichever door wrote it.

**Harder.** One more thing to get right when the toggle is on: the account manager places every
piece (the model helps, d.8). Overlapping phases mean a date can be "in" two phases, so the
fallback placement is deliberately narrow (exactly one match) and the flag exists. The campaign
page carries a second strip of rings; on a campaign with many phases it is wide, and that is the
first thing to look at when Edward inspects.

**Locked in.** A phase is an attribute of a deliverable, not a parent of departments, and it
carries no brief and no approval — changing that is a new ADR. `phase_id` is nullable and the
invariant lives in a trigger, so the tables, the reports and every existing read keep working
with phases off.

**Not decided here.** Whether the client portal (M10) ever sees phases — a follow-up row when
asked for. (Edward, 20 Sep, on the first draft's open points: the emails name the phase, the
schedule and Pipeline filter — d.11 and d.12.)

**Money.** None. No new dependency.

## Implementation note — 20 Sep, the same day

Built as `20260920100000` (pgTAP 130). Two things the build settled differently from the words
above, recorded rather than rewritten:

- **d.4 said `security invoker`; the four RPCs are `security definer` with the authority tested
  inside**, exactly as `add_campaign_deliverable` is (I52.20). The account manager's role holds no
  row write on `deliverables` of a department outside their reach, and `campaign_phases` has no
  write policy at all — an invoker function would be refused by RLS before the authority test ran.
  The guard trigger still governs a direct PATCH identically (ADR-0037). The table privilege the
  migrations never grant (I43.2) is granted explicitly in the same file.
- **d.11 is read at send time, not stored.** `notify-email` reads the deliverable's phase when it
  builds the facts line, so a deliverable moved between phases is named by where it is now;
  `notifications.detail` does not carry the phase. The inbox door is unchanged.
- The wizard's fallback placement (d.8) runs when a DUE DATE is typed on the Timing step, since a
  row has no date when it is proposed; a row still unplaced blocks Next there, worded.

## Addendum — 24 Sep: in the wizard, a date chooses the phase (Edward)

Recorded, not rewritten — d.1–d.12 stand as accepted. What Edward decided on 24 Sep while the
timing step (`CB-v3-04`, `I56.11`) was being built, and what it changes:

- **Dates and phases can be edited on the timing step.** The frame had no way to change a date once
  it was on screen (Edward: *"the designer did not include an edit button in the event that dates
  need to be changed"*). Each phase on the strip opens the same name / start / end dialog step 1
  uses; each piece opens one dialog — its due date, the start counted back from it, and "given to
  the client".
- **A piece's date chooses its phase — earlier or later.** Edward: *"if dates are changed .. this
  needs to move the deliverable into the appropriate phase dynamically and update the view"*, and
  for a date in a later phase, *"Move it to that phase"*. The dialog reads the day against every
  phase's range and says *"This moves it from Week 1 to Week 2"* before the press. The day judged is
  the day it will actually be due (a Friday is the Thursday before). A day inside **no** phase is
  refused, naming the ranges — a piece outside every phase has nothing to plan back from.
- **So d.7's warning no longer arises from a typed date in the wizard.** A date past a phase's end
  is simply in the next phase, and the piece moves. d.7 still governs the campaign page (*Add / edit
  deliverable*, *Change promise*), and in the wizard it still fires where a phase edit leaves a
  piece's own date past its phase's end with no phase to hold it — `plan-back` brings it back to the
  end and the row says so.
- **d.6 is narrower in the wizard.** Re-dating a phase there DOES move pieces: every piece with a
  date of its own is read against the new ranges and moves where its date now falls, named in the
  dialog first. A piece on its phase's own date simply follows the phase. After creation, on the
  campaign page, d.6 stands as written.
- **In the wizard, phases do not overlap.** d.2 allows overlap and the table still does. The
  timing step's phase dialog refuses a start before the previous phase ends, or an end past the
  next phase's end, in words; an end that runs into the next phase's START pushes that start to the
  day after, and says so before the press. The reason is the rule above: with a date choosing the
  phase, a day in two phases would have two answers.

`TimingStepContainer`, `TimingPieceDialog`, `AddPhaseDialog`'s `check`; `phaseForDay` /
`phaseRanges` in `lib/timing/plan-back.ts`. `MovePieceDialog` (`CB-v3-P7`) is gone — the date does
the moving.
