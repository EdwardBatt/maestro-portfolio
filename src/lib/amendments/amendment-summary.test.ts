import { describe, expect, it } from 'vitest'
import { amendmentsOf, indexSummary } from './amendment-summary'

describe('amendment summary (ADR-0142 d.3)', () => {
  const s = indexSummary([
    { level: 'deliverable', id: 'd1', amendments: '2', hours: '3.5' },
    { level: 'campaign', id: 'c1', amendments: 4, hours: 11.5 },
    { level: 'client', id: 'k1', amendments: 4, hours: null },
    { level: 'campaign', id: null, amendments: 1, hours: 1 },
  ])

  it('indexes each level by id, reading PostgREST numerics as numbers', () => {
    expect(amendmentsOf(s, 'deliverable', 'd1')).toEqual({ amendments: 2, hours: 3.5 })
    expect(amendmentsOf(s, 'campaign', 'c1')).toEqual({ amendments: 4, hours: 11.5 })
    expect(amendmentsOf(s, 'client', 'k1')).toEqual({ amendments: 4, hours: 0 })
  })

  it('says nothing for a piece with no amendment, an unknown level or a missing id', () => {
    expect(amendmentsOf(s, 'deliverable', 'd2')).toBeNull()
    expect(amendmentsOf(s, 'client', 'c1')).toBeNull()
    expect(amendmentsOf(s, 'campaign', null)).toBeNull()
    expect(amendmentsOf(undefined, 'campaign', 'c1')).toBeNull()
  })
})
