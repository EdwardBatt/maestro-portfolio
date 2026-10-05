import { spansOverlap } from '../../../lib/capacity/engine'
import { workProgress } from '../../../lib/deliverables/work-phase'
import { pieceThreatensDeadline, isLateTask, isWaitingOnClient, type PulsePiece } from '../../../lib/campaigns/pulse'

/**
 * The Dashboard's figures (ADR-0122, I61) — pure, so each rule is tested once and every view counts
 * the same way. The rules are the system's own: at risk and late are ADR-0075 through the campaigns
 * list's `pieceThreatensDeadline`; "nobody on it" is ADR-0118's ready-to-assign rule, the Team page's;
 * a clash is the capacity engine's (a person over 100% at one moment, or a room or kit booked twice).
 */

const DAY_MS = 24 * 60 * 60 * 1000
const LIVE = (s: string) => s !== 'done' && s !== 'cancelled'
const FINISHED = (s: string) => s === 'approved' || s === 'delivered' || s === 'archived'

/** A piece as the Dashboard reads it: the pulse's piece, plus where it sits and what it is called. */
export interface DashPiece extends PulsePiece {
  id: string
  name: string
  campaignId: string
}

export interface DashCampaign {
  id: string
  name: string
  clientName: string
  goLiveAt: string | null
  status: string
  accountManagerId: string | null
}

// ------------------------------------------------------------------ the week

/** Sunday 00:00 UTC of the week `now` falls in — the working week starts Sunday (ADR-0005). */
export function weekStartOf(now: number): number {
  const d = new Date(now)
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  return day - new Date(day).getUTCDay() * DAY_MS
}

/** Seven day buckets from `weekStart`, each counting the dates that fall in it. */
export function perDay(dates: readonly (string | null | undefined)[], weekStart: number): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0]
  for (const iso of dates) {
    if (!iso) continue
    const t = Date.parse(iso)
    if (!Number.isFinite(t)) continue
    const i = Math.floor((t - weekStart) / DAY_MS)
    if (i >= 0 && i < 7) out[i]! += 1
  }
  return out
}

export const inWeek = (iso: string | null | undefined, weekStart: number): boolean => {
  if (!iso) return false
  const t = Date.parse(iso)
  return Number.isFinite(t) && t >= weekStart && t < weekStart + 7 * DAY_MS
}

// ------------------------------------------------------------------ pieces

/** Live pieces: not archived. Finished ones still count as delivered in the breakdown. */
export const livePieces = (pieces: readonly DashPiece[]) => pieces.filter((p) => p.state !== 'archived')

export const threatened = (pieces: readonly DashPiece[], now: number) =>
  pieces.filter((p) => pieceThreatensDeadline(p, { now }))

export const waitingOnClient = (pieces: readonly DashPiece[]) => pieces.filter((p) => isWaitingOnClient(p))

export type WorkState = 'delivered' | 'inProgress' | 'inReview' | 'notStarted' | 'blocked'
export const WORK_STATES: readonly WorkState[] = ['delivered', 'inProgress', 'inReview', 'notStarted', 'blocked']

/** Where a piece is, for the ring (Figma H "Where the work is"). */
export function workStateOf(p: PulsePiece): WorkState {
  if (p.state === 'approved' || p.state === 'delivered') return 'delivered'
  if (p.state === 'blocked' || p.outstandingInputs > 0) return 'blocked'
  return fromPhase(p)
}

/** The shared rule (I67.4): the word follows the least advanced open task (`workProgress`). */
function fromPhase(p: PulsePiece): 'inReview' | 'inProgress' | 'notStarted' {
  const phase = workProgress(p.tasks, p.state).phase
  if (phase === 'in_review' || phase === 'awaiting_signoff') return 'inReview'
  if (phase === 'in_progress') return 'inProgress'
  return 'notStarted'
}

export function breakdown(pieces: readonly PulsePiece[]): Record<WorkState, number> {
  const out: Record<WorkState, number> = { delivered: 0, inProgress: 0, inReview: 0, notStarted: 0, blocked: 0 }
  for (const p of pieces) if (p.state !== 'archived') out[workStateOf(p)] += 1
  return out
}

/**
 * Tasks nobody has that could be handed out now (ADR-0118 d.3, I59.59 — the Team page's rule): a live
 * task with no assignee, on a piece not finished, whose task list is approved, on a released campaign.
 */
export function nobodyOnIt(pieces: readonly DashPiece[], campaignStatus: ReadonlyMap<string, string>) {
  const out: { piece: DashPiece; taskId: string }[] = []
  for (const p of pieces) {
    if (FINISHED(p.state) || p.taskListApprovedAt == null) continue
    if (campaignStatus.get(p.campaignId) !== 'approved') continue
    for (const t of p.tasks) if (LIVE(t.status) && !t.assigneeId) out.push({ piece: p, taskId: t.id })
  }
  return out
}

/** Late (ADR-0075) — the rule lives with the campaign pulse, so the campaigns list's Late filter agrees (I61.17). */
export { isLateTask }

export function lateTasks<T extends { status: string; committedDueAt: string | null }>(tasks: readonly T[], now: number): T[] {
  return tasks.filter((t) => isLateTask(t, now))
}

/** Rounds used by a piece: its tasks' highest revision number (round 1 is revision 0). */
export const roundsUsed = (p: PulsePiece) => Math.max(0, ...p.tasks.map((t) => t.revisionNumber ?? 0))

// ------------------------------------------------------------------ campaigns

/** Campaigns whose go-live is this week and which have a piece late or at risk (I61.3). */
export function goLivesInDanger(
  campaigns: readonly DashCampaign[],
  piecesOf: ReadonlyMap<string, readonly DashPiece[]>,
  weekStart: number,
  now: number,
): DashCampaign[] {
  return campaigns.filter(
    (c) => c.status === 'approved' && inWeek(c.goLiveAt, weekStart) && threatened(piecesOf.get(c.id) ?? [], now).length > 0,
  )
}

export function piecesByCampaign(pieces: readonly DashPiece[]): Map<string, DashPiece[]> {
  const m = new Map<string, DashPiece[]>()
  for (const p of pieces) m.set(p.campaignId, [...(m.get(p.campaignId) ?? []), p])
  return m
}

// ------------------------------------------------------------------ bookings

export interface ClashBooking {
  id: string
  resourceId: string
  start: number
  end: number
  loadPct: number | null
}

export interface Clash {
  resourceId: string
  a: ClashBooking
  b: ClashBooking
}

/**
 * Clashes this window (I61.3): a room or a piece of kit booked twice at the same moment — exclusive
 * resources (§4.2). A person's bookings may overlap by design (load-based, §4.1); a person booked past
 * their week is the "over the ceiling" figure, not a clash. One clash per overlapping pair.
 */
export function clashes(bookings: readonly ClashBooking[], kindOf: (resourceId: string) => string | undefined): Clash[] {
  const by = new Map<string, ClashBooking[]>()
  for (const b of bookings) {
    const kind = kindOf(b.resourceId)
    if (kind !== 'room' && kind !== 'equipment') continue
    by.set(b.resourceId, [...(by.get(b.resourceId) ?? []), b])
  }
  const out: Clash[] = []
  for (const [resourceId, list] of by) {
    const sorted = [...list].sort((x, y) => x.start - y.start)
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const a = sorted[i]!
        const b = sorted[j]!
        if (b.start >= a.end) break
        if (spansOverlap(a, b)) out.push({ resourceId, a, b })
      }
    }
  }
  return out
}

// ------------------------------------------------------------------ drawing

/** A ring's arcs: each value's share of the whole as [start, end] fractions, zeros dropped. */
export function arcs<K extends string>(values: readonly { key: K; value: number }[]): { key: K; from: number; to: number }[] {
  const total = values.reduce((n, v) => n + Math.max(0, v.value), 0)
  if (total === 0) return []
  let at = 0
  const out: { key: K; from: number; to: number }[] = []
  for (const v of values) {
    if (v.value <= 0) continue
    const share = v.value / total
    out.push({ key: v.key, from: at, to: at + share })
    at += share
  }
  return out
}

/** A whole percent of a part, 0 when there is no whole. */
export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0)

/** The change from last period as a whole percent — null when there was nothing to compare with. */
export function trendPct(now: number, before: number): number | null {
  if (before <= 0) return null
  return Math.round(((now - before) / before) * 100)
}

// ------------------------------------------------------------------ finished work

/** On time (ADR-0075, I61.3): finished no later than the piece's due date; a piece with no date is on time. */
export const finishedOnTime = (p: Pick<PulsePiece, 'finishedAt' | 'dueAt'>) =>
  !!p.finishedAt && (!p.dueAt || Date.parse(p.finishedAt) <= Date.parse(p.dueAt))

/** Pieces finished in each week starting at `weekStarts`, split on time / late. */
export function finishedPerWeek(pieces: readonly PulsePiece[], weekStarts: readonly number[]) {
  return weekStarts.map((w) => {
    let onTime = 0
    let late = 0
    for (const p of pieces) {
      if (!inWeek(p.finishedAt, w)) continue
      if (finishedOnTime(p)) onTime += 1
      else late += 1
    }
    return { onTime, late }
  })
}

// ------------------------------------------------------------------ Figma H's own readings

export type DueOutcome = 'onTime' | 'late' | 'inReview' | 'open'

/**
 * "Deliveries, last four weeks" (Figma H DB-AM): the pieces DUE each week, by how they came out — finished by
 * their date, late (finished after it, or still open past it), in review, or still open.
 */
export function dueOutcomes(pieces: readonly PulsePiece[], weekStarts: readonly number[], now: number): Record<DueOutcome, number>[] {
  return weekStarts.map((w) => {
    const out: Record<DueOutcome, number> = { onTime: 0, late: 0, inReview: 0, open: 0 }
    for (const p of pieces) {
      if (p.state === 'archived' || !inWeek(p.dueAt, w)) continue
      const due = Date.parse(p.dueAt!)
      const done = p.state === 'approved' || p.state === 'delivered'
      if (done) out[finishedOnTime(p) ? 'onTime' : 'late'] += 1
      else if (due < now) out.late += 1
      else if (fromPhase(p) === 'inReview') out.inReview += 1
      else out.open += 1
    }
    return out
  })
}

/** "Busiest day" (Figma H DB-L): how many of these people are booked a full day or more, each day of the week. */
export function peopleFullPerDay(
  bookings: readonly { resourceId: string; start: number; end: number }[],
  people: ReadonlySet<string>,
  weekStart: number,
  dayHours = 8,
): number[] {
  const hours = new Map<string, number[]>()
  for (const b of bookings) {
    if (!people.has(b.resourceId)) continue
    const row = hours.get(b.resourceId) ?? [0, 0, 0, 0, 0, 0, 0]
    for (let d = 0; d < 7; d += 1) {
      const from = Math.max(b.start, weekStart + d * DAY_MS)
      const to = Math.min(b.end, weekStart + (d + 1) * DAY_MS)
      if (to > from) row[d]! += (to - from) / 3_600_000
    }
    hours.set(b.resourceId, row)
  }
  const out = [0, 0, 0, 0, 0, 0, 0]
  for (const row of hours.values()) row.forEach((h, d) => { if (h >= dayHours - 1e-9) out[d]! += 1 })
  return out
}

/** The Figma's colour for a person's load (DB-L "Load by person"): red from 80%, amber from 55% or when blocked. */
export function loadTone(pct: number, blocked = false): 'risk' | 'warn' | 'ink' | 'empty' {
  if (pct >= 80) return 'risk'
  if (blocked || pct >= 55) return 'warn'
  return pct > 0 ? 'ink' : 'empty'
}

/** The Figma's colour for a campaign's bar (DB-AM "Campaigns"): done green, a problem red, waiting amber, started blue. */
export function campaignTone(c: { total: number; done: number; atRisk: number; nobody: number; waiting: number }): 'ok' | 'risk' | 'warn' | 'blue' | 'ink' {
  if (c.total > 0 && c.done === c.total) return 'ok'
  if (c.atRisk > 0 || c.nobody > 0) return 'risk'
  if (c.waiting > 0) return 'warn'
  return c.done === 0 ? 'blue' : 'ink'
}

/** One resource's booked hours on each day of the week (Figma H DB-M "Your week, by day"). */
export function hoursPerDay(bookings: readonly { resourceId: string; start: number; end: number }[], resourceId: string, weekStart: number): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0]
  for (const b of bookings) {
    if (b.resourceId !== resourceId) continue
    for (let d = 0; d < 7; d += 1) {
      const from = Math.max(b.start, weekStart + d * DAY_MS)
      const to = Math.min(b.end, weekStart + (d + 1) * DAY_MS)
      if (to > from) out[d]! += (to - from) / 3_600_000
    }
  }
  return out.map((h) => Math.round(h * 10) / 10)
}
