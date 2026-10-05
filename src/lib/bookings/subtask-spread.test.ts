import { describe, it, expect } from 'vitest'
import { workingDaysInRange, spreadHours } from './subtask-spread'
import type { OfficeCalendar } from '../capacity/types'

// Baghdad: UTC+3, no DST. Working week Sun–Thu ⇒ ISO weekdays [7,1,2,3,4]; weekend Fri/Sat.
const BAGHDAD: OfficeCalendar = { timezone: 'Asia/Baghdad', workingDays: [7, 1, 2, 3, 4] }

// 09:00 Baghdad on a given date = 06:00Z (UTC+3).
const bgd = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 6, 0, 0)

describe('workingDaysInRange', () => {
  it('lists each working day in a Mon→Wed range', () => {
    const days = workingDaysInRange(bgd(2026, 8, 17), bgd(2026, 8, 19), BAGHDAD) // Mon..Wed
    expect(days.map((d) => d.isoDate)).toEqual(['2026-08-17', '2026-08-18', '2026-08-19'])
  })

  it('excludes the Fri/Sat weekend', () => {
    // Thu 2026-08-20 → Sun 2026-08-23: Thu(work) Fri(off) Sat(off) Sun(work) ⇒ 2 working days
    const days = workingDaysInRange(bgd(2026, 8, 20), bgd(2026, 8, 23), BAGHDAD)
    expect(days.map((d) => d.isoDate)).toEqual(['2026-08-20', '2026-08-23'])
  })

  it('handles a single day', () => {
    const days = workingDaysInRange(bgd(2026, 8, 17), bgd(2026, 8, 17), BAGHDAD)
    expect(days.map((d) => d.isoDate)).toEqual(['2026-08-17'])
  })

  it('returns nothing when due precedes start', () => {
    expect(workingDaysInRange(bgd(2026, 8, 19), bgd(2026, 8, 17), BAGHDAD)).toEqual([])
  })
})

describe('spreadHours', () => {
  it('spreads evenly across working days', () => {
    const alloc = spreadHours(12, bgd(2026, 8, 17), bgd(2026, 8, 19), BAGHDAD) // 3 days
    expect(alloc.map((a) => a.hours)).toEqual([4, 4, 4])
    expect(alloc.map((a) => a.loadPct)).toEqual([50, 50, 50]) // 4/8h
  })

  it('puts the rounding remainder on the last working day so it sums to total', () => {
    const alloc = spreadHours(10, bgd(2026, 8, 17), bgd(2026, 8, 19), BAGHDAD) // 3 days
    expect(alloc.map((a) => a.hours)).toEqual([3.3, 3.3, 3.4])
    expect(alloc.reduce((s, a) => s + a.hours, 0)).toBeCloseTo(10, 5)
  })

  it('skips the weekend when spreading across it', () => {
    const alloc = spreadHours(8, bgd(2026, 8, 20), bgd(2026, 8, 23), BAGHDAD) // Thu + Sun only
    expect(alloc.map((a) => a.isoDate)).toEqual(['2026-08-20', '2026-08-23'])
    expect(alloc.map((a) => a.hours)).toEqual([4, 4])
  })

  // ADR-0061 d.2 — **this expectation was deliberately reversed.** It used to assert `[]`, and that
  // empty array is what made the whole failure silent: the caller booked nothing, said nothing, and
  // the person pressed the button again. Five duplicate ad-hoc tasks came out of it.
  //
  // Nothing blocks (ADR-0006). Somebody who picks a Friday and a Saturday has been warned on screen
  // that they are non-working and has proceeded; the span is the answer.
  it('spreads across the span when it holds NO working day, rather than placing nothing', () => {
    // Fri→Sat: both weekend in Baghdad
    const alloc = spreadHours(8, bgd(2026, 8, 21), bgd(2026, 8, 22), BAGHDAD)
    expect(alloc.map((a) => a.isoDate)).toEqual(['2026-08-21', '2026-08-22'])
    expect(alloc.map((a) => a.hours)).toEqual([4, 4])
  })

  // The other half, and the one that keeps the change safe: the fallback fires ONLY when there is
  // no honest alternative. A span that straddles the weekend still uses the working days and skips
  // the rest — a Thursday-to-Sunday task does not quietly book somebody's Friday.
  it('still skips non-working days whenever the span has a working one', () => {
    const alloc = spreadHours(8, bgd(2026, 8, 20), bgd(2026, 8, 23), BAGHDAD)
    expect(alloc.map((a) => a.isoDate)).toEqual(['2026-08-20', '2026-08-23'])
  })

  it('returns nothing for non-positive hours', () => {
    expect(spreadHours(0, bgd(2026, 8, 17), bgd(2026, 8, 19), BAGHDAD)).toEqual([])
    expect(spreadHours(-4, bgd(2026, 8, 17), bgd(2026, 8, 19), BAGHDAD)).toEqual([])
  })

  it('returns nothing when the range is inverted', () => {
    expect(spreadHours(8, bgd(2026, 8, 19), bgd(2026, 8, 17), BAGHDAD)).toEqual([])
  })
})

describe('spreadHours — a small total over many days (I74)', () => {
  it('never books a negative day, sums back to the total, and leaves out days with nothing', () => {
    const office = { timezone: 'UTC', workingDays: [0, 1, 2, 3, 4, 5, 6] }
    const start = Date.parse('2026-10-01T00:00:00Z')
    const due = Date.parse('2026-10-12T23:00:00Z') // 12 days
    const out = spreadHours(1.3, start, due, office as never)
    expect(out.length).toBeGreaterThan(6) // the old even share (0.1 a day, remainder last) went negative here
    expect(out.every((d) => d.hours > 0)).toBe(true)
    expect(Math.round(out.reduce((s, d) => s + d.hours, 0) * 10) / 10).toBe(1.3)
    const hours = out.map((d) => d.hours)
    expect(Math.max(...hours) - Math.min(...hours)).toBeLessThanOrEqual(0.1 + 1e-9)
    expect(out[out.length - 1].hours).toBeGreaterThanOrEqual(out[0].hours)
  })
})
