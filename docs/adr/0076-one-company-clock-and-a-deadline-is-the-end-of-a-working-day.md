# ADR-0076: One company clock, and a deadline is the end of a working day

- **Status:** **accepted**
- **Date:** 2026-09-08
- **Open Decision:** none directly, but it **closes `I1.7`**, which has been ⚠️-gated since 1 Sep
  awaiting exactly this call.
- **Task(s):** `I1.7` (closed by this), `I1.9` (the implementation), and the thirteen render sites
  it names. Relates to **ADR-0005** (per-office working week) — **not superseded**, see d.5.

## Context

**A deadline in Maestro is a day pretending to be a moment.** `deliverables.due_at`,
`sub_tasks.due_at` and the leave dates are `timestamptz`, but a deadline is *picked* as a day and
*written* as midnight UTC (`DeliverablesPage.tsx:527,593` — `${day}T00:00:00Z`). Thirteen render
sites across twelve files then print `dueAt.slice(0, 10)`, which is the UTC date.

**Both halves are wrong and they cancel.** Storing a day as a moment is wrong; printing a moment
while ignoring its zone is wrong. Together they show the right day — but only while every user is
east of UTC, which today they all are. Convert one of those renders to the reader's local clock —
the right rule for a genuine timestamp, and what `I3.4`/`I4.4`/`I5.3`/`I3.5` now do — and every
deadline jumps **back a day** for anyone west of UTC. `docs/memory/traps.md` carries this as a trap
precisely because the fix and the defect look identical in a diff.

`I1.7` put two options to Edward and both were about making the value honestly a **day**: store it
as a `date`, or pin the nine (now thirteen) renders to UTC with a comment. It sat open for a week.

**Edward, 8 Sep, took a third option neither was:**

> *"all dates and time to be specified in IRAQ time… and this needs to be stated when presented.
> also the time generated is always midnight. it should be 18:00 iraq as this is the office close
> each working day."*

That makes the value honestly a **moment** — the end of business on the day it is due — after which
the ordinary timestamp rule (store UTC, display in a named zone) applies to it like everything else,
and the trap stops existing rather than being documented around.

**On the working week.** A first draft of this ADR proposed superseding ADR-0005, on the evidence
that every office row in the live database was Sun–Thu when measured on 6 Sep, and on Edward's
*"no one in any location works Mon - Friday."* He rejected that:

> *"we need to keep the current schema as well as the ability to set differing work weeks etc… so I
> do not want that option removed."*

The correct reading is that **every office being Sun–Thu is configuration, not a rule.** ADR-0005
stands. Nothing here hardcodes a working week, and the per-office mechanism keeps working exactly as
built. What changes is only what a reader is *shown*, and when a deadline falls.

**On where 18:00 lives.** `offices` carries `timezone` and `working_days` and **no closing time**.
Two options were weighed:

- **A column `offices.close_time`, defaulting to 18:00**, so a future office could differ. Consistent
  with the per-office philosophy above, and it is what the working-week capability would suggest.
- **A single constant, 18:00 Asia/Baghdad.** Simpler, and accurate to what was actually asked for:
  one company close, not a per-office one.

The constant wins, on Edward's standing rule — *"always choose the most reliable option that is
reliable, accurate and minimum simplest code required"*. A per-office closing time is a capability
nobody has asked for, and adding the column later is a small migration whose absence costs nothing
today. **This ADR does not pre-build it.**

## Decision

1. **One company clock.** Every date and time shown to a person is presented in **Asia/Baghdad**,
   regardless of where the reader or the work is. There is no per-viewer or per-office display zone.

2. **The zone is stated wherever a time is shown.** A date or time on screen, in an email, or in an
   export names the clock it is on — *"12 March 2027, 18:00 (Iraq time)"* — so no reader has to work
   out whose day is meant. A date with no time component still says it: *"Thursday 12 March (Iraq
   time)"*. This is the half that makes d.1 safe rather than merely consistent.

3. **A deadline is 18:00 Asia/Baghdad on its day** — the close of the working day — and is stored as
   the real instant that represents (15:00Z while Iraq is UTC+3; Iraq does not observe DST, so this
   is stable, and the conversion is done properly rather than by adding three hours).

4. **Existing deadlines are moved.** Every `due_at` currently at 00:00Z is rewritten to 15:00Z on the
   same calendar day, in a migration, so old and new work answer the same question the same way. A
   deadline that is already at some other time is left alone — it was set deliberately.

5. **ADR-0005 stands and the per-office working week is untouched.** Offices keep `timezone` and
   `working_days`, they remain editable, and every scheduling calculation — which day a booking falls
   on, which days are worked, how hours spread — continues to use the **office's** values, not this
   clock. d.1 governs *presentation only*. Conflating the two would put Dubai and Cairo bookings on
   the wrong days, and this ADR must not be read as licence to do that.

6. **`slice(0, 10)` on a `timestamptz` is banned** once d.4 has run. It is the mechanism of the trap:
   it silently means "the UTC day", which will be the wrong day for an 18:00 Baghdad deadline
   (15:00Z is still the same UTC day, but 21:00 Baghdad would not be, and nothing stops a later
   deadline). Dates are formatted through `Intl.DateTimeFormat` with `timeZone: 'Asia/Baghdad'`.

7. **One helper, not thirteen call sites.** The formatting and the zone label live in a single unit
   in `src/lib/` with its own tests, used by the app and by the Edge Functions. Thirteen hand-written
   copies of a date rule is the drift this project has already paid for three times in one day
   (traps.md: the notification copy map, the audit trigger list, the audit entity filter).

## Consequences

**Easier.** A deadline becomes an ordinary timestamp, so the rule for every temporal value in the
system is finally one rule: store UTC, display Asia/Baghdad, say so. The `I1.7` trap stops needing
documentation because it stops being possible. A user in London or the Americas can be given an
account without every deadline moving a day. And "due Thursday" stops being ambiguous about whether
that means Thursday morning or the end of Thursday — it is the end of Thursday, and it says so.

**Harder.** Thirteen render sites change in one pass, and each one must be checked rather than
pattern-replaced: some of those `slice(0, 10)` calls are on genuine timestamps (`created_at`,
`updated_at`) where the fix is different, and telling them apart is exactly the judgement the trap is
about. The data migration (d.4) rewrites live pilot rows. Tests that assert a formatted date must
pin the zone, because Vitest pins no `TZ` and CI runs UTC.

**Locked in.** A single display clock. If Maestro is ever sold to an agency outside Iraq, or this
agency opens an office that keeps genuinely different hours, d.1 and d.2 are the decision to revisit
— and revisiting them means a new ADR, not an exception in a component. Note that d.5 deliberately
leaves that door open: the *scheduling* machinery is already per-office, so only presentation would
need to change.

**Not decided here.** Whether `offices` gains a closing time. Whether the leave dates and any other
day-shaped `timestamptz` follow the same 18:00 rule — they are days, not deadlines, and a separate
pass should establish which is which rather than assuming.
