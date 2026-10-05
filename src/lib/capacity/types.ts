/** Pure domain types for the capacity engine — no I/O, no framework. */

export interface Span {
  /** epoch ms, inclusive start */
  start: number
  /** epoch ms, exclusive end */
  end: number
}

export interface LoadBooking extends Span {
  id: string
  /** percentage of the person consumed by this booking (e.g. 60) */
  loadPct: number
}

export interface CapacityResourceLoad {
  model: 'load_based'
  /** hard-warn threshold, e.g. 120 — crossing warns strongly, never blocks */
  ceilingPct: number
  /** early-warn threshold, e.g. 100 */
  warnAtPct: number
}

export interface CapacityResourceExclusive {
  model: 'exclusive'
}

export interface CapacityResourcePooled {
  model: 'pooled'
  poolSize: number
}

export type CapacityResource =
  | CapacityResourceLoad
  | CapacityResourceExclusive
  | CapacityResourcePooled

export interface OfficeCalendar {
  /** IANA zone, e.g. Asia/Baghdad */
  timezone: string
  /** ISO weekday numbers 1=Mon … 7=Sun (ADR-0005) */
  workingDays: number[]
  /**
   * Office-local ISO dates the office is CLOSED — public holidays and company-closed days
   * (ADR-0079 d.4). This is the whole seam: every "is this a working day" decision reads the weekly
   * pattern AND this list through `isWorkingDay`, so the spreader, the grid, the drop warning and
   * the go-live offsets can never disagree. Optional only so a caller with no closure data (a unit
   * test, a preview) is not forced to invent an empty list; absent means none.
   */
  closures?: readonly string[]
}

/** A contiguous interval with a constant summed load. */
export interface LoadSegment extends Span {
  totalPct: number
}

export type AssessmentLevel = 'ok' | 'warn' | 'over_ceiling' | 'conflict'

export interface CandidateAssessment {
  /**
   * Worst finding across all checks. NEVER blocks — 'conflict' (exclusive
   * double-book) is the only level the DB will also physically reject.
   */
  level: AssessmentLevel
  /** peak summed load % across the candidate's span, including the candidate */
  projectedPeakPct?: number
  /** concurrent count peak for pooled resources, including the candidate */
  projectedConcurrent?: number
  /** ISO dates (office-local) of the candidate's days falling on non-working days */
  nonWorkingDays: string[]
  /** blackout spans the candidate overlaps */
  blackoutOverlaps: Span[]
  reasons: AssessmentReason[]
}

export type AssessmentReason =
  | 'exclusive_conflict'
  | 'pool_full'
  | 'over_ceiling'
  | 'over_warn_threshold'
  | 'non_working_day'
  | 'blackout_overlap'
