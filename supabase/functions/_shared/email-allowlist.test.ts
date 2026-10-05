import { describe, expect, it } from 'vitest'
import { isAllowedRecipient } from './email-allowlist.ts'

/**
 * ADR-0081 d.3a — the local-only recipient fence.
 *
 * The assertions that carry weight here are the ones about being OFF and being MISCONFIGURED, not
 * the ones about matching. A fence that lets the wrong person through is the failure this exists to
 * prevent, and it arrives in somebody's inbox where it cannot be recalled.
 */
describe('isAllowedRecipient', () => {
  const MAILBOX = 'maestro.dev@example.test'

  describe('off — the production state', () => {
    it.each([undefined, null, '', '   '])('lets everybody through when the value is %p', (v) => {
      expect(isAllowedRecipient('someone@a-real-client.com', v)).toBe(true)
    })
  })

  describe('on', () => {
    it('allows the mailbox itself', () => {
      expect(isAllowedRecipient(MAILBOX, MAILBOX)).toBe(true)
    })

    /** The point of seeding with plus-addresses: one entry covers every seeded user. */
    it.each(['+fadia', '+amira', '+traffic.manager'])('allows the %s plus-address', (tag) => {
      expect(isAllowedRecipient(`maestro.dev${tag}@example.test`, MAILBOX)).toBe(true)
    })

    it('refuses anybody else', () => {
      expect(isAllowedRecipient('someone@a-real-client.com', MAILBOX)).toBe(false)
    })

    it('is case-insensitive on both sides', () => {
      expect(isAllowedRecipient('Maestro.Dev+QA@Example.test', 'MAESTRO.DEV@EXAMPLE.TEST')).toBe(true)
    })

    it('accepts a comma-separated list, and tolerates spacing', () => {
      const list = ` ${MAILBOX} , @maestro.test `
      expect(isAllowedRecipient('anyone@maestro.test', list)).toBe(true)
      expect(isAllowedRecipient(MAILBOX, list)).toBe(true)
      expect(isAllowedRecipient('someone@a-real-client.com', list)).toBe(false)
    })

    /**
     * The bug the first cut of this file shipped and these tests refused: plain substring matching.
     * A plus-address does not CONTAIN its base address — the tag sits between the local part and the
     * `@` — so `maestro.dev+fadia@example.test` failed against `maestro.dev@example.test`, which is the one
     * case the whole fence exists to serve.
     */
    it('does not match a DIFFERENT mailbox that merely shares a prefix', () => {
      expect(isAllowedRecipient('maestro.devista@example.test', MAILBOX)).toBe(false)
      expect(isAllowedRecipient('maestro.dev@example.test.evil.test', MAILBOX)).toBe(false)
    })

    it('matches a domain entry against anything at that domain, and nothing else', () => {
      expect(isAllowedRecipient('anyone@maestro.test', '@maestro.test')).toBe(true)
      expect(isAllowedRecipient('anyone@notmaestro.test', '@maestro.test')).toBe(false)
    })
  })

  /**
   * The branch worth the whole file. A value that is SET is somebody saying "fence this"; a typo
   * that leaves no usable entries must not read as "fence off". The tempting implementation —
   * `allowed.some(...)` over an empty array — returns false already, but only by accident of
   * Array.some, and a later refactor to `every` or a short-circuit would reverse it silently.
   */
  describe('misconfigured — fails closed', () => {
    it.each([',', ' , , ', ',,'])('refuses everybody when %p leaves no usable entries', (v) => {
      expect(isAllowedRecipient(MAILBOX, v)).toBe(false)
      expect(isAllowedRecipient('someone@a-real-client.com', v)).toBe(false)
    })
  })

  it('refuses a recipient that is not an address at all', () => {
    expect(isAllowedRecipient('', MAILBOX)).toBe(false)
    expect(isAllowedRecipient('   ', MAILBOX)).toBe(false)
    expect(isAllowedRecipient('not-an-address', MAILBOX)).toBe(false)
  })
})
