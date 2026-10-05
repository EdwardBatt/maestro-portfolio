/**
 * Who matches what you typed, and in what order.
 *
 * Split out of `PersonPicker` because it is the feature. Edward, 29 Aug — *"if I typed L would it
 * filter to all names starting with L?"* The first version delegated to `<datalist>`, where every
 * browser answers that differently and Chrome surfaces "Omar **Al**-Rawi" for "L". Owning the match
 * means it can be stated, ranked, and tested without rendering anything.
 */
export interface PickablePerson {
  id: string
  name: string
  /** Shown beside the name — the wizard passes the department. Never matched against. */
  hint?: string | null
}

/** Prefix matches before substring matches, each keeping the order it was given in. */
export function rankPeople(people: readonly PickablePerson[], query: string): PickablePerson[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...people]
  const starts: PickablePerson[] = []
  const contains: PickablePerson[] = []
  for (const p of people) {
    const name = p.name.toLowerCase()
    if (name.startsWith(q)) starts.push(p)
    // A surname is still a name somebody searches by, so "rawi" has to find Omar Al-Rawi — it just
    // ranks below anyone whose name opens with it.
    else if (name.includes(q)) contains.push(p)
  }
  return [...starts, ...contains]
}
