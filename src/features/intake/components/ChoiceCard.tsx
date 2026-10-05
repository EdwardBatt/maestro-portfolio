import type { ReactNode } from 'react'
import { Tag } from '../../../components/Tag'

/**
 * One of the two doors on SJ-01 — a large horizontal card: an icon tile on the inline-start, then
 * a title with its step-count badge and a line of description beside it. The recommended route
 * (single job) is drawn `primary`, which the frame gives a violet border and a soft violet ground
 * so the eye takes the door the agency wants people taking (designer note AM-F1).
 *
 * Presentation only: a click handler and strings in.
 */
export function ChoiceCard({
  icon,
  title,
  badge,
  description,
  primary = false,
  onClick,
  testId,
  buttonRef,
}: {
  icon: ReactNode
  title: ReactNode
  badge: ReactNode
  description: ReactNode
  primary?: boolean
  onClick: () => void
  testId?: string
  buttonRef?: React.Ref<HTMLButtonElement>
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`choice-card${primary ? ' choice-card-primary' : ''}`}
      onClick={onClick}
      data-testid={testId}
    >
      <span className="choice-card-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="choice-card-body">
        <span className="choice-card-head">
          <span className="choice-card-title">{title}</span>
          <Tag tone={primary ? 'accent' : 'neutral'}>{badge}</Tag>
        </span>
        <span className="choice-card-text">{description}</span>
      </span>
    </button>
  )
}
