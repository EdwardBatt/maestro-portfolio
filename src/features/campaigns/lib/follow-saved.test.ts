import { describe, expect, it } from 'vitest'
import { followSaved, sameSaved } from './follow-saved'

describe('followSaved (test script: the panel after an answered ask)', () => {
  const was = { dueDay: '2026-10-25', name: 'Summer key visual', languages: ['ar', 'en'] }
  it('an untouched field takes the newly saved value — the accepted due date reaches the box', () => {
    const now = { ...was, dueDay: '2026-11-05' }
    expect(followSaved(was, now, was)).toEqual(now)
  })
  it('a field the person changed keeps their edit', () => {
    const now = { ...was, dueDay: '2026-11-05', name: 'Renamed by someone else' }
    const mine = { ...was, name: 'My new name' }
    expect(followSaved(was, now, mine)).toEqual({ ...now, name: 'My new name' })
  })
  it('lists compare by their items', () => {
    expect(sameSaved(was, { ...was, languages: ['ar', 'en'] })).toBe(true)
    expect(sameSaved(was, { ...was, languages: ['en'] })).toBe(false)
  })
})
