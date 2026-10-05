import type { DeliverableState } from '../deliverables/state-machine'

/**
 * Campaign delivery-status rollup (ADR-0024 / I2.5, consolidated onto the campaign page 31 Aug).
 *
 * This is the **Account Manager's slice of the Tier-2 oversight surface** described by ADR-0018 d.4
 * — "account manager → their assigned campaigns/projects" — read in the campaign's own context
 * rather than on a separate screen. ADR-0018 d.7 deferred that slice to the engine phase; the
 * engine has since landed (states, due dates, blocked, assignment), so the counts below are real.
 *
 * **It lived on a page nobody could open.** `/campaigns/:campaignId` was declared TWICE in
 * `router.tsx`; React Router matches the first, so the status page and this rollup were unreachable
 * from 27 Aug (`800666c`) until the pages were merged. Nothing errored — the route simply never won.
 * `router.test.ts` now fails the build if two routes ever claim one path again.
 *
 * Moved out of `src/features/deliverables/lib/` because it is pure reshaping with no feature
 * dependency, and the surface that reads it is `features/campaigns` — leaving it where it was would
 * have added another cross-feature import edge to the 21 already recorded in STATE.md.
 */

/** The least a row must carry to be counted. Structural on purpose: an engine in `src/lib` must not
 *  depend on a feature's API type, and every caller's row already satisfies this. */
export interface RollupRow {
  state: DeliverableState
  dueAt: string | null
}

export interface StatusRollup {
  /** Live deliverables — archived excluded, because a total that only ever grows tells you nothing. */
  total: number
  byState: Record<DeliverableState, number>
  /** Signed-off or handed over (approved + delivered). */
  done: number
  blocked: number
  /** Past due and not yet done/archived. */
  overdue: number
  /** Whole percent done of total; 0 when there is nothing to be done. */
  percent: number
}

const zeroByState = (): Record<DeliverableState, number> => ({
  draft: 0,
  in_progress: 0,
  in_review: 0,
  approved: 0,
  delivered: 0,
  archived: 0,
  blocked: 0,
})

/**
 * Past its due date and still owed. Delivered, approved and archived work is never overdue however
 * old it is — the date stops mattering once the thing exists.
 */
export const isOverdue = (d: RollupRow, now: number): boolean =>
  d.dueAt != null &&
  Date.parse(d.dueAt) < now &&
  d.state !== 'delivered' &&
  d.state !== 'approved' &&
  d.state !== 'archived'

/**
 * Roll a set of deliverables into counts.
 *
 * **Archived rows are excluded from `total` and `overdue` but still tallied in `byState`** — the
 * headline figure is about live work, while the per-state breakdown stays a complete census of what
 * was passed in. Both behaviours are relied on: the first by the progress bar, the second by anyone
 * asking how much has been archived.
 */
export function computeRollup(rows: readonly RollupRow[], now: number): StatusRollup {
  const byState = zeroByState()
  let total = 0
  let overdue = 0
  for (const d of rows) {
    byState[d.state] += 1
    if (d.state === 'archived') continue
    total += 1
    if (isOverdue(d, now)) overdue += 1
  }
  const done = byState.approved + byState.delivered
  return {
    total,
    byState,
    done,
    blocked: byState.blocked,
    overdue,
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
  }
}

/** True when a rollup has something a lead should act on. Drives whether the strip is worth reading
 *  at a glance, and keeps "what counts as an exception" in one place rather than in each surface. */
export const hasExceptions = (r: StatusRollup): boolean => r.blocked > 0 || r.overdue > 0

/**
 * How much of the campaign's work has somebody on it.
 *
 * **The most important exception on this surface** (Edward, 31 Aug). A campaign is approved on the
 * strength of its briefs, and then the tasks sit there with nobody on them: on the live tenant,
 * Test Campaign is approved with **16 live tasks and 16 unassigned**. Deliverable counts cannot see
 * this — every deliverable reads `draft`, which is true and useless.
 *
 * Counts every task except a cancelled one (I52.10, Edward 17 Sep — done is a status, not an
 * exclusion; the total moves only when a task is added, cancelled or removed). Cancelled work still
 * cannot flatter the figure: two of that campaign's eighteen tasks are cancelled and the truth is
 * 0 of 16, not 2 of 18. Before 17 Sep `done` was excluded too, so the ring shrank as work finished.
 */
export interface TaskCoverage {
  /** Every task under the campaign or department except a cancelled one (I52.10). */
  total: number
  assigned: number
  unassigned: number
  /** Of `total`, how many are done. */
  done: number
  /**
   * ADR-0090 d.3b: of the unassigned, how many sit on a single job's deliverable whose owner has
   * not approved the list yet. Counted INSIDE `unassigned` (d.9 — they are unassigned) and named
   * separately, because nobody should assign them yet; the owner should approve the list.
   */
  held: number
  /** Who is sitting on a held list, by name, deduplicated — the person the line points at. */
  heldOwners: string[]
}

export interface CoverageRow {
  taskCount: number
  unassignedCount: number
  /** I52.10: the total counts done tasks too. Optional so an older caller still gets a coverage
   *  (it then falls back to the live count). */
  taskTotal?: number
  doneCount?: number
  /** Optional so a caller that never read the ADR-0090 columns still gets a coverage. */
  campaignKind?: 'single_job' | 'campaign' | null
  tasksApprovedAt?: string | null
  ownerName?: string | null
}

export function taskCoverage(rows: readonly CoverageRow[]): TaskCoverage {
  let total = 0
  let unassigned = 0
  let done = 0
  let held = 0
  const owners = new Set<string>()
  for (const d of rows) {
    // Edward, 17 Sep: "the total should always read the total, unless a task is cancelled or
    // deleted… done is a status, not whether or not it counts." A done task stays in the total and
    // counts as assigned; only cancelled work leaves the figure.
    total += d.taskTotal ?? d.taskCount
    done += d.doneCount ?? 0
    unassigned += d.unassignedCount
    if (d.campaignKind === 'single_job' && d.tasksApprovedAt === null && d.unassignedCount > 0) {
      held += d.unassignedCount
      if (d.ownerName) owners.add(d.ownerName)
    }
  }
  return { total, assigned: total - unassigned, unassigned, done, held, heldOwners: [...owners] }
}

/** One ring per deliverable: its tasks done out of its tasks (I52.10). Archived deliverables are
 *  not shown — a closed container has nothing left to fill. */
export interface DeliverableProgressRow {
  id: string
  name: string
  state: DeliverableState
  taskTotal?: number
  taskCount: number
  doneCount?: number
}
export interface DeliverableProgress {
  id: string
  name: string
  done: number
  total: number
}
export function deliverableProgress(rows: readonly DeliverableProgressRow[]): DeliverableProgress[] {
  return rows
    .filter((d) => d.state !== 'archived')
    .map((d) => ({ id: d.id, name: d.name, done: d.doneCount ?? 0, total: d.taskTotal ?? d.taskCount }))
}
