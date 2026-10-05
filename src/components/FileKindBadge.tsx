import { fileKind } from '../lib/assets/kind'

/**
 * The small square that says what a file is — "SVG", "DOCX", "MP4" — on a ground picked by its kind
 * (Figma K, LB-04 / LB-05 / LB-08: 34 wide, 9 tall padding, 8.5px bold). Presentation only.
 */
export function FileKindBadge({ name, contentType, isLink = false }: { name: string; contentType?: string | null; isLink?: boolean }) {
  const k = fileKind(name, contentType, isLink)
  return (
    <span className={`file-kind-badge file-kind-${k.tone}`} aria-hidden="true">
      {k.badge}
    </span>
  )
}
