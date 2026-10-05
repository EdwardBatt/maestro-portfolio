import { describe, expect, it } from 'vitest'
import { errorText, joinNames, nudgeDraft, personNamed } from './requests-text'

describe('requests-text (I59 Track 6)', () => {
  it('joins the names a Who-is-told line reads, dropping blanks and repeats', () => {
    expect(joinNames(['Fadia'], 'and')).toBe('Fadia')
    expect(joinNames(['Fadia', 'Inas', 'Hasan'], 'and')).toBe('Fadia, Inas and Hasan')
    expect(joinNames(['فادية', 'إيناس', 'حسن'], 'و', '، ')).toBe('فادية، إيناس و حسن')
    expect(joinNames(['Inas', null, '', 'Inas'], 'and')).toBe('Inas')
    expect(joinNames([null, undefined], 'and')).toBeNull()
  })

  it("says the server's sentence, or the fallback when it has none", () => {
    expect(errorText({ message: 'Only the deliverable’s owner can forward this request.' }, 'x')).toBe('Only the deliverable’s owner can forward this request.')
    expect(errorText({ message: '  ' }, 'fallback')).toBe('fallback')
    expect(errorText(null, 'fallback')).toBe('fallback')
  })

  it('pre-writes the nudge from what the maker is waiting for', () => {
    const say = (k: string, v?: Record<string, unknown>) => `${k}:${JSON.stringify(v)}`
    expect(nudgeDraft(say, { task: 'Cards', what: 'copy', maker: 'Lujain' })).toContain('requests.nudge.draftBlocked')
    expect(nudgeDraft(say, { task: 'Cards', what: null, maker: null })).toContain('requests.nudge.draft:')
  })

  it('matches "who has it" to one person by exact name only', () => {
    const people = [{ id: 'a', name: 'Abeer' }, { id: 'b', name: 'Abeer Salim' }, { id: 'c', name: 'Omar' }, { id: 'd', name: 'Omar' }]
    expect(personNamed(people, ' abeer ')?.id).toBe('a')
    expect(personNamed(people, 'Omar')).toBeNull() // two Omars — nobody is guessed
    expect(personNamed(people, 'the printer')).toBeNull()
    expect(personNamed(people, null)).toBeNull()
  })
})

import { untimedRefusal } from './requests-text'

describe('untimedRefusal — the server refused an untimed send (ADR-0106 d.2)', () => {
  it('reads the allocated hours from DETAIL on 22023 / untimed', () => {
    expect(untimedRefusal({ code: '22023', hint: 'untimed', details: '32' })).toBe(32)
    expect(untimedRefusal({ code: '22023', hint: 'untimed', details: '' })).toBeNull()
  })
  it('is undefined for any other refusal — the same 22023 from a finished task included', () => {
    expect(untimedRefusal({ code: '22023', hint: null as unknown as string })).toBeUndefined()
    expect(untimedRefusal({ code: '55000', hint: 'untimed' })).toBeUndefined()
    expect(untimedRefusal(null)).toBeUndefined()
  })
})
