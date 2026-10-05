import { useEffect, useRef, type ReactNode } from 'react'
import { Tag } from './Tag'

/**
 * The modal shell the CS-Flows frames share — the New-request door, "Similar job" (SJ-A1),
 * "Promote to campaign" (SJ-A2) and "Add a brand" (SJ-A3). One vocabulary, so the four read as the
 * same product rather than four dialogs (the defect `I12.9` raised for Notice/Confirm, applied to
 * the intake surfaces).
 *
 * It sits beside `NoticeDialog`/`ConfirmDialog` rather than replacing them: those report what
 * happened or ask before something destructive and are small (`--radius`, 440px); a `Modal` is a
 * task surface — an eyebrow tag, a title, a subtitle, a body of fields, and a footer that carries
 * a primary action plus a quiet note (`--radius-lg`, wider). All measurements come from tokens.
 *
 * Behaviour: backdrop click and Escape close it, focus lands on the first focusable control inside,
 * and the body scrolls if it is taller than the viewport. Presentation only (AGENTS.md §4).
 *
 * Composed with `ModalHeader` and `ModalFooter`:
 *
 *   <Modal onClose={close} labelledById="x-title" testId="x" size="wide">
 *     <ModalHeader id="x-title" eyebrow="NEW BRAND" title="…" subtitle="…" />
 *     <div className="modal-body">…fields…</div>
 *     <ModalFooter note="It appears on the client record too">
 *       <Button variant="primary">Add it and carry on</Button>
 *       <Button variant="secondary" onClick={close}>Cancel</Button>
 *     </ModalFooter>
 *   </Modal>
 */
export function Modal({
  onClose,
  labelledById,
  testId,
  size = 'default',
  /** Set false where the parent owns the Escape key (the door listens for its own shortcut). */
  closeOnEscape = true,
  /**
   * When true (default) the Modal renders its own `.modal` card chrome. Set FALSE to reuse the
   * shared behaviour — backdrop-click, Escape, focus-in — while a child that already carries its own
   * card (a legacy `.dialog`, whose field styling is scoped to that class) stays the visual surface.
   * Lets older dialogs gain dismiss-on-Esc/outside without being re-chromed (I48.6).
   */
  card = true,
  children,
}: {
  onClose: () => void
  labelledById?: string
  testId?: string
  size?: 'default' | 'wide'
  closeOnEscape?: boolean
  card?: boolean
  children: ReactNode
}) {
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // The first control, or the wrapper itself — a modal nobody can act on from the keyboard is
    // worse than none. Never an (i): focusing one opens its tip over the dialog the moment it
    // appears (found 24 Sep on Remove a piece), and it is not what anybody came to the dialog for.
    // Never a person picker (`role="combobox"`) either, for the same reason: focus opens its list,
    // which then lies over the fields below it and the dialog's own buttons — on Nudge the name was
    // already filled in, and a click on the message box picked somebody else (found 25 Sep).
    const focusable = cardRef.current?.querySelector<HTMLElement>(
      'input:not([role="combobox"]), select, textarea, button:not(.info-tip-btn), [href], [tabindex]:not([tabindex="-1"])',
    )
    ;(focusable ?? cardRef.current)?.focus()
  }, [])

  useEffect(() => {
    if (!closeOnEscape) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, closeOnEscape])

  // `card={false}`: the behaviour only. The wrapper is `display:contents` so it adds no box — the
  // child IS the card and keeps its own role/aria/styling — while backdrop-click, Escape and
  // focus-in all still work (the ref finds the first focusable inside the child).
  if (!card) {
    return (
      <div className="dialog-backdrop" role="presentation" onClick={onClose}>
        <div ref={cardRef} style={{ display: 'contents' }} onClick={(e) => e.stopPropagation()} data-testid={testId}>
          {children}
        </div>
      </div>
    )
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={cardRef}
        className={`modal modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledById}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        data-testid={testId}
      >
        {children}
      </div>
    </div>
  )
}

/** The eyebrow tag + title + subtitle block every CS-Flows modal opens with. */
export function ModalHeader({
  id,
  eyebrow,
  title,
  subtitle,
}: {
  id?: string
  eyebrow?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
}) {
  return (
    <header className="modal-header">
      {eyebrow ? <Tag tone="accent">{eyebrow}</Tag> : null}
      <h2 id={id} className="modal-title">
        {title}
      </h2>
      {subtitle ? <p className="modal-subtitle">{subtitle}</p> : null}
    </header>
  )
}

/**
 * The footer: the actions on the inline-start (primary first, per the frames), and an optional
 * quiet note on the inline-end ("It appears on the client record too", "A single job can be
 * promoted to a campaign later without retyping").
 */
export function ModalFooter({ note, children }: { note?: ReactNode; children: ReactNode }) {
  return (
    <footer className="modal-footer">
      <div className="modal-footer-actions">{children}</div>
      {note ? <span className="modal-footer-note">{note}</span> : null}
    </footer>
  )
}
