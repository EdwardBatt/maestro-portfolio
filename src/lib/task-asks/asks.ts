import { iraqDay } from '../time/iraq'

/**
 * ADR-0139 (I74.2, I74.4, I74.5): an ask of another team — a task, its hours, the day it is needed by,
 * a note, and optionally one of that team's people ("Anyone — Amira decides" when not). One row of
 * `sub_task_assignment_requests` as the Schedule and My work read it.
 *
 * Pure data and the small derivations every surface shares (its state on the asker's card, when it
 * goes to Traffic, which days it sits on). No I/O here; `api.ts` beside it does the reading and
 * the writing. In `src/lib/` because the Schedule and My work both read it (AGENTS.md §3).
 */

export type TaskAskStatus = 'pending' | 'offered' | 'approved' | 'refused' | 'withdrawn' | 'superseded'

export interface TaskAsk {
  id: string
  subTaskId: string
  taskTitle: string
  deliverableId: string | null
  pieceName: string | null
  campaignId: string | null
  campaignName: string | null
  teamId: string | null
  teamName: string | null
  /** the person asked for, or — once answered — the person booked or offered */
  assigneeId: string | null
  assigneeName: string | null
  requestedBy: string
  requesterName: string | null
  /** the asker's own team, for "Ask from Art & Video" */
  requesterTeamName: string | null
  createdAt: string
  hours: number | null
  /** the Iraq day the work is needed by */
  neededBy: string | null
  startsAt: string | null
  dueAt: string | null
  note: string | null
  status: TaskAskStatus
  offeredStartsAt: string | null
  offeredEndsAt: string | null
  answeredBy: string | null
  answeredByName: string | null
  answerNote: string | null
  answeredAt: string | null
  /** set when it waited past the rule and went to Traffic and the department lead (d.5) */
  escalatedAt: string | null
}

/** What the asker's card says (SC-18, SC-30): Waiting · Offer · Booked · No. */
export type AskCardState = 'waiting' | 'offer' | 'booked' | 'no' | 'closed'

export function askCardState(a: Pick<TaskAsk, 'status'>): AskCardState {
  switch (a.status) {
    case 'pending': return 'waiting'
    case 'offered': return 'offer'
    case 'approved': return 'booked'
    case 'refused': return 'no'
    default: return 'closed'
  }
}

/**
 * When an unanswered ask goes to Traffic and the department lead (ADR-0139 d.5): asked + the rule's
 * hours, in REAL time — the same arithmetic as `app.escalation_due` (ADR-0108 d.1), so the "3h 40m left
 * to answer" on the card and the sweep agree. Null with no rule.
 */
export function askEscalatesAt(createdAt: string, ruleHours: number | null | undefined): number | null {
  const at = Date.parse(createdAt)
  if (!Number.isFinite(at) || ruleHours == null || !(ruleHours > 0)) return null
  return at + ruleHours * 3_600_000
}

/** Time left to answer, as hours and minutes; null once it has gone (or with no rule). */
export function timeLeftToAnswer(
  createdAt: string,
  ruleHours: number | null | undefined,
  now: number = Date.now(),
): { h: number; m: number } | null {
  const at = askEscalatesAt(createdAt, ruleHours)
  if (at == null || at <= now) return null
  const mins = Math.max(1, Math.floor((at - now) / 60_000))
  return { h: Math.floor(mins / 60), m: mins % 60 }
}

/** Has it waited past the rule — "unanswered", Traffic and the department lead told (mock-up 2)? */
export function isUnanswered(a: Pick<TaskAsk, 'status' | 'escalatedAt' | 'createdAt'>, ruleHours: number | null | undefined, now: number = Date.now()): boolean {
  if (a.status !== 'pending') return false
  if (a.escalatedAt) return true
  const at = askEscalatesAt(a.createdAt, ruleHours)
  return at != null && at <= now
}

const DAY = 86_400_000
const isoPlus = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)

/**
 * The Iraq days an ask sits on, for the ⏳ chip on the asker's grid (SC-18): the offered days while an
 * offer waits, else the days asked for, else the needed-by day alone. Empty when it names none.
 */
export function askDays(a: Pick<TaskAsk, 'status' | 'startsAt' | 'dueAt' | 'neededBy' | 'offeredStartsAt' | 'offeredEndsAt'>): string[] {
  const from = a.status === 'offered' && a.offeredStartsAt ? a.offeredStartsAt : a.startsAt
  const to = a.status === 'offered' && a.offeredEndsAt ? a.offeredEndsAt : a.dueAt
  if (from && to) {
    const f = iraqDay(from)
    const l = iraqDay(to)
    if (l < f) return [f]
    const out: string[] = []
    for (let d = f; d <= l && out.length < 62; d = isoPlus(d, 1)) out.push(d)
    return out
  }
  if (a.neededBy) return [a.neededBy]
  return []
}

/** Hours on each of the ask's days — what the ⏳ chip says ("2h Translation"). */
export function askHoursPerDay(a: Pick<TaskAsk, 'hours'> & Parameters<typeof askDays>[0]): number | null {
  if (a.hours == null) return null
  const n = askDays(a).length || 1
  return Math.round((a.hours / n) * 10) / 10
}

/** The asks still on the asker's mind: open, or answered and not yet put away. Newest first. */
export function asksToShow(asks: readonly TaskAsk[], dismissed: ReadonlySet<string>): TaskAsk[] {
  return asks
    .filter((a) => a.status === 'pending' || a.status === 'offered' || ((a.status === 'approved' || a.status === 'refused') && !dismissed.has(a.id)))
    .sort((x, y) => (x.createdAt < y.createdAt ? 1 : x.createdAt > y.createdAt ? -1 : 0))
}

/** One maker's ask for more time (ADR-0141 d.5, SC-01 "Lujain wants Wednesday too"). */
export interface TimeAsk {
  id: string
  subTaskId: string
  taskTitle: string
  deliverableId: string | null
  pieceName: string | null
  askedBy: string
  askerName: string | null
  /** the Iraq day she asks to finish on */
  toDay: string
  note: string | null
  status: 'pending' | 'given' | 'refused' | 'withdrawn' | 'superseded'
  /** the task's current due, and the piece's — "Still before the due date" / "Thursday is the due day" */
  taskDueAt: string | null
  pieceDueAt: string | null
  createdAt: string
  answerNote: string | null
}

/** Where the day asked for sits against the piece's due day: before it, on it, or past it. */
export function timeAskAgainstDue(a: Pick<TimeAsk, 'toDay' | 'pieceDueAt'>): 'before' | 'on' | 'past' | 'none' {
  if (!a.pieceDueAt) return 'none'
  const due = iraqDay(a.pieceDueAt)
  return a.toDay < due ? 'before' : a.toDay === due ? 'on' : 'past'
}

/** The refusal hints the ask RPCs carry (`20261003110000`, `20261003130000`), each a sentence of its own. */
export const ASK_HINTS = [
  'request_pending', 'request_settled', 'not_the_answerer', 'book_directly', 'unplaced_resource',
  'reason_required', 'days_required', 'person_required', 'day_required',
] as const
export type AskHint = (typeof ASK_HINTS)[number]

/** The i18n key for a refused ask write, or null when the server gave no hint we word (its message is shown). */
export function askHintKey(e: unknown): string | null {
  const hint = (e as { hint?: unknown } | null)?.hint
  return typeof hint === 'string' && (ASK_HINTS as readonly string[]).includes(hint) ? `schedule.asks.hint.${hint}` : null
}
