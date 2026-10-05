import { describe, expect, it } from 'vitest'
import { dayLoad, freeHoursOf, internalLoad, weekNote } from './day-load'
import { overloadFor } from './drop-check'
import type { ScheduleBooking, ScheduleResource } from '../api/schedule-api'

/**
 * I74.24 — "8h free / Full / 4h over / On leave". The words in a cell must be the drop warning's own
 * judgement, so every case here is also checked against `overloadFor`.
 */
const person = { capacityModel: 'load_based', warnAtPct: 100, ceilingPct: 120, poolSize: null } as Pick<ScheduleResource, 'capacityModel' | 'warnAtPct' | 'ceilingPct' | 'poolSize'>
const b = (hours: number, state: ScheduleBooking['state'] = 'confirmed') => ({ state, loadPct: (hours / 8) * 100 })

describe('dayLoad', () => {
  it('an empty working day is 8h free', () => {
    expect(dayLoad(person, [])).toMatchObject({ state: 'free', freeHours: 8, bookedHours: 0 })
  })
  it('a part-booked day says what is left', () => {
    expect(dayLoad(person, [b(2)])).toMatchObject({ state: 'free', freeHours: 6 })
  })
  it('exactly a full day is Full, and the drop check agrees it is not over', () => {
    expect(dayLoad(person, [b(8)]).state).toBe('full')
    expect(overloadFor(person, [b(8)])).toBeNull()
  })
  it('past a full day is over by the difference — the same day the drop check calls over', () => {
    const d = dayLoad(person, [b(8), b(4)])
    expect(d).toMatchObject({ state: 'over', overHours: 4, bookedHours: 12, freeHours: 0 })
    expect(overloadFor(person, [b(8), b(4)])).not.toBeNull()
  })
  it('counts confirmed work only, as the overload badge does', () => {
    expect(dayLoad(person, [b(8, 'tentative')])).toMatchObject({ state: 'free', freeHours: 8 })
  })
  it('leave and a day off have no free hours', () => {
    expect(dayLoad(person, [], { onLeave: true })).toMatchObject({ state: 'leave', freeHours: 0 })
    expect(dayLoad(person, [], { nonWorking: true })).toMatchObject({ state: 'off', freeHours: 0 })
  })
})

describe('freeHoursOf — "24h free this week"', () => {
  it('over days give nothing back', () => {
    // SC-01, Basheer: 1h over, 4h over, then three free days.
    const week = [dayLoad(person, [b(9)]), dayLoad(person, [b(12)]), dayLoad(person, []), dayLoad(person, []), dayLoad(person, [])]
    expect(freeHoursOf(week)).toBe(24)
  })
  it('leave counts as nothing', () => {
    // SC-01, Fadia: Full, on leave, three free days.
    const week = [dayLoad(person, [b(8)]), dayLoad(person, [], { onLeave: true }), dayLoad(person, []), dayLoad(person, []), dayLoad(person, [])]
    expect(freeHoursOf(week)).toBe(24)
  })
})

describe('weekNote — the line under a name in Who', () => {
  const days = (loads: ReturnType<typeof dayLoad>[]) => loads.map((load, i) => ({ isoDate: `2026-09-${27 + i}`, load }))
  it('names an over day first', () => {
    expect(weekNote(days([dayLoad(person, []), dayLoad(person, [b(12)])]))).toEqual({ kind: 'over', hours: 4, isoDate: '2026-09-28' })
  })
  it('then leave', () => {
    expect(weekNote(days([dayLoad(person, [b(8)]), dayLoad(person, [], { onLeave: true })]))).toEqual({ kind: 'leave', isoDate: '2026-09-28' })
  })
  it('then the first run of full days', () => {
    expect(weekNote(days([dayLoad(person, [b(8)]), dayLoad(person, [b(8)]), dayLoad(person, [b(8)]), dayLoad(person, [b(2)])])))
      .toEqual({ kind: 'full', from: '2026-09-27', to: '2026-09-29' })
  })
  it('else the run of whole free days', () => {
    expect(weekNote(days([dayLoad(person, [b(2)]), dayLoad(person, []), dayLoad(person, []), dayLoad(person, [])])))
      .toEqual({ kind: 'free', from: '2026-09-28', to: '2026-09-30' })
  })
})

describe('internal work counts in the day (ADR-0142 d.4, I74.25)', () => {
  it('takes its hours out of the free hours — partial, not a whole-day block', () => {
    expect(dayLoad(person, [...internalLoad(3.5)])).toMatchObject({ state: 'free', freeHours: 4.5, bookedHours: 3.5 })
  })
  it('with bookings, it can make the day go over — and the drop check agrees', () => {
    const cell = [b(6), ...internalLoad(4)]
    expect(dayLoad(person, cell)).toMatchObject({ state: 'over', overHours: 2 })
    expect(overloadFor(person, cell)).not.toBeNull()
  })
  it('adds nothing when there are no hours', () => {
    expect(internalLoad(0)).toEqual([])
  })
})
