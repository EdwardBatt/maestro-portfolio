import { describe, expect, it } from 'vitest'
import { withoutLeaving } from './leaving'

/** ADR-0133 d.1: a Leaving person is offered for no new work. */
describe('withoutLeaving', () => {
  const people = [{ id: 'a', name: 'Maya' }, { id: 'b', name: 'Dina' }, { id: 'c', name: 'Shomous' }]

  it('leaves out anyone Leaving', () => {
    expect(withoutLeaving(people, new Set(['b']), (p) => p.id).map((p) => p.name)).toEqual(['Maya', 'Shomous'])
  })

  it('narrows nothing when nobody is Leaving — or the read failed', () => {
    expect(withoutLeaving(people, new Set(), (p) => p.id)).toHaveLength(3)
  })

  it('keeps a row with no person on it', () => {
    expect(withoutLeaving([{ id: null as string | null }], new Set(['x']), (r) => r.id)).toHaveLength(1)
  })
})
