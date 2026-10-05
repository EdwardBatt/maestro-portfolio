import { describe, expect, it } from 'vitest'
import { groupByRound } from './review-rounds'

describe('groupByRound (ADR-0025, I3.3)', () => {
  it('groups by round, newest round first, order preserved within a round', () => {
    const groups = groupByRound([
      { id: 'a', round: 1 },
      { id: 'b', round: 2 },
      { id: 'c', round: 1 },
      { id: 'd', round: 2 },
    ])
    expect(groups.map((g) => g.round)).toEqual([2, 1])
    expect(groups[0].comments.map((c) => c.id)).toEqual(['b', 'd'])
    expect(groups[1].comments.map((c) => c.id)).toEqual(['a', 'c'])
  })

  it('handles an empty list', () => {
    expect(groupByRound([])).toEqual([])
  })

  it('single round → one group', () => {
    const groups = groupByRound([{ id: 'a', round: 3 }, { id: 'b', round: 3 }])
    expect(groups).toHaveLength(1)
    expect(groups[0].round).toBe(3)
  })
})
