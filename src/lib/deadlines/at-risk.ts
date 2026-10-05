/**
 * Is a piece at risk? ADR-0075 d.4 / d.5, the date checks (I57.1, Edward 24 Sep).
 *
 * Edward, 24 Sep: *"an item is at risk if it threatens the deadline… work has not started, not
 * approved, stuck in review etc. Whatever threatens the deadline. It is a time issue."* ADR-0075 was
 * accepted on 6–9 Sep and never built — the dashboard's tile has said *coming soon* since. This is
 * that rule, over data every campaign already carries, as ONE engine the campaigns list, the grid,
 * the season map, the board, the timeline and the clock all read, so no two screens can disagree.
 *
 * What counts, each a {@link RiskReason}:
 *   - **past_due** — the piece's date has gone and it is not approved. That is LATE, not at risk.
 *   - **not_started** — assigned, and nobody pressed Start by the day it was committed to start
 *     (ADR-0075: "the committed baseline is the SPAN" — a late start warns while there is time).
 *   - **no_time_left** — not started, and fewer working hours remain before its deadline than the
 *     task needs (d.4, second clause). Covers a task nobody has been given yet.
 *   - **task_list_unapproved** — the same shortfall on a piece whose owner has not approved its task
 *     list yet (ADR-0090 d.9: "an unapproved list on a job due in three days is at risk").
 *   - **stuck_in_review** — submitted, and nobody has answered for longer than the review buffer.
 *   - **too_close** — the last task's committed date leaves less than the review buffer before the
 *     piece's own date (d.5).
 *   - **not_enough_booked** — d.4, first clause (I57.12): the task's hours remaining (its hours less
 *     the minutes logged this round) exceed its assignee's hours BOOKED on it between now and its
 *     committed date. Judged only when the caller supplies both figures; without them the engine
 *     answers exactly as it did before.
 *
 * **Waiting is not at risk** (d.4, Edward 9 Sep: *"Sara's task is only identified as at risk if
 * Omar's task was required as an input into her task"*). A task short of time only because a
 * declared prerequisite is outstanding reports `waiting`; the prerequisite carries the risk.
 *
 * Days are Iraq days (ADR-0076) and working days follow the office calendar (ADR-0078/0079); an hour
 * count uses the standard day.
 */

import type { DeliverableState } from '../deliverables/state-machine.ts'
import { IRAQ_WORKING_CALENDAR, workingDaysBetween, type WorkingCalendar } from '../campaigns/go-live-dates.ts'
import { STANDARD_DAY_HOURS } from '../capacity/day-hours.ts'
import { iraqDay } from '../time/iraq.ts'
import { DEFAULT_REVIEW_BUFFER_DAYS } from './extension-arithmetic.ts'

export type RiskTaskStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled'

export interface RiskTask {
  id: string
  status: RiskTaskStatus
  assigneeId: string | null
  /** ADR-0075 d.3 — the span committed to at assignment. Null until somebody is given it. */
  committedStartsAt: string | null
  committedDueAt: string | null
  /** The hours the task needs: committed hours, else its SLA hours. Null when nobody said. */
  hours: number | null
  /** When it went into review this round — the latest submission. Null unless in review. */
  submittedAt: string | null
  /** A declared prerequisite (ADR-0069) is still outstanding. */
  waitingOnPrerequisite?: boolean
  /** d.4 first clause — the task's hours less the minutes logged this round, in hours. Absent or
   *  null: not judged. */
  hoursRemaining?: number | null
  /** d.4 first clause — the assignee's hours booked on this task between now and its committed
   *  date. Absent or null: not judged (the task has no schedule to judge it by). */
  bookedHoursLeft?: number | null
}

export interface RiskPiece {
  state: DeliverableState
  /** The piece's approval deadline (ADR-0075 d.5). */
  dueAt: string | null
  /** ADR-0100 / ADR-0090 — when the owner approved its task list; null while not approved. */
  taskListApprovedAt: string | null
  tasks: readonly RiskTask[]
}

export type RiskReasonKind =
  | 'past_due'
  | 'not_started'
  | 'no_time_left'
  | 'task_list_unapproved'
  | 'stuck_in_review'
  | 'too_close'
  | 'not_enough_booked'

export interface RiskReason {
  kind: RiskReasonKind
  /** The task that is the reason (d.6: the task explains the piece). Absent for piece-level reasons. */
  taskId?: string
}

/** `done` — approved, delivered or closed: the date no longer matters. */
export type RiskLevel = 'done' | 'on_time' | 'waiting' | 'at_risk' | 'late'

export interface RiskAssessment {
  level: RiskLevel
  reasons: RiskReason[]
  /** Reasons set aside because the task is waiting on a prerequisite. */
  waiting: RiskReason[]
  /** Working days past the date, when late. */
  lateByWorkingDays: number
}

export interface RiskOptions {
  now: number
  calendar?: WorkingCalendar
  /** Working days of review a piece needs after its last task (ADR-0075 d.5). */
  reviewBufferDays?: number
  dayHours?: number
}

const FINISHED: ReadonlySet<DeliverableState> = new Set(['approved', 'delivered', 'archived'])

/** Hours a task with no stated hours is assumed to need — one standard day. */
const hoursOf = (t: RiskTask, dayHours: number) => (t.hours != null && t.hours > 0 ? t.hours : dayHours)

export function assessRisk(piece: RiskPiece, opts: RiskOptions): RiskAssessment {
  const calendar = opts.calendar ?? IRAQ_WORKING_CALENDAR
  const buffer = opts.reviewBufferDays ?? DEFAULT_REVIEW_BUFFER_DAYS
  const dayHours = opts.dayHours ?? STANDARD_DAY_HOURS
  const today = iraqDay(opts.now)
  const none: RiskAssessment = { level: 'on_time', reasons: [], waiting: [], lateByWorkingDays: 0 }

  if (FINISHED.has(piece.state)) return { ...none, level: 'done' }

  const dueDay = piece.dueAt ? iraqDay(piece.dueAt) : null
  if (piece.dueAt && Date.parse(piece.dueAt) < opts.now) {
    return {
      level: 'late',
      reasons: [{ kind: 'past_due' }],
      waiting: [],
      lateByWorkingDays: Math.max(1, workingDaysBetween(dueDay!, today, calendar)),
    }
  }

  const reasons: RiskReason[] = []
  const waiting: RiskReason[] = []
  const live = piece.tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled')
  const listApproved = piece.taskListApprovedAt != null

  for (const t of live) {
    const found: RiskReason[] = []

    if (t.status === 'review' && t.submittedAt) {
      if (workingDaysBetween(iraqDay(t.submittedAt), today, calendar) > buffer) {
        found.push({ kind: 'stuck_in_review', taskId: t.id })
      }
    }

    if (t.status === 'todo') {
      if (t.assigneeId && t.committedStartsAt && today > iraqDay(t.committedStartsAt)) {
        found.push({ kind: 'not_started', taskId: t.id })
      } else {
        // The deadline a not-started task works to: its own committed date, else the piece's date
        // less the review day. Today counts as spent — a task nobody has started is not being worked.
        const deadlineDay = t.committedDueAt
          ? iraqDay(t.committedDueAt)
          : dueDay
            ? shiftBack(dueDay, buffer, calendar)
            : null
        if (deadlineDay != null) {
          const hoursLeft = workingDaysBetween(today, deadlineDay, calendar) * dayHours
          if (hoursLeft < hoursOf(t, dayHours)) {
            found.push({ kind: listApproved ? 'no_time_left' : 'task_list_unapproved', taskId: t.id })
          }
        }
      }
    }

    // d.4, first clause: the work left against the time booked for it. Only for work not yet handed
    // in — a task in review has nothing left for its maker to do this round.
    if (
      (t.status === 'todo' || t.status === 'in_progress') &&
      t.assigneeId &&
      t.hoursRemaining != null &&
      t.bookedHoursLeft != null &&
      t.hoursRemaining > t.bookedHoursLeft + 1e-9
    ) {
      found.push({ kind: 'not_enough_booked', taskId: t.id })
    }

    if (t.waitingOnPrerequisite) waiting.push(...found)
    else reasons.push(...found)
  }

  // d.5 — the last committed finish against the piece's date. A task already past its committed
  // date finishes no earlier than today.
  if (dueDay) {
    let last: string | null = null
    let lastTask: string | undefined
    for (const t of live) {
      if (!t.committedDueAt) continue
      const finish = maxDay(iraqDay(t.committedDueAt), today)
      if (last == null || finish > last) {
        last = finish
        lastTask = t.id
      }
    }
    if (last != null && workingDaysBetween(last, dueDay, calendar) < buffer) {
      reasons.push({ kind: 'too_close', taskId: lastTask })
    }
  }

  const level: RiskLevel = reasons.length > 0 ? 'at_risk' : waiting.length > 0 ? 'waiting' : 'on_time'
  return { level, reasons: dedupeTaskList(reasons), waiting, lateByWorkingDays: 0 }
}

/** An unapproved task list is ONE reason, however many of its tasks fall short. */
function dedupeTaskList(reasons: RiskReason[]): RiskReason[] {
  let seen = false
  return reasons.filter((r) => {
    if (r.kind !== 'task_list_unapproved') return true
    if (seen) return false
    seen = true
    return true
  })
}

function maxDay(a: string, b: string): string {
  return a > b ? a : b
}

/** `day` moved back `n` working days (ADR-0078: a day of work is a working day). */
function shiftBack(day: string, n: number, calendar: WorkingCalendar): string {
  let d = day
  let left = n
  for (let guard = 0; left > 0 && guard < 366; guard++) {
    d = prevDay(d)
    if (workingDaysBetween(prevDay(d), d, calendar) === 1) left -= 1
  }
  return d
}

function prevDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) - 86_400_000).toISOString().slice(0, 10)
}

/** Late or at risk — what the "At risk" badge counts. */
export const threatensDeadline = (a: RiskAssessment) => a.level === 'at_risk' || a.level === 'late'
