import type {
  AssessmentReason,
  CandidateAssessment,
  CapacityResource,
  LoadBooking,
  LoadSegment,
  OfficeCalendar,
  Span,
} from './types.ts'
import { nonWorkingDaysInSpan } from './working-week.ts'

/**
 * Maestro capacity engine (M3) — pure functions, no I/O.
 *
 * AUTHORITY NOTE (AGENTS.md §2): the authoritative execution of these rules is
 * server-side — the M4 booking Edge Function runs this module before any state
 * transition, and the DB exclusion constraint physically guarantees the
 * exclusive-overlap invariant. The frontend may call the same functions ONLY
 * to preview the warning a booker is about to receive; its verdict is never
 * trusted.
 *
 * Design rules encoded here (§4.1–§4.3):
 * - load-based humans: overlaps allowed; loads accumulate; crossing warn/ceiling
 *   INFORMS, never blocks (warn-and-allow)
 * - exclusive: a confirmed overlap is a hard conflict (DB-enforced)
 * - pooled(n): up to n concurrent, then full
 * - blackouts and non-working days (ADR-0005) warn, never block
 */

export function spansOverlap(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end
}

export function overlapping<T extends Span>(items: T[], span: Span): T[] {
  return items.filter((i) => spansOverlap(i, span))
}

/**
 * Boundary-sweep load profile: contiguous segments of constant summed load
 * across the window, from the given (confirmed) load bookings.
 */
export function loadSegments(bookings: LoadBooking[], window: Span): LoadSegment[] {
  const relevant = overlapping(bookings, window)
  const bounds = new Set<number>([window.start, window.end])
  for (const b of relevant) {
    if (b.start > window.start) bounds.add(b.start)
    if (b.end < window.end) bounds.add(b.end)
  }
  const sorted = [...bounds].sort((x, y) => x - y)
  const segments: LoadSegment[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const seg: Span = { start: sorted[i]!, end: sorted[i + 1]! }
    const totalPct = relevant
      .filter((b) => spansOverlap(b, seg))
      .reduce((sum, b) => sum + b.loadPct, 0)
    segments.push({ ...seg, totalPct })
  }
  return segments
}

/** Peak summed load across a window. */
export function peakLoadPct(bookings: LoadBooking[], window: Span): number {
  return Math.max(0, ...loadSegments(bookings, window).map((s) => s.totalPct))
}

/** Peak concurrent booking count across a window (pooled/exclusive). */
export function peakConcurrent(bookings: Span[], window: Span): number {
  const relevant = overlapping(bookings, window)
  const events: [number, number][] = []
  for (const b of relevant) {
    events.push([Math.max(b.start, window.start), +1])
    events.push([Math.min(b.end, window.end), -1])
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]) // ends before starts at same instant
  let cur = 0
  let peak = 0
  for (const [, delta] of events) {
    cur += delta
    if (cur > peak) peak = cur
  }
  return peak
}

export interface AssessInput {
  resource: CapacityResource
  /** the candidate booking's span */
  candidate: Span
  /** candidate's load, for load_based resources (defaults to work-type default upstream) */
  candidateLoadPct?: number
  /** existing CONFIRMED bookings on this resource (soft-holds/tentatives don't consume capacity, §4.2) */
  existing: (Span & { loadPct?: number; id?: string })[]
  /** blackouts for this resource */
  blackouts: Span[]
  /** the resource's office calendar, when known (humans; equipment inherits office too) */
  office?: OfficeCalendar
}

/**
 * The warn-and-allow assessment (§4.1). Returns the single message the booker
 * sees — one gentle warning with a proceed option — or 'ok'. Only
 * 'exclusive_conflict' corresponds to something the database will refuse.
 */
export function assessCandidate(input: AssessInput): CandidateAssessment {
  const reasons: AssessmentReason[] = []
  let level: CandidateAssessment['level'] = 'ok'
  let projectedPeakPct: number | undefined
  let projectedConcurrent: number | undefined

  const bump = (next: CandidateAssessment['level']) => {
    const order = { ok: 0, warn: 1, over_ceiling: 2, conflict: 3 } as const
    if (order[next] > order[level]) level = next
  }

  // capacity-model check
  if (input.resource.model === 'exclusive') {
    if (overlapping(input.existing, input.candidate).length > 0) {
      reasons.push('exclusive_conflict')
      bump('conflict')
    }
  } else if (input.resource.model === 'pooled') {
    const concurrent = peakConcurrent(input.existing, input.candidate) + 1
    projectedConcurrent = concurrent
    if (concurrent > input.resource.poolSize) {
      reasons.push('pool_full')
      bump('warn') // pool overflow is warn-and-allow: approval decides (§4.2)
    }
  } else {
    const loads: LoadBooking[] = input.existing.map((b, i) => ({
      id: b.id ?? String(i),
      start: b.start,
      end: b.end,
      loadPct: b.loadPct ?? 0,
    }))
    loads.push({
      id: '__candidate__',
      start: input.candidate.start,
      end: input.candidate.end,
      loadPct: input.candidateLoadPct ?? 0,
    })
    const peak = peakLoadPct(loads, input.candidate)
    projectedPeakPct = peak
    if (peak > input.resource.ceilingPct) {
      reasons.push('over_ceiling')
      bump('over_ceiling')
    } else if (peak > input.resource.warnAtPct) {
      reasons.push('over_warn_threshold')
      bump('warn')
    }
  }

  // blackout interaction (§4.3): unavailability warns; it never blocks
  const blackoutOverlaps = overlapping(
    input.blackouts.map((b) => ({ ...b })),
    input.candidate,
  )
  if (blackoutOverlaps.length > 0) {
    reasons.push('blackout_overlap')
    bump('warn')
  }

  // working week (ADR-0005): non-working days warn; never hidden, never blocked
  const nonWorkingDays = input.office
    ? nonWorkingDaysInSpan(input.candidate, input.office)
    : []
  if (nonWorkingDays.length > 0) {
    reasons.push('non_working_day')
    bump('warn')
  }

  return { level, projectedPeakPct, projectedConcurrent, nonWorkingDays, blackoutOverlaps, reasons }
}
