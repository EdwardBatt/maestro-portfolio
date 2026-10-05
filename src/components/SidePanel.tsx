import { useEffect, useRef, type ReactNode } from 'react'

/**
 * A panel that slides over the page's inline-end edge (Figma K, LB-07: 440 wide, full height,
 * `--shadow-drawer`, a quiet footer). The page behind is dimmed and stays where it was; backdrop click
 * and Escape close it. Presentation only.
 */
export function SidePanel({
  onClose,
  labelledById,
  testId,
  children,
  footer,
}: {
  onClose: () => void
  labelledById?: string
  testId?: string
  children: ReactNode
  footer?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="side-panel-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <aside
        className="side-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledById}
        tabIndex={-1}
        ref={ref}
        data-testid={testId}
      >
        <div className="side-panel-body">{children}</div>
        {footer && <footer className="side-panel-foot">{footer}</footer>}
      </aside>
    </div>
  )
}
