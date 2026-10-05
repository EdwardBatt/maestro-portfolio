import { outstandingReviewers, type TaskReviewer } from '../../../lib/reviewers/task-reviewers'
import type { SubTaskStatus } from '../api/deliverables-api'

/**
 * The people on a deliverable's row (I40.22).
 *
 * Three different questions, three different answers, and the page kept collapsing them into one:
 *
 *   * the OWNER is accountable for the deliverable (ADR-0050) and may be doing none of the work;
 *   * the ASSIGNEES are the people actually on its live tasks — the unit that gets booked on the
 *     schedule, which is why Edward pushed back on a deliverable-shaped view of it;
 *   * the BLOCKING REVIEWERS are the mandatory ones outstanding on a task in review. Optional
 *     reviewers are outstanding too, and are deliberately not here: they cannot hold the work up,
 *     so naming them on a tracking screen sends somebody to chase the wrong person.
 *
 * Pure, so both list reads and their tests can use it without touching the network.
 */

export interface TaskPeopleInput {
  id: string
  status: SubTaskStatus
  assigneeName?: string | null
  assignerName?: string | null
}

const LIVE: SubTaskStatus[] = ['todo', 'in_progress', 'review']

/** Distinct names of the people on the live tasks, in a stable order. */
export function assigneeNamesOf(tasks: readonly TaskPeopleInput[] | null | undefined): string[] {
  const seen = new Set<string>()
  for (const t of tasks ?? []) {
    if (!LIVE.includes(t.status)) continue
    const n = t.assigneeName?.trim()
    if (n) seen.add(n)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}

/**
 * Distinct names of whoever HANDED OUT the live work.
 *
 * On ad-hoc, the deliverable's owner and its task's assignee are the same person — the schedule
 * creates both from one action — so a column for the owner repeated the next column and said nothing
 * (Edward, 8 Sep). Who gave the work out is the half that was missing.
 */
export function assignerNamesOf(tasks: readonly TaskPeopleInput[] | null | undefined): string[] {
  const seen = new Set<string>()
  for (const t of tasks ?? []) {
    if (!LIVE.includes(t.status)) continue
    const n = t.assignerName?.trim()
    if (n) seen.add(n)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}

/**
 * Distinct names of the MANDATORY reviewers who have not yet acted, on tasks that are in review.
 *
 * The status check matters as much as the mandatory one: a reviewer appointed to a task nobody has
 * submitted yet is not blocking anything, and listing them would make every planned task look like
 * it was waiting on somebody.
 */
export function blockingReviewerNamesOf(
  tasks: readonly TaskPeopleInput[] | null | undefined,
  reviewersByTask: Map<string, TaskReviewer[]>,
): { names: string[]; allRequired: boolean } {
  const inReview = (tasks ?? []).filter((t) => t.status === 'review')
  const outstanding = inReview.flatMap((t) => outstandingReviewers(reviewersByTask.get(t.id) ?? []))

  // `sub_task_reviewers.is_mandatory` DEFAULTS TO FALSE, deliberately: with no mandatory reviewer
  // the first approval completes the task, which is how a single-reviewer task has always behaved
  // (ADR-0043 d.5). So on real data almost every appointment is optional, and a mandatory-only
  // column is blank on a task that is genuinely waiting for somebody.
  //
  // Blank is the wrong answer. "The UI never blocks — an empty narrowed list falls back to the full
  // one": name the required reviewers when any exist, and otherwise name whoever is outstanding,
  // with the caller saying which of the two it is. Nobody is left looking at an em-dash on a task
  // that has been sitting in review for a week.
  const required = outstanding.filter((r) => r.isMandatory)
  const shown = required.length > 0 ? required : outstanding

  const seen = new Set<string>()
  for (const r of shown) if (r.name) seen.add(r.name)
  return {
    names: [...seen].sort((a, b) => a.localeCompare(b)),
    allRequired: required.length > 0,
  }
}
