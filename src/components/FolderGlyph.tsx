/**
 * The Library's folder mark (Figma K): a tab and a body, violet for a brand's folders and green for a
 * project's. Two sizes — 26×20 on cards and section heads, 20×15 inline (the upload box, the move tree).
 */
export function FolderGlyph({ tone = 'violet', size = 'md' }: { tone?: 'violet' | 'green'; size?: 'md' | 'sm' }) {
  return (
    <span className={`folder-glyph folder-glyph-${tone} folder-glyph-${size}`} aria-hidden="true">
      <span className="folder-glyph-tab" />
      <span className="folder-glyph-body" />
    </span>
  )
}
