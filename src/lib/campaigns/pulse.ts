/**
 * A campaign's pulse — what its card on the campaigns list says (I57.2 / I57.3, Figma CG-00).
 *
 * One pass over a campaign's live pieces answers four questions the card shows as separate badges,
 * each only above zero (Edward, 24 Sep: *"there are more alerts than status"*), plus the progress
 * figure and who is ON the campaign for the list's "Mine" filter:
 *
 *   - **At risk** — pieces late or at risk by ADR-0075 (`assessRisk`, I57.1).
 *   - **Waiting on client** — the TEMPORARY rule until the client portal exists (I57 answer 5):
 *     approved internally and not yet delivered — the client's approval happens outside the system
 *     and Delivered is pressed by hand when it has — OR an outstanding external input.
 *   - **Tasks unassigned** — live tasks nobody has been given, on pieces whose task list IS approved.
 *     A piece always has an owner (the wizard requires one), so this counts TASKS, never pieces
 *     (Edward, 24 Sep).
 *   - **Task lists to approve** — pieces whose owner has not approved the task list (ADR-0100).
 *
 * "Delivered" in the progress is Edward's word, 24 Sep: the client approved it and was handed the
 * final product. Approved is the internal approval and is not yet delivered.
 */

import type { DeliverableState } from '../deliverables/state-machine.ts'
import { assessRisk, threatensDeadline, type RiskOptions, type RiskTask } from '../deadlines/at-risk.ts'
import type { WorkingCalendar } from './go-live-dates.ts'
import { iraqDay } from '../time/iraq.ts'

export interface PulseTask extends Omit<RiskTask, 'waitingOnPrerequisite'> {
  reviewerIds: readonly string[]
  /** The round it is on (0 = the first) — the Dashboard's "Rounds used" (I61). */
  revisionNumber?: number
}

export interface PulsePiece {
  /** The deliverable and its name — the Dashboard lists pieces (I61); the badges only count them. */
  id?: string
  name?: string
  /** When it first became approved or delivered (I61.3) — the Dashboard's finished-per-week. */
  finishedAt?: string | null
  state: DeliverableState
  dueAt: string | null
  taskListApprovedAt: string | null
  ownerId: string | null
  reviewerId: string | null
  workstreamOwnerId: string | null
  /** Outstanding external inputs (ADR-0069) — things expected from outside the agency. */
  outstandingInputs: number
  tasks: readonly PulseTask[]
  /** The client's working week (ADR-0123 d.3) — its days decide when the piece is late or at risk.
   *  Absent, the options' calendar (or Iraq's) is used. */
  calendar?: WorkingCalendar
}

export interface CampaignPulse {
  /** Live pieces — closed ones are not work anybody owes. */
  total: number
  delivered: number
  atRisk: number
  waitingOnClient: number
  tasksUnassigned: number
  taskListsToApprove: number
  /** Everyone on it in one of the four ways (I57 answer 2): owns a piece, holds a task, reviews,
   *  owns a workstream. The account manager is added by the caller, from the campaign row. */
  people: ReadonlySet<string>
}

const LIVE_TASK = (s: RiskTask['status']) => s !== 'done' && s !== 'cancelled'

/** Late (ADR-0075): a live task past the Iraq day it was committed to. The dashboards' "Late" and the campaigns
 *  list's Late filter (I61.17) read this one rule. */
export function isLateTask(t: { status: string; committedDueAt: string | null }, now: number): boolean {
  if (!t.committedDueAt || t.status === 'done' || t.status === 'cancelled') return false
  return iraqDay(now) > iraqDay(t.committedDueAt)
}

/**
 * A piece whose task list still waits for approval (ADR-0100's second gate): live, not finished, and with
 * live tasks on a list nobody has approved. The campaigns list's badge and the Dashboard's "Task lists not
 * approved" (I66.2) count the same pieces.
 */
export function awaitsTaskListApproval(p: Pick<PulsePiece, 'state' | 'taskListApprovedAt' | 'tasks'>): boolean {
  if (p.state === 'archived' || p.state === 'approved' || p.state === 'delivered') return false
  return p.taskListApprovedAt == null && p.tasks.some((t) => LIVE_TASK(t.status))
}

export function isWaitingOnClient(p: Pick<PulsePiece, 'state' | 'outstandingInputs'>): boolean {
  if (p.state === 'delivered' || p.state === 'archived') return false
  return p.state === 'approved' || p.outstandingInputs > 0
}

export function campaignPulse(pieces: readonly PulsePiece[], opts: RiskOptions): CampaignPulse {
  const people = new Set<string>()
  const out = { total: 0, delivered: 0, atRisk: 0, waitingOnClient: 0, tasksUnassigned: 0, taskListsToApprove: 0 }

  for (const p of pieces) {
    for (const id of [p.ownerId, p.reviewerId, p.workstreamOwnerId]) if (id) people.add(id)
    for (const t of p.tasks) {
      if (t.assigneeId) people.add(t.assigneeId)
      for (const r of t.reviewerIds) people.add(r)
    }
    if (p.state === 'archived') continue

    out.total += 1
    if (p.state === 'delivered') out.delivered += 1
    if (isWaitingOnClient(p)) out.waitingOnClient += 1

    const finished = p.state === 'approved' || p.state === 'delivered'
    if (finished) continue
    if (awaitsTaskListApproval(p)) out.taskListsToApprove += 1
    // Only under an APPROVED list: before approval nobody may be assigned (ADR-0090), so those tasks
    // are the task-list badge's, and counting them twice would call the system working a problem.
    if (p.taskListApprovedAt != null) out.tasksUnassigned += p.tasks.filter((t) => LIVE_TASK(t.status) && !t.assigneeId).length

    if (pieceThreatensDeadline(p, opts)) out.atRisk += 1
  }

  return { ...out, people }
}

/**
 * Late or at risk, for one live piece — the "At risk" badge's test, and the dashboard's and Team
 * page's tiles (I57.13), so the three can never disagree. Closed, approved and delivered pieces
 * never count.
 */
export function pieceThreatensDeadline(p: PulsePiece, opts: RiskOptions): boolean {
  if (p.state === 'archived' || p.state === 'approved' || p.state === 'delivered') return false
  // ADR-0069 d.7: an outstanding input cascades to the piece's tasks — they are WAITING, and a
  // task short of time only for that reason is not at risk (ADR-0075 d.4).
  const waiting = p.outstandingInputs > 0
  const withCalendar = p.calendar ? { ...opts, calendar: p.calendar } : opts
  return threatensDeadline(assessRisk({ ...p, tasks: p.tasks.map((t) => ({ ...t, waitingOnPrerequisite: waiting })) }, withCalendar))
}

/** How many of these pieces are late or at risk; `owned` narrows it to pieces whose OWNER is one of
 *  the given people (the Team page's team or department). */
export function countThreatened(
  pieces: Iterable<PulsePiece>,
  opts: RiskOptions,
  owned?: ReadonlySet<string>,
): number {
  let n = 0
  for (const p of pieces) {
    if (owned && (!p.ownerId || !owned.has(p.ownerId))) continue
    if (pieceThreatensDeadline(p, opts)) n += 1
  }
  return n
}
