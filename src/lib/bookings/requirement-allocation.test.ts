import { describe, expect, it } from 'vitest'
import { allocatedHours, requirementAllocations } from './requirement-allocation'

// Baghdad: Sun–Thu (7,1,2,3,4). London: Mon–Fri, and observes DST — the reason day-level reasoning
// goes through Intl rather than calendar arithmetic.
const baghdad = { timezone: 'Asia/Baghdad', workingDays: [7, 1, 2, 3, 4] }
const london = { timezone: 'Europe/London', workingDays: [1, 2, 3, 4, 5] }

const shape = (a: ReturnType<typeof requirementAllocations>) => a.map((d) => [d.isoDate, d.hours])

describe('requirementAllocations — an asset is booked for its hours, not for whole days', () => {
  // The bug this replaced: `days` meant a 3-hour camera blocked the whole day and the grid reported
  // the studio unavailable when it was free from lunchtime.
  it('books a part-day requirement as a part day', () => {
    expect(shape(requirementAllocations('2026-09-07', 3, london))).toEqual([['2026-09-07', 3]])
  })

  it('derives load % from hours rather than asking for it (ADR-0006)', () => {
    const [day] = requirementAllocations('2026-09-07', 4, london)
    expect(day.loadPct).toBe(50) // 4h of an 8h standard day
  })

  it('fills consecutive working days, it does not spread evenly', () => {
    // 20h = a full day, a full day, then the remainder — NOT 6.7h × 3.
    expect(shape(requirementAllocations('2026-09-07', 20, london))).toEqual([
      ['2026-09-07', 8],
      ['2026-09-08', 8],
      ['2026-09-09', 4],
    ])
  })

  it('exactly two days of hours is exactly two days', () => {
    expect(shape(requirementAllocations('2026-09-07', 16, london))).toEqual([
      ['2026-09-07', 8],
      ['2026-09-08', 8],
    ])
  })

  it('steps over the office weekend rather than compressing into it', () => {
    // Fri 11th, then London's next working days are Mon 14th and Tue 15th.
    expect(shape(requirementAllocations('2026-09-11', 20, london))).toEqual([
      ['2026-09-11', 8],
      ['2026-09-14', 8],
      ['2026-09-15', 4],
    ])
  })

  it('uses the RESOURCE office calendar, not a western week', () => {
    // Fri 11th and Sat 12th are not working days in Baghdad; the run starts Sun 13th.
    expect(shape(requirementAllocations('2026-09-11', 10, baghdad))).toEqual([
      ['2026-09-13', 8],
      ['2026-09-14', 2],
    ])
  })

  it('a start date on a non-working day rolls forward, it does not fail', () => {
    expect(shape(requirementAllocations('2026-09-12', 2, london))).toEqual([['2026-09-14', 2]])
  })

  it('refuses to guess at a nonsensical requirement', () => {
    expect(requirementAllocations('2026-09-07', 0, london)).toEqual([])
    expect(requirementAllocations('2026-09-07', -4, london)).toEqual([])
    expect(requirementAllocations('not-a-date', 4, london)).toEqual([])
  })

  // A short result is the signal the caller must report as "could not place it all" — silently
  // booking fewer hours than asked is the schedule lying by a different route.
  it('places what it can and lets the caller detect the shortfall', () => {
    const none = requirementAllocations('2026-09-07', 8, { timezone: 'Europe/London', workingDays: [] })
    expect(none).toEqual([])
    expect(allocatedHours(none)).toBe(0)

    const sundaysOnly = { timezone: 'Europe/London', workingDays: [7] }
    const short = requirementAllocations('2026-09-07', 24, sundaysOnly, 8, 10)
    expect(allocatedHours(short)).toBe(8) // only one Sunday inside the lookahead
    expect(allocatedHours(short)).toBeLessThan(24)
  })

  it('crosses a DST boundary without dropping or duplicating a day', () => {
    // London leaves BST on 2026-10-25 (a Sunday); Mon 26th must still be one distinct day.
    expect(shape(requirementAllocations('2026-10-23', 24, london))).toEqual([
      ['2026-10-23', 8],
      ['2026-10-26', 8],
      ['2026-10-27', 8],
    ])
  })

  it('honours a non-standard day length', () => {
    expect(shape(requirementAllocations('2026-09-07', 9, london, 6))).toEqual([
      ['2026-09-07', 6],
      ['2026-09-08', 3],
    ])
  })
})
