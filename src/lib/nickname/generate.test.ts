import { describe, expect, it } from 'vitest'
import { NICKNAME_ADJECTIVES, NICKNAME_NOUNS, randomNickname } from './generate'

describe('randomNickname (ADR-0011)', () => {
  it('is "<Adjective> <Noun>" with both words drawn from the pools', () => {
    const adj = new Set<string>(NICKNAME_ADJECTIVES)
    const noun = new Set<string>(NICKNAME_NOUNS)
    for (let i = 0; i < 200; i++) {
      const nick = randomNickname()
      const sp = nick.indexOf(' ')
      expect(sp).toBeGreaterThan(0)
      const a = nick.slice(0, sp)
      const n = nick.slice(sp + 1)
      expect(adj.has(a)).toBe(true)
      expect(noun.has(n)).toBe(true)
    }
  })

  it('is deterministic under an injected rng', () => {
    expect(randomNickname(() => 0)).toBe(`${NICKNAME_ADJECTIVES[0]} ${NICKNAME_NOUNS[0]}`)
    // rng just below 1 selects the last element of each pool
    const last = randomNickname(() => 0.999999)
    expect(last).toBe(`${NICKNAME_ADJECTIVES.at(-1)} ${NICKNAME_NOUNS.at(-1)}`)
  })

  it('offers enough combinations to avoid frequent de-dup suffixes', () => {
    expect(NICKNAME_ADJECTIVES.length * NICKNAME_NOUNS.length).toBeGreaterThan(1000)
  })

  it('has no duplicate words within a pool', () => {
    expect(new Set(NICKNAME_ADJECTIVES).size).toBe(NICKNAME_ADJECTIVES.length)
    expect(new Set(NICKNAME_NOUNS).size).toBe(NICKNAME_NOUNS.length)
  })
})
