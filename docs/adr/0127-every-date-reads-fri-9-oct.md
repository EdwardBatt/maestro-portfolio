# ADR-0127: Every date reads "Fri, 9 Oct", entered through one date box that never crashes on a mistyped date

- **Status:** accepted (Edward, 30 Sep) — records Edward's answers of 29 and 30 Sep, already built and on production
- **Date:** 2026-09-30
- **Open Decision:** none
- **Amends:** ADR-0076 d.2 and d.7 (the words of a date; the one helper). ADR-0076 d.1, d.3 and d.5 stand.
- **Task(s):** I66.8

## Context

Production crashed on the Single job: *"RangeError: Invalid time value at Date.toISOString"*.

Chrome's year box takes five digits. So `20266-10-09` counts as a valid date to the browser, but it is not
a real day. The day strip (`intake/lib/lead-time.ts`) did date arithmetic on it on every keystroke, and
with no error boundary the page went. The same weakness sat in all 39 date boxes.

Dates were also written in many ways. About 25 screens formatted their own dates or printed raw
`YYYY-MM-DD`. Some stamps (inbox, review comments, audit, feedback) used the viewer's own computer clock,
which ADR-0076 d.1 forbids.

Edward's answers, one at a time, 29 Sep:

1. **A:** keep the browser's calendar box, show the day in words beside it, and catch a mistyped date.
   Rejected: a custom date picker.
2. **A:** show the year only when it is not this year.
3. **Arabic A:** the pan-Arab form with Western digits (*"الجمعة، 9 أكتوبر"*). There are clients and
   staff in Egypt and staff in Dubai. Rejected: Iraqi month names; Eastern digits.

On 30 Sep Edward answered the question left open: the compact labels stay as they are (d.5).

## Decision

1. **Every full date reads "Fri, 9 Oct"**, with the time as "Fri, 9 Oct, 15:00" when the hour matters.
   The year is added only when it is not this year ("Fri, 9 Oct 2027"). The month is written "Sep", never
   "Sept". Arabic reads "الجمعة، 9 أكتوبر" with Western digits.
2. **One source for the words:** `src/lib/time/iraq.ts` (`formatIraqDate`, `formatCalendarDay`,
   `formatIraqDateTime`, `stampFormatter`, `dayFormatter`). The screens and the emails import it. A
   deadline or a moment still names its clock, *"(Iraq time)"*, as ADR-0076 d.2 requires.
3. **Every stamp reads in Iraq time**, not the viewer's clock (ADR-0076 d.1).
4. **One date box, `components/DateField.tsx`, replaces every `type="date"`.** It shows the day in words
   beside the box. A day that does not exist (`isRealDay`, years 2000–2099) gets *"That isn't a date — pick
   it from the calendar."* under it. Only a real day, or empty, is passed on, and what was typed is kept.
   The one date-and-time box is guarded the same way, and the day strip refuses an unreal day.
5. **The compact labels stay compact** (Edward, 30 Sep: *"no"*): weekday-only column heads and lists
   ("Sun", "Mon"), and the short ranges of the season map and phase headers ("26 Sep – 2 Oct").

## Consequences

*Easier:* one way to read a date everywhere, and a mistyped year can no longer take a page down.

*Harder:* a new screen must use `DateField` and the shared formatters. A raw `type="date"` or a local
`toLocaleDateString` is the drift this ADR closes.

*Locked in:* Western digits in Arabic, and the year shown only when it differs.

*Cost:* no migration; ~25 screens and the email templates moved to the shared words.
