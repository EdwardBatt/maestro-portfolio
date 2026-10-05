import { describe, expect, it } from 'vitest'
import { isRealDay } from './real-day'

describe('isRealDay (I66.8)', () => {
  it('takes a real day', () => {
    expect(isRealDay('2026-10-09')).toBe(true)
    expect(isRealDay('2028-02-29')).toBe(true)
  })
  it('refuses what crashed production and its cousins', () => {
    expect(isRealDay('20266-10-09')).toBe(false) // Chrome's year box takes five digits
    expect(isRealDay('2026-02-31')).toBe(false)
    expect(isRealDay('2027-02-29')).toBe(false)
    expect(isRealDay('1999-12-31')).toBe(false)
    expect(isRealDay('')).toBe(false)
    expect(isRealDay(null)).toBe(false)
    expect(isRealDay('2026-10-9')).toBe(false)
  })
})
