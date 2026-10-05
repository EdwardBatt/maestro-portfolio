/**
 * Ranked name search, for any list somebody scans by typing.
 *
 * `rankPeople` proved the rule on the owner picker (Edward, 29 Aug — *"if I typed L would it filter
 * to all names starting with L?"*): a prefix match is what somebody expects first, and a substring
 * match is still useful because a surname is a name people search by. This is the same rule with
 * the person-shaped type taken out, so a deliverable list and a resource list get the behaviour
 * without either of them importing the other's module.
 *
 * **Matching is owned here, not delegated to the browser.** `<datalist>` answers this differently
 * in every browser — Chrome surfaces "Omar **Al**-Rawi" for "L" — and a filter nobody can predict
 * is worse than no filter.
 */

/** Prefix matches first, then substring, each keeping the order it arrived in. */
export function rankByName<T>(items: readonly T[], query: string, nameOf: (item: T) => string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...items]
  const starts: T[] = []
  const contains: T[] = []
  for (const item of items) {
    const name = nameOf(item).toLowerCase()
    if (name.startsWith(q)) starts.push(item)
    else if (name.includes(q)) contains.push(item)
  }
  return [...starts, ...contains]
}

/**
 * The same, across SEVERAL fields per item.
 *
 * A deliverable is found by its name, but also by its type or the department doing it — "print"
 * should reach a Print Advertisement whatever it happens to be called. A prefix hit on ANY field
 * outranks a substring hit on any other, so the strongest match still leads.
 */
export function rankByFields<T>(
  items: readonly T[],
  query: string,
  fieldsOf: (item: T) => (string | null | undefined)[],
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...items]
  const starts: T[] = []
  const contains: T[] = []
  for (const item of items) {
    const fields = fieldsOf(item)
      .filter((f): f is string => typeof f === 'string' && f !== '')
      .map((f) => f.toLowerCase())
    if (fields.some((f) => f.startsWith(q))) starts.push(item)
    else if (fields.some((f) => f.includes(q))) contains.push(item)
  }
  return [...starts, ...contains]
}
