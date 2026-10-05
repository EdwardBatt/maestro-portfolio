/**
 * A workstream's code letters — the `DA` in `DA-001` (I56.9, I59.53, I59.54).
 *
 * The database decides: `app.workstream_code_letters` gives the rule's letters from a name, and the
 * workstreams trigger keeps typed ones, in capitals, when they are two to four Latin letters. This
 * mirrors both so the dialog can SUGGEST the letters the database would use and refuse, while the
 * person types, what it would refuse. The two must not drift; the tests pin the same names.
 */

/** The rule's letters for a name — first letters of the first two words, or three of a one-word
 *  name; `WS` when the name has no Latin letters (an Arabic name, say). */
export function suggestCodeLetters(name: string): string {
  const words = name
    .trim()
    .split(/[\s·\-–—/&]+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ''))
    .filter((w) => w !== '')
  if (words.length === 0) return 'WS'
  if (words.length === 1) return (words[0] + 'XX').slice(0, 3).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** What the person typed, as the database will store it. */
export function normaliseCodeLetters(typed: string): string {
  return typed.trim().toUpperCase()
}

/** Two to four Latin letters — the database refuses anything else. */
export function isValidCodeLetters(typed: string): boolean {
  return /^[A-Z]{2,4}$/.test(normaliseCodeLetters(typed))
}
