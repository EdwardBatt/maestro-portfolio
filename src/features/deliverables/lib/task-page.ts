/**
 * The task page's pure decisions (I59.11, Figma M2 / M4) — kept apart so each state is tested
 * without rendering the page.
 */

/** Where it is (M2): the task's real states. The deliverable's "Delivered" is not a task state. */
export type TaskStep = 'todo' | 'in_progress' | 'review' | 'done'
export const TASK_STEPS: readonly TaskStep[] = ['todo', 'in_progress', 'review', 'done']

export function stepOf(it: { status: string; deliverableState: string | null }): TaskStep {
  if (it.status === 'done' || it.deliverableState === 'approved' || it.deliverableState === 'delivered') return 'done'
  if (it.status === 'review') return 'review'
  if (it.status === 'in_progress') return 'in_progress'
  return 'todo'
}

/**
 * Whether "Send for review" may be pressed — the same question `app.sub_task_submit` asks, never a
 * looser one (ADR-0059), exactly as the retired Submit dialog asked it:
 * - the task is in progress (Start opens the round; ADR-0030);
 * - a standalone task (no deliverable) has nothing to attach and sends at once;
 * - a manual task needs the assignee's own note on THIS round;
 * - a digital task needs a version uploaded in THIS round (I11.9), never last round's.
 */
export function canSend(args: {
  status: string
  hasDeliverable: boolean
  isManual: boolean
  hasVersionThisRound: boolean
  hasOwnNoteThisRound: boolean
}): boolean {
  if (args.status !== 'in_progress') return false
  if (!args.hasDeliverable) return true
  return args.isManual ? args.hasOwnNoteThisRound : args.hasVersionThisRound
}

/** Minutes as "3h 20m" / "45m". */
export function formatMinutes(total: number): string {
  const m = Math.max(0, Math.round(total))
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h === 0) return `${r}m`
  return r === 0 ? `${h}h` : `${h}h ${r}m`
}

/**
 * The timer line's figure (ADR-0030): the minutes recorded once the round was sent; while it runs,
 * the time since Start. A display figure only — the record is the server's.
 */
export function timedMinutes(
  timer: { startedAt: string | null; submittedAt: string | null; minutes: number | null } | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!timer) return null
  if (timer.submittedAt) return timer.minutes
  const at = timer.startedAt ? Date.parse(timer.startedAt) : NaN
  return Number.isFinite(at) ? Math.max(0, (now - at) / 60_000) : null
}

/**
 * The header's timer (plan View 4, ADR-0107 d.3): "started 09:12 · 3h 20m · 4h blocked, not
 * counted". Once the round is sent, the recorded figures (`minutes` is already less the blocked
 * time on a timed round). While it runs, the server's figures so far (`task_round_timing`): the
 * time since Start less the blocked minutes, and the blocked minutes. Display only.
 */
export function timerFigures(
  timer: { startedAt: string | null; submittedAt: string | null; minutes: number | null; blockedMinutes?: number | null; untimed?: boolean } | null | undefined,
  running: { elapsedMinutes: number | null; blockedMinutesSoFar: number } | null | undefined,
  now: number = Date.now(),
): { timed: number | null; blocked: number; untimed: boolean } {
  if (timer?.submittedAt) {
    return { timed: timer.minutes, blocked: Math.max(0, timer.blockedMinutes ?? 0), untimed: timer.untimed === true }
  }
  const blocked = Math.max(0, running?.blockedMinutesSoFar ?? 0)
  const elapsed = running?.elapsedMinutes ?? timedMinutes(timer, now)
  return { timed: elapsed == null ? null : Math.max(0, elapsed - blocked), blocked, untimed: false }
}

/**
 * Would sending NOW be an untimed round (ADR-0106 d.1)? Never started, or started less than the
 * tenant's threshold ago — the server's `task_round_timing` figures read against the clock now, so a
 * figure fetched a minute ago does not warn about a round that has since passed the threshold. The
 * warning only; the server decides what is recorded.
 */
export function wouldBeUntimed(
  r: { startedAt: string | null; thresholdMinutes: number },
  now: number = Date.now(),
): boolean {
  if (!r.startedAt) return true
  const at = Date.parse(r.startedAt)
  if (!Number.isFinite(at)) return true
  return now - at < r.thresholdMinutes * 60_000
}

/** The previous version (M4): the newest one uploaded before this round. */
export function previousVersion<V extends { round: number; version: number }>(versions: readonly V[], thisRound: number): V | null {
  return [...versions].filter((v) => v.round < thisRound).sort((a, b) => b.version - a.version)[0] ?? null
}
