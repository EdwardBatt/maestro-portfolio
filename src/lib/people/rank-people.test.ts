import { describe, expect, it } from 'vitest'
import { rankPeople } from './rank-people'

/**
 * Edward, 29 Aug: "is it a true smart filter… so if I typed L would it filter to all names
 * starting with L?"
 *
 * The first version delegated to `<datalist>` and the answer was "sort of, and differently in every
 * browser" — Chrome matches a substring anywhere, so "L" also surfaced "Omar Al-Rawi". The match is
 * ours now, and this is the promise: prefix first, substring after.
 */
const PEOPLE = [
  { id: 'u1', name: 'Lina Haddad', hint: 'Creative' },
  { id: 'u2', name: 'Omar Al-Rawi', hint: 'Production' },
  { id: 'u3', name: 'Fadia Kadri', hint: 'Content' },
  { id: 'u4', name: 'Laith Saeed', hint: 'Performance' },
]

describe('rankPeople — the filter itself', () => {
  it('typing L shows the names that START with L', () => {
    expect(rankPeople(PEOPLE, 'L').map((p) => p.name)).toEqual([
      'Lina Haddad',
      'Laith Saeed',
      // Ranked below, not excluded: "Omar Al-Rawi" contains an l, and a surname is still a name
      // people search by.
      'Omar Al-Rawi',
    ])
  })

  it('ranks a prefix above a substring', () => {
    // "Kadri" is a surname; "Fadia" opens with F. Searching "a" must not bury the openers.
    const out = rankPeople(PEOPLE, 'la').map((p) => p.name)
    expect(out[0]).toBe('Laith Saeed')
  })

  it('finds a surname, which is what people actually type', () => {
    expect(rankPeople(PEOPLE, 'rawi').map((p) => p.name)).toEqual(['Omar Al-Rawi'])
  })

  it('ignores case and stray whitespace', () => {
    expect(rankPeople(PEOPLE, '  LINA ').map((p) => p.name)).toEqual(['Lina Haddad'])
  })

  it('offers everybody when nothing has been typed', () => {
    expect(rankPeople(PEOPLE, '')).toHaveLength(4)
  })

  it('offers nobody rather than everybody when nothing matches', () => {
    expect(rankPeople(PEOPLE, 'zzz')).toEqual([])
  })
})
