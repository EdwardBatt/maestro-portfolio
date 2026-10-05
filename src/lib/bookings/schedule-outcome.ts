/**
 * What `subtask-schedule` actually did, and whether anybody needs to hear about it (ADR-0061 d.1).
 *
 * **The defect this exists to end.** The function returns HTTP 200 with a body saying how many
 * bookings it made and, when that is zero, exactly why. Every caller did this:
 *
 * ```ts
 * try { await invokeFn('subtask-schedule', { subTaskId }) } catch (e) { warning = e.message }
 * ```
 *
 * A 200 does not throw, so the body was discarded and the dialog reported success. A person booked
 * a Sunday in an office that did not work Sundays, was told it worked, saw nothing on the calendar,
 * and pressed the button again. Five duplicate tasks came out of that on 27 Aug.
 *
 * **`scheduled: 0` is not always an error, which is why this is a function and not a thrown
 * exception.** Two of the reasons are ordinary and must stay quiet, or the channel becomes noise
 * people learn to click past. The rest are faults and are named.
 */

export interface ScheduleOutcome {
  scheduled?: number
  released?: boolean
  reason?: string
  skipped?: string
}

/**
 * Reasons that mean "correctly placed nothing".
 *
 * - `overridden` — somebody arranged this schedule by hand, so the materialiser leaves it alone.
 *   Saying so on every later save would be nagging about a decision they made on purpose.
 * - `not_schedulable` — no assignee, hours or dates, or the task is already settled. The ordinary
 *   state of every task the moment it is created: a workflow lays down its whole list unassigned,
 *   and the scheduler is called on each one.
 */
const EXPECTED = new Set(['overridden', 'not_schedulable'])

/**
 * The i18n key to show, or null when nothing needs saying.
 *
 * Returns a key rather than a sentence so the caller does not have to know the vocabulary, and so
 * the Arabic is written once beside the English.
 */
export function scheduleWarningKey(outcome: ScheduleOutcome | null | undefined): string | null {
  if (!outcome) return null
  // A `skipped` body carries no `reason`; it is the overridden case under another name.
  const reason = outcome.reason ?? outcome.skipped
  if ((outcome.scheduled ?? 0) > 0) return null
  if (reason && EXPECTED.has(reason)) return null
  // An unrecognised reason is still reported. A new one added to the function later must not
  // inherit the silence this whole file exists to remove.
  return reason ? `schedule.unscheduled.${reason}` : 'schedule.unscheduled.unknown'
}

/** Did this actually put the work on somebody's calendar? */
export function wasScheduled(outcome: ScheduleOutcome | null | undefined): boolean {
  return (outcome?.scheduled ?? 0) > 0
}

/**
 * Render a warning that may be either an i18n key or a raw error message.
 *
 * Two things end up in the same field and both need showing: the KEY this file produces when the
 * scheduler placed nothing, and the MESSAGE a thrown error carries when the call failed outright.
 * Rather than give callers two fields to remember, they get one string and this to render it.
 */
export function translateScheduleWarning(
  t: (key: string) => string,
  warning: string | null | undefined,
): string | null {
  if (!warning) return null
  return warning.startsWith('schedule.unscheduled.') ? t(warning) : warning
}
