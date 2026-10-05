import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkProgress } from '../lib/deliverables/work-phase'

/**
 * **A deliverable's progress: the bar, and the numbers behind its status word** (I67.4, Edward 30 Sep, A).
 *
 * The status word follows the piece's least advanced open task (`workProgress`), so one word cannot say
 * that two tasks are done, one is in review and two have not started. The bar shows that mix — a segment
 * per task, coloured by where it is — and the card, on hover, focus or a tap of the status, says it in
 * numbers, one line per status: "2 of 8 – Done", "1 of 8 – In review"… Chosen by Edward from
 * the mock `Claude outputs/mocks/deliverable-progress.html`.
 */
type Counts = Pick<WorkProgress, 'done' | 'everTotal' | 'inReview' | 'inProgress' | 'notStarted'>

/**
 * One line per status that has tasks, "2 of 8 – Done" (Edward, 30 Sep: "Each status should display as x of x -
 * <status> .. one line per applicable status" — the first cut said "2 done" and "2 of 2 done", the same fact twice).
 */
function useLines(p: Counts): { lines: string[]; of: string } {
  const { t } = useTranslation()
  const line = (count: number, key: string) =>
    count > 0 ? t('progress.line', { count, total: p.everTotal, status: t(`progress.status.${key}`) }) : null
  const lines = [
    line(p.done, 'done'),
    line(p.inReview, 'inReview'),
    line(p.inProgress, 'inProgress'),
    line(p.notStarted, 'notStarted'),
  ].filter((x): x is string => x != null)
  return { lines, of: t('progress.of', { done: p.done, total: p.everTotal }) }
}

/** The "x of y – status" lines on their own, for a card that already has its own heading (the Schedule's chip, I67.8). */
export function ProgressLines({ progress, className = 'info-tip-line' }: { progress: Counts; className?: string }) {
  const { lines } = useLines(progress)
  if (progress.everTotal === 0) return null
  return <>{lines.map((l) => <span key={l} className={className}>{l}</span>)}</>
}

/** The status pill, with the numbers on hover, focus or a tap. The pill itself is the caller's. */
export function ProgressTip({
  progress,
  status,
  children,
  testId = 'progress-tip',
}: {
  progress: Counts
  /** The status word the pill shows — the card's heading. */
  status: string
  children: ReactNode
  testId?: string
}) {
  const tipId = useId()
  const { lines } = useLines(progress)
  const [above, setAbove] = useState(false)
  const place = (el: HTMLElement) => setAbove(el.getBoundingClientRect().bottom > window.innerHeight * 0.6)
  if (progress.everTotal === 0) return <>{children}</>
  // Hover and keyboard focus open it (CSS). No click handler: the pill often sits inside a row or card
  // that opens on a click, and that click must still open it.
  return (
    <span
      className={`progress-tip${above ? ' is-above' : ''}`}
      tabIndex={0}
      aria-describedby={tipId}
      onMouseEnter={(e) => place(e.currentTarget)}
      onFocus={(e) => place(e.currentTarget)}
      onKeyDown={(e) => { if (e.key === 'Escape') e.currentTarget.blur() }}
      data-testid={testId}
    >
      {children}
      <span id={tipId} role="tooltip" className="info-tip-body" data-testid={`${testId}-body`}>
        <strong className="info-tip-title">{status}</strong>
        {lines.map((l) => <span key={l} className="info-tip-line">{l}</span>)}
      </span>
    </span>
  )
}

/** The bar — a segment per task, by where it is — and "2 of 8 done" beside it. */
export function ProgressBar({ progress, testId = 'progress-bar' }: { progress: Counts; testId?: string }) {
  const { lines, of } = useLines(progress)
  if (progress.everTotal === 0) return null
  const segments = [
    ['done', progress.done],
    ['review', progress.inReview],
    ['progress', progress.inProgress],
    ['todo', progress.notStarted],
  ] as const
  return (
    <span className="progress-bar" data-testid={testId}>
      <span className="progress-bar-track" role="img" aria-label={lines.join('; ')} title={lines.join('\n')}>
        {segments.map(([k, n]) => n > 0 && <i key={k} className={`is-${k}`} style={{ flexGrow: n }} />)}
      </span>
      <span className="progress-bar-count">{of}</span>
    </span>
  )
}
