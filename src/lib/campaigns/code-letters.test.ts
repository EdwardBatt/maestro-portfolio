import { describe, expect, it } from 'vitest'
import { isValidCodeLetters, normaliseCodeLetters, suggestCodeLetters } from './code-letters'

describe('suggestCodeLetters — the same rule as app.workstream_code_letters', () => {
  it.each([
    ['Design & Animation', 'DA'],
    ['Short Format · Meridian Squad', 'SF'],
    ['Influencers', 'INF'],
    ['Media Toolkit', 'MT'],
    ['TV', 'TVX'],
    ['  always-on  ', 'AO'],
    ['حملة', 'WS'],
    ['', 'WS'],
  ])('%s -> %s', (name, letters) => {
    expect(suggestCodeLetters(name)).toBe(letters)
  })
})

describe('typed letters — what the workstreams trigger keeps', () => {
  it('stores them trimmed and in capitals', () => {
    expect(normaliseCodeLetters(' ia ')).toBe('IA')
  })

  it.each([
    ['IA', true],
    ['inf', true],
    ['ABCD', true],
    ['A', false],
    ['ABCDE', false],
    ['I1', false],
    ['I A', false],
    ['', false],
  ])('%s valid: %s', (typed, ok) => {
    expect(isValidCodeLetters(typed)).toBe(ok)
  })
})
