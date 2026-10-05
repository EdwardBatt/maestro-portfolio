import { useEffect } from 'react'

/**
 * **Every data table becomes cards on a phone** (Edward, 26 Sep: "make sure everything is responsive").
 *
 * The rule was his earlier choice, written above the `[data-stacked]` block in `index.css`: below
 * 768px each row becomes a card and every cell carries its column's name — chosen over horizontal
 * scroll, *"where the arrows sit off one edge and Remove off the other"*. The CSS existed; no table
 * carried the labels, so on 26 Sep a dozen pages scrolled sideways at 390px (Users by 1,363px).
 *
 * Rather than hand-copy each header onto every cell of ~35 tables, this reads the header row once and
 * stamps `data-label` on the body cells — one source for the words, so a renamed column is right in
 * both places. It marks the table with `data-stacked` (an attribute React does not manage, so a
 * re-render cannot strip it the way it would reset a `className`). Desktop is untouched: the CSS only
 * acts under 768px.
 *
 * A cell that already carries its own `data-label` keeps it. A table opts out with `data-no-stack`
 * or by being a matrix the cards would make unreadable (the roles grid, the team load).
 */
const OPT_OUT = '[data-no-stack], .grants-matrix, .tv-load, .tv-pieces'
const AUTO = 'data-label-auto'

export function stampTable(table: HTMLTableElement): void {
  if (table.matches(OPT_OUT)) return
  const head = table.tHead?.rows[table.tHead.rows.length - 1]
  if (!head) return
  // Visible header text only: a column headed by an aria-label alone (an actions column) is blank on
  // screen, and its card cell spans the full width instead of carrying a name nobody sees above it.
  const labels: string[] = []
  for (const th of Array.from(head.cells)) {
    const text = (th.textContent ?? '').replace(/[▲▼↑↓]/g, '').trim()
    for (let i = 0; i < (th.colSpan || 1); i++) labels.push(text)
  }
  if (!table.hasAttribute('data-stacked')) table.setAttribute('data-stacked', '')
  for (const body of Array.from(table.tBodies)) {
    for (const row of Array.from(body.rows)) {
      let col = 0
      for (const cell of Array.from(row.cells)) {
        if (cell.tagName === 'TD' && (!cell.hasAttribute('data-label') || cell.hasAttribute(AUTO))) {
          const want = labels[col] ?? ''
          if (cell.getAttribute('data-label') !== want) cell.setAttribute('data-label', want)
          cell.setAttribute(AUTO, '')
        }
        col += cell.colSpan || 1
      }
    }
  }
}

/** Mount once, in the shell: stamps every `table.data-table`, and again whenever rows arrive. */
export function useStackedTables(): void {
  useEffect(() => {
    let frame = 0
    const run = () => {
      frame = 0
      document.querySelectorAll<HTMLTableElement>('table.data-table').forEach(stampTable)
    }
    run()
    // childList only: stamping sets attributes, which must not wake the observer again.
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(run)
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])
}
