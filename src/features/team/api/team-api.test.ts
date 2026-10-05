import { describe, expect, it, vi } from 'vitest'

// team-api imports lib/supabase (→ lib/env, which throws in CI); stub it so the
// pure capacityLevel helper can be imported and tested in isolation.
vi.mock('../../../lib/supabase', () => ({ supabaseUntyped: {}, supabase: {} }))

import { capacityLevel } from './team-api'

describe('capacityLevel — the shared capacity rule (ADR-0018)', () => {
  it('is ok below the warn threshold', () => {
    expect(capacityLevel(0, 100, 120)).toBe('ok')
    expect(capacityLevel(99, 100, 120)).toBe('ok')
  })
  it('is warn from warn up to (not incl.) ceiling', () => {
    expect(capacityLevel(100, 100, 120)).toBe('warn')
    expect(capacityLevel(110, 100, 120)).toBe('warn')
    expect(capacityLevel(119, 100, 120)).toBe('warn')
  })
  it('is over at/above the ceiling', () => {
    expect(capacityLevel(120, 100, 120)).toBe('over')
    expect(capacityLevel(150, 100, 120)).toBe('over')
  })
  it('defaults to warn 100 / ceiling 120', () => {
    expect(capacityLevel(99)).toBe('ok')
    expect(capacityLevel(105)).toBe('warn')
    expect(capacityLevel(120)).toBe('over')
  })
})
