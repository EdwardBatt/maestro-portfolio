import { describe, expect, it } from 'vitest'
import { localDayOf, localDaysInSpan, nonWorkingDaysInSpan } from './working-week.ts'
import { assessCandidate } from './engine.ts'
import type { OfficeCalendar, Span } from './types.ts'

// ADR-0005 fixtures: real Meridian office shapes.
const BAGHDAD: OfficeCalendar = { timezone: 'Asia/Baghdad', workingDays: [7, 1, 2, 3, 4] } // Sun–Thu
const DUBAI: OfficeCalendar = { timezone: 'Asia/Dubai', workingDays: [1, 2, 3, 4, 5] } // Mon–Fri
const CAIRO: OfficeCalendar = { timezone: 'Africa/Cairo', workingDays: [7, 1, 2, 3, 4] } // Sun–Thu, observes DST

const spanUTC = (iso1: string, iso2: string): Span => ({ start: Date.parse(iso1), end: Date.parse(iso2) })

describe('office-local day resolution (§12: timezone edges over-specified)', () => {
  it('an instant can be Thursday in Dubai and still Wednesday in a western zone — office wins', () => {
    // 2026-07-30 22:00 UTC = 2026-07-31 02:00 Dubai (Friday) — non-working there
    const t = Date.parse('2026-07-30T22:00:00Z')
    expect(localDayOf(t, 'Asia/Dubai').isoDate).toBe('2026-07-31')
    expect(localDayOf(t, 'Asia/Baghdad').isoDate).toBe('2026-07-31') // 01:00 Friday Baghdad
  })

  it('Friday is non-working in Baghdad; Saturday is non-working in Dubai but Sunday works in Baghdad', () => {
    // Friday 2026-07-31 10:00 Baghdad time (07:00Z)
    const friday = spanUTC('2026-07-31T07:00:00Z', '2026-07-31T09:00:00Z')
    expect(nonWorkingDaysInSpan(friday, BAGHDAD)).toEqual(['2026-07-31'])
    // Sunday 2026-08-02: working day in Baghdad, weekend in Dubai
    const sunday = spanUTC('2026-08-02T07:00:00Z', '2026-08-02T09:00:00Z')
    expect(nonWorkingDaysInSpan(sunday, BAGHDAD)).toEqual([])
    expect(nonWorkingDaysInSpan(sunday, DUBAI)).toEqual(['2026-08-02'])
  })

  it('multi-day span enumerates each office-local day exactly once', () => {
    // Thu 06:00Z → Sun 06:00Z touches Thu, Fri, Sat, Sun in Baghdad (UTC+3)
    const days = localDaysInSpan(spanUTC('2026-07-30T06:00:00Z', '2026-08-02T06:00:00Z'), 'Asia/Baghdad')
    expect(days.map((d) => d.isoDate)).toEqual(['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02'])
  })

  it('Cairo DST fall-back day (25h) is not duplicated or skipped', () => {
    // Egypt ends DST on the last Thursday of October 2026 (2026-10-29, clocks back at midnight).
    const around = spanUTC('2026-10-28T12:00:00Z', '2026-10-31T12:00:00Z')
    const days = localDaysInSpan(around, 'Africa/Cairo').map((d) => d.isoDate)
    expect(new Set(days).size).toBe(days.length) // unique
    expect(days).toContain('2026-10-29')
    expect(days).toContain('2026-10-30')
  })

  it('a span ending exactly at office midnight does not leak into the next day', () => {
    // 2026-08-03 21:00Z = 2026-08-04 00:00 Baghdad (UTC+3): end-exclusive span must not include Aug 4
    const s = spanUTC('2026-08-03T18:00:00Z', '2026-08-03T21:00:00Z')
    expect(localDaysInSpan(s, 'Asia/Baghdad').map((d) => d.isoDate)).toEqual(['2026-08-03'])
  })
})

describe('working week in the assessment (ADR-0005: warn, never hide or block)', () => {
  const sarah = { model: 'load_based', ceilingPct: 120, warnAtPct: 100 } as const

  it('booking a Baghdad resource on Friday warns with the exact dates', () => {
    const a = assessCandidate({
      resource: sarah, candidate: spanUTC('2026-07-31T06:00:00Z', '2026-07-31T10:00:00Z'),
      candidateLoadPct: 40, existing: [], blackouts: [], office: BAGHDAD,
    })
    expect(a.level).toBe('warn')
    expect(a.reasons).toEqual(['non_working_day'])
    expect(a.nonWorkingDays).toEqual(['2026-07-31'])
  })

  it('the same Friday instant is a working day for Dubai — no warning', () => {
    const a = assessCandidate({
      resource: sarah, candidate: spanUTC('2026-07-31T06:00:00Z', '2026-07-31T10:00:00Z'),
      candidateLoadPct: 40, existing: [], blackouts: [], office: DUBAI,
    })
    expect(a.level).toBe('ok')
  })

  it('Cairo Sunday works; Cairo Saturday warns', () => {
    const sun = assessCandidate({
      resource: sarah, candidate: spanUTC('2026-08-02T08:00:00Z', '2026-08-02T12:00:00Z'),
      candidateLoadPct: 40, existing: [], blackouts: [], office: CAIRO,
    })
    expect(sun.level).toBe('ok')
    const sat = assessCandidate({
      resource: sarah, candidate: spanUTC('2026-08-01T08:00:00Z', '2026-08-01T12:00:00Z'),
      candidateLoadPct: 40, existing: [], blackouts: [], office: CAIRO,
    })
    expect(sat.nonWorkingDays).toEqual(['2026-08-01'])
  })
})
