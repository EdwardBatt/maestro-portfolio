import { describe, expect, it } from 'vitest'
import { assessDrop, hasFindings, landsOnDay, overloadFor, pastCommitmentFor, pastPieceDue, taskSpanDays } from './drop-check'
import type { ScheduleBooking, ScheduleResource } from '../api/schedule-api'

/**
 * I41.5. Dragging a chip asked only "may I write this row" and then moved it. A Friday, a blackout
 * and a day already over its ceiling were all silent — the target cell's shading was the whole
 * signal. Edward found it while testing I41.2: "dragged it back to Friday, no warning."
 */

const person = (over: Partial<ScheduleResource> = {}): ScheduleResource =>
  ({
    id: 'r1', name: 'Sam', nickname: null, kind: 'human', userId: 'u1',
    capacityModel: 'load_based', warnAtPct: 100, ceilingPct: 200, poolSize: null,
    office: { name: 'Baghdad', timezone: 'UTC', workingDays: [7, 1, 2, 3, 4] },
    ...over,
  }) as ScheduleResource

const booking = (id: string, loadPct: number): ScheduleBooking =>
  ({ id, resourceId: 'r1', state: 'confirmed', loadPct, start: 0, end: 0 }) as unknown as ScheduleBooking

const clean = { nonWorking: false, blackout: false }

describe('assessDrop (I41.5)', () => {
  it('says nothing about an ordinary drop on a free working day', () => {
    const check = assessDrop({ targetResource: person(), cellBookings: [], moving: booking('b1', 50), ...clean })
    expect(hasFindings(check)).toBe(false)
  })

  it('flags a day the office does not work', () => {
    const check = assessDrop({
      targetResource: person(), cellBookings: [], moving: booking('b1', 50), nonWorking: true, blackout: false,
    })
    expect(check.nonWorking).toBe(true)
    expect(hasFindings(check)).toBe(true)
  })

  it('flags a blackout', () => {
    const check = assessDrop({
      targetResource: person(), cellBookings: [], moving: booking('b1', 50), nonWorking: false, blackout: true,
    })
    expect(hasFindings(check)).toBe(true)
  })

  it('counts the moving booking INTO the target day, so a full day is caught before it commits', () => {
    // 100% already there, and 50% arriving: over the 100% warn line.
    const check = assessDrop({
      targetResource: person(), cellBookings: [booking('other', 100)], moving: booking('b1', 50), ...clean,
    })
    expect(check.overload).toEqual({ level: 'warn', pct: 150 })
  })

  it('reports a breach past the ceiling, not just a warning', () => {
    const check = assessDrop({
      targetResource: person(), cellBookings: [booking('other', 175)], moving: booking('b1', 50), ...clean,
    })
    expect(check.overload?.level).toBe('breach')
  })

  /**
   * The one that would have produced a phantom warning: dragging a chip one day sideways inside the
   * same row. The booking is already in that cell's list, so counting it again reports an overload
   * that exists only because it was double-counted.
   */
  it('does not count the moving booking twice when it is already on the target day', () => {
    const moving = booking('b1', 120)
    const check = assessDrop({ targetResource: person(), cellBookings: [moving], moving, ...clean })
    expect(check.overload).toEqual({ level: 'warn', pct: 120 })
  })

  it('ignores anything not confirmed', () => {
    const tentative = { ...booking('t1', 200), state: 'tentative' } as ScheduleBooking
    const check = assessDrop({
      targetResource: person(), cellBookings: [tentative], moving: booking('b1', 50), ...clean,
    })
    expect(check.overload).toBeNull()
  })
})

describe('overloadFor — unchanged behaviour, now testable outside the grid', () => {
  it('counts an exclusive resource by bookings, not load', () => {
    const camera = person({ capacityModel: 'exclusive', kind: 'equipment', userId: null })
    expect(overloadFor(camera, [booking('a', 0), booking('b', 0)])).toEqual({ level: 'breach', count: 2 })
    expect(overloadFor(camera, [booking('a', 0)])).toBeNull()
  })

  it('counts a pooled resource against its pool size', () => {
    const pool = person({ capacityModel: 'pooled', poolSize: 2 })
    expect(overloadFor(pool, [booking('a', 0), booking('b', 0)])).toBeNull()
    expect(overloadFor(pool, [booking('a', 0), booking('b', 0), booking('c', 0)])?.count).toBe(3)
  })
})

/**
 * I59.13 (ADR-0105 d.5, D5). The check both screens run on a drop gains one rule: the moved work
 * ends after the task's committed date. It warns (L6) and never refuses — "Move it anyway" stays.
 */
describe('past the committed date (I59.13)', () => {
  it('measures a task span first to last day, inclusive, never under one', () => {
    expect(taskSpanDays('2026-09-20T06:00:00Z', '2026-09-23T14:00:00Z')).toBe(4)
    expect(taskSpanDays('2026-09-20T06:00:00Z', '2026-09-20T14:00:00Z')).toBe(1)
    expect(taskSpanDays(null, '2026-09-20T14:00:00Z')).toBe(1)
  })

  it('lands on the drop day plus the span', () => {
    expect(landsOnDay('2026-09-24', 1)).toBe('2026-09-24')
    expect(landsOnDay('2026-09-24', 4)).toBe('2026-09-27')
  })

  it('says how late, in days, against the committed Iraq day', () => {
    // 21:30 UTC on the 24th is already the 25th in Baghdad (ADR-0076): the commitment is the 25th.
    expect(pastCommitmentFor('2026-09-27', '2026-09-24T21:30:00Z')).toEqual({ committedDay: '2026-09-25', landsOn: '2026-09-27', daysLate: 2 })
    expect(pastCommitmentFor('2026-09-24', '2026-09-24T14:00:00Z')).toBeNull()
    expect(pastCommitmentFor('2026-09-27', null)).toBeNull()
  })

  it('is a finding of the drop, on its own', () => {
    const check = assessDrop({
      targetResource: person(), cellBookings: [], moving: booking('b1', 50), ...clean,
      commitment: { committedDueAt: '2026-09-24T14:00:00Z', landsOn: '2026-09-27' },
    })
    expect(check.pastCommitment?.daysLate).toBe(3)
    expect(check.overload).toBeNull()
    expect(hasFindings(check)).toBe(true)
  })

  it('says nothing when the move stays inside the commitment, or there is none', () => {
    const inside = assessDrop({
      targetResource: person(), cellBookings: [], moving: booking('b1', 50), ...clean,
      commitment: { committedDueAt: '2026-09-24T14:00:00Z', landsOn: '2026-09-23' },
    })
    expect(hasFindings(inside)).toBe(false)
    const none = assessDrop({ targetResource: person(), cellBookings: [], moving: booking('b1', 50), ...clean, commitment: null })
    expect(none.pastCommitment).toBeNull()
  })
})

describe('pastPieceDue — when a move offers the change form (ADR-0141 d.2, I74 fix-up)', () => {
  // The piece is due Thursday 1 Oct, close of business Baghdad (14:00Z); the task is committed to Tuesday 29 Sep.
  const pieceDue = '2026-10-01T14:00:00Z'
  it('past the task commitment but on or before the piece date: no form — the lead may move it', () => {
    expect(pastCommitmentFor('2026-09-30', '2026-09-29T14:00:00Z')).not.toBeNull()
    expect(pastPieceDue('2026-09-30', pieceDue)).toBe(false)
    expect(pastPieceDue('2026-10-01', pieceDue)).toBe(false)
  })
  it('past the piece date: the form opens', () => {
    expect(pastPieceDue('2026-10-02', pieceDue)).toBe(true)
  })
  it('the piece date is read as the Iraq day, not the UTC one', () => {
    // 21:30Z on the 30th is 00:30 on 1 Oct in Baghdad: landing on the 1st is not past it.
    expect(pastPieceDue('2026-10-01', '2026-09-30T21:30:00Z')).toBe(false)
    expect(pastPieceDue('2026-10-02', '2026-09-30T21:30:00Z')).toBe(true)
  })
  it('no piece date or no landing day: nothing to ask', () => {
    expect(pastPieceDue('2026-10-02', null)).toBe(false)
    expect(pastPieceDue(null, pieceDue)).toBe(false)
  })
})
