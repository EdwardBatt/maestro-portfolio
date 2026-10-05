import { useTranslation } from 'react-i18next'
import { outstandingReviewers, reviewerRole, type TaskReviewer } from '../lib/reviewers/task-reviewers'

/**
 * Who a task in review is still waiting for (ADR-0043 d.8, ADR-0089 d.12).
 *
 * With one reviewer, "waiting on review" had exactly one name against it and everybody knew who to
 * ask. With three it has none, and a task can sit for a week while each person assumes another is
 * looking. So wherever a task in review is shown — the assignee's My Work row, the Deliverables
 * table, the reviewer's own inbox — it names the reviewers who have not acted, and marks the ones
 * whose approval is required.
 *
 * ADR-0089 gives the wait two kinds. A REQUIRED reviewer is outstanding until they approve, marked
 * *(required)* as before. An OPTIONAL reviewer is outstanding until they ANSWER, marked
 * *(no answer yet)* — because the required reviewer cannot complete the task until they have, and
 * this line is where somebody learns who to chase. Somebody who has answered or approved is not
 * named at all.
 *
 * Renders nothing when nobody is outstanding: an empty "waiting on —" is noise on every finished
 * task. Presentation only.
 */
export function WaitingOn({
  reviewers,
  testId = 'waiting-on',
  blockingOnly = false,
}: {
  reviewers: TaskReviewer[]
  testId?: string
  /**
   * I40.22 — name only the MANDATORY reviewers. Edward, 8 Sep: *"show the mandatory reviewer/s as
   * they are the only ones that block the work"*.
   *
   * Set on TRACKING surfaces, where the question is "what is holding this up" and an optional
   * reviewer is not an answer. Left off on the personal ones — My Work and Awaiting Review — where
   * the question is "who is looking at my work", and an optional reviewer very much is.
   */
  blockingOnly?: boolean
}) {
  const { t } = useTranslation()
  const all = outstandingReviewers(reviewers)
  const outstanding = blockingOnly ? all.filter((r) => r.isMandatory) : all
  if (outstanding.length === 0) return null

  return (
    <span className="waiting-on muted" data-testid={testId}>
      {t('reviewers.waitingOn')}{' '}
      {outstanding.map((r, i) => (
        <span key={r.userId} data-testid={`${testId}-${r.userId}`}>
          {i > 0 && <span aria-hidden="true">, </span>}
          {r.name ?? '—'}
          {r.isMandatory && (
            <span className="reviewer-required-badge" data-testid={`${testId}-required-${r.userId}`}>
              {' '}{t('reviewers.requiredMark')}
            </span>
          )}
          {/* ADR-0089 d.12: an optional reviewer is here because they have not ANSWERED. Said
              in those words, so it is not read as an approval the task is waiting for. */}
          {reviewerRole(r, reviewers) === 'optional' && (
            <span className="reviewer-unanswered-badge" data-testid={`${testId}-unanswered-${r.userId}`}>
              {' '}{t('reviewers.noAnswerMark')}
            </span>
          )}
          {/* ADR-0061 d.11. A deactivated reviewer's approval is never coming — they cannot sign
              in. If they are also MANDATORY the task can never complete, because the arithmetic
              waits for them. Marked here rather than removed: silently dropping a reviewer from
              work in progress is the class of quiet change this whole ADR exists to stop. */}
          {!r.isActive && (
            <span
              className="cell-warn"
              title={t(r.isMandatory ? 'reviewers.inactiveBlocking' : 'reviewers.inactiveHint')}
              data-testid={`${testId}-inactive-${r.userId}`}
            >
              {' '}⚠ {t('reviewers.inactive')}
            </span>
          )}
        </span>
      ))}
    </span>
  )
}
