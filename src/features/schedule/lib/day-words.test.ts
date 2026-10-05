import { describe, expect, it } from 'vitest'
import { dayLong, dayRange, dayTiny, spanWords, weekdayName } from './day-words'

describe('the Schedule\'s day words (Figma L)', () => {
  it('a day in a sentence: Tue 29 Sep, no comma', () => {
    expect(dayLong('2026-09-29', 'en')).toBe('Tue 29 Sep')
  })
  it('a row: the month only when it is not the week\'s', () => {
    expect(dayTiny('2026-09-28', 'en', '2026-09-27')).toBe('Mon 28')
    expect(dayTiny('2026-10-04', 'en', '2026-09-27')).toBe('Sun 4 Oct')
  })
  it('a range', () => {
    expect(dayRange('2026-09-29', '2026-09-30', 'en', '2026-09-27')).toBe('Tue 29 – Wed 30')
    expect(dayRange('2026-10-06', '2026-10-07', 'en', '2026-09-27')).toBe('Tue 6 – Wed 7 Oct')
    expect(dayRange('2026-10-01', '2026-10-01', 'en', '2026-09-27')).toBe('Thu 1 Oct')
  })
  it('a week span and a weekday', () => {
    expect(spanWords('2026-09-27', '2026-10-01', 'en')).toBe('27 Sep – 1 Oct')
    expect(spanWords('2026-10-04', '2026-10-08', 'en')).toBe('4 – 8 Oct')
    expect(weekdayName('2026-09-28', 'en')).toBe('Monday')
  })
  it('Arabic keeps Western digits', () => {
    expect(dayTiny('2026-09-28', 'ar', '2026-09-27')).toMatch(/28/)
    expect(weekdayName('2026-09-28', 'ar')).toBe('الاثنين')
  })
})
