import type { DeliverableRow } from '../api/deliverables-api'
import type { WorkPhase } from '../../../lib/deliverables/work-phase'

/**
 * Per-department pipeline board (ADR-0024, I2.4 — the swimlane surface). Pure reshaping of a
 * campaign's deliverables into one swimlane per DEPARTMENT with lifecycle-state columns. No new
 * data — the /deliverables query already carries department and state; this just pivots it.
 *
 * Until 20 Sep the lane was the STREAM. ADR-0050 made the stream a container — one per campaign —
 * so every deliverable of a campaign landed in one lane named after whichever department came
 * first (LUMA Season 2's Caption, Carousel and TVC all under "Production", guide 13). A
 * deliverable's department is stamped from its owner; that is the lane.
 *
 * `buildPhaseGrid` is the same rows pivoted the way the team's own spreadsheet lays them out
 * (ADR-0096, the client content master sheet (client-supplied, not included), Dashboard section C): phases
 * down the side, departments across, each cell that department's pieces in that phase.
 */

/**
 * The columns, left→right: where the WORK is (I40.22, `work-phase.ts`) — the one status the
 * Deliverables page and the campaign page wear. The container's own `state` ("draft",
 * "in_progress") is not a column here: it reads "In progress" for work nobody has begun. `blocked`
 * and `cancelled` are appended only when the campaign has any.
 */
export const PIPELINE_STAGES: WorkPhase[] = ['no_tasks', 'not_started', 'in_progress', 'in_review', 'awaiting_signoff', 'complete', 'delivered']

export interface BoardSwimlane {
  /** The department's id, or '—' for deliverables that have no owner yet. */
  laneId: string
  discipline: string | null
  columns: Record<WorkPhase, DeliverableRow[]>
  count: number
}

const emptyColumns = (): Record<WorkPhase, DeliverableRow[]> => ({
  no_tasks: [],
  cancelled: [],
  not_started: [],
  in_progress: [],
  in_review: [],
  awaiting_signoff: [],
  delivered: [],
  blocked: [],
  complete: [],
})

const dueKey = (d: DeliverableRow): number => (d.dueAt ? Date.parse(d.dueAt) : Number.POSITIVE_INFINITY)

/** The columns to render: the happy path, plus `blocked` / `cancelled` iff any deliverable is. */
export function boardStages(rows: DeliverableRow[]): WorkPhase[] {
  const live = rows.filter((r) => r.state !== 'archived')
  return [
    ...PIPELINE_STAGES,
    ...(live.some((r) => r.progress.phase === 'blocked') ? (['blocked'] as WorkPhase[]) : []),
    ...(live.some((r) => r.progress.phase === 'cancelled') ? (['cancelled'] as WorkPhase[]) : []),
  ]
}

/**
 * Group a campaign's deliverables into swimlanes (one per stream), each with state-keyed columns.
 * `archived` deliverables are dropped; cards within a column are ordered by due date (soonest
 * first, undated last). Swimlanes are ordered by discipline then stream name.
 */
export function buildBoard(rows: DeliverableRow[]): BoardSwimlane[] {
  const lanes = new Map<string, BoardSwimlane>()
  for (const d of rows) {
    if (d.state === 'archived') continue
    const key = d.departmentId ?? '—'
    let lane = lanes.get(key)
    if (!lane) {
      lane = { laneId: key, discipline: d.discipline, columns: emptyColumns(), count: 0 }
      lanes.set(key, lane)
    }
    lane.columns[d.progress.phase].push(d)
    lane.count += 1
  }
  const out = [...lanes.values()]
  for (const lane of out) {
    for (const state of Object.keys(lane.columns) as WorkPhase[]) {
      lane.columns[state].sort((a, b) => dueKey(a) - dueKey(b))
    }
  }
  // Named departments alphabetically; the unowned lane last.
  out.sort((a, b) => {
    if (a.laneId === '—') return 1
    if (b.laneId === '—') return -1
    return (a.discipline ?? '').localeCompare(b.discipline ?? '')
  })
  return out
}

/** A phase as the grid needs it. */
export interface GridPhase {
  id: string
  number: number
  name: string
  startsOn?: string
  endsOn?: string
}

export interface PhaseGridColumn {
  /** The department's id, or '—' for deliverables that have no owner yet. */
  id: string
  name: string | null
  total: number
}

export interface PhaseGridRow {
  phase: GridPhase | null
  /** By column id, in column order. */
  cells: Record<string, DeliverableRow[]>
  total: number
  done: number
}

export interface PhaseGrid {
  columns: PhaseGridColumn[]
  rows: PhaseGridRow[]
}

/**
 * Phases × departments (ADR-0096 d.12, as the team's sheet draws it). Every phase is a row, in
 * number order, even when empty — an empty week is a fact worth seeing. A deliverable that carries
 * no phase (none should, on a phased campaign; the guard forbids it) goes in a last row with no
 * phase, so nothing is hidden. Columns are the departments that have work, alphabetically, the
 * unowned column last. Cells sort by due date, undated last.
 */
export function buildPhaseGrid(rows: DeliverableRow[], phases: readonly GridPhase[]): PhaseGrid {
  const live = rows.filter((d) => d.state !== 'archived')
  const cols = new Map<string, PhaseGridColumn>()
  for (const d of live) {
    const id = d.departmentId ?? '—'
    const col = cols.get(id) ?? { id, name: d.discipline, total: 0 }
    col.total += 1
    cols.set(id, col)
  }
  const columns = [...cols.values()].sort((a, b) => {
    if (a.id === '—') return 1
    if (b.id === '—') return -1
    return (a.name ?? '').localeCompare(b.name ?? '')
  })
  const mkRow = (phase: GridPhase | null): PhaseGridRow => ({
    phase,
    cells: Object.fromEntries(columns.map((c) => [c.id, [] as DeliverableRow[]])),
    total: 0,
    done: 0,
  })
  const byPhase = new Map<string, PhaseGridRow>()
  const ordered = [...phases].sort((a, b) => a.number - b.number).map((p) => {
    const row = mkRow(p)
    byPhase.set(p.id, row)
    return row
  })
  const unphased = mkRow(null)
  for (const d of live) {
    const row = (d.phaseId && byPhase.get(d.phaseId)) || unphased
    row.cells[d.departmentId ?? '—']!.push(d)
    row.total += 1
    if (d.progress.phase === 'complete' || d.progress.phase === 'delivered') row.done += 1
  }
  for (const row of [...ordered, unphased]) {
    for (const id of Object.keys(row.cells)) row.cells[id]!.sort((a, b) => dueKey(a) - dueKey(b))
  }
  return { columns, rows: unphased.total > 0 ? [...ordered, unphased] : ordered }
}
