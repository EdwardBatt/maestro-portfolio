import { describe, expect, it } from 'vitest'
import { teamWeekPct, weekOptions, weekWord, workingRange } from './week-menu'
import { resourceInReach, viewerReach } from './team-reach'
import type { ScheduleBooking, ScheduleResource } from '../api/schedule-api'

const SUN = Date.parse('2026-09-27T00:00:00Z')
const H = 3_600_000
const person = (id: string): ScheduleResource => ({
  id, name: id, nickname: null, kind: 'human', userId: id, departmentId: null, departmentName: null, teamId: null, teamName: null,
  officeId: null, capacityModel: 'load_based', warnAtPct: 100, ceilingPct: 120, poolSize: null, requiresApproval: false,
  office: { name: 'Baghdad', timezone: 'UTC', workingDays: [7, 1, 2, 3, 4] },
})
const booking = (resourceId: string, start: number, hours: number) =>
  ({ id: `${resourceId}${start}`, resourceId, state: 'confirmed', start, end: start + hours * H, loadPct: (hours / 8) * 100 }) as ScheduleBooking

describe('the weeks menu (I74.24, SC-20)', () => {
  it('how full the team is: booked over two people\'s 40 hours', () => {
    const team = [person('a'), person('b')]
    expect(teamWeekPct(team, [booking('a', SUN + 9 * H, 8), booking('b', SUN + 9 * H, 8)], SUN)).toBe(20)
    // a booking with no load counts nothing, as in the cells
    expect(teamWeekPct(team, [{ ...booking('a', SUN + 9 * H, 8), loadPct: null }], SUN)).toBe(0)
  })
  it('lists last week, this week and the three after', () => {
    const opts = weekOptions(SUN, [person('a')], [])
    expect(opts.map((o) => o.offset)).toEqual([-1, 0, 1, 2, 3])
    expect(opts[2]!.start).toBe(SUN + 7 * 86_400_000)
  })
  it('names this, next and last week', () => {
    expect(weekWord(SUN, SUN)).toBe('this')
    expect(weekWord(SUN + 7 * 86_400_000, SUN)).toBe('next')
    expect(weekWord(SUN - 7 * 86_400_000, SUN)).toBe('last')
    expect(weekWord(SUN + 14 * 86_400_000, SUN)).toBeNull()
  })
  it('a Sun–Thu week reads 27 Sep – 1 Oct', () => {
    expect(workingRange(SUN)).toEqual({ from: '2026-09-27', to: '2026-10-01' })
  })
})

describe('whose week the grid opens on (ADR-0139 d.6)', () => {
  it('a team lead her team, a department lead his department, Traffic everyone, an account manager nobody (falls back)', () => {
    expect(viewerReach('team', 'cr', 'design')).toEqual({ kind: 'team', teamId: 'design', departmentId: 'cr' })
    expect(viewerReach('department', 'cr', null)).toEqual({ kind: 'department', departmentId: 'cr' })
    expect(viewerReach('tenant', null, null)).toEqual({ kind: 'all' })
    expect(viewerReach('account', null, null)).toEqual({ kind: 'none' })
  })
  it('reads a row by its team, or by its effective department', () => {
    expect(resourceInReach({ teamId: 'design' }, 'cr', { kind: 'team', teamId: 'design', departmentId: 'cr' })).toBe(true)
    expect(resourceInReach({ teamId: 'motion' }, 'cr', { kind: 'team', teamId: 'design', departmentId: 'cr' })).toBe(false)
    expect(resourceInReach({ teamId: 'motion' }, 'cr', { kind: 'department', departmentId: 'cr' })).toBe(true)
  })
})
