import type { DeliverableRow } from '../../deliverables/api/deliverables-api'
import type { RiskAssessment } from '../../../lib/deadlines/at-risk'
import { iraqDay } from '../../../lib/time/iraq'

/**
 * Where is everything (Figma CG-03, I57.10) — the rules, pure, so the component is a layout.
 *
 * One row per live piece: where it is, with whom, for how long, the one thing that moves it, and the
 * clock. Every answer is about the PIECE and its OWNER, never one task person (Edward, 24 Sep: the
 * drawer, CG-04, carries the task breakdown).
 *
 * The clock is the at-risk rule (I57 answer 11, `assessRisk`, ADR-0075 date checks): late by N days
 * in red, at risk in amber, waiting when only an input holds it, on time otherwise, nothing once the
 * piece is finished. "Blocked" does not exist (the 3 Sep rule) — a piece with an outstanding input
 * is WAITING; red means late.
 */

export type WhereStatus =
  | 'not_started'
  | 'in_progress'
  | 'in_review'
  | 'waiting'
  | 'unassigned'
  | 'with_client'
  | 'delivered'

export const WHERE_STATUSES: readonly WhereStatus[] = [
  'not_started', 'in_progress', 'in_review', 'waiting', 'unassigned', 'with_client', 'delivered',
]

/** What the campaign-scoped risk read says about one piece (`useCampaignRisk`). */
export interface PieceRisk {
  assessment: RiskAssessment
  /** Outstanding external inputs (ADR-0069, `deliverable_pending_inputs`, not satisfied). */
  outstandingInputs: number
  /** Since when the piece has been where it is — see `useCampaignRisk` for which moment. */
  since: string | null
  /** The oldest outstanding input's request, when there is one: how long it has been waiting. */
  waitingSince: string | null
}

const liveTask = (s: string) => s !== 'done' && s !== 'cancelled'

/** Live tasks nobody has been given. The task list when the read carried it, else the row's count. */
function unassignedTasks(d: DeliverableRow): number {
  if (d.taskList) return d.taskList.filter((t) => liveTask(t.status) && !t.assigneeName).length
  return d.unassignedCount ?? 0
}

/**
 * Where the piece is. The order is the frame's meaning: finished first (delivered, then approved —
 * the internal approval, out with the client until Delivered is pressed, I57 answer 5), then an
 * outstanding input (Waiting), then what its tasks say.
 */
export function whereStatus(d: DeliverableRow, inputs: number): WhereStatus {
  if (d.state === 'delivered') return 'delivered'
  if (d.state === 'approved') return 'with_client'
  if (inputs > 0 || d.state === 'blocked') return 'waiting'
  const phase = d.progress.phase
  if (phase === 'in_review' || phase === 'awaiting_signoff') return 'in_review'
  if (phase === 'in_progress') return 'in_progress'
  if (d.taskCount > 0 && (d.tasksApprovedAt == null || unassignedTasks(d) > 0)) return 'unassigned'
  return 'not_started'
}

export type NextKind =
  | 'delivered'
  | 'clientSignsOff'
  | 'inputs'
  | 'inputArrives'
  | 'approveOrChanges'
  | 'ownerApproves'
  | 'goesForReview'
  | 'ownerApprovesList'
  | 'ownerGivesIt'
  | 'ownerPlans'
  | 'startsOn'
  | 'someoneStarts'

/** The one thing that moves it, as a key and its values — the component words it. */
export interface Next {
  kind: NextKind
  count?: number
  /** Only for `startsOn`: the earliest start of a task not yet started. */
  at?: string
}

export function nextStep(d: DeliverableRow, status: WhereStatus, inputs: number): Next {
  switch (status) {
    case 'delivered':
      return { kind: 'delivered' }
    case 'with_client':
      return { kind: 'clientSignsOff' }
    case 'waiting':
      return inputs > 0 ? { kind: 'inputs', count: inputs } : { kind: 'inputArrives' }
    case 'in_review':
      // Every task approved and the piece not signed off: its owner signs it off.
      return d.progress.phase === 'awaiting_signoff' ? { kind: 'ownerApproves' } : { kind: 'approveOrChanges' }
    case 'in_progress':
      return { kind: 'goesForReview' }
    case 'unassigned':
      return d.tasksApprovedAt == null ? { kind: 'ownerApprovesList' } : { kind: 'ownerGivesIt' }
    case 'not_started': {
      if (d.taskCount === 0) return { kind: 'ownerPlans' }
      const starts = (d.taskList ?? [])
        .filter((t) => t.status === 'todo' && t.startsAt)
        .map((t) => t.startsAt!)
        .sort()
      return starts.length > 0 ? { kind: 'startsOn', at: starts[0] } : { kind: 'someoneStarts' }
    }
  }
}

export type ClockTone = 'late' | 'at_risk' | 'waiting' | 'on_time'

/** The clock. Null for a finished piece, and while the risk read has not answered. */
export function clockOf(risk: PieceRisk | undefined): { tone: ClockTone; days: number } | null {
  if (!risk) return null
  const a = risk.assessment
  switch (a.level) {
    case 'done':
      return null
    case 'late':
      return { tone: 'late', days: Math.max(1, a.lateByWorkingDays) }
    case 'at_risk':
      return { tone: 'at_risk', days: 0 }
    case 'waiting':
      return { tone: 'waiting', days: 0 }
    default:
      return { tone: 'on_time', days: 0 }
  }
}

/**
 * Since when the piece has been where its tasks put it — what `useCampaignRisk` stores as `since`:
 * approved (out with the client): the piece row's last change, which is the approval; a task in
 * review: the latest submission among them; a task in progress: the earliest current start among
 * them; otherwise the task list's approval, else the piece's creation.
 */
export function pieceSince(
  piece: { state: DeliverableRow['state']; tasksApprovedAt: string | null; createdAt: string; updatedAt: string },
  tasks: readonly { status: string; submittedAt: string | null; startedAt: string | null }[],
): string {
  if (piece.state === 'approved') return piece.updatedAt
  const review = tasks.filter((t) => t.status === 'review' && t.submittedAt).map((t) => t.submittedAt!).sort()
  if (review.length > 0) return review[review.length - 1]
  const started = tasks.filter((t) => t.status === 'in_progress' && t.startedAt).map((t) => t.startedAt!).sort()
  if (started.length > 0) return started[0]
  return piece.tasksApprovedAt ?? piece.createdAt
}

/** Since when it has been where it is. Delivered is finished — nothing is counting. */
export function sinceOf(status: WhereStatus, risk: PieceRisk | undefined): string | null {
  if (status === 'delivered' || !risk) return null
  if (status === 'waiting') return risk.waitingSince ?? risk.since
  return risk.since
}

/** "For how long", as the frame writes it: `3h` under a day, `1 day`, `2 days`. */
export type Duration = { unit: 'under_hour' } | { unit: 'hours'; n: number } | { unit: 'days'; n: number }

export function durationSince(since: string | null, now: number): Duration | null {
  if (!since) return null
  const ms = now - Date.parse(since)
  if (!Number.isFinite(ms)) return null
  const hours = Math.floor(Math.max(0, ms) / 3_600_000)
  if (hours < 1) return { unit: 'under_hour' }
  if (hours < 24) return { unit: 'hours', n: hours }
  return { unit: 'days', n: Math.floor(hours / 24) }
}

// ---------------------------------------------------------------------------------------------
// Filters and order
// ---------------------------------------------------------------------------------------------

export interface WhereFilters {
  /** A phase id, or '' for all. */
  phase: string
  /** A workstream id, `none` for pieces in no workstream, or '' for all. */
  workstream: string
  /** An owner's user id, or '' for anyone. */
  owner: string
  status: WhereStatus | ''
}

export interface WherePhase {
  id: string
  startsOn: string
  endsOn: string
}

/**
 * The phase the page opens on: the one today falls in, else all. A phase with no live piece in it
 * would open the page on nothing, so that falls back to all too (the UI never blocks).
 */
export function defaultPhase(phases: readonly WherePhase[], pieces: readonly DeliverableRow[], now: number): string {
  const today = iraqDay(now)
  const current = phases.find((p) => p.startsOn <= today && today <= p.endsOn)
  if (!current) return ''
  return pieces.some((d) => d.state !== 'archived' && d.phaseId === current.id) ? current.id : ''
}

export interface WhereRow {
  piece: DeliverableRow
  status: WhereStatus
  next: Next
  clock: ReturnType<typeof clockOf>
  since: string | null
}

const RANK: Record<ClockTone, number> = { late: 0, at_risk: 1, waiting: 2, on_time: 2 }

/** Late first (the latest first), then at risk, then by due date; finished pieces last. */
function compare(a: WhereRow, b: WhereRow): number {
  const ra = a.clock ? RANK[a.clock.tone] : 3
  const rb = b.clock ? RANK[b.clock.tone] : 3
  if (ra !== rb) return ra - rb
  if (a.clock?.tone === 'late' && b.clock?.tone === 'late' && a.clock.days !== b.clock.days) return b.clock.days - a.clock.days
  const da = a.piece.dueAt ? Date.parse(a.piece.dueAt) : Number.POSITIVE_INFINITY
  const db = b.piece.dueAt ? Date.parse(b.piece.dueAt) : Number.POSITIVE_INFINITY
  if (da !== db) return da - db
  return (a.piece.code ?? a.piece.name).localeCompare(b.piece.code ?? b.piece.name)
}

/** Every live piece as a row, before any filter. Archived pieces will not be made — not listed. */
export function whereRows(pieces: readonly DeliverableRow[], risk: ReadonlyMap<string, PieceRisk>): WhereRow[] {
  return pieces
    .filter((d) => d.state !== 'archived')
    .map((d) => {
      const r = risk.get(d.id)
      const inputs = r?.outstandingInputs ?? 0
      const status = whereStatus(d, inputs)
      return { piece: d, status, next: nextStep(d, status, inputs), clock: clockOf(r), since: sinceOf(status, r) }
    })
    .sort(compare)
}

export function filterRows(
  rows: readonly WhereRow[],
  f: WhereFilters,
  /** Which period (phase, or week without phases — I63) a piece is in; the phase id when absent. */
  periodOf: (d: DeliverableRow) => string | null = (d) => d.phaseId ?? null,
): WhereRow[] {
  return rows.filter(
    ({ piece: d, status }) =>
      (!f.phase || periodOf(d) === f.phase) &&
      (!f.workstream || (f.workstream === 'none' ? d.workstreamId == null : d.workstreamId === f.workstream)) &&
      (!f.owner || d.ownerUserId === f.owner) &&
      (!f.status || status === f.status),
  )
}
