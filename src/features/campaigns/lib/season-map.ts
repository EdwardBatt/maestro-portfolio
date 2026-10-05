import { isOverdue } from '../../../lib/campaigns/status'
import { iraqDay } from '../../../lib/time/iraq'
import type { DeliverableRow } from '../../deliverables/api/deliverables-api'
import type { CampaignPhase } from '../api/campaign-detail-api'
import { gridGroups, NO_FILTERS, type GridGroup, type GridWorkstream } from './campaign-grid'

/**
 * The season map (Figma CG-02, I57.6) and the brief's "What it produced" (CG-07, I57.7): one
 * coloured square per PIECE, never per task (Edward, 24 Sep). Pure, so the colour rule and the
 * grouping are tested here and the components are layouts.
 *
 * Rows are the grid's groups (`gridGroups`: by workstream, by department where the campaign has
 * none, and "Not in a workstream"); columns are the campaign's phases, with a trailing "No phase"
 * column only when some piece sits in none. A campaign WITHOUT phases is mapped by week (Edward,
 * 28 Sep, I63.5 — as CG-02 is drawn): one column per week from the first piece due to the last,
 * the week starting on the client's first working day, and "No date" for a piece without one. An
 * archived piece will not be made and is left out.
 */

export type SquareStatus = 'delivered' | 'approved' | 'in_progress' | 'in_review' | 'waiting' | 'not_started' | 'late'

/** The legend's order, and the order squares sit in a cell: done first, untouched last. */
export const SQUARE_STATUSES: readonly SquareStatus[] = ['delivered', 'approved', 'in_progress', 'in_review', 'waiting', 'late', 'not_started']

/**
 * Where a piece is, as one colour. Red means LATE (the 3 Sep rule: there is no "blocked").
 * - past its date and not yet approved or delivered → late (`isOverdue` already spares both);
 * - `delivered` — the client approved it and has the final product → delivered;
 * - `approved` — the INTERNAL approval → approved (Edward, 24 Sep: it shows as Approved);
 * - tasks in review, or all done and awaiting sign-off → in review;
 * - tasks in progress → in progress;
 * - an outstanding input (or the legacy `blocked` state) → WAITING, the colour the Board and the
 *   Timeline give it (sky), so the four views agree;
 * - anything else (not started, no tasks yet) → not started — the hollow square.
 */
export function squareStatus(d: DeliverableRow, now: number, outstandingInputs = 0): SquareStatus {
  if (d.state === 'delivered') return 'delivered'
  if (d.state === 'approved') return 'approved'
  if (isOverdue(d, now)) return 'late'
  if (outstandingInputs > 0 || d.state === 'blocked') return 'waiting'
  const phase = d.progress.phase
  if (phase === 'in_review' || phase === 'awaiting_signoff') return 'in_review'
  if (phase === 'in_progress') return 'in_progress'
  if (phase === 'delivered' || phase === 'complete') return 'delivered'
  return 'not_started'
}

export const NO_PHASE = 'none'

export interface MapColumn {
  /** The phase id, `NO_PHASE`, a week's key (`week:YYYY-MM-DD`, its first day) or `NO_DATE`. */
  key: string
  phase: CampaignPhase | null
  /** The week, on a campaign mapped by week: its number (1 = the first with work) and its days. */
  week?: { number: number; startsOn: string; endsOn: string }
  /** Today (in Iraq) falls within the phase's, or the week's, dates. */
  current: boolean
}

export const NO_DATE = 'nodate'

const DAY_MS = 86_400_000
const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`)
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)
/** ISO weekday, 1 = Monday … 7 = Sunday. */
const isoWeekday = (iso: string) => ((new Date(dayMs(iso)).getUTCDay() + 6) % 7) + 1

/** The day a working week starts: the first working day after a day off (Iraq: Sunday; Mon–Fri: Monday). */
export function weekStartDay(workingDays: readonly number[]): number {
  const on = new Set(workingDays)
  for (let d = 1; d <= 7; d++) if (on.has(d) && !on.has(d === 1 ? 7 : d - 1)) return d
  return 1
}

/** The first day of the week `day` falls in. */
export function weekOf(day: string, startDay: number): string {
  return isoOf(dayMs(day) - ((isoWeekday(day) - startDay + 7) % 7) * DAY_MS)
}

/**
 * A campaign without phases, mapped by week: every week from the first live piece's due date to the
 * last one's — a week with nothing due stays, so the map reads as time — then "No date" when a live
 * piece has none.
 */
export function weekColumns(pieces: readonly DeliverableRow[], todayIraq: string, startDay: number): MapColumn[] {
  const live = livePieces(pieces)
  const weeks = [...new Set(live.filter((d) => d.dueAt).map((d) => weekOf(iraqDay(d.dueAt!), startDay)))].sort()
  const cols: MapColumn[] = []
  if (weeks.length) {
    const today = weekOf(todayIraq, startDay)
    for (let ms = dayMs(weeks[0]!), n = 1; ms <= dayMs(weeks[weeks.length - 1]!); ms += 7 * DAY_MS, n++) {
      const startsOn = isoOf(ms)
      cols.push({ key: `week:${startsOn}`, phase: null, week: { number: n, startsOn, endsOn: isoOf(ms + 6 * DAY_MS) }, current: startsOn === today })
    }
  }
  if (live.some((d) => !d.dueAt)) cols.push({ key: NO_DATE, phase: null, current: false })
  return cols
}

export const livePieces = (pieces: readonly DeliverableRow[]) => pieces.filter((d) => d.state !== 'archived')

/** The phases in number order, then "No phase" when a live piece is in none (or in one not listed). */
export function mapColumns(phases: readonly CampaignPhase[], pieces: readonly DeliverableRow[], todayIraq: string): MapColumn[] {
  const known = new Set(phases.map((p) => p.id))
  const cols: MapColumn[] = [...phases]
    .sort((a, b) => a.number - b.number)
    .map((p) => ({ key: p.id, phase: p, current: p.startsOn <= todayIraq && todayIraq <= p.endsOn }))
  if (livePieces(pieces).some((d) => d.phaseId == null || !known.has(d.phaseId))) {
    cols.push({ key: NO_PHASE, phase: null, current: false })
  }
  return cols
}

/**
 * The campaign's periods — its phases, or its weeks when it has none (I63.5) — for the map's columns
 * AND the views' phase filter (Edward, 28 Sep: the filter was missing without phases), so the two agree.
 */
export function periodColumns(phases: readonly CampaignPhase[], pieces: readonly DeliverableRow[], todayIraq: string, startDay: number): MapColumn[] {
  return phases.length > 0 ? mapColumns(phases, pieces, todayIraq) : weekColumns(pieces, todayIraq, startDay)
}

/** Which of these columns a piece sits in: its phase, or the week it is due (`NO_PHASE` / `NO_DATE` for neither). */
export function columnKeyOf(columns: readonly MapColumn[]): (d: DeliverableRow) => string {
  const phaseKeys = new Set(columns.filter((c) => c.phase).map((c) => c.key))
  const byWeek = columns.some((c) => c.week || c.key === NO_DATE)
  const first = columns.find((c) => c.week)?.week?.startsOn
  const weekStart = first ? isoWeekday(first) : 1
  return (d) => {
    if (byWeek) return d.dueAt ? `week:${weekOf(iraqDay(d.dueAt), weekStart)}` : NO_DATE
    return d.phaseId != null && phaseKeys.has(d.phaseId) ? d.phaseId : NO_PHASE
  }
}

export interface MapSquare {
  piece: DeliverableRow
  status: SquareStatus
}

export interface MapRow {
  group: GridGroup
  /** Column key → the squares in that cell, in legend order then by code. */
  cells: Map<string, MapSquare[]>
}

const rank = (s: SquareStatus) => SQUARE_STATUSES.indexOf(s)

/** Squares in legend order, then by code (or name), so a cell reads green → hollow left to right. */
export function orderSquares(pieces: readonly DeliverableRow[], now: number, inputs?: ReadonlyMap<string, number>): MapSquare[] {
  return pieces
    .map((piece) => ({ piece, status: squareStatus(piece, now, inputs?.get(piece.id) ?? 0) }))
    .sort((a, b) => rank(a.status) - rank(b.status) || (a.piece.code ?? a.piece.name).localeCompare(b.piece.code ?? b.piece.name))
}

export function mapRows(
  pieces: readonly DeliverableRow[],
  workstreams: readonly GridWorkstream[],
  columns: readonly MapColumn[],
  now: number,
  inputs?: ReadonlyMap<string, number>,
): MapRow[] {
  const keyOf = columnKeyOf(columns)
  return gridGroups(pieces, workstreams, NO_FILTERS).map((group) => {
    const cells = new Map<string, MapSquare[]>()
    for (const col of columns) {
      cells.set(col.key, orderSquares(group.rows.filter((d) => keyOf(d) === col.key), now, inputs))
    }
    return { group, cells }
  })
}
