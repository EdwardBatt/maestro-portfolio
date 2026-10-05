import { supabaseUntyped } from '../supabase'

/**
 * People who are **Leaving** (ADR-0133 d.1): deactivated by an admin, access already gone, their work not yet
 * handed over. They are offered for no new work — no picker, owner list, assignee or reviewer list offers them —
 * while what they already hold stays with them until the hand-over moves it.
 *
 * One read (`leaving_since` set on an active profile) and one filter, applied inside every source that offers
 * people for work (`useAssignableUsers`, the owner and lead lists, workstream owners, reviewers, account
 * managers), so the pickers themselves need no change. The database refuses the write too; this only keeps the
 * name off the list.
 *
 * A read that fails — the column not there yet on a stack whose migrations lag — narrows nothing: a list
 * that still shows a leaving person is better than a picker that is empty.
 */
export async function fetchLeavingIds(): Promise<ReadonlySet<string>> {
  try {
    const { data, error } = await supabaseUntyped
      .from('user_profiles')
      .select('id')
      .eq('is_active', true)
      .not('leaving_since', 'is', null)
    if (error) return new Set()
    return new Set(((data ?? []) as { id: string }[]).map((r) => r.id))
  } catch {
    return new Set()
  }
}

/** The list without anyone Leaving. `idOf` reads the person's user id off a row. */
export function withoutLeaving<T>(list: readonly T[], leaving: ReadonlySet<string>, idOf: (row: T) => string | null | undefined): T[] {
  if (leaving.size === 0) return [...list]
  return list.filter((row) => {
    const id = idOf(row)
    return !(id && leaving.has(id))
  })
}
