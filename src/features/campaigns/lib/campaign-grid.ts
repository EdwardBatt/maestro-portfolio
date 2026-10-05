import type { DeliverableRow } from '../../deliverables/api/deliverables-api'
import type { WorkPhase } from '../../../lib/deliverables/work-phase'

/**
 * The campaign grid (Figma CG-01, I57.5): which pieces show, in which groups, and what each group's
 * line says. Pure, so the component is a layout and this is testable.
 *
 * Grouped by WORKSTREAM, as the frame draws it; a campaign with no workstreams is grouped by
 * DEPARTMENT instead (ADR-0099: grouping is optional, so "none" is a normal campaign, not a
 * half-built one), and pieces outside every workstream get a group of their own. A closed piece is
 * not on the grid — it will not be made.
 *
 * "Executed" is every person holding a task on the piece, not one name (Edward, 24 Sep: the tasks
 * under one deliverable can be assigned to several people, and all of them are shown). The owner —
 * the lead accountable — is a separate column.
 */

export interface GridFilters {
  /** A workstream id, `none` for pieces in no workstream, or '' for all. */
  workstream: string
  /** A phase id, or '' for all. */
  phase: string
  /** An owner's user id, or '' for anyone. */
  owner: string
  status: WorkPhase | ''
  /** Only pieces whose task list waits for its owner (ADR-0100 d.2). */
  needsApproval: boolean
}

export const NO_FILTERS: GridFilters = { workstream: '', phase: '', owner: '', status: '', needsApproval: false }

export interface GridWorkstream {
  id: string
  name: string
  ownerName: string | null
  /** I66.9: a piece's owner is offered from its workstream's department. */
  departmentId?: string | null
}

export interface GridGroup {
  key: string
  /** Null for "not in a workstream" / "no department" — the caller words it. */
  name: string | null
  kind: 'workstream' | 'department' | 'none'
  /** Position in the campaign, for the group's colour. */
  index: number
  rows: DeliverableRow[]
  /** Counted over the group's live pieces, before any filter, so the line is the group's truth. */
  total: number
  delivered: number
  managerName: string | null
}

export const needsApproval = (d: DeliverableRow) => d.tasksApprovedAt == null && (d.taskCount ?? 0) > 0

/** Everyone holding a task on the piece, in task order, once each; and how many live tasks nobody has. */
export function executedBy(d: DeliverableRow): { names: string[]; unassigned: number } {
  const names: string[] = []
  let unassigned = 0
  for (const t of d.taskList ?? []) {
    if (t.assigneeName) {
      if (!names.includes(t.assigneeName)) names.push(t.assigneeName)
    } else if (t.status !== 'done' && t.status !== 'cancelled') {
      unassigned += 1
    }
  }
  return { names, unassigned }
}

export function gridGroups(
  pieces: readonly DeliverableRow[],
  workstreams: readonly GridWorkstream[],
  f: GridFilters,
  /** Which period (phase, or week without phases — I63) a piece is in; the phase id when absent. */
  periodOf: (d: DeliverableRow) => string | null = (d) => d.phaseId ?? null,
): GridGroup[] {
  const live = pieces.filter((d) => d.state !== 'archived')
  const passes = (d: DeliverableRow) =>
    (!f.workstream || (f.workstream === 'none' ? d.workstreamId == null : d.workstreamId === f.workstream)) &&
    (!f.phase || periodOf(d) === f.phase) &&
    (!f.owner || d.ownerUserId === f.owner) &&
    (!f.status || d.progress.phase === f.status) &&
    (!f.needsApproval || needsApproval(d))

  const groups: GridGroup[] = []
  const add = (key: string, name: string | null, kind: GridGroup['kind'], managerName: string | null, all: DeliverableRow[]) => {
    if (all.length === 0) return
    groups.push({
      key,
      name,
      kind,
      index: groups.length,
      rows: all.filter(passes),
      total: all.length,
      delivered: all.filter((d) => d.state === 'delivered').length,
      managerName,
    })
  }

  if (workstreams.length > 0) {
    for (const w of workstreams) add(w.id, w.name, 'workstream', w.ownerName, live.filter((d) => d.workstreamId === w.id))
    const known = new Set(workstreams.map((w) => w.id))
    add('none', null, 'none', null, live.filter((d) => d.workstreamId == null || !known.has(d.workstreamId)))
  } else {
    const byDept = new Map<string, DeliverableRow[]>()
    for (const d of live) {
      const k = d.departmentId ?? 'none'
      byDept.set(k, [...(byDept.get(k) ?? []), d])
    }
    for (const [k, rows] of byDept) add(k, k === 'none' ? null : rows[0].discipline, k === 'none' ? 'none' : 'department', null, rows)
  }
  return groups
}

/** The owners a filter offers: each once, by name. */
export function ownersOf(pieces: readonly DeliverableRow[]): { id: string; name: string }[] {
  const seen = new Map<string, string>()
  for (const d of pieces) if (d.ownerUserId && d.ownerName && d.state !== 'archived') seen.set(d.ownerUserId, d.ownerName)
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
}
