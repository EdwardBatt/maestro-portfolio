/**
 * The order a deliverable's task list is read in, and the two moves that change it.
 *
 * ADR-0052 d.14: `sort_order` is **presentation**. `starts_at` and `due_at` are dates, owned by the
 * task (ADR-0039) and materialised from the assignee's bookings (ADR-0042) — so nothing in this
 * file knows about them, and `public.resequence_deliverable_tasks` writes `sort_order` and nothing
 * else. Moving step 4 to step 7 changes a number. It must never move anybody's week.
 *
 * Why the ordering lives here rather than in the query: a hand-added task has **no**
 * `workflow_step_id` and **no** `sort_order` (I19.3) and must still land somewhere predictable —
 * after the template's steps, in the order it was added. That is a rendering rule with an exact
 * expected output, so it is a pure function with a unit test rather than an `order()` clause whose
 * behaviour nothing in this repository can assert without a database.
 */

/** The two fields the order is decided on. Deliberately structural, so `SubTaskRow` is not the
 *  only thing that can be ordered — the campaign surface reads the same list with fewer columns. */
export interface Sequenced {
  id: string
  sortOrder: number | null
  createdAt: string | null
}

/**
 * `sort_order nulls last, created_at` — template steps in the sequence the template lays down,
 * then everything hand-added, oldest first.
 *
 * Stable: two rows that tie on both keys keep the order they arrived in, so a re-render never
 * reshuffles a list somebody is reading.
 */
export function orderTasks<T extends Sequenced>(rows: readonly T[]): T[] {
  return rows.map((row, index) => ({ row, index })).sort((a, b) => {
    const sa = a.row.sortOrder
    const sb = b.row.sortOrder
    // Nulls last, and never compared as numbers: `null < 1` is true in JS, which would put every
    // hand-added task at the TOP — the opposite of the rule.
    if (sa == null && sb != null) return 1
    if (sa != null && sb == null) return -1
    if (sa != null && sb != null && sa !== sb) return sa - sb
    const ca = a.row.createdAt ?? ''
    const cb = b.row.createdAt ?? ''
    if (ca !== cb) return ca < cb ? -1 : 1
    return a.index - b.index
  }).map((x) => x.row)
}

/**
 * The ids of `rows` with the one at `id` moved one place `up` or `down`, for handing straight to
 * `public.resequence_deliverable_tasks`.
 *
 * `rows` must be the WHOLE list in its displayed order. A filtered list would renumber only the
 * rows it contains — the RPC assigns positions from the array — which silently interleaves the
 * hidden ones. The surface withdraws the control while a filter is on rather than passing a subset.
 *
 * Returns null when there is nothing to do (the row is already at that end, or is not in the list),
 * so the caller can skip a round trip instead of writing the order it already has.
 */
export function moveTask(rows: readonly Sequenced[], id: string, direction: 'up' | 'down'): string[] | null {
  const ids = rows.map((r) => r.id)
  const from = ids.indexOf(id)
  if (from < 0) return null
  const to = direction === 'up' ? from - 1 : from + 1
  if (to < 0 || to >= ids.length) return null
  const next = [...ids]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved as string)
  return next
}
