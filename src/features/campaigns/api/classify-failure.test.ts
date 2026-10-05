import { describe, expect, it, vi } from 'vitest'

// The module reaches lib/supabase → lib/env, which Zod-parses import.meta.env at import time
// and throws when the VITE_ vars are absent — they are absent in CI (docs/memory/traps.md).
// Only `classify` is under test here and it touches neither.
vi.mock('../../../lib/supabase', () => ({ supabaseUntyped: {} }))

import { classify, parseProposal, DeliverablesRefusedError } from './deliverables-generate-api'

/** What `functions.invoke` throws for a non-2xx: the raw Response hangs off `.context`. */
const httpError = (status: number) => ({ context: { status } })

// Edward, 27 Aug: "ANYWHERE AN ERROR COULD OCCUR IT SHOULD NOT FAIL SILENTLY."
//
// This is the unit that decides. The wizard suite proves the MESSAGE is shown; this proves an
// error is produced in the first place — which is where the real bug was. A stale Edge Function
// returned 400, `classify`'s predecessor had no branch for it, the caller returned [], and the
// wizard showed an empty table with nothing to read.
describe('classify — every failure produces an error (ADR-0050)', () => {
  it('calls a 400 a MISMATCH, not an outage', () => {
    // The one that cost an afternoon. A 400 means this client and that function disagree about
    // the request — a deploy is out of step. Reporting it as "the service was unavailable" is a
    // true sentence about a false cause, and it sends the reader to the wrong problem.
    expect(classify(httpError(400)).code).toBe('mismatch')
  })

  it.each([
    [401, 'unauthenticated'],
    [403, 'forbidden'],
    [413, 'too_long'],
    [503, 'unconfigured'],
  ])('maps %i to %s — something the person can act on', (status, code) => {
    expect(classify(httpError(status)).code).toBe(code)
  })

  it.each([500, 502, 504, 418])('calls %i unavailable rather than guessing', (status) => {
    expect(classify(httpError(status)).code).toBe('unavailable')
  })

  it('calls anything with no status unavailable — it never reached the server', () => {
    expect(classify(new Error('network down')).code).toBe('unavailable')
    expect(classify(null).code).toBe('unavailable')
    expect(classify({ context: {} }).code).toBe('unavailable')
    expect(classify({ context: { status: 'nonsense' } }).code).toBe('unavailable')
  })

  it('ALWAYS returns an error — there is no input that means "nothing found"', () => {
    // The guarantee, stated as a test: no branch of this function can return null, undefined
    // or anything a caller could mistake for an empty result.
    for (const input of [null, undefined, 0, '', {}, [], new Error('x'), httpError(400), httpError(999)]) {
      const out = classify(input)
      expect(out).toBeInstanceOf(DeliverablesRefusedError)
      expect(typeof out.code).toBe('string')
      expect(out.code.length).toBeGreaterThan(0)
    }
  })
})

// ADR-0054 extends the answer with a type code, a channel and a vocabulary outcome. That widens
// the parse, and a widened parse is the exact shape the 27 August bug had: `deliverables` is
// `.catch([])`, so a row schema that refuses an older deployment's rows turns a real answer into
// an empty table with nothing to read. These are that risk, asserted closed — the guarantee is
// EXTENDED here rather than replaced.
describe('parseProposal — a widened schema never invents an empty answer (ADR-0054)', () => {
  it('reads a full ADR-0054 answer', () => {
    const out = parseProposal({
      deliverables: [{ name: 'Reel', quantity: 3, typeCode: 'SOC-004', channel: 'INSTAGRAM' }],
      vocabulary: { types: 'offered', channels: 'offered' },
    })
    expect(out.rows).toEqual([
      { name: 'Reel', quantity: 3, typeCode: 'SOC-004', needsType: false, note: null, channel: 'INSTAGRAM', phaseNumber: null, from: null, group: null },
    ])
    expect(out.vocabulary).toEqual({ types: 'offered', channels: 'offered' })
    expect(out.needsType).toBe(0)
  })

  it('keeps the rows a PRE-ADR-0054 deployment returns, untyped', () => {
    // The version-skew case. A function deployed a version behind returns {name, quantity} and no
    // vocabulary at all. Those rows are real work somebody wrote a brief for; dropping them
    // because the answer is one version old is the failure this suite exists to prevent.
    const out = parseProposal({ deliverables: [{ name: '60-second hero film', quantity: 1 }] })
    // ADR-0097 d.4: an untyped row from an older deployment is a row that needs a person to choose.
    expect(out.rows).toEqual([
      { name: '60-second hero film', quantity: 1, typeCode: null, needsType: true, note: null, channel: null, phaseNumber: null, from: null, group: null },
    ])
    // And it says the vocabulary was unavailable, which is the honest reading: that deployment
    // offered none.
    expect(out.vocabulary).toEqual({ types: 'unavailable', channels: 'unavailable' })
  })

  it('reads an explicit null exactly as it reads an absent field', () => {
    const out = parseProposal({
      deliverables: [{ name: 'Something new', quantity: 1, typeCode: null, channel: null }],
      vocabulary: { types: 'offered', channels: 'offered' },
    })
    expect(out.rows[0]!.typeCode).toBeNull()
  })

  it('falls back rather than throwing when the vocabulary outcome is a word it does not know', () => {
    const out = parseProposal({
      deliverables: [{ name: 'A thing', quantity: 1 }],
      vocabulary: { types: 'something_new', channels: 'offered' },
    })
    expect(out.rows).toHaveLength(1)
    expect(out.vocabulary.types).toBe('unavailable')
  })

  it('throws MALFORMED — never an empty list — when the answer is not an object at all', () => {
    for (const input of [null, undefined, 0, '', 'nope', []]) {
      expect(() => parseProposal(input)).toThrow(DeliverablesRefusedError)
    }
  })

  // ⚠️ KNOWN GAP, asserted as current behaviour rather than discovered later. `deliverables`
  // carries `.catch([])`, so a 200 whose body is an object with no `deliverables` key parses to an
  // empty list instead of `malformed` — the one hole left in "no input returns an empty list to
  // mean a failure". It predates ADR-0054 and no deployed version of the function can produce it
  // (every failure path is a non-2xx, and every success carries the key), so it is recorded here
  // rather than changed inside a task about the taxonomy. Whoever closes it changes a FAILING
  // expectation instead of finding a silent one.
  it('reads an object with no deliverables key as an empty list (known gap)', () => {
    expect(parseProposal({ nope: true }).rows).toEqual([])
  })

  it('an empty list is only ever an empty list when the server said so', () => {
    // The one legitimate empty: the model read the brief and found no deliverables in it.
    const out = parseProposal({
      deliverables: [],
      vocabulary: { types: 'offered', channels: 'offered' },
    })
    expect(out.rows).toEqual([])
    expect(out.vocabulary.types).toBe('offered')
  })
})
