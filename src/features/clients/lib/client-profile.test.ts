import { describe, expect, it } from 'vitest'
import { lastActivityLabel, onTimeTone, profilePct, weekLabel, weekendOf } from './client-profile'

describe('the profile meter (CL-v3)', () => {
  const none = { basics: false, businessTypes: 0, brands: 0, contacts: 0, signsOff: 0, rules: 0 }

  it('steps as the frames do: 20 after the basics, 40 with a brand, 60 with a person', () => {
    expect(profilePct(none)).toBe(0)
    expect(profilePct({ ...none, basics: true })).toBe(20)
    expect(profilePct({ ...none, basics: true, brands: 1 })).toBe(40)
    expect(profilePct({ ...none, basics: true, brands: 1, contacts: 2 })).toBe(60)
    expect(profilePct({ ...none, basics: true, brands: 1, contacts: 2, rules: 4 })).toBe(75)
  })

  it('is full only with what the business is and someone who signs off', () => {
    expect(profilePct({ basics: true, businessTypes: 2, brands: 1, contacts: 2, signsOff: 0, rules: 4 })).toBe(90)
    expect(profilePct({ basics: true, businessTypes: 2, brands: 1, contacts: 2, signsOff: 1, rules: 4 })).toBe(100)
  })
})

describe('the working week in words', () => {
  it('says Iraq as Sun–Thu and its weekend as Fri–Sat', () => {
    expect(weekLabel([7, 1, 2, 3, 4], 'en')).toBe('Sun–Thu')
    expect(weekLabel(weekendOf([7, 1, 2, 3, 4]), 'en')).toBe('Fri–Sat')
  })

  it('says the UAE as Mon–Fri, long when asked', () => {
    expect(weekLabel([1, 2, 3, 4, 5], 'en')).toBe('Mon–Fri')
    expect(weekLabel([1, 2, 3, 4, 5], 'en', 'long')).toBe('Monday – Friday')
  })

  it('names a week with a gap as two runs', () => {
    expect(weekLabel([1, 2, 4, 5], 'en')).toBe('Mon–Tue, Thu–Fri')
  })
})

describe('last activity (CV-01)', () => {
  // Monday 28 Sep 2026, 15:00 in Baghdad.
  const now = Date.parse('2026-09-28T12:00:00Z')

  it('is hours today, "yesterday", then the day, then the date', () => {
    expect(lastActivityLabel('2026-09-28T11:40:00Z', now, 'en')).toEqual({ key: 'minutesAgo', count: 20 })
    expect(lastActivityLabel('2026-09-28T10:00:00Z', now, 'en')).toEqual({ key: 'hoursAgo', count: 2 })
    expect(lastActivityLabel('2026-09-27T10:00:00Z', now, 'en')).toEqual({ key: 'yesterday', count: 1 })
    expect(lastActivityLabel('2026-09-24T10:00:00Z', now, 'en')).toEqual({ text: 'Thu, 24 Sep' })
    expect(lastActivityLabel('2026-09-10T10:00:00Z', now, 'en')).toEqual({ text: 'Thu, 10 Sep' })
  })

  it('says nothing for nothing', () => {
    expect(lastActivityLabel(null, now, 'en')).toBeNull()
  })
})

describe('on time (CV-01)', () => {
  it('is green when all of it is, amber from three in four, red below, quiet with nothing live', () => {
    expect(onTimeTone({ onTime: 2, unfinished: 2 })).toBe('ok')
    expect(onTimeTone({ onTime: 9, unfinished: 12 })).toBe('amber')
    expect(onTimeTone({ onTime: 1, unfinished: 2 })).toBe('risk')
    expect(onTimeTone({ onTime: 0, unfinished: 0 })).toBe('none')
  })
})
