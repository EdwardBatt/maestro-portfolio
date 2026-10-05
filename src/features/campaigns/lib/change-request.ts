/**
 * A change to started work is a request the owner answers (ADR-0110 + its 25 Sep addendum, I59.23,
 * Figma CG-E2). The pure half of Edit's Save: which fields save straight away and which become a
 * change request, what the request costs, and how a request reads on the campaign page.
 *
 *  - Name, phase and owner save straight away, started or not (E6: "changing the owner of the
 *    deliverable has no impact on the tasks").
 *  - Type, quantity and due date on a STARTED deliverable go to its owner as a request. "Started" is
 *    the database's `deliverable_is_started` (any task in_progress / review / done, or any time
 *    entry) — read, never decided here.
 *  - On unstarted work nothing changes from CG-E1: type and quantity save, the due date moves
 *    through the evidenced dialog (ADR-0088 d.7a).
 *
 * Presentation only: the figures shown are sums of rows the database holds; the database refuses
 * a direct write to the four fields on started work whatever this says (the started-work guard).
 */

export type ChangeField = 'type' | 'quantity' | 'due'
export type AskedBy = 'client' | 'us'
export type ChangeRequestStatus = 'pending' | 'accepted' | 'declined' | 'pushed_back' | 'counter_accepted' | 'withdrawn'

/** One field's before and after. `due` is a YYYY-MM-DD Iraq day; `type` a deliverable type id. */
export interface FieldChange {
  from: string | null
  to: string
}
export type RequestedChanges = Partial<Record<ChangeField, FieldChange>>

/** What Edit holds when Save is pressed, next to what the piece holds. */
export interface EditDraft {
  typeId: string | null
  quantity: number
  /** The new due day (YYYY-MM-DD), or null when the date was not touched. */
  dueDay: string | null
}
export interface PieceNow {
  typeId: string | null
  quantity: number
  /** The piece's due day today (YYYY-MM-DD), or null. */
  dueDay: string | null
}

/**
 * The fields that go to the owner as a request. Empty when the work has not started (they save as
 * CG-E1 saves them) or when nothing of the three changed.
 */
export function requestedChanges(now: PieceNow, draft: EditDraft, started: boolean): RequestedChanges {
  if (!started) return {}
  const out: RequestedChanges = {}
  if (draft.typeId && draft.typeId !== (now.typeId ?? null)) out.type = { from: now.typeId, to: draft.typeId }
  if (draft.quantity !== now.quantity) out.quantity = { from: String(now.quantity), to: String(draft.quantity) }
  if (draft.dueDay && draft.dueDay !== now.dueDay) out.due = { from: now.dueDay, to: draft.dueDay }
  return out
}

/**
 * The task-status half of `deliverable_is_started`, for when the database's answer cannot be read:
 * any task in progress, in review or done. (The time-entry half needs the entries.)
 */
export function startedFromTasks(tasks: readonly { status: string }[]): boolean {
  return tasks.some((t) => t.status === 'in_progress' || t.status === 'review' || t.status === 'done')
}

export const hasChanges =(c: RequestedChanges): boolean => Object.keys(c).length > 0

/** The body `request_deliverable_change` takes: `{field: {to}}` — the server reads `from` itself. */
export function toRpcChanges(c: RequestedChanges): Record<string, { to: string }> {
  const out: Record<string, { to: string }> = {}
  for (const [k, v] of Object.entries(c) as [ChangeField, FieldChange][]) out[k] = { to: v.to }
  return out
}

// ------------------------------------------------------------------ the cost ----

/** A task of the piece, with the hours the database holds against it. */
export interface WorkTask {
  id: string
  title: string
  status: 'todo' | 'in_progress' | 'blocked' | 'review' | 'done' | 'cancelled'
  /** Hours booked on it (live bookings), rounded to a tenth. */
  bookedHours: number
  /** Hours timed on it (every time entry, every round), rounded to a tenth. */
  timedHours: number
}

export interface WorkCost {
  /** The tasks already started (in progress, in review, done, or with time on them). */
  started: WorkTask[]
  bookedHours: number
  timedHours: number
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** The work already put in — what a change to started work puts at risk. */
export function workCost(tasks: readonly WorkTask[]): WorkCost {
  const started = tasks.filter(
    (t) => t.status !== 'cancelled' && (t.status === 'in_progress' || t.status === 'review' || t.status === 'done' || t.timedHours > 0),
  )
  return {
    started,
    bookedHours: round1(started.reduce((s, t) => s + t.bookedHours, 0)),
    timedHours: round1(started.reduce((s, t) => s + t.timedHours, 0)),
  }
}

/**
 * Where the piece lands: the new due day when the request moves it, else today's. Nothing here
 * re-plans the work — the landing date is the promise the request asks for (a question for Edward
 * whether it should be computed from capacity instead).
 */
export function landsOn(c: RequestedChanges, nowDueDay: string | null): string | null {
  return c.due?.to ?? nowDueDay
}

/** The figures recorded on the request (`p_cost`) — named numbers, as the RPC asks. */
export function costFigures(cost: WorkCost, landing: string | null): Record<string, number | string | null> {
  return {
    started_tasks: cost.started.length,
    booked_hours: cost.bookedHours,
    timed_hours: cost.timedHours,
    lands_on: landing,
  }
}

/** The names `costFigures` stores — the one list both the sender (Edit) and the reader (Needs you) use. */
export const COST_KEYS = ['started_tasks', 'booked_hours', 'timed_hours', 'lands_on'] as const

/** A stored `cost`, read back by the names `costFigures` wrote. */
export interface StoredCost {
  startedTasks: number
  bookedHours: number
  timedHours: number
  landsOn: string | null
  /** Anything else the jsonb holds, under its own name (shown as it came). */
  other: [string, unknown][]
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

/**
 * The request's `cost` jsonb as `costFigures` stored it (I59 Track 11: Needs you's "See what it
 * costs" reads the same names Edit sends). Null when none of the names is there — a request made
 * without figures, or by another path — so the reader says "no cost was worked out" rather than 0.
 */
export function readStoredCost(raw: Record<string, unknown> | null | undefined): StoredCost | null {
  const r = raw ?? {}
  const known = new Set<string>(COST_KEYS)
  if (!COST_KEYS.some((k) => r[k] != null && r[k] !== '')) {
    return null
  }
  const landing = r.lands_on
  return {
    startedTasks: num(r.started_tasks) ?? 0,
    bookedHours: num(r.booked_hours) ?? 0,
    timedHours: num(r.timed_hours) ?? 0,
    landsOn: typeof landing === 'string' && landing ? landing : null,
    other: Object.entries(r).filter(([k, v]) => !known.has(k) && v != null && v !== ''),
  }
}

/** The instant the request escalates: now + the tenant's hours for `change_request` (real time). */
export function escalatesAt(from: number, hours: number | null): number | null {
  return hours == null || hours <= 0 ? null : from + hours * 3_600_000
}

/** Send is refused until who asked is said — the one required answer (ADR-0110 d.1). */
export function sendError(askedBy: AskedBy | null): 'askedByRequired' | null {
  return askedBy === 'client' || askedBy === 'us' ? null : 'askedByRequired'
}

// ------------------------------------------------------------------ reading a request ----

export interface ChangeRequestRow {
  id: string
  deliverableId: string
  status: ChangeRequestStatus
  requestedBy: string
  requestedByName: string | null
  changes: RequestedChanges
  askedBy: AskedBy
  declineReason: string | null
  counterText: string | null
  counterDate: string | null
  createdAt: string
  closedAt: string | null
}

/** One open question per deliverable (the database's unique index): pending or pushed back. */
export const isOpen = (r: Pick<ChangeRequestRow, 'status'>): boolean => r.status === 'pending' || r.status === 'pushed_back'

/** Still wants somebody's attention on the campaign card: open, or declined and not yet closed. */
export const isLive = (r: Pick<ChangeRequestRow, 'status' | 'closedAt'>): boolean =>
  isOpen(r) || (r.status === 'declined' && r.closedAt == null)

/** The newest request per deliverable, from rows in any order. */
export function latestByDeliverable(rows: readonly ChangeRequestRow[]): Map<string, ChangeRequestRow> {
  const out = new Map<string, ChangeRequestRow>()
  for (const r of rows) {
    const seen = out.get(r.deliverableId)
    if (!seen || r.createdAt > seen.createdAt) out.set(r.deliverableId, r)
  }
  return out
}

/** The i18n key and values of the one line a request reads as ("Change requested · waiting on Fadia"). */
export function requestLine(
  r: Pick<ChangeRequestRow, 'status' | 'requestedByName' | 'declineReason' | 'closedAt'>,
  ownerName: string | null,
): { key: string; values: Record<string, string> } {
  const owner = ownerName ?? '—'
  const requester = r.requestedByName ?? '—'
  switch (r.status) {
    case 'pending':
      return { key: 'changeRequest.state.pending', values: { owner } }
    case 'pushed_back':
      return { key: 'changeRequest.state.pushedBack', values: { owner, requester } }
    case 'declined':
      return r.closedAt == null
        ? { key: 'changeRequest.state.declined', values: { owner, reason: r.declineReason ?? '' } }
        : { key: 'changeRequest.state.declinedClosed', values: { owner } }
    case 'accepted':
      return { key: 'changeRequest.state.accepted', values: { owner } }
    case 'counter_accepted':
      return { key: 'changeRequest.state.counterAccepted', values: { owner } }
    default:
      return { key: 'changeRequest.state.withdrawn', values: {} }
  }
}

/** Postgres's timestamptz text as an ISO instant the browser parses the same everywhere. */
export function pgInstant(s: string): string {
  return s.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')
}
