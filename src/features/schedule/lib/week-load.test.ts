import { describe, expect, it } from 'vitest'
import { bookedHoursInWeek, roomCandidates, weekLoadPct, weekStartOf, withRoom } from './week-load'
import type { ScheduleBooking, ScheduleResource } from '../api/schedule-api'

const SUN = Date.parse('2026-09-20T00:00:00Z')
const H = 3_600_000
const b = (resourceId: string, dayOffset: number, hours: number): ScheduleBooking =>
  ({ id: `${resourceId}-${dayOffset}`, resourceId, start: SUN + dayOffset * 86_400_000 + 6 * H, end: SUN + dayOffset * 86_400_000 + (6 + hours) * H }) as ScheduleBooking
const person = (id: string, name: string, over: Partial<ScheduleResource> = {}): ScheduleResource =>
  ({ id, name, nickname: null, kind: 'human', userId: `u-${id}`, warnAtPct: 100, office: { name: 'B', timezone: 'UTC', workingDays: [7, 1, 2, 3, 4] }, ...over }) as ScheduleResource

describe('week load — the figure the move warnings name (I59.13)', () => {
  it('is booked hours over the working week, as a whole percent', () => {
    expect(weekLoadPct(20, 5)).toBe(50)
    expect(weekLoadPct(44, 5)).toBe(110)
    expect(weekLoadPct(10, 0)).toBe(0)
  })

  it('counts only the week asked for', () => {
    const books = [b('r1', 0, 8), b('r1', 2, 4), b('r1', 8, 8), b('r2', 0, 8)]
    expect(bookedHoursInWeek('r1', books, SUN)).toBe(12)
  })

  it('names who has room, emptiest first, and never the person dragged onto', () => {
    const rs = [person('a', 'Zubaida'), person('b', 'Fadia'), person('c', 'Lujain'), person('room', 'Studio', { kind: 'room', userId: null })]
    const books = [b('a', 0, 8), b('a', 1, 8), b('a', 2, 8), b('a', 3, 8), b('a', 4, 8), b('b', 0, 8), b('c', 0, 4)]
    const cands = roomCandidates(rs, books, SUN)
    expect(cands.map((c) => c.resourceId)).toEqual(['a', 'b', 'c']) // the room is not a person
    expect(withRoom(cands).map((c) => c.name)).toEqual(['Lujain', 'Fadia']) // Zubaida is at 100%
    expect(withRoom(cands, 'c').map((c) => c.name)).toEqual(['Fadia'])
  })

  it('finds the Sunday a day belongs to', () => {
    expect(weekStartOf('2026-09-24')).toBe(SUN)
    expect(weekStartOf('2026-09-20')).toBe(SUN)
  })
})
