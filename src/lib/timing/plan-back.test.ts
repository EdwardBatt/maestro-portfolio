import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  IRAQ_WORKING_CALENDAR,
  canPullTo,
  formatPlanDay,
  formatPlanRange,
  formatWeekday,
  isWorkingIsoDay,
  movePhaseEnd,
  phaseDueDate,
  phaseStartAfter,
  planCampaign,
  planPhase,
  planPiece,
  previousWorkingDay,
  restDays,
  startFromDue,
  workingDaysAvailable,
  workingWeekSpan,
  phaseForDay,
  phaseRanges,
  type PlanPhase,
  type PlanPiece,
  type WorkingCalendar,
} from './plan-back'

/**
 * `I56.11` — the dates the campaign is made of.
 *
 * This suite is deliberately heavier than the screen that uses it. A wrong colour is caught in
 * review; a wrong count-back is caught by a client, in October, when the work does not arrive.
 * So the frame's OWN numbers are asserted cell by cell (`CB-v3-04` shows Week 2 of LUMA Season 2,
 * and its calendar is 2026 — Fri 2 Oct 2026 really is a Friday), and then every edge around them:
 * weekends, closures, a phase end nobody works, a run-up that does not fit, a pull, a re-plan, and
 * the event that cannot move.
 */

// LUMA Season 2, straight off the frame. Fridays are draw nights; the office works Sun–Thu.
const WEEK_1: PlanPhase = { id: 'w1', name: 'Week 1', eventName: 'Draw Night 1', endsOn: '2026-09-25', startsOn: '2026-09-18' }
const WEEK_2: PlanPhase = { id: 'w2', name: 'Week 2', eventName: 'Draw Night 2', endsOn: '2026-10-02', startsOn: '2026-09-26' }
const WEEK_3: PlanPhase = { id: 'w3', name: 'Week 3', eventName: 'Draw Night 3', endsOn: '2026-10-09', startsOn: '2026-10-03' }
const WEEK_4: PlanPhase = { id: 'w4', name: 'Week 4', eventName: 'FINALE', endsOn: '2026-10-16', startsOn: '2026-10-10' }
const SEASON = [WEEK_1, WEEK_2, WEEK_3, WEEK_4]

const piece = (over: Partial<PlanPiece> & { id: string }): PlanPiece => ({
  code: over.id.toUpperCase(),
  name: over.id,
  departmentName: 'Creative',
  phaseId: 'w2',
  ...over,
})

// Before the season starts, so nothing is accidentally short of its run-up unless a test says so.
const ctx = { today: '2026-09-14' }

describe('the working day — borrowed, never redefined', () => {
  it('agrees with the one calendar: Sun–Thu work, Fri and Sat never count', () => {
    expect(isWorkingIsoDay('2026-09-27', IRAQ_WORKING_CALENDAR)).toBe(true) // Sun
    expect(isWorkingIsoDay('2026-10-01', IRAQ_WORKING_CALENDAR)).toBe(true) // Thu
    expect(isWorkingIsoDay('2026-10-02', IRAQ_WORKING_CALENDAR)).toBe(false) // Fri
    expect(isWorkingIsoDay('2026-10-03', IRAQ_WORKING_CALENDAR)).toBe(false) // Sat
  })

  it('honours a closure on a day the week otherwise works', () => {
    const closed: WorkingCalendar = { workingDays: [7, 1, 2, 3, 4], closures: ['2026-10-01'] }
    expect(isWorkingIsoDay('2026-10-01', closed)).toBe(false)
  })

  it('previousWorkingDay stays put on a working day and steps back over the weekend', () => {
    expect(previousWorkingDay('2026-09-30', IRAQ_WORKING_CALENDAR)).toBe('2026-09-30') // Wed
    expect(previousWorkingDay('2026-10-03', IRAQ_WORKING_CALENDAR)).toBe('2026-10-01') // Sat → Thu
    expect(previousWorkingDay('2026-10-02', IRAQ_WORKING_CALENDAR)).toBe('2026-10-01') // Fri → Thu
  })

  it('previousWorkingDay steps over a closure as well as a day off', () => {
    const closed: WorkingCalendar = { workingDays: [7, 1, 2, 3, 4], closures: ['2026-10-01'] }
    expect(previousWorkingDay('2026-10-02', closed)).toBe('2026-09-30')
  })

  it('an office that works no day at all gives up rather than looping forever', () => {
    const none: WorkingCalendar = { workingDays: [] }
    expect(previousWorkingDay('2026-10-02', none)).toBe('2026-10-02')
    expect(workingDaysAvailable('2026-09-14', '2026-10-02', none)).toBe(0)
  })
})

describe('a phase gives a delivery day', () => {
  it('counts the tenant run-up back from the EVENT, across the weekend', () => {
    // Fri 2 Oct is the draw night. Thu 1 Oct is one working day back, Wed 30 Sep is two.
    expect(phaseDueDate(WEEK_2)).toBe('2026-09-30')
  })

  it('works the same when the event lands on a day the office DOES work', () => {
    // Wed 30 Sep: Tue 29 is one back, Mon 28 is two. No weekend involved.
    expect(phaseDueDate({ endsOn: '2026-09-30' })).toBe('2026-09-28')
  })

  it('steps over a closure the same way it steps over a Friday', () => {
    const closed: WorkingCalendar = { workingDays: [7, 1, 2, 3, 4], closures: ['2026-10-01'] }
    expect(phaseDueDate(WEEK_2, closed)).toBe('2026-09-29')
  })

  it('never lands a delivery on a day nobody works — for a whole month of events', () => {
    // The I41.9 defect in a new place: a Friday deadline. Asserted as a property, not a case.
    for (let d = 1; d <= 31; d++) {
      const endsOn = `2026-10-${String(d).padStart(2, '0')}`
      expect(isWorkingIsoDay(phaseDueDate({ endsOn }), IRAQ_WORKING_CALENDAR)).toBe(true)
    }
  })
})

describe('a piece counts back from the delivery day', () => {
  it('start = needs working days back, COUNTING the due day (the frame, row by row)', () => {
    expect(startFromDue('2026-09-30', 1)).toBe('2026-09-30')
    expect(startFromDue('2026-09-30', 2)).toBe('2026-09-29') // INF-013 · 2 days
    expect(startFromDue('2026-09-30', 3)).toBe('2026-09-28') // SF-022 · 3 days
    expect(startFromDue('2026-09-30', 4)).toBe('2026-09-27') // DA-017 · 4 days
    expect(startFromDue('2026-09-30', 9)).toBe('2026-09-20') // MC-003 · 9 days, two weekends back
  })

  it('a piece that names no lead time takes the tenant run-up of four working days', () => {
    const p = planPiece(piece({ id: 'da-017' }), WEEK_2, ctx)
    expect(p.needsWorkingDays).toBe(4)
    expect(p.startsOn).toBe('2026-09-27')
  })

  it('reproduces every date on CB-v3-04 · Week 2', () => {
    const rows = [
      piece({ id: 'da-017', code: 'DA-017', needsWorkingDays: 4 }),
      piece({ id: 'sf-022', code: 'SF-022', needsWorkingDays: 3, departmentName: 'Content' }),
      piece({ id: 'mc-003', code: 'MC-003', needsWorkingDays: 9, departmentName: 'Content' }),
      piece({ id: 'inf-013', code: 'INF-013', needsWorkingDays: 2, departmentName: 'Influencers' }),
      piece({ id: 'ls-002', code: 'LS-002', isEvent: true, departmentName: null }),
    ]
    const planned = planPhase(WEEK_2, rows, ctx)
    expect(planned.pieces.map((p) => [p.code, p.startsOn, p.dueOn])).toEqual([
      ['DA-017', '2026-09-27', '2026-09-30'],
      ['SF-022', '2026-09-28', '2026-09-30'],
      ['MC-003', '2026-09-20', '2026-09-30'],
      ['INF-013', '2026-09-29', '2026-09-30'],
      ['LS-002', '2026-10-02', '2026-10-02'],
    ])
  })

  it('a piece whose work starts before its own phase is still planned, not refused', () => {
    // MC-003 needs nine days and therefore starts in Week 1. "Starts in Week 1" on the frame.
    const p = planPiece(piece({ id: 'mc-003', needsWorkingDays: 9 }), WEEK_2, ctx)
    expect(p.startsOn < (WEEK_2.startsOn ?? '')).toBe(true)
    expect(p.fit).toBe('fits')
  })

  // I57.35 (Edward, 25 Sep): a start is never in the past — but it MAY be before its own phase,
  // because only the delivery has to fall inside the phase.
  it('I57.35: a start before its own phase stands — only the delivery must be inside the phase', () => {
    const p = planPiece(piece({ id: 'mc-003', needsWorkingDays: 9 }), WEEK_2, { today: '2026-09-14' })
    expect(p.startsOn).toBe('2026-09-20')
    expect(p.startsOn < (WEEK_2.startsOn ?? '')).toBe(true)
    expect(p.fit).toBe('fits')
  })

  it('I57.35: a start is never in the past — today, when the count-back is earlier', () => {
    const p = planPiece(piece({ id: 'a', needsWorkingDays: 4 }), WEEK_2, { today: '2026-09-29' })
    expect(p.startsOn).toBe('2026-09-29')
    expect(p.fit).toBe('reduced_scope')
  })

  it('I57.35: a today the office does not work floors to the next working day', () => {
    // Fri 25 Sep is not worked; the next working day is Sun 27.
    const p = planPiece(piece({ id: 'a', needsWorkingDays: 9 }), WEEK_2, { today: '2026-09-25' })
    expect(p.startsOn).toBe('2026-09-27')
    expect(p.fit).toBe('reduced_scope')
  })

  it('I57.35: a start never passes its own due day', () => {
    const p = planPiece(piece({ id: 'a', needsWorkingDays: 4 }), WEEK_2, { today: '2026-10-01' })
    expect(p.startsOn).toBe(p.dueOn)
    expect(p.fit).toBe('reduced_scope')
  })
})

describe('the event cannot move', () => {
  const event = piece({ id: 'ls-002', isEvent: true, departmentName: null })

  it('is due on its own Friday, working day or not, and needs no run-up', () => {
    const p = planPiece(event, WEEK_2, ctx)
    expect(p.dueOn).toBe('2026-10-02')
    expect(p.startsOn).toBe('2026-10-02')
    expect(p.needsWorkingDays).toBeNull()
    expect(p.fit).toBe('fixed')
    expect(p.pulled).toBe(false)
  })

  it('ignores a pull — the phase moves, the event does not', () => {
    const p = planPiece({ ...event, pulledDueOn: '2026-09-28' }, WEEK_2, ctx)
    expect(p.dueOn).toBe('2026-10-02')
    expect(p.pulled).toBe(false)
  })

  it('is never short of its run-up, even with the date already past', () => {
    expect(planPiece(event, WEEK_2, { today: '2026-12-01' }).fit).toBe('fixed')
  })

})

describe('pulling a piece earlier', () => {
  it('takes the exact date and reports that it is no longer the phase date', () => {
    const p = planPiece(piece({ id: 'a', pulledDueOn: '2026-09-28', needsWorkingDays: 3 }), WEEK_2, ctx)
    expect(p.dueOn).toBe('2026-09-28')
    expect(p.startsOn).toBe('2026-09-24') // Mon 28, Sun 27, then Thu 24 — Fri and Sat cost nothing
    expect(p.pulled).toBe(true)
    expect(p.phaseDueOn).toBe('2026-09-30')
    expect(p.clampedToPhaseEnd).toBe(false)
  })

  it('snaps a pull onto a Friday back to the Thursday — nobody works the day it was set to', () => {
    const p = planPiece(piece({ id: 'a', pulledDueOn: '2026-09-25' }), WEEK_2, ctx)
    expect(p.dueOn).toBe('2026-09-24')
  })

  it('allows a date later than the phase date but inside the phase', () => {
    // Thu 1 Oct is after Wed 30 Sep but before the draw night. Later than PLANNED is not later
    // than the PHASE, and the screen warns rather than blocks.
    const p = planPiece(piece({ id: 'a', pulledDueOn: '2026-10-01' }), WEEK_2, ctx)
    expect(p.dueOn).toBe('2026-10-01')
    expect(p.pulled).toBe(true)
    expect(p.clampedToPhaseEnd).toBe(false)
  })

  it('brings a date past the event back to the event, and says it did', () => {
    const p = planPiece(piece({ id: 'a', pulledDueOn: '2026-10-05' }), WEEK_2, ctx)
    expect(p.clampedToPhaseEnd).toBe(true)
    expect(p.dueOn).toBe('2026-10-01') // the end is a Friday, so the working day before it
  })

  it('canPullTo names the one ceiling there is', () => {
    expect(canPullTo('2026-10-01', WEEK_2)).toEqual({ ok: true, reason: null })
    expect(canPullTo('2026-10-02', WEEK_2)).toEqual({ ok: true, reason: null })
    expect(canPullTo('2026-10-03', WEEK_2)).toEqual({ ok: false, reason: 'after_phase_end' })
    // Earlier than the phase starts is fine — a nine-day piece has to start before its phase.
    expect(canPullTo('2026-09-01', WEEK_2)).toEqual({ ok: true, reason: null })
  })
})

describe('short of its run-up — the amber row', () => {
  it('counts today when the office works today, and up to and including the due day', () => {
    expect(workingDaysAvailable('2026-09-28', '2026-09-30')).toBe(3) // Mon, Tue, Wed
    expect(workingDaysAvailable('2026-09-24', '2026-09-30')).toBe(5) // Thu, then Sun–Wed
    expect(workingDaysAvailable('2026-09-30', '2026-09-30')).toBe(1)
  })

  it('does not count a today the office does not work', () => {
    expect(workingDaysAvailable('2026-09-25', '2026-09-30')).toBe(4) // Fri: Sun–Wed only
  })

  it('counts nothing once the date is past', () => {
    expect(workingDaysAvailable('2026-10-05', '2026-09-30')).toBe(0)
  })

  it('is amber when the days left are fewer than the days needed', () => {
    const p = planPiece(piece({ id: 'a', needsWorkingDays: 4 }), WEEK_2, { today: '2026-09-28' })
    expect(p.workingDaysAvailable).toBe(3)
    expect(p.fit).toBe('reduced_scope')
  })

  it('is green with exactly enough — the boundary is not off by one', () => {
    const p = planPiece(piece({ id: 'a', needsWorkingDays: 4 }), WEEK_2, { today: '2026-09-27' })
    expect(p.workingDaysAvailable).toBe(4)
    expect(p.fit).toBe('fits')
  })

  it('counts the phase, so the screen can say how much will not fit', () => {
    const rows = [
      piece({ id: 'a', needsWorkingDays: 9 }),
      piece({ id: 'b', needsWorkingDays: 2 }),
      piece({ id: 'c', isEvent: true }),
    ]
    expect(planPhase(WEEK_2, rows, { today: '2026-09-28' }).reducedScopeCount).toBe(1)
  })
})

describe('moving a phase end re-plans everything in it', () => {
  const rows = [
    piece({ id: 'a', needsWorkingDays: 4 }),
    piece({ id: 'b', needsWorkingDays: 2 }),
    piece({ id: 'evt', isEvent: true }),
    piece({ id: 'other', phaseId: 'w3', needsWorkingDays: 4 }),
  ]

  it('moves every date in the phase, the event included, and nothing outside it', () => {
    const moved = movePhaseEnd(SEASON, 'w2', '2026-10-09')
    const plan = planCampaign(moved, rows, ctx)
    const w2 = plan.find((p) => p.phase.id === 'w2')!
    expect(w2.dueOn).toBe('2026-10-07')
    expect(w2.pieces.map((p) => [p.id, p.startsOn, p.dueOn])).toEqual([
      ['a', '2026-10-04', '2026-10-07'],
      ['b', '2026-10-06', '2026-10-07'],
      ['evt', '2026-10-09', '2026-10-09'],
    ])
    // Week 3 kept its own event and therefore its own dates.
    expect(plan.find((p) => p.phase.id === 'w3')!.dueOn).toBe('2026-10-07')
  })

  it('re-clamps a pull that the new, earlier end has left behind', () => {
    const pulled = [piece({ id: 'a', pulledDueOn: '2026-10-01', needsWorkingDays: 2 })]
    const moved = movePhaseEnd(SEASON, 'w2', '2026-09-25')
    const p = planPhase(moved[1], pulled, ctx).pieces[0]
    expect(p.clampedToPhaseEnd).toBe(true)
    expect(p.dueOn).toBe('2026-09-24')
  })

  it('fills the next phase start from the new end when it still held the derived one', () => {
    const moved = movePhaseEnd(SEASON, 'w2', '2026-10-06')
    expect(moved[2].startsOn).toBe('2026-10-07')
  })

  it('leaves a start somebody typed alone — a moved phase never silently rewrites a decision', () => {
    const typed = SEASON.map((p) => (p.id === 'w3' ? { ...p, startsOn: '2026-10-05' } : p))
    const moved = movePhaseEnd(typed, 'w2', '2026-10-06')
    expect(moved[2].startsOn).toBe('2026-10-05')
  })

  it('does nothing at all for a phase it does not have, or an empty date', () => {
    expect(movePhaseEnd(SEASON, 'nope', '2026-10-06')).toEqual(SEASON)
    expect(movePhaseEnd(SEASON, 'w2', '')).toEqual(SEASON)
  })

  it('a phase start is the day after the one before it ends — calendar days, not working ones', () => {
    // The Add-a-phase frame: Week 4 ends Fri 16 Oct, Week 5 starts Sat 17 Oct.
    expect(phaseStartAfter('2026-10-16')).toBe('2026-10-17')
  })
})

describe('which phase a day falls in — a date chooses the phase (Edward, 24 Sep)', () => {
  it('finds the phase whose range holds the day, earlier or later alike', () => {
    expect(phaseForDay(SEASON, '2026-09-22')?.id).toBe('w1')
    expect(phaseForDay(SEASON, '2026-10-07')?.id).toBe('w3')
  })

  it('counts both ends of a phase as inside it', () => {
    expect(phaseForDay(SEASON, '2026-09-26')?.id).toBe('w2')
    expect(phaseForDay(SEASON, '2026-10-02')?.id).toBe('w2')
  })

  it('answers null for a day outside every phase — the caller refuses it', () => {
    expect(phaseForDay(SEASON, '2026-10-20')).toBeNull()
    expect(phaseForDay(SEASON, '2026-09-01')).toBeNull()
    expect(phaseForDay(SEASON, '')).toBeNull()
  })

  it('a phase with no start of its own begins the day after the one before it', () => {
    const season = [WEEK_1, { ...WEEK_2, startsOn: null }]
    expect(phaseRanges(season)[1]).toEqual({ phase: season[1], from: '2026-09-26', to: '2026-10-02' })
    expect(phaseForDay(season, '2026-09-27')?.id).toBe('w2')
  })
})

describe('the working week, said in words', () => {
  // I66.8: a day shows its year only when it is not this year, so pin "today" (the date only).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-29T09:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  it('reads Sun–Thu as one unbroken run', () => {
    expect(workingWeekSpan(IRAQ_WORKING_CALENDAR)).toEqual({ from: 7, to: 4 })
  })

  it('reads a Mon–Fri office too', () => {
    expect(workingWeekSpan({ workingDays: [1, 2, 3, 4, 5] })).toEqual({ from: 1, to: 5 })
  })

  it('refuses to say "Sun – Thu" about a week with a hole in it', () => {
    expect(workingWeekSpan({ workingDays: [7, 1, 3, 4] })).toBeNull()
    expect(workingWeekSpan({ workingDays: [] })).toBeNull()
  })

  it('names the days that are never counted', () => {
    expect(restDays(IRAQ_WORKING_CALENDAR)).toEqual([5, 6]) // Friday, Saturday
  })

  it('formats a day as "Wed, 30 Sep", a range and a weekday without one, in both languages (I66.8)', () => {
    expect(formatPlanDay('2026-09-30')).toBe('Wed, 30 Sep')
    expect(formatPlanDay('2026-10-02')).toBe('Fri, 2 Oct')
    expect(formatPlanDay('2027-10-09')).toBe('Sat, 9 Oct 2027') // the year only when it is not this year
    expect(formatPlanDay('2026-10-02', 'en', false)).toBe('2 Oct')
    expect(formatPlanRange('2026-09-26', '2026-10-02')).toBe('26 Sep – 2 Oct')
    expect(formatPlanRange(null, '2026-10-02')).toBe('2 Oct')
    expect(formatWeekday(7)).toBe('Sun')
    expect(formatWeekday(4)).toBe('Thu')
    expect(formatPlanDay('2026-09-30', 'ar')).toBe('الأربعاء، 30 سبتمبر')
    expect(formatPlanRange('2026-09-26', '2026-10-02', 'ar')).toBe('26 سبتمبر – 2 أكتوبر')
    for (const s of [formatPlanRange('2026-09-26', '2026-10-02', 'ar'), formatWeekday(7, 'ar')]) {
      expect(s).not.toMatch(/[,،]/)
      expect(s.length).toBeGreaterThan(0)
    }
  })

  it('reads the day it was given and never the day before it', () => {
    // A `YYYY-MM-DD` put through a local Date is midnight UTC, which in a western zone is the
    // previous evening. Formatting in UTC is what keeps 1 Oct from printing as 30 Sep.
    expect(formatPlanDay('2026-10-01')).toBe('Thu, 1 Oct')
    expect(formatPlanDay('2026-01-01')).toBe('Thu, 1 Jan')
  })

  it('hands back an unparseable day rather than inventing one', () => {
    expect(formatPlanDay('')).toBe('')
    expect(formatPlanDay('not-a-date')).toBe('not-a-date')
  })
})

describe('the whole season', () => {
  it('plans each phase from its own event, and leaves a piece in no phase unplanned', () => {
    const rows = [
      piece({ id: 'a', phaseId: 'w1' }),
      piece({ id: 'b', phaseId: 'w2' }),
      piece({ id: 'orphan', phaseId: 'gone' }),
    ]
    const plan = planCampaign(SEASON, rows, ctx)
    expect(plan.map((p) => [p.phase.id, p.dueOn, p.pieces.length])).toEqual([
      ['w1', '2026-09-23', 1],
      ['w2', '2026-09-30', 1],
      ['w3', '2026-10-07', 0],
      ['w4', '2026-10-14', 0],
    ])
  })

  it('carries "given to client" through as a marker and nothing else', () => {
    // Q4: no second date, no evidence. It travels; it changes no arithmetic.
    const marked = piece({ id: 'a', givenToClient: true, needsWorkingDays: 4 })
    const p = planPiece(marked, WEEK_2, ctx)
    const plain = planPiece({ ...marked, givenToClient: false }, WEEK_2, ctx)
    expect(p.givenToClient).toBe(true)
    expect([p.dueOn, p.startsOn, p.fit]).toEqual([plain.dueOn, plain.startsOn, plain.fit])
  })
})
