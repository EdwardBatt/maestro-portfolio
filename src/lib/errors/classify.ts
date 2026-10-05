/**
 * Classify a caught write/RPC error so a dialog can say the RIGHT thing and decide whether the
 * failure is worth reporting to an administrator (ADR-0092 d.2/d.3).
 *
 * A permission denial is not a bug — it is an authorization outcome the user should be told plainly
 * ("you do not have permission"), and it is NOT reportable. An unexpected failure is.
 */
export function isPermissionDenied(err: unknown): boolean {
  const e = err as { code?: string; status?: number; message?: string } | null
  if (!e) return false
  if (e.code === '42501') return true // Postgres: insufficient privilege (RLS / policy)
  if (e.status === 403) return true // PostgREST / Edge Function forbidden
  const m = (e.message ?? '').toLowerCase()
  return m.includes('permission denied') || m.includes('forbidden') || m.includes('not allowed')
}

/** What a failed write should say, and whether it is the administrator's business. */
export interface WriteFailure {
  text: string
  /** Report to the administrator is offered only for an unexpected failure (ADR-0092 d.3). */
  reportable: boolean
  /** Whatever was thrown, for the report — never shown to the user. */
  cause?: unknown
}

/**
 * Classify a failed write into a sentence (I48.42, ADR-0092 d.2/d.3). Three kinds of "no", told
 * apart by CODE rather than by showing whatever the database said:
 *
 *  - `42501` — a permission or scope refusal: an RPC's own worded raise is shown as written; a
 *    bare RLS "new row violates row-level security policy" becomes `outsideReach`. Not
 *    reportable either way — it is an answer, not a bug;
 *  - `22023` / `P0002` / `55000` — an RPC's own sentence, written for the person ("a title is
 *    required", "attach this round's version first", "a change description is required"): shown
 *    as it is;
 *  - anything else — `fallback`, reportable, carrying the cause for the administrator.
 *
 * The raw "new row violates row-level security policy for table sub_tasks" a user saw on 15 Sep
 * came from a helper that showed `err.message` for everything, with no report button.
 */
/**
 * A 42501 raised by one of our own functions carries a sentence written for the person — "this
 * department has not approved its brief yet, so its work cannot be assigned", "you cannot assign
 * this task: X is outside the part of the organisation you can schedule". A bare RLS refusal
 * carries Postgres's own wording, which is not. Tell the two apart by the wording.
 */
export function refusalSentence(e: { code?: string; message?: string } | null | undefined): string | null {
  if (e?.code !== '42501' || !e.message) return null
  const m = e.message.trim()
  if (/row-level security|permission denied|violates|insufficient privilege/i.test(m)) return null
  return m
}

/**
 * The refusals that name WHO CAN (I54.20). The function raises three things: an English sentence
 * (what a log or an unwired surface reads), `detail` — the people's names — and `hint`, the action.
 *
 * The hint is what makes the refusal translatable. A sentence assembled in Postgres is English for
 * ever; a key plus a list of names can be said in either language, which is the whole reason the
 * names do not simply ride inside the message.
 *
 * Edward, 23 Sep: *"Error messages must be explicit, they should state who to contact."*
 */
export type RefusalHint =
  | 'reorder_tasks'
  | 'remove_task'
  | 'cancel_task'
  | 'reinstate_task'
  | 'create_adhoc'
  | 'approve_brief'
  | 'reopen_brief'
  | 'promote_job'
  | 'attach_job'

const REFUSAL_HINTS: readonly string[] = [
  'reorder_tasks', 'remove_task', 'cancel_task', 'reinstate_task',
  'create_adhoc', 'approve_brief', 'reopen_brief', 'promote_job', 'attach_job',
]

/** Translate a named refusal, or null when this is not one. */
export function namedRefusal(
  err: unknown,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string | null {
  const e = err as { code?: string; details?: string; hint?: string } | null
  if (e?.code !== '42501' || !e.hint || !REFUSAL_HINTS.includes(e.hint)) return null
  const names = (e.details ?? '').trim()
  // Never "…outside your reach." full stop. A refusal that names nobody is the fault this exists
  // to fix, so even the no-name case says where to go.
  const who = names ? t('refusals.ask', { names }) : t('refusals.askNobody')
  return `${t(`refusals.${e.hint}`)} ${who}`
}

export function classifyWriteFailure(
  err: unknown,
  fallback: string,
  outsideReach: string,
  t?: (key: string, opts?: Record<string, unknown>) => string,
): WriteFailure {
  const e = err as { code?: string; message?: string } | null
  // Edward, 22 Sep: a team lead was refused an assignment and every screen said "outside your
  // write scope" — the database's actual reason (a different check entirely) was thrown away here.
  // A worded refusal is shown as written; only a bare RLS refusal gets the generic sentence.
  if (e?.code === '42501') {
    // I54.20 first: a refusal that carries a hint can be said in the reader's own language, with
    // the names in it. Without `t` (a caller not yet passing one) the English sentence still shows.
    const named = t ? namedRefusal(err, t) : null
    return { text: named ?? refusalSentence(e) ?? outsideReach, reportable: false }
  }
  if ((e?.code === '22023' || e?.code === 'P0002' || e?.code === '55000') && e.message) return { text: e.message, reportable: false }
  return { text: fallback, reportable: true, cause: err }
}
