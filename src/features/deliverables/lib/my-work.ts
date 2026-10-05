/**
 * Classification for the My Work surface: what counts as finished, what is still open, and where
 * "today" ends. One definition each, used by every panel and the exceptions strip, so a count and a
 * list can never disagree about the same task.
 *
 * Previously each of the three components computed `new Date().toISOString().slice(0, 10)`, which is
 * the UTC date. For a Cairo or Baghdad team that is the *previous* day until 02:00–03:00 local, so
 * work due today reads as overdue, and work due tomorrow reads as due today. Three copies of the
 * same mistake, drifting independently.
 *
 * The viewer's own calendar day is the right answer here: the person reading the page is the
 * assignee, and "today" means their today. (An office-timezone answer would be more precise for
 * someone working across offices, but `AssignedWorkItem` carries no office — worth revisiting if
 * cross-office assignment becomes common.)
 */

/** The local calendar day of an instant, as YYYY-MM-DD. Never UTC. */
export function localDay(at: string | number | Date): string {
  const d = at instanceof Date ? at : new Date(at)
  // Build from local parts rather than toISOString(), which converts to UTC first.
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Today, as YYYY-MM-DD in the viewer's timezone. `now` is injectable so tests are deterministic. */
export function today(now: number = Date.now()): string {
  return localDay(now)
}

/**
 * Which panel a task belongs to.
 *
 * `today` covers due-today AND anything already past due: an overdue task is today's problem, not a
 * later one. (The first cut sorted strictly on `due === today`, which pushed overdue work into
 * "Other Tasks" — below the fold, under everything that is not yet urgent.)
 *
 * It also covers a task whose booked span has BEGUN. A task is assigned across a span — the
 * scheduler writes `starts_at` from the first booking and `due_at` from the last (ADR-0039) — and
 * sorting on the due date alone left a Thursday–Sunday task sitting under "Other tasks" for three
 * days, below work that was not urgent yet, reaching "Today" only on the day it was already due.
 * The whole point of the booking is that Thursday is the day to do it.
 *
 * Takes the item rather than a bare date: the previous signature was `(dueAt, now)`, and adding a
 * second date to it would have made two interchangeable string arguments sitting side by side.
 */
export function isForToday(
  it: { startsAt: string | null; dueAt: string | null },
  now: number = Date.now(),
): boolean {
  const t = today(now)
  if (it.startsAt && localDay(it.startsAt) <= t) return true
  if (it.dueAt) return localDay(it.dueAt) <= t
  return false
}

/** Overdue = due before today. Due-today is not yet overdue, however late in the day it is. */
export function isOverdue(dueAt: string | null, now: number = Date.now()): boolean {
  if (!dueAt) return false
  return localDay(dueAt) < today(now)
}

/** Due exactly today. */
export function isDueToday(dueAt: string | null, now: number = Date.now()): boolean {
  if (!dueAt) return false
  return localDay(dueAt) === today(now)
}

// ------------------------------------------------------------------ work state ----

/**
 * States in which a container is settled and nothing under it is still somebody's problem.
 *
 * `archived` and `delivered` were missing, and the gap was not cosmetic (ADR-0080 d.8). A container
 * can be archived while a task under it is still `todo`, and that task then sat in its assignee's
 * "Tasks for today" permanently — she cannot cancel her own work, the modal hides every task control
 * on a finished container, and `archived` is terminal so it cannot be reopened to get at the task.
 * Six tasks across four people were in exactly that state on 9 Sep.
 *
 * ADR-0080 d.1 stops NEW ones arriving, by cancelling the work when the job is archived. This is the
 * net underneath it, and it is worth having *because* of d.1 rather than instead of it: it clears
 * rows that predate the rule, it covers `delivered` — which d.1 deliberately says nothing about
 * (d.12) — and it means any future path writing the state directly, as the 8 Sep migrations did,
 * produces a stale row rather than an unclearable one.
 */
const SETTLED_CONTAINER_STATES = ['approved', 'delivered', 'archived']

/**
 * Finished work. `status === 'done'` is the real answer; the container's state is the second half,
 * for a task whose own row never got there — see `SETTLED_CONTAINER_STATES`.
 */
export function isFinished(it: { status: string; deliverableState: string | null }): boolean {
  return (
    it.status === 'done' ||
    (it.deliverableState != null && SETTLED_CONTAINER_STATES.includes(it.deliverableState))
  )
}

/** Everything still to do. The working lists and the exception counts must agree on this. */
export function openWork<T extends { status: string; deliverableState: string | null }>(items: T[]): T[] {
  return items.filter((it) => !isFinished(it))
}

// ------------------------------------------------------------------- priority ----

/** High first, then medium, then normal; no priority sorts with normal. */
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

export function priorityRank(p: string | null | undefined): number {
  return p != null && p in PRIORITY_RANK ? PRIORITY_RANK[p] : 2
}

/**
 * The order the working lists are read in (I54.15, Edward 23 Sep: *"order the work according to
 * priority"*).
 *
 * **The deadline still leads.** Priority breaks the tie between two tasks due the same day, and
 * only that. If priority overruled the date outright, a normal job due today would sink below a
 * high one due next week and somebody would miss it — the opposite of what ordering by priority
 * is for.
 *
 * A task with no date sorts last: it is the one thing on the list nobody has promised.
 *
 * The lists were not sorted AT ALL before this — they arrived in whatever order PostgREST
 * returned, which is why the same two tasks could swap places between reloads.
 */
export function byDeadlineThenPriority<T extends { dueAt: string | null; priority?: string | null }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => {
    // Compared as a DAY, not an instant. Since ADR-0076 a deadline is 18:00 Iraq, so two tasks due
    // the same day usually share a timestamp — but a task carrying any other time would otherwise
    // never reach the priority tie-break at all, which is the whole point of this sort.
    const dayOf = (it: T) => (it.dueAt ? localDay(it.dueAt) : null)
    const da = dayOf(a)
    const db = dayOf(b)
    if (da !== db) {
      if (da == null) return 1
      if (db == null) return -1
      return da < db ? -1 : 1
    }
    return priorityRank(a.priority) - priorityRank(b.priority)
  })
}

// ----------------------------------------------------------------- the five lists ----

/**
 * The lists My Work reads in (ADR-0105 d.1, Q7): **Today · This week · Later · Waiting on someone
 * else · Completed**.
 *
 * - `waiting`  — my open task is in review: it is with somebody else, whatever its date.
 * - `today`    — due today, overdue, or its booked span has begun (`isForToday`, unchanged).
 * - `week`     — due later this week, to Saturday (the working week starts on Sunday, as `/team`).
 * - `later`    — due after this week, or with no date at all (nobody has promised it).
 * - `done`     — finished (`isFinished`).
 */
export type WorkList = 'today' | 'week' | 'later' | 'waiting' | 'done'

/** The Saturday that ends the viewer's current week, as YYYY-MM-DD. */
export function endOfWeek(now: number = Date.now()): string {
  const d = new Date(now)
  const sat = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (6 - d.getDay()))
  return localDay(sat)
}

export function listOf(
  it: { status: string; deliverableState: string | null; startsAt: string | null; dueAt: string | null },
  now: number = Date.now(),
): WorkList {
  if (isFinished(it)) return 'done'
  if (it.status === 'review') return 'waiting'
  if (isForToday(it, now)) return 'today'
  if (it.dueAt && localDay(it.dueAt) <= endOfWeek(now)) return 'week'
  return 'later'
}
