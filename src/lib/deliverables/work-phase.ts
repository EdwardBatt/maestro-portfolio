import type { DeliverableState } from './state-machine'
import { isDeliverableComplete } from './completeness'

/**
 * Where a deliverable's work actually IS, read from its tasks (I40.22).
 *
 * Edward, 8 Sep: *"the task assigned sits under the deliverable… we need to track each task as the
 * task is what is actually assigned on the /schedule"*, and *"when a task is assigned it does not
 * get marked started before the assignee selects start"*.
 *
 * The deliverable's own `state` column answers a different question. It reads `in_progress` from
 * the moment the deliverable exists — including when every task on it is sitting untouched — so the
 * list said "In progress" for work nobody had begun. That is the opposite of what a tracking
 * surface is for: the row that needs attention looked exactly like the row that does not.
 *
 * `todo` is the status a task holds from assignment until the assignee presses Start, which is what
 * makes NOT_STARTED meaningful rather than a synonym for "new".
 */

export type WorkPhase =
  | 'no_tasks'      // nothing has ever been planned on it
  | 'cancelled'     // it HAD work and the work was called off — not the same as never having any
  | 'not_started'   // assigned, and nobody has pressed Start
  | 'in_progress'
  | 'in_review'
  | 'awaiting_signoff' // every task done, and nobody has signed the deliverable off
  | 'delivered'    // signed off AND sent to the client; still live, a revision can come back
  | 'blocked'      // the DELIVERABLE is blocked — a task cannot be, see below
  | 'complete'

export interface WorkProgress {
  phase: WorkPhase
  /** Live tasks — cancelled ones are not work anybody owes. */
  total: number
  /** Live tasks nobody is on. Planned and forgotten look identical without this (ADR-0052 d.11). */
  unassigned: number
  /** Finished, out of every task that ever existed on it. `done / everTotal` is the honest ratio. */
  done: number
  everTotal: number
  /** The open tasks by where they are (I67.4) — the progress bar's segments and the hover card's numbers. */
  inReview: number
  inProgress: number
  notStarted: number
}

/** A task's status (`sub_tasks_status_check`). */
export type SubTaskStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled'

type TaskLike = { status: SubTaskStatus; assigneeId?: string | null; assignee_id?: string | null }

const assigneeOf = (t: TaskLike) => t.assigneeId ?? t.assignee_id ?? null

/**
 * Ordered by what needs attention, not by lifecycle: the worst thing true of the work wins, so the
 * row somebody has to act on cannot be buried by a majority of healthy tasks.
 */
export function workProgress(
  tasks: readonly TaskLike[] | null | undefined,
  deliverableState?: DeliverableState,
): WorkProgress {
  const all = tasks ?? []
  const live = all.filter((t) => t.status !== 'done' && t.status !== 'cancelled')
  const done = all.filter((t) => t.status === 'done').length
  const base = {
    total: live.length,
    unassigned: live.filter((t) => !assigneeOf(t)).length,
    done,
    everTotal: all.filter((t) => t.status !== 'cancelled').length,
    inReview: live.filter((t) => t.status === 'review').length,
    inProgress: live.filter((t) => t.status === 'in_progress').length,
    notStarted: live.filter((t) => t.status === 'todo').length,
  }

  // COMPLETE is the deliverable's own answer, and it comes first so the badge and the Live/Complete
  // grouping can never contradict each other. They did: a deliverable whose tasks were all done
  // read "Complete" while sitting in the LIVE group, because the badge was counting tasks and the
  // group was reading `state`. Two meanings of the same word on one row (Edward, 8 Sep).
  if (deliverableState && isDeliverableComplete(deliverableState)) return { ...base, phase: 'complete' }

  // BLOCKED is a property of the DELIVERABLE, not of a task: `sub_tasks_status_check` admits only
  // todo / in_progress / review / done / cancelled, so there is no such thing as a blocked task
  // however much the leftover `deliverables.subStatus.blocked` label suggests otherwise. It is the
  // exception worth surfacing — a blocked deliverable with four running tasks still needs somebody,
  // and a rollup reporting the majority would bury it.
  if (deliverableState === 'blocked') return { ...base, phase: 'blocked' }
  // "No tasks yet" and "the work was called off" are different facts and were reading as the same
  // one: `everTotal` excludes cancelled tasks, so a deliverable whose only task was CANCELLED
  // reported as never having had any. Thirty-four ad-hoc rows on the live tenant said "No tasks
  // yet" about work that was created WITH its task from the schedule, where having none is not
  // even possible (Edward, 8 Sep).
  if (all.length === 0) return { ...base, phase: 'no_tasks' }
  if (base.everTotal === 0) return { ...base, phase: 'cancelled' }

  // DELIVERED is already signed off — `approved → delivered` is the only way in — and it is out with
  // the client. It is deliberately not "complete" (a revision can still come back, so it stays in
  // the live list), but calling it "awaiting sign-off" would be plainly wrong: the sign-off has
  // happened. It gets its own answer rather than being folded into either.
  if (deliverableState === 'delivered') return { ...base, phase: 'delivered' }

  // Every task done, and the deliverable is NOT signed off. Rare by design: a deliverable approves
  // itself when its last task is approved (ADR-0058 d.6, `app.maybe_complete_sub_task`). So this
  // phase is an EXCEPTION — work that finished without the automatic approval firing — which is
  // exactly why it is worth showing in amber rather than rounding up to "Complete".
  if (live.length === 0) return { ...base, phase: 'awaiting_signoff' }
  // The word follows the LEAST advanced open task (I67.4, Edward 30 Sep, A): one task in review
  // does not make a piece with untouched work "In review". The bar and the hover card
  // (`DeliverableProgress`) show the mix; the word says how far the whole piece has got.
  if (live.every((t) => t.status === 'review')) return { ...base, phase: 'in_review' }
  // Nothing begun — every open task untouched and none finished — is Not started; anything else is under way.
  if (done === 0 && live.every((t) => t.status === 'todo')) return { ...base, phase: 'not_started' }
  return { ...base, phase: 'in_progress' }
}
