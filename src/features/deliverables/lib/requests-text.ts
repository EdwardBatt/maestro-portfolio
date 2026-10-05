/**
 * Small wording helpers the Needs-you and task-page dialogs share (I59 Track 6). Pure.
 */

/**
 * "Fadia, Inas and Hasan" — the names a Who-is-told line reads. `sep` and `and` come from the
 * locale (`requests.listSep`, `requests.listAnd`), so Arabic reads "فادية، إيناس و حسن".
 * Blank names and repeats are dropped; null when nobody is left.
 */
export function joinNames(names: readonly (string | null | undefined)[], and: string, sep = ', '): string | null {
  const list = [...new Set(names.filter((n): n is string => !!n && n.trim().length > 0))]
  if (list.length === 0) return null
  if (list.length === 1) return list[0]!
  return `${list.slice(0, -1).join(sep)} ${and} ${list[list.length - 1]}`
}

/** A refusal is the server's own sentence (ADR-0095); a failure with no words says so. */
export function errorText(err: unknown, fallback: string): string {
  const m = (err as { message?: unknown } | null)?.message
  return typeof m === 'string' && m.trim() ? m : fallback
}

/**
 * The nudge's pre-written message (plan View 6: "a message pre-written from the item, editable"),
 * in the reader's words through `say`. Blocked: what the maker is waiting for.
 */
export function nudgeDraft(
  say: (key: string, vars?: Record<string, unknown>) => string,
  args: { task: string; what: string | null; maker: string | null },
): string {
  return args.what
    ? say('requests.nudge.draftBlocked', { task: args.task, what: args.what, maker: args.maker ?? '' })
    : say('requests.nudge.draft', { task: args.task })
}

/** The tenant person whose name matches the free text "who has it" exactly (case and spaces aside), or null. */
export function personNamed<P extends { id: string; name: string }>(people: readonly P[], text: string | null | undefined): P | null {
  const want = (text ?? '').trim().toLocaleLowerCase()
  if (!want) return null
  const hits = people.filter((p) => p.name.trim().toLocaleLowerCase() === want)
  return hits.length === 1 ? hits[0]! : null
}

/**
 * The server refused an untimed send (ADR-0106 d.2): SQLSTATE 22023, HINT `untimed`, DETAIL the
 * allocated hours (empty when none). Returns the hours (null when none) or undefined when the error
 * is something else.
 */
export function untimedRefusal(err: unknown): number | null | undefined {
  const e = err as { code?: string; hint?: string; details?: string; detail?: string } | null
  if (!e || e.code !== '22023' || e.hint !== 'untimed') return undefined
  const raw = (e.details ?? e.detail ?? '').trim()
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) ? n : null
}
