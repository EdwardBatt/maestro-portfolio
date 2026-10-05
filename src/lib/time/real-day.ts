/**
 * Is this `YYYY-MM-DD` a real calendar day a person could mean (I66.8)? Four-digit years only, 2000–2099 — a
 * five-digit year is what Chrome's date box accepts and what crashed production ("Invalid time value") — and the
 * day must exist (no 31 February). Anything that passes is safe to hand to `endOfWorkingDay`, `Date.parse` and the
 * rest of the date arithmetic.
 */
export function isRealDay(day: string | null | undefined): day is string {
  if (!day) return false
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (y < 2000 || y > 2099 || mo < 1 || mo > 12 || d < 1) return false
  const t = new Date(Date.UTC(y, mo - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
}
