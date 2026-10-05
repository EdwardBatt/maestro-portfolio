import { describe, expect, it } from 'vitest'
import { bookedHoursBetween, bookingHours, hoursRemaining } from './booked-hours'

const H = 3_600_000
const T0 = Date.parse('2026-09-24T06:00:00Z') // 09:00 Baghdad

describe('booked hours (ADR-0075 d.4, I57.12)', () => {
  it('a booking holds its load in hours, else its length', () => {
    expect(bookingHours({ start: T0, end: T0 + 4 * H, loadPct: 50 })).toBe(4)
    expect(bookingHours({ start: T0, end: T0 + 3 * H, loadPct: null })).toBe(3)
    // A range booking at 50 % over three days is four hours on each.
    expect(bookingHours({ start: T0, end: T0 + 2 * 24 * H + 4 * H, loadPct: 50 })).toBe(12)
  })

  it('counts only the part of each booking inside the window', () => {
    const b = [
      { start: T0 - 24 * H, end: T0 - 20 * H, loadPct: 50 }, // yesterday: gone
      { start: T0, end: T0 + 4 * H, loadPct: 50 }, // today, half of it already behind now
      { start: T0 + 24 * H, end: T0 + 28 * H, loadPct: 50 }, // tomorrow
      { start: T0 + 48 * H, end: T0 + 52 * H, loadPct: 50 }, // past the deadline
    ]
    expect(bookedHoursBetween(b, T0 + 2 * H, T0 + 30 * H)).toBe(6)
  })

  it('nothing booked is zero', () => {
    expect(bookedHoursBetween([], T0, T0 + 10 * H)).toBe(0)
  })
})

describe('hours remaining this round', () => {
  it('is the hours less the minutes logged, never below zero', () => {
    expect(hoursRemaining(8, [{ minutes: 90, startedAt: null, submittedAt: null }], T0)).toBe(6.5)
    expect(hoursRemaining(1, [{ minutes: 120, startedAt: null, submittedAt: null }], T0)).toBe(0)
  })

  it('a running timer counts up to now', () => {
    const running = { minutes: null, startedAt: new Date(T0 - 2 * H).toISOString(), submittedAt: null }
    expect(hoursRemaining(8, [running], T0)).toBe(6)
  })

  it('no stated hours: not judged', () => {
    expect(hoursRemaining(null, [], T0)).toBeNull()
    expect(hoursRemaining(0, [], T0)).toBeNull()
  })
})
