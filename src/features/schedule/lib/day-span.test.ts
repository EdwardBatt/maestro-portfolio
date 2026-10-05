import { describe, expect, it } from 'vitest'
import { daySpan } from './day-span.ts'
import { localDayOf } from '../../../lib/capacity/working-week.ts'
import { expandDaily } from '../../../lib/bookings/recurrence.ts'
import { hoursToLoadPct, loadPctToHours } from '../../../lib/capacity/day-hours.ts'

describe('daySpan (ADR-0006 cell → span mapping)', () => {
  it('anchors 09:00 office-local regardless of zone', () => {
    const b = daySpan('2026-08-03', 4, 'Asia/Baghdad') // UTC+3 → 06:00Z
    expect(new Date(b.start).toISOString()).toBe('2026-08-03T06:00:00.000Z')
    expect((b.end - b.start) / 3600_000).toBe(4)
    const d = daySpan('2026-08-03', 4, 'Asia/Dubai') // UTC+4 → 05:00Z
    expect(new Date(d.start).toISOString()).toBe('2026-08-03T05:00:00.000Z')
  })

  it('Cairo DST: same calendar date maps to different UTC before/after fall-back', () => {
    const summer = daySpan('2026-10-15', 4, 'Africa/Cairo') // DST, UTC+3
    const winter = daySpan('2026-11-05', 4, 'Africa/Cairo') // standard, UTC+2
    expect(new Date(summer.start).getUTCHours()).toBe(6)
    expect(new Date(winter.start).getUTCHours()).toBe(7)
    // both are 09:00 local on the requested date
    expect(localDayOf(summer.start, 'Africa/Cairo').isoDate).toBe('2026-10-15')
    expect(localDayOf(winter.start, 'Africa/Cairo').isoDate).toBe('2026-11-05')
  })

  it('multi-day: expandDaily over a daySpan lands each instance on consecutive office days', () => {
    const first = daySpan('2026-08-03', 6, 'Asia/Baghdad')
    const spans = expandDaily({ first, repeatCount: 3, timezone: 'Asia/Baghdad' })
    expect(spans.map((s) => localDayOf(s.start, 'Asia/Baghdad').isoDate))
      .toEqual(['2026-08-03', '2026-08-04', '2026-08-05'])
  })
})

describe('hours ↔ load derivation (8h standard day)', () => {
  it('round-trips typical values', () => {
    expect(hoursToLoadPct(4)).toBe(50)
    expect(hoursToLoadPct(8)).toBe(100)
    expect(hoursToLoadPct(10)).toBe(125)
    expect(loadPctToHours(50)).toBe(4)
    expect(loadPctToHours(115)).toBe(9.2)
  })
})
