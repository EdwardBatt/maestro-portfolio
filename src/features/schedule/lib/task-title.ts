/**
 * The Schedule pop-up's title, "<task> — <piece>", the piece said ONCE (Figma L SC-26; I74 fix-up). Task titles are
 * written "step — piece" (I53.15), so appending the piece again read "Write Copy — Social Advertisement — Social
 * Advertisement". Any trailing " — <piece>" (repeated, any case or spacing, with or without a unit number) is folded
 * into one; a title that names the piece elsewhere is left as it is; one that does not gets it added.
 */
const squash = (s: string) => s.replace(/\s+/g, ' ').trim()
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const pieceTail = (piece: string, repeated: boolean) =>
  new RegExp(`${repeated ? '(?:' : ''}\\s*[—–-]\\s*${escape(piece)}(\\s+\\d+)?${repeated ? ')+' : ''}$`, 'i')

export function taskWithPiece(title: string, pieceName: string | null | undefined): string {
  const t = squash(title)
  const piece = pieceName ? squash(pieceName) : ''
  if (!piece) return t
  const m = t.match(pieceTail(piece, true))
  if (m && m.index != null && m.index > 0) {
    // The last segment carries the unit number, if any ("Social statics 3").
    return `${t.slice(0, m.index)} — ${piece}${m[1] ?? ''}`
  }
  if (t.toLowerCase().includes(piece.toLowerCase())) return t
  return `${t} — ${piece}`
}

/** The step alone — "Write Copy" from "Write Copy — Social Advertisement" — for the pop-up's list of the piece's tasks. */
export function stepOf(title: string, pieceName: string | null | undefined): string {
  const full = taskWithPiece(title, pieceName)
  const piece = pieceName ? squash(pieceName) : ''
  if (!piece) return full
  const m = full.match(pieceTail(piece, false))
  return m && m.index != null && m.index > 0 ? full.slice(0, m.index) + (m[1] ?? '') : full
}
