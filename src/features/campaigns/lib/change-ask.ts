/**
 * The one change form (ADR-0141, I74.14–I74.16) — the pure part: what can be asked, what a refusal
 * means, and the lines the piece shows while an ask waits and once it is answered. No React, no
 * Supabase; unit-tested in `change-ask.test.ts`.
 *
 * Hours are RECORDED only: a deliverable has no hours of its own ("About 12" is the sum of its live
 * tasks' hours), so an accepted ask says the hours and moves no task. Only the due date is applied by
 * the answer; the other kinds are recorded and the account manager makes them in the piece.
 */

/** What isn't right (CP-06), in the order the form shows them — the database's own list. */
export const CHANGE_ASK_KINDS = ['hours', 'due_date', 'format', 'language', 'quantity', 'brief', 'other'] as const
export type ChangeAskKind = (typeof CHANGE_ASK_KINDS)[number]

export type ChangeAskStatus = 'pending' | 'accepted' | 'changed' | 'kept' | 'withdrawn'
export type ChangeAskAnswer = 'accept' | 'change' | 'keep'

export interface ChangeAskRow {
  id: string
  deliverableId: string
  askedBy: string
  askedByName: string | null
  kinds: ChangeAskKind[]
  requestedDueDay: string | null
  requestedHours: number | null
  reason: string
  fromSubTaskId: string | null
  status: ChangeAskStatus
  answeredBy: string | null
  answeredByName: string | null
  answeredAt: string | null
  answerNote: string | null
  appliedDueDay: string | null
  appliedHours: number | null
  escalatedAt: string | null
  createdAt: string
}

/** The kinds the answer does NOT apply — the account manager makes them in the piece herself. */
export function kindsToMakeInThePiece(kinds: readonly ChangeAskKind[]): ChangeAskKind[] {
  return kinds.filter((k) => k !== 'hours' && k !== 'due_date')
}

/** What the form needs before Send: at least one kind, and why. A due-date ask needs the day too. */
export function askReady(a: { kinds: readonly ChangeAskKind[]; reason: string; dueDay: string; hours: string }): boolean {
  if (a.kinds.length === 0 || a.reason.trim() === '') return false
  if (a.kinds.includes('due_date') && a.dueDay === '') return false
  if (a.kinds.includes('hours')) {
    const h = Number(a.hours)
    if (a.hours.trim() === '' || !Number.isFinite(h) || h <= 0) return false
  }
  return true
}

/** True when a task's new last day runs past the piece's due day (both `YYYY-MM-DD`, Iraq days). */
export function pastPieceDue(landsOn: string | null | undefined, pieceDueDay: string | null | undefined): boolean {
  return !!landsOn && !!pieceDueDay && landsOn > pieceDueDay
}

/**
 * A refusal from ask / answer, as a locale key under `changeAsk.error.*` and the name it carries.
 * The database words every one (hint + DETAIL); the screen only says it in the reader's language.
 */
export function askRefusal(err: unknown): { key: string; name: string | null } | null {
  const e = err as { hint?: string; details?: string } | null
  const hint = e?.hint ?? ''
  const known = ['ask_account_manager', 'change_directly', 'change_pending', 'kinds_required', 'reason_required', 'ask_your_lead', 'request_settled', 'extension_retired']
  if (!known.includes(hint)) return null
  const name = (e?.details ?? '').trim() || null
  return { key: `changeAsk.error.${hint}`, name }
}

/** The account manager named by a refusal of a direct edit (hint `ask_account_manager`), or null. */
export function askAccountManagerOf(err: unknown): { name: string | null } | null {
  const e = err as { hint?: string; details?: string } | null
  if (e?.hint !== 'ask_account_manager') return null
  return { name: (e.details ?? '').trim() || null }
}

/** "20 min ago" — the unit and the count; the screen words it (`changeAsk.ago.*`). */
export function agoParts(sinceIso: string, nowMs: number): { unit: 'now' | 'min' | 'hour' | 'day'; count: number } {
  const ms = Math.max(0, nowMs - Date.parse(sinceIso))
  const min = Math.floor(ms / 60_000)
  if (min < 1) return { unit: 'now', count: 0 }
  if (min < 60) return { unit: 'min', count: min }
  const h = Math.floor(min / 60)
  if (h < 24) return { unit: 'hour', count: h }
  return { unit: 'day', count: Math.floor(h / 24) }
}

/** The newest ask of a piece's list that the piece should show: the pending one, else the latest answered. */
export function askToShow(rows: readonly ChangeAskRow[]): ChangeAskRow | null {
  const pending = rows.find((r) => r.status === 'pending')
  if (pending) return pending
  const answered = rows
    .filter((r) => r.status === 'accepted' || r.status === 'changed' || r.status === 'kept')
    .sort((a, b) => (b.answeredAt ?? b.createdAt).localeCompare(a.answeredAt ?? a.createdAt))
  return answered[0] ?? null
}

/** "16 · was 12" — a value the answer applied beside the one it replaced; null when nothing changed. */
export function wasNow<T extends string | number>(now: T | null | undefined, was: T | null | undefined): { now: T; was: T | null } | null {
  if (now == null) return null
  if (was != null && now === was) return null
  return { now, was: was ?? null }
}

/** Parse a numeric column PostgREST may hand back as a string. */
export function num(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** The live tasks' hours, summed — the piece's "About 12". */
export function aboutHours(tasks: readonly { status: string; hours: number | null }[]): number | null {
  const live = tasks.filter((x) => x.status !== 'cancelled' && x.hours != null)
  if (live.length === 0) return null
  const total = live.reduce((s, x) => s + (x.hours ?? 0), 0)
  return Math.round(total * 10) / 10
}

/** Who an applied answer told (CP-08's footer): the people on the piece's live tasks, not the asker or the answerer. */
export function toldNames(
  tasks: readonly { status: string; assigneeId: string | null; assigneeName: string | null }[],
  askerId: string | null,
  answererId: string | null,
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of tasks) {
    if (x.status === 'done' || x.status === 'cancelled' || !x.assigneeId || !x.assigneeName) continue
    if (x.assigneeId === askerId || x.assigneeId === answererId || seen.has(x.assigneeId)) continue
    seen.add(x.assigneeId)
    out.push(x.assigneeName)
  }
  return out
}
