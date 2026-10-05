import { useTranslation } from 'react-i18next'
import { Icon, type IconName } from './Icon'

/**
 * A deliverable's priority, as a coloured SYMBOL (I54.15; Edward, 23 Sep: *"show as a symbol
 * (exclamation icon for high priority)… use color coded symbols"*).
 *
 * It was a word in a pill, which works on a table with room for it and nowhere else. The three
 * surfaces that had to show it next — My Work, the schedule grid and the campaign's deliverable
 * rows — are dense, and a fourth word on every row is the kind of thing that makes a grid
 * unreadable. So one mark, everywhere, and the two places that already showed the word now show
 * the same mark: there is one way of reading priority rather than two.
 *
 * The family: **high** an exclamation in the breach red, **medium** an up chevron in amber,
 * **normal** a down chevron, quiet. Alarm, up, down.
 *
 * "Normal" is the WORD only (Edward, 23 Sep — "change low to Normal"). The stored value is still
 * `low`: renaming it in the database means a migration, a CHECK constraint and every writer of a
 * priority changed, to alter something nobody outside this component reads.
 *
 * Colour is never the only carrier — the mark has a title and a screen-reader label, so the same
 * three states are legible without it.
 *
 * Presentation only.
 */
const SYMBOL: Record<'high' | 'medium' | 'low', IconName> = {
  high: 'alert',
  medium: 'chevron-up',
  low: 'chevron-down',
}

export function PriorityMark({
  priority,
  testId,
}: {
  priority: 'high' | 'medium' | 'low'
  testId?: string
}) {
  const { t } = useTranslation()
  const label = t(`intake.who.priorities.${priority}`)
  return (
    <span
      className={`priority-mark priority-${priority}`}
      title={label}
      data-priority={priority}
      data-testid={testId}
    >
      <Icon name={SYMBOL[priority]} size={14} />
      <span className="sr-only">{label}</span>
    </span>
  )
}
