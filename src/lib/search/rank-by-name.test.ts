import { describe, expect, it } from 'vitest'
import { rankByFields, rankByName } from './rank-by-name'

/**
 * The rule Edward set on the owner picker, applied to any list somebody scans by typing: *"if I
 * typed L would it filter to all names starting with L?"*
 *
 * A prefix match is what somebody expects to see first. A substring match still has to appear,
 * because a surname is a name people search by — it just ranks below. The one thing that must not
 * happen is the browser deciding: `<datalist>` answers this differently in every engine, and Chrome
 * surfaces "Omar **Al**-Rawi" for "L".
 */

const people = [
  { id: '1', name: 'Layla Hassan' },
  { id: '2', name: 'Omar Al-Rawi' },
  { id: '3', name: 'Lina Aziz' },
  { id: '4', name: 'Hassan Karim' },
]

describe('rankByName', () => {
  it('puts prefix matches before substring matches', () => {
    expect(rankByName(people, 'l', (p) => p.name).map((p) => p.id)).toEqual(['1', '3', '2'])
  })

  // "Omar Al-Rawi" must NOT come back for "L" — the browser behaviour this replaces.
  it('does not treat a mid-word letter as a prefix', () => {
    const ids = rankByName(people, 'l', (p) => p.name).map((p) => p.id)
    expect(ids.indexOf('2')).toBeGreaterThan(ids.indexOf('1'))
  })

  it('finds somebody by their surname, ranked below a first-name match', () => {
    expect(rankByName(people, 'hassan', (p) => p.name).map((p) => p.id)).toEqual(['4', '1'])
  })

  it('is case-insensitive and ignores surrounding space', () => {
    expect(rankByName(people, '  LAY ', (p) => p.name).map((p) => p.id)).toEqual(['1'])
  })

  // An empty query is not a filter. Returning [] would blank a grid the moment somebody cleared
  // the box, which reads as "there is nothing here".
  it('returns everything for an empty query', () => {
    expect(rankByName(people, '', (p) => p.name)).toHaveLength(4)
    expect(rankByName(people, '   ', (p) => p.name)).toHaveLength(4)
  })

  it('returns nothing when nothing matches, rather than everything', () => {
    expect(rankByName(people, 'zzz', (p) => p.name)).toEqual([])
  })

  it('does not mutate what it was given', () => {
    const original = [...people]
    rankByName(people, 'l', (p) => p.name)
    expect(people).toEqual(original)
  })
})

describe('rankByFields', () => {
  const deliverables = [
    { id: 'a', name: 'Hero film', type: 'Long-form Video', dept: 'Production' },
    { id: 'b', name: 'Print run', type: 'Print Advertisement', dept: 'Creative' },
    { id: 'c', name: 'Ramadan KV', type: 'Key Visual', dept: 'Creative' },
  ]
  const fields = (d: (typeof deliverables)[number]) => [d.name, d.type, d.dept]

  // The reason this exists: "print" should reach a Print Advertisement whatever it is called.
  it('matches on any field, not only the name', () => {
    expect(rankByFields(deliverables, 'print', fields).map((d) => d.id)).toEqual(['b'])
  })

  it('finds everything a department owns', () => {
    expect(rankByFields(deliverables, 'creative', fields).map((d) => d.id)).toEqual(['b', 'c'])
  })

  // A prefix hit on ANY field outranks a substring hit on any other, so the strongest match leads.
  it('ranks a prefix on one field above a substring on another', () => {
    const rows = [
      { id: 'x', name: 'Teaser', type: 'Long-form Video', dept: 'Production' },
      { id: 'y', name: 'Video wall', type: 'Key Visual', dept: 'Creative' },
    ]
    const f = (r: (typeof rows)[number]) => [r.name, r.type, r.dept]
    expect(rankByFields(rows, 'video', f).map((r) => r.id)).toEqual(['y', 'x'])
  })

  it('skips null and empty fields without matching them', () => {
    const rows = [{ id: 'n', name: 'Untyped', type: null, dept: '' }]
    const f = (r: (typeof rows)[number]) => [r.name, r.type, r.dept]
    expect(rankByFields(rows, 'untyped', f)).toHaveLength(1)
    expect(rankByFields(rows, 'x', f)).toHaveLength(0)
  })

  it('returns everything for an empty query', () => {
    expect(rankByFields(deliverables, '', fields)).toHaveLength(3)
  })
})
