// ADR-0066 d.14 — the timezone arithmetic behind a receipt.
//
// A screenshot shows a wall-clock reading with no offset: the sender's mail client rendered it in
// the READER's zone and the image cannot say which. So a zone is chosen — the confirming person's
// office — and the two halves are resolved against it. The obvious implementation,
// `new Date('2026-09-01T14:32')`, silently applies the BROWSER's zone instead, which puts the
// receipt hours out for anyone travelling or working from another office and would move a campaign
// in or out of breach without anything on screen changing.
//
// `lib/supabase` is mocked to keep `lib/env` out of the import graph — it Zod-parses
// `import.meta.env` at import time and throws where no VITE_ vars exist (traps.md).
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/supabase', () => ({ supabaseUntyped: { from: vi.fn(), functions: { invoke: vi.fn() } } }))
vi.mock('../../../app/auth-context', () => ({ useAuth: () => ({ claims: { tenantId: 't1' } }) }))

import { instantFrom, wallClockIn } from './brief-receipt-api'

describe('instantFrom (ADR-0066 d.14)', () => {
  it('reads the wall clock in the zone it was given, not the browser\'s', () => {
    // 14:32 in Dubai (UTC+4) is 10:32 UTC. If this ever returns 14:32Z, the zone was ignored.
    expect(instantFrom('2026-09-01', '14:32', 'Asia/Dubai')).toBe('2026-09-01T10:32:00.000Z')
  })

  it('gives a different instant for the same reading in a different office', () => {
    // The same screenshot confirmed in London is a different moment, and the four-hour gap is
    // most of a T+1 threshold — which is why the zone is stored and shown rather than assumed.
    const dubai = instantFrom('2026-09-01', '14:32', 'Asia/Dubai')
    const london = instantFrom('2026-09-01', '14:32', 'Europe/London')
    expect(dubai).not.toBe(london)
    expect(london).toBe('2026-09-01T13:32:00.000Z')
  })

  it('handles a zone whose offset changes with the date', () => {
    // London is UTC+1 in September and UTC+0 in January. A fixed offset taken once would put one
    // of these an hour out.
    expect(instantFrom('2026-09-01', '09:00', 'Europe/London')).toBe('2026-09-01T08:00:00.000Z')
    expect(instantFrom('2026-01-15', '09:00', 'Europe/London')).toBe('2026-01-15T09:00:00.000Z')
  })

  it('resolves a reading on the far side of a DST change correctly', () => {
    // 2026-03-29 is the day the UK springs forward. A single-pass offset lookup picks the wrong
    // side of the boundary here; the second pass is what fixes it.
    expect(instantFrom('2026-03-29', '02:30', 'Europe/London')).toBe('2026-03-29T01:30:00.000Z')
    expect(instantFrom('2026-03-28', '02:30', 'Europe/London')).toBe('2026-03-28T02:30:00.000Z')
  })

  it('returns nothing when either half is missing — a partial receipt starts no clock (d.13)', () => {
    expect(instantFrom('', '14:32', 'Asia/Dubai')).toBeNull()
    expect(instantFrom('2026-09-01', '', 'Asia/Dubai')).toBeNull()
    expect(instantFrom('', '', 'Asia/Dubai')).toBeNull()
  })

  it('refuses an unknown zone rather than quietly recording the browser\'s', () => {
    expect(instantFrom('2026-09-01', '14:32', 'Mars/Olympus')).toBeNull()
  })

  it('refuses a malformed reading', () => {
    expect(instantFrom('01/09/2026', '14:32', 'Asia/Dubai')).toBeNull()
    expect(instantFrom('2026-09-01', 'half two', 'Asia/Dubai')).toBeNull()
  })

  it('keeps UTC as UTC', () => {
    expect(instantFrom('2026-09-01', '14:32', 'UTC')).toBe('2026-09-01T14:32:00.000Z')
  })
})

/**
 * The round trip (I40). The reading a person confirmed is the one INSIDE the image (ADR-0066 d.5),
 * so it has to survive storage unchanged — a receipt that disagrees with its own evidence is worse
 * than one that was never read back.
 *
 * The first version of this shipped as `receivedAt.split('T')`, which returns UTC: 14:32 in Baghdad
 * came back as 11:32, quietly, in the one field a late-brief argument turns on.
 */
describe('wallClockIn — the inverse of instantFrom', () => {
  it('returns the reading that was typed, not the UTC one', () => {
    const stored = instantFrom('2026-09-01', '14:32', 'Asia/Dubai')
    expect(stored).toBe('2026-09-01T10:32:00.000Z')
    expect(wallClockIn(stored, 'Asia/Dubai')).toEqual({ date: '2026-09-01', time: '14:32' })
  })

  // A naive split would pass the Dubai case above by accident only if the zone were UTC. Baghdad
  // is +3, so this is the assertion that would have caught the bug.
  it('survives a round trip in every zone the agency uses', () => {
    for (const zone of ['Asia/Baghdad', 'Asia/Dubai', 'Europe/London', 'UTC']) {
      const stored = instantFrom('2026-09-01', '14:32', zone)
      expect(wallClockIn(stored, zone)).toEqual({ date: '2026-09-01', time: '14:32' })
    }
  })

  it('keeps the date right when the zone pushes the reading across midnight', () => {
    // 01:15 in Dubai is 21:15 the PREVIOUS day in UTC. Splitting the ISO string returns both the
    // wrong time AND the wrong date.
    const stored = instantFrom('2026-09-02', '01:15', 'Asia/Dubai')
    expect(stored).toBe('2026-09-01T21:15:00.000Z')
    expect(wallClockIn(stored, 'Asia/Dubai')).toEqual({ date: '2026-09-02', time: '01:15' })
  })

  it('round-trips across a DST boundary, where the offset is not constant', () => {
    const stored = instantFrom('2026-03-29', '02:30', 'Europe/London')
    expect(wallClockIn(stored, 'Europe/London')).toEqual({ date: '2026-03-29', time: '02:30' })
  })

  // A partial receipt is normal (d.13) and reads back as partial, never as a guess.
  it('returns blanks rather than inventing a reading', () => {
    expect(wallClockIn(null, 'Asia/Dubai')).toEqual({ date: '', time: '' })
    expect(wallClockIn('2026-09-01T10:32:00.000Z', null)).toEqual({ date: '', time: '' })
    expect(wallClockIn('not-a-date', 'Asia/Dubai')).toEqual({ date: '', time: '' })
    expect(wallClockIn('2026-09-01T10:32:00.000Z', 'Mars/Olympus')).toEqual({ date: '', time: '' })
  })
})
