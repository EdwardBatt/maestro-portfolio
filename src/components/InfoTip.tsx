import { useId, useState } from 'react'
import { Icon } from './Icon'

/**
 * **The (i) beside a heading, and the tip it opens** — Figma `SJ-v3-01b` ("the long explanation
 * lives here, not on the page").
 *
 * Guidance that is always on the page is guidance people stop reading, and a boxed amber notice
 * reads as a warning when it is only an explanation. So the explanation sits behind a small dark
 * disc and opens on hover — and on keyboard focus and on a tap, because hover alone would lock out
 * a keyboard and every touch screen. Escape closes it.
 *
 * The tip is announced through `aria-describedby`, so a screen reader hears it when the button is
 * reached, whether or not it is drawn.
 */
export function InfoTip({
  label,
  title,
  lines,
  testId = 'info-tip',
}: {
  /** What the button is, for a screen reader: "About the evidence". */
  label: string
  /** The tip's own heading — "Why the screenshot". */
  title?: string
  lines: string[]
  testId?: string
}) {
  const tipId = useId()
  // Pinned open by a tap or click; hover and focus open it on their own through CSS.
  const [pinned, setPinned] = useState(false)
  // Low on the screen the tip opens ABOVE its (i): opened below, it ran off the bottom of the
  // window (24 Sep walkthrough — "These details are correct" at the foot of step 1).
  const [above, setAbove] = useState(false)
  const place = (el: HTMLElement) => setAbove(el.getBoundingClientRect().bottom > window.innerHeight * 0.6)

  return (
    <span
      className={`info-tip${pinned ? ' is-open' : ''}${above ? ' is-above' : ''}`}
      onMouseEnter={(e) => place(e.currentTarget)}
      onFocus={(e) => place(e.currentTarget)}
      data-testid={testId}
    >
      <button
        type="button"
        className="info-tip-btn"
        aria-label={label}
        aria-describedby={tipId}
        aria-expanded={pinned}
        onClick={() => setPinned((v) => !v)}
        onBlur={() => setPinned(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setPinned(false)
            e.currentTarget.blur()
          }
        }}
        data-testid={`${testId}-button`}
      >
        <Icon name="info" size={12} />
      </button>
      <span id={tipId} role="tooltip" className="info-tip-body" data-testid={`${testId}-body`}>
        {title && <strong className="info-tip-title">{title}</strong>}
        {lines.map((line) => (
          <span key={line} className="info-tip-line">{line}</span>
        ))}
      </span>
    </span>
  )
}
