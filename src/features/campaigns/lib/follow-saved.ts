/**
 * **A form that follows what was saved** (test script, 4 Oct). The deliverable panel holds its fields in its own state,
 * seeded once from the deliverable. When the deliverable changes under it — the account manager accepts an ask and
 * the due date moves — the panel kept the old date, and "Save the deliverable" lit up to write it back.
 *
 * `followSaved(prev, next, current)`: for every field the person has NOT touched (it still equals what was saved
 * before), take the newly saved value; a field the person changed keeps their edit. Arrays compare by their items.
 */
type Value = string | readonly string[]
const same = (a: Value, b: Value) =>
  Array.isArray(a) || Array.isArray(b) ? (a as readonly string[]).join('\u0000') === (b as readonly string[]).join('\u0000') : a === b

export function followSaved<T extends Record<string, Value>>(prev: T, next: T, current: T): T {
  const out = { ...current }
  for (const k of Object.keys(next) as (keyof T)[]) {
    if (same(current[k], prev[k])) out[k] = next[k]
  }
  return out
}

export function sameSaved<T extends Record<string, Value>>(a: T, b: T): boolean {
  return (Object.keys(a) as (keyof T)[]).every((k) => same(a[k], b[k]))
}
