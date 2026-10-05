import { describe, expect, it } from 'vitest'
import { assessCandidate, loadSegments, peakConcurrent, peakLoadPct, spansOverlap } from './engine.ts'
import type { LoadBooking, Span } from './types.ts'

const H = 3600_000
const T0 = Date.UTC(2026, 7, 3, 9) // 2026-08-03 09:00Z (Monday)
const span = (startH: number, endH: number): Span => ({ start: T0 + startH * H, end: T0 + endH * H })
const lb = (id: string, s: number, e: number, pct: number): LoadBooking => ({ id, ...span(s, e), loadPct: pct })

describe('span math', () => {
  it('half-open overlap: touching spans do not overlap', () => {
    expect(spansOverlap(span(0, 2), span(2, 4))).toBe(false)
    expect(spansOverlap(span(0, 2), span(1, 3))).toBe(true)
  })
})

describe('load accumulation (§4.1)', () => {
  it('segments sum overlapping loads', () => {
    const segs = loadSegments([lb('a', 0, 4, 60), lb('b', 2, 6, 60)], span(0, 6))
    expect(segs).toEqual([
      { ...span(0, 2), totalPct: 60 },
      { ...span(2, 4), totalPct: 120 },
      { ...span(4, 6), totalPct: 60 },
    ])
  })

  it('peak reflects the busiest instant only within the window', () => {
    const all = [lb('a', 0, 4, 60), lb('b', 2, 6, 60), lb('c', 10, 12, 90)]
    expect(peakLoadPct(all, span(0, 6))).toBe(120)
    expect(peakLoadPct(all, span(6, 9))).toBe(0)
  })

  it('bookings partially outside the window still count inside it', () => {
    expect(peakLoadPct([lb('a', -5, 1, 80)], span(0, 2))).toBe(80)
  })
})

describe('concurrent counting (pooled/exclusive)', () => {
  it('back-to-back spans never double-count (end before start at same instant)', () => {
    expect(peakConcurrent([span(0, 2), span(2, 4)], span(0, 4))).toBe(1)
  })
  it('true triple overlap counts 3', () => {
    expect(peakConcurrent([span(0, 4), span(1, 5), span(2, 3)], span(0, 5))).toBe(3)
  })
})

describe('warn-and-allow assessment (§4.1/§4.2)', () => {
  const sarah = { model: 'load_based', ceilingPct: 120, warnAtPct: 100 } as const

  it('clean booking passes silently', () => {
    const a = assessCandidate({
      resource: sarah, candidate: span(0, 4), candidateLoadPct: 60,
      existing: [], blackouts: [],
    })
    expect(a.level).toBe('ok')
    expect(a.reasons).toEqual([])
  })

  it('the "this puts Sarah at 115%" case warns, never blocks', () => {
    const a = assessCandidate({
      resource: sarah, candidate: span(0, 8), candidateLoadPct: 55,
      existing: [{ ...span(0, 8), loadPct: 60 }], blackouts: [],
    })
    expect(a.level).toBe('warn')
    expect(a.projectedPeakPct).toBe(115)
    expect(a.reasons).toContain('over_warn_threshold')
  })

  it('exactly at warn threshold stays ok (warn is strictly past it)', () => {
    const a = assessCandidate({
      resource: sarah, candidate: span(0, 8), candidateLoadPct: 40,
      existing: [{ ...span(0, 8), loadPct: 60 }], blackouts: [],
    })
    expect(a.level).toBe('ok')
  })

  it('past ceiling escalates to over_ceiling — still not a block', () => {
    const a = assessCandidate({
      resource: sarah, candidate: span(0, 8), candidateLoadPct: 70,
      existing: [{ ...span(0, 8), loadPct: 60 }], blackouts: [],
    })
    expect(a.level).toBe('over_ceiling')
    expect(a.projectedPeakPct).toBe(130)
  })

  it('exclusive overlap is the one true conflict (mirrors the DB constraint)', () => {
    const a = assessCandidate({
      resource: { model: 'exclusive' }, candidate: span(1, 3),
      existing: [span(0, 2)], blackouts: [],
    })
    expect(a.level).toBe('conflict')
    expect(a.reasons).toEqual(['exclusive_conflict'])
  })

  it('pooled: at capacity warns (approval decides), under capacity ok', () => {
    const pool = { model: 'pooled', poolSize: 2 } as const
    const busy = [span(0, 4), span(0, 4)]
    expect(assessCandidate({ resource: pool, candidate: span(1, 2), existing: busy, blackouts: [] }).level).toBe('warn')
    expect(assessCandidate({ resource: pool, candidate: span(1, 2), existing: [span(0, 4)], blackouts: [] }).level).toBe('ok')
  })

  it('blackout overlap warns and reports the span', () => {
    const a = assessCandidate({
      resource: sarah, candidate: span(0, 4), candidateLoadPct: 20,
      existing: [], blackouts: [span(2, 6)],
    })
    expect(a.level).toBe('warn')
    expect(a.blackoutOverlaps).toHaveLength(1)
    expect(a.reasons).toEqual(['blackout_overlap'])
  })

  it('findings compose: over-ceiling + blackout reports both, worst level wins', () => {
    const a = assessCandidate({
      resource: sarah, candidate: span(0, 8), candidateLoadPct: 70,
      existing: [{ ...span(0, 8), loadPct: 60 }], blackouts: [span(0, 1)],
    })
    expect(a.level).toBe('over_ceiling')
    expect(a.reasons).toEqual(expect.arrayContaining(['over_ceiling', 'blackout_overlap']))
  })
})
