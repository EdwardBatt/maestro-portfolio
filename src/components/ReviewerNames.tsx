import { useTranslation } from 'react-i18next'
import { reviewerRole, sortReviewers, type TaskReviewer } from '../lib/reviewers/task-reviewers'

/**
 * Everyone appointed to review a task, each marked with their standing (ADR-0043 d.5, ADR-0089 d.12).
 *
 * Distinct from `WaitingOn`, which answers a different question — *who is holding this up* — and so
 * names only the reviewers still outstanding. Both were on the schedule's task modal, and between
 * them the required mark was invisible: this line printed
 * `reviewers.map(r => r.name).join(', ')` with no mark at all, and `WaitingOn` drops anybody who has
 * already acted. So a reviewer marked required on `/deliverables` read as an ordinary one on
 * `/schedule`, and once they had approved there was nowhere on that screen saying they had ever
 * been required (`I42.3`).
 *
 * ADR-0089 adds the optional reviewer's state, because "not answered" and "not approved" are now
 * two different things: a required reviewer is *(required)*, and *approved* once they have; an
 * optional one is *(no answer yet)* until they answer, then *(no comment)* or *(feedback left)*.
 *
 * Presentation only (AGENTS.md §4). Renders a dash for an empty list rather than nothing: on a task
 * modal, blank means "not loaded" and a dash means "nobody", and those must not look the same.
 */
export function ReviewerNames({
  reviewers,
  testId = 'reviewer-names',
}: {
  reviewers: TaskReviewer[]
  testId?: string
}) {
  const { t } = useTranslation()
  if (reviewers.length === 0) return <>—</>

  return (
    <>
      {sortReviewers(reviewers).map((r, i) => {
        const role = reviewerRole(r, reviewers)
        return (
          <span key={r.userId} data-testid={`${testId}-${r.userId}`}>
            {i > 0 && <span aria-hidden="true">, </span>}
            {r.name ?? '—'}
            {r.isMandatory && (
              <span className="reviewer-required-badge" data-testid={`${testId}-required-${r.userId}`}>
                {' '}{t('reviewers.requiredMark')}
              </span>
            )}
            {role === 'required' && r.approvedAt != null && (
              <span className="muted" data-testid={`${testId}-approved-${r.userId}`}>
                {' '}{t('reviewers.approvedMark')}
              </span>
            )}
            {role === 'optional' && (
              <span
                className={r.respondedAt == null ? 'reviewer-unanswered-badge' : 'muted'}
                data-testid={`${testId}-${r.respondedAt == null ? 'unanswered' : 'answered'}-${r.userId}`}
              >
                {' '}
                {r.respondedAt == null
                  ? t('reviewers.noAnswerMark')
                  : t(r.response === 'feedback' ? 'reviewers.answeredFeedbackMark' : 'reviewers.answeredNoCommentMark')}
              </span>
            )}
            {/* ADR-0061 d.11, same reasoning as WaitingOn: somebody deactivated after they were
                appointed keeps the appointment, and if they are mandatory the task can never
                complete. Marked wherever reviewers are shown, never silently dropped. */}
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
        )
      })}
    </>
  )
}
