# ADR-0079: A closed day belongs to the office, not to each person

- **Status:** **accepted** (drafted and accepted 9 Sep 2026)
- **Date:** 2026-09-09 (accepted 2026-09-09)
- **Open Decision:** none. Both questions this needed were answered by Edward on 9 Sep and are quoted
  in the decisions below.
- **Task(s):** closes the working-calendar half of `I41.4`. Raises `I41.11` (the closure calendar and
  its HR surface) and `I41.12` (the list of work stranded on a newly-declared closure).
- **Completes:** [ADR-0078](0078-a-day-of-work-is-a-working-day.md) — d.1 there decided that a count
  of days is a count of WORKING days, and its own closing section names this gap as the thing it
  could not settle.
- **Amends:** [ADR-0013](0013-people-culture-leave-authority.md) — its line *"they record staff
  leave — planned and emergency — plus public holidays, which land as `resource_unavailability`"*
  is the sentence this changes. Staff leave is unchanged and stays exactly where it is.
- **Relates to:** [ADR-0061](0061-assigning-work-says-what-actually-happened.md) d.2 and ADR-0078 d.3 (an
  explicit placement is never re-derived), [ADR-0075](0075-at-risk-and-breach-are-measured-from-the-work-not-from-a-profile.md)
  d.5 (the go-live offsets are counted in working days, so they read this calendar too).

## Context

**ADR-0078 said days are working days, and then had to admit the calendar is not real.** Its closing
section: *"`workingDaysInRange` knows a weekly pattern and nothing else: there is no holidays table
anywhere in the schema, and `resource_unavailability` is never consulted by the spreader. Every
office works the same week every week of the year, Eid included."* That gap got sharper the moment
d.1 landed, because the weekly pattern now decides where work is PLACED rather than only how it is
divided.

**The half that already exists.** `/people/leave` (grant `leave:view`, writes behind `leave:manage`)
records unavailability, and `resource_unavailability.kind` has allowed `'holiday'` since 28 July.
`leave-api.ts` types it — `LeaveKind = 'leave' | 'holiday'` — and its own header says People &
Culture record *"staff leave (incl. emergency) and company holidays"*.

**The half that does not.** `resource_unavailability.resource_id` is `not null` and references one
resource, and `LeaveDialog` enforces it: `if (!resourceId) return setError(t('leave.resourceRequired'))`.
So a national holiday can only be recorded one person at a time. Sixty staff, sixty rows, for a fact
that is the same fact about all of them.

**Which is not merely tedious — it goes wrong silently.** Somebody hired in March has no Eid row, so
the system believes they are available on a national holiday and books them. The absence is
invisible, because an empty result is indistinguishable from a person who is simply free.

**What reads unavailability today**, verified rather than assumed: the schedule grid
(`schedule-api.ts:175`) and the booking checks (`booking-transition/index.ts:227`, `:374`). What does
NOT read it is the thing ADR-0078 made decisive — `workingDaysInRange` in
`src/lib/bookings/subtask-spread.ts:38`, which takes an `OfficeCalendar` of `{ timezone, workingDays }`
(`src/lib/capacity/types.ts:38`) and knows nothing else.

## Options weighed

**One unavailability row per person, entered in bulk.** Rejected. No schema change, and permanently
wrong for anyone who joins after the entry — the failure above. It also merges two different facts:
"why is Sara unavailable?" can no longer distinguish her leave from a national closure.

**Make `resource_id` nullable, null meaning everyone.** Rejected. One row per holiday and joiners are
covered, but every existing reader must be taught that an empty column means the opposite of empty,
and any reader that is missed ignores the closure with no error. That is the fail-silent shape this
repository has been bitten by repeatedly — an unresolvable embed returning empty rather than raising,
`memory-lint`'s index check passing while proving nothing.

**A closure calendar on the OFFICE.** Chosen. It is where the fact actually lives.

## Decision

**d.1 — A closure is a property of an office and is stored as one.** A new table keyed by office and
date, not by person: tenant, office, the day (or span), a kind, a name, and who entered it. One row
per closure per office, and a person hired tomorrow is covered by it tonight, because nothing about
the row mentions people.

**Per office, because offices genuinely differ.** ADR-0005 already gives each office its own working
week and requires every surface to read *that office's*; `resources.office_id` exists and the grid
already uses it per row. Baghdad and Dubai do not share a national calendar, and a tenant-wide table
would force one of them to be wrong.

**d.2 — A public holiday and a company-closed day are the same thing.** Confirmed by Edward, 9 Sep.
Both mean the office does not work that day; they differ in the label a reader sees and in nothing
else. One table, one kind column, no second mechanism — a second mechanism would be two things to
consult and one of them would eventually be forgotten.

**d.3 — It displays exactly as a weekend does, because it travels the same path.** Edward asked
directly: *"does it display for everyone as weekends do."* It does, and this decision is what makes
that literally true rather than approximately.

`DayGrid` shades a cell by asking whether that ROW's own office works that weekday
(`DayGrid.tsx:190`), and narrows a whole column when it is non-working for every office shown and
carries no bookings (`:119`). A closure joins the same test: a day is non-working if the weekly
pattern excludes it **or** the office is closed on that date. Baghdad rows shade for Eid while Dubai
rows do not, in the same view, with no further work — and a closure common to every office collapses
the column exactly as a weekend does.

The per-person option could not have delivered this. Sixty leave rows do not shade a column; they
draw sixty bars.

**d.4 — `OfficeCalendar` carries the closures, and that is the whole seam.** Every date decision in
the system reaches `workingDaysInRange` through that one type. Extending it means the spreader, the
capacity preview, the drag warning (`I41.5`) and ADR-0075 d.5's go-live offsets all begin reading a
real calendar together. **A second source of truth for "is this a working day" is forbidden** — the
three-places-disagreeing failure is precisely what ADR-0078 was written about, and it cost a person
sixteen hours on one Thursday.

**d.5 — Declaring a closure moves no work that is already booked.** ADR-0078 d.3: an explicit
placement is never re-derived. Eid is often confirmed weeks ahead of itself, so by the time it is
entered the calendar is already full; moving it automatically would shift deadlines under people who
have already made commitments, some past a client due date, with nobody told which.

**d.6 — But the stranded work is LISTED, and the list is where it gets fixed.** Edward, 9 Sep:
*"once the list is generated the authorised person can drag if required."* Entering a closure
produces what is now sitting on a closed day, with its owner. Nothing is moved for anybody; each
booking is dragged by a person who can see what they are doing, and the drop warns exactly as
`I41.5` made it warn.

**This is what makes d.5 honest.** "Nothing moves" without a list means nobody finds out, which is
the same silent failure in a different coat. The list is not a nicety attached to the decision; it is
the half that makes the other half defensible.

**d.7 — `/people/leave` becomes the HR surface and holds both.** Edward, 9 Sep: *"this page will
become the HR Admin interface, the functionality should be included here to place public holidays,
company closed style events onto the calendar."* Leave and closures are entered in one place because
they are one person's job, and they stay separate underneath because they are different facts.
Writes remain behind `leave:manage`; the closure form asks for an office, not a person, which is the
visible shape of d.1.

**d.8 — Closure dates are entered by hand, and no import is built.** Edward, 9 Sep: *"we will not
import holidays, they will be entered manually."*

**This is the correct answer rather than a deferral, and the reason is the calendar itself.** Iraqi
public holidays follow a lunar calendar and are confirmed by announcement close to the day; Eid's
dates are not knowable far enough ahead for a feed to be authoritative. An import would therefore
be right most years and wrong occasionally — and a source that is *usually* right is worse than no
source at all, because nobody checks it. Somebody entering a date they have read in an announcement
is both more accurate and visibly accountable.

It also keeps d.1 whole: a closure is a small, deliberate, audited row entered by the person whose
job it is (d.7), not a bulk write from outside with no actor. Nothing here forbids an import later
if a trustworthy source appears — but no part of this design waits on one, and none of the work in
`I41.11` assumes it.

## What this does not decide

- **Half-days and partial closures.** A closure is a whole day for the office. An early finish is
  capacity, not a calendar, and modelling it here would put two different ideas in one table.
- **Per-person religious observance.** That is leave, it already works, and it stays where it is.

## Consequences

**Easier.** "Two days of Sara's time" finally means two days Sara can actually work. The capacity
preview stops assessing days nobody works, ADR-0075's go-live offsets stop landing deliverables on
closed days, and a new joiner is covered by every closure already recorded without anybody
remembering to add them.

**Harder.** One migration, one HR form, and a list nobody has built. `OfficeCalendar` gains a field,
so every caller is touched — that is the cost of having one seam, and it is cheaper than the
alternative, which is several places quietly disagreeing about what a working day is.

**Locked in.** "Is this a working day?" has exactly one answer, computed in one place, for the whole
system. Anything later that decides it independently is a defect, however local it looks.

**One loose end in ADR-0013, named so it is not left dangling.** Its leave RLS policy is fenced to
`kind in ('leave','holiday')` in both USING and WITH CHECK. Once closures live elsewhere the
`'holiday'` arm covers nothing, and it should be dropped in the same migration rather than left as a
permission for a row type that can no longer be written.

**Migrations.** One: the closure table, keyed by tenant and office with a date span, a kind
(`public_holiday` | `company_closed`), a name and an actor; RLS reading tenant-wide like
`resource_unavailability` and writing behind `leave:manage`; audited by the universal trigger. Its
pgTAP asserts that a closure is visible to a resource created AFTER it was entered — the failure this
ADR exists to prevent — and that no existing booking is altered by declaring one.
