/**
 * A person's round mark (Figma L): the first letter of their name on one of the twelve hue tokens,
 * picked from their id so the same person keeps the same colour on every screen. Decoration only —
 * the name always stands beside it.
 */
export function Avatar({ id, name, size = 28 }: { id: string; name: string; size?: number }) {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const hue = (h % 12) + 1
  return (
    <span
      className="sc-avatar"
      aria-hidden="true"
      style={{ inlineSize: size, blockSize: size, background: `var(--hue-${hue})`, fontSize: Math.round(size * 0.42) }}
    >
      {[...name.trim()][0] ?? '?'}
    </span>
  )
}
