import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export interface MenuItem {
  key: string
  label: string
  onSelect: () => void
  danger?: boolean
  /** A hairline above this item (Figma K: above Delete). */
  separated?: boolean
  testId?: string
}

/**
 * A ⋯ button that opens a list of actions (Figma K, LB-04: 230 wide, 6 padding, items 10×8 at 12px, a
 * hairline before the destructive one, `--shadow-menu`). Outside click and Escape close it; arrow keys
 * move between items. Presentation only: each item says what it does through `onSelect`.
 */
export function Menu({
  items,
  label,
  testId,
  trigger,
}: {
  items: MenuItem[]
  /** The button's accessible name, e.g. "More for LUMA_logo_primary.svg". */
  label: string
  testId?: string
  trigger?: ReactNode
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    list.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function onListKey(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const buttons = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = e.key === 'ArrowDown' ? (at + 1) % buttons.length : (at - 1 + buttons.length) % buttons.length
    buttons[next]?.focus()
  }

  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        type="button"
        className={`menu-trigger${open ? ' menu-trigger-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={t('common.more')}
        onClick={() => setOpen((o) => !o)}
        data-testid={testId}
      >
        {trigger ?? '⋯'}
      </button>
      {open && (
        <div className="menu-list" role="menu" ref={list} onKeyDown={onListKey}>
          {items.map((it) => (
            <div key={it.key} className={it.separated ? 'menu-item-wrap menu-item-separated' : 'menu-item-wrap'}>
              <button
                type="button"
                role="menuitem"
                className={it.danger ? 'menu-item menu-item-danger' : 'menu-item'}
                onClick={() => { setOpen(false); it.onSelect() }}
                data-testid={it.testId}
              >
                {it.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
