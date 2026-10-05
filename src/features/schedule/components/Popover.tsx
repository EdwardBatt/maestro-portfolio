import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * A menu that hangs under the control that opened it (Figma L: Who, Dates, Waits for, + Add a task,
 * the weeks menu). Portalled to the body and placed `fixed`, so a scrolling dialog never clips it;
 * React events still bubble through the dialog, so a click inside never reaches its backdrop.
 *
 * Escape closes the popover only — caught on the way DOWN, before the dialog's own Escape (which is
 * a window listener) can close the whole window. A click anywhere else closes it too.
 */
export function Popover({
  anchor,
  onClose,
  children,
  testId,
  width,
  align = 'start',
}: {
  anchor: HTMLElement | null
  onClose: () => void
  children: ReactNode
  testId?: string
  width?: number
  /** which edge of the control it lines up with, in reading order */
  align?: 'start' | 'end'
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!anchor) return
    const place = () => {
      const r = anchor.getBoundingClientRect()
      const rtl = document.documentElement.dir === 'rtl'
      const w = ref.current?.offsetWidth ?? width ?? 280
      const h = ref.current?.offsetHeight ?? 0
      const startEdge = rtl ? r.right - w : r.left
      const endEdge = rtl ? r.left : r.right - w
      let left = align === 'start' ? startEdge : endEdge
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
      let top = r.bottom + 4
      if (h && top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4)
      setPos({ top, left })
    }
    place()
    const raf = requestAnimationFrame(place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor, width, align])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      onClose()
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || anchor?.contains(t)) return
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown, true)
    }
  }, [anchor, onClose])

  return createPortal(
    <div
      ref={ref}
      className="sc-pop"
      role="dialog"
      data-testid={testId}
      style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, inlineSize: width }}
    >
      {children}
    </div>,
    document.body,
  )
}
