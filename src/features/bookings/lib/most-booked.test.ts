import { describe, expect, it } from 'vitest'
import { isMostBookedInTeam } from './most-booked'

describe('isMostBookedInTeam — Your week (I59 Track 6)', () => {
  const people = [
    { userId: 'me', teamId: 't1', utilPct: 90 },
    { userId: 'lujain', teamId: 't1', utilPct: 70 },
    { userId: 'omar', teamId: 't2', utilPct: 120 },
  ]
  it('is true when I am strictly above every teammate (another team does not count)', () => {
    expect(isMostBookedInTeam(people, 'me')).toBe(true)
  })
  it('is false on a tie, below a teammate, alone, with no team, or unknown', () => {
    expect(isMostBookedInTeam([...people, { userId: 'hasan', teamId: 't1', utilPct: 90 }], 'me')).toBe(false)
    expect(isMostBookedInTeam(people, 'lujain')).toBe(false)
    expect(isMostBookedInTeam(people, 'omar')).toBe(false)
    expect(isMostBookedInTeam([{ userId: 'me', teamId: null, utilPct: 90 }], 'me')).toBe(false)
    expect(isMostBookedInTeam(people, null)).toBe(false)
    expect(isMostBookedInTeam(people, 'ghost')).toBe(false)
  })
})
