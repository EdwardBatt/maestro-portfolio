import { describe, expect, it } from 'vitest'
import { isFiller } from './filler'

// The SAME cases as pgTAP 173 (`app.is_filler_with`) — keep the two lists identical.
const FILLER = [
  'XYZ', 'xyz', 'TBD', 'tbd.', 'TBC', 'TBA', 'lorem ipsum', 'Lorem Ipsum',
  '…', '...', '-', 'x', 'X', 'test', 'TEST', 'aaaa', '????', 'XYZ 123', 'TBD - TBC',
  'XYZ ٢٠٢٦', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit', 'lorem ipsum — the new pack shot',
]
const REAL = [
  'Test the new pack shot', '1080x1920', 'Launch the summer offer to students', 'N/A for print, 30s for TikTok', 'N/A', 'n/a', 'NA', '123', '  42  ', '30', '٢٠٢٦',
  'Crescent Bank logo lock-up', 'اطلاق العرض الصيفي', 'The lorem ipsum on the old KV must go',
]

describe('isFiller (ADR-0111 d.1)', () => {
  it.each(FILLER)('refuses %j as filler', (text) => {
    expect(isFiller(text)).toBe(true)
  })

  it.each(REAL)('passes %j as real text', (text) => {
    expect(isFiller(text)).toBe(false)
  })

  it('does not call blank filler — blank is its own refusal', () => {
    expect(isFiller('')).toBe(false)
    expect(isFiller('   ')).toBe(false)
    expect(isFiller(null)).toBe(false)
  })

  it("adds the tenant's words: a one-word entry is a filler run, a phrase matches the whole text", () => {
    expect(isFiller('placeholder', ['Placeholder'])).toBe(true)
    expect(isFiller('placeholder 2', ['placeholder'])).toBe(true)
    expect(isFiller('coming soon', ['Coming soon'])).toBe(true)
    expect(isFiller('coming', ['coming soon'])).toBe(false)
    expect(isFiller('placeholder')).toBe(false)
  })
})
