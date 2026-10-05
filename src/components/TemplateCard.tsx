import type { ReactNode } from 'react'

/**
 * One kind of thing among several, chosen by a press — the brief cards on SJ-v3-01 (Figma
 * `B · SINGLE JOB — BRIEF FIRST`, 22 Sep). An icon tile on the card's own hue, the name, its name in
 * the other language, one line of description, a badge (which departments write from it) with a
 * count beside it (how many fields), and a usage line at the foot.
 *
 * It is a toggle button: `selected` is `aria-pressed`, and the chosen card takes its hue as its
 * edge. `hue` is 1–12 and maps to the categorical `--hue-*` tokens — for telling kinds apart, never
 * for status (the reserved green/amber/red belong to `StatusRollupStrip`).
 *
 * Presentation only (AGENTS.md §4): strings, a hue and a click handler in; nothing decided.
 */
export type TemplateHue = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12
export const TEMPLATE_HUES = 12

export function TemplateCard({
  icon,
  title,
  alt,
  description,
  badge,
  badgeQuiet = false,
  count,
  note,
  noteQuiet = false,
  hue = 6,
  selected = false,
  disabled = false,
  onClick,
  testId,
}: {
  icon: ReactNode
  title: ReactNode
  /** The name in the other language, under the title. */
  alt?: ReactNode
  description?: ReactNode
  /** The small uppercase pill — who writes from this. */
  badge?: ReactNode
  /** The pill in the faint caption colour rather than the card's hue — "no department yet". */
  badgeQuiet?: boolean
  /** The count beside the badge — "6 fields". */
  count?: ReactNode
  /** The foot line — where this was last used. */
  note?: ReactNode
  /** The foot line in the faint caption colour rather than the card's hue. */
  noteQuiet?: boolean
  hue?: TemplateHue
  selected?: boolean
  disabled?: boolean
  onClick: () => void
  testId?: string
}) {
  return (
    <button
      type="button"
      className="template-card"
      data-hue={hue}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
    >
      <span className="template-card-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="template-card-title">{title}</span>
      {alt && (
        <span className="template-card-alt" dir="auto">
          {alt}
        </span>
      )}
      {description && <span className="template-card-text">{description}</span>}
      {(badge || count) && (
        <span className="template-card-meta">
          {badge && <span className={`template-card-badge${badgeQuiet ? ' is-quiet' : ''}`}>{badge}</span>}
          {count && <span className="template-card-count">{count}</span>}
        </span>
      )}
      {note && <span className={`template-card-note${noteQuiet ? ' is-quiet' : ''}`}>{note}</span>}
    </button>
  )
}
