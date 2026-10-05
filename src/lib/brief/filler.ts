/**
 * ADR-0111 d.1 (I59.27) — filler is not a brief.
 *
 * The screen's copy of the database rule `app.is_filler_with` (migration
 * `20260926123000_filler_is_not_a_brief.sql`). The two must agree case for case — the database is the
 * gate (`app.approve_campaign` refuses), this lets the screen say so before the press. Both test suites
 * (`filler.test.ts`, pgTAP 173) carry the same cases.
 *
 * The rule: trimmed and lower-cased, the text is split into runs of letters/digits. It is filler when
 * it is not blank and EVERY run is filler — or there is no run at all ("…", "...", "-"). A run is
 * filler when it is a built-in word (xyz, tbd, tbc, tba, test, x, lorem, ipsum), digits only (but never
 * when EVERY run is digits: "30" is an answer), one repeated character, or one of the tenant's one-word entries. A
 * tenant's several-word entry ("coming soon") matches the whole text. Text that BEGINS "lorem ipsum" is
 * filler however it goes on ("Lorem ipsum dolor sit amet…", I59 settled 25 Sep). Blank is NOT filler: an
 * empty field is its own refusal (and an empty optional one is allowed — every field WITH text is checked,
 * ADR-0111 addendum). "N/A" and a number on its own are real answers, not filler (Edward, 25 Sep —
 * the templates' own guidance asks for them). Mirrors `20260926140000`.
 */

export const BUILT_IN_FILLER_WORDS: readonly string[] = ['xyz', 'tbd', 'tbc', 'tba', 'test', 'x', 'lorem', 'ipsum']

const RUN = /[\p{L}\p{N}]+/gu
const DIGITS_ONLY = /^[0-9٠-٩۰-۹]+$/u
const ONE_REPEATED = /^(.)\1*$/u
/** "N/A", "NA", "n.a." — a real answer (not applicable), Edward 25 Sep. */
const NOT_APPLICABLE = /^n\s*[/.]?\s*a\.?$/iu

function runsOf(text: string): string[] {
  return text.toLowerCase().trim().match(RUN) ?? []
}

/** True when `text` holds only placeholder text. `extraWords` are the tenant's own entries. */
export function isFiller(text: string | null | undefined, extraWords: readonly string[] = []): boolean {
  const trimmed = (text ?? '').trim()
  if (trimmed === '') return false
  if (NOT_APPLICABLE.test(trimmed)) return false

  const single = new Set<string>()
  const phrases = new Set<string>()
  for (const w of extraWords) {
    const runs = runsOf(w)
    if (runs.length === 0) continue
    if (runs.length > 1) phrases.add(runs.join(' '))
    else single.add(runs[0]!)
  }

  const runs = runsOf(trimmed)
  if (runs.length === 0) return true
  if (runs.length >= 2 && runs[0] === 'lorem' && runs[1] === 'ipsum') return true
  if (phrases.has(runs.join(' '))) return true
  // A number on its own is a real answer (a budget, an order value) — Edward, 25 Sep. Digits beside
  // placeholder words ("XYZ 123") are still filler.
  if (runs.every((run) => DIGITS_ONLY.test(run))) return false

  return runs.every(
    (run) => BUILT_IN_FILLER_WORDS.includes(run) || DIGITS_ONLY.test(run) || ONE_REPEATED.test(run) || single.has(run),
  )
}
