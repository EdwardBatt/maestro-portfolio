import { describe, expect, it } from 'vitest'
import { isLocalSupabase } from './env'

/**
 * ADR-0081. `isLocalSupabase` decides two things that must never disagree: whether a URL is allowed
 * to be plain `http`, and whether the app tells the person they are on a local database. A URL that
 * passed one test and failed the other would be the worst possible outcome — an environment
 * permitted to be local while presenting itself as production.
 *
 * Imports only the predicate, never `env` itself: that parses `import.meta.env` at module load and
 * throws where the VITE_ vars are absent, which is CI (traps.md).
 */
describe('isLocalSupabase (ADR-0081)', () => {
  it.each([
    'http://127.0.0.1:54321',
    'http://localhost:54321',
    'https://localhost:54321',
    'http://[::1]:54321',
  ])('recognises %s as the local stack', (u) => {
    expect(isLocalSupabase(u)).toBe(true)
  })

  it('does not treat a hosted project as local', () => {
    expect(isLocalSupabase('https://abcdefgh.supabase.co')).toBe(false)
  })

  /**
   * The reason this is host-based rather than a string test. Every one of these contains the word
   * `localhost` or `127.0.0.1`, and a `String.includes` check — the obvious implementation — would
   * hand each of them an http exemption AND tell the user they were safely on local while they wrote
   * to a hosted database.
   */
  it.each([
    'https://prod.example.com/?redirect=localhost',
    'https://localhost.evil.test',
    'https://127.0.0.1.evil.test',
    'https://notlocalhost',
  ])('refuses %s, which only LOOKS local', (u) => {
    expect(isLocalSupabase(u)).toBe(false)
  })

  it('refuses something that is not a URL at all rather than throwing', () => {
    expect(isLocalSupabase('')).toBe(false)
    expect(isLocalSupabase('127.0.0.1:54321')).toBe(false)
  })
})
