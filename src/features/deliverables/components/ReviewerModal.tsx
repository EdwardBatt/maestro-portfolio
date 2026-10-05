import { useTranslation } from 'react-i18next'
import { Modal } from '../../../components/Modal'
import { Button } from '../../../components/Button'
import { ReviewerNames } from '../../../components/ReviewerNames'
import { WaitingOn } from '../../../components/WaitingOn'
import type { AwaitingReviewItem } from '../api/deliverables-api'
import { ReviewPanel } from '../ReviewPanel'
import { TaskReviewThread } from '../TaskReviewThread'
import { ReviewActions } from './ReviewActions'

/**
 * The reviewer's inline review + sign-off (ADR-0035, I11.3) — opened by a Review card in "Needs you"
 * (I59.10, D2). Moved here unchanged from the retired Awaiting-review panel, test ids included.
 *
 * The full ReviewPanel (versions, playback, anchored comments) with the reviewer's actions
 * (`ReviewActions` — one implementation, shared with the ad-hoc panel). Request changes reopens the
 * sub-task — the DB requires an unresolved review comment as the change note, so a bare click
 * without a comment surfaces that as an error, which is shown.
 *
 * ADR-0089 d.12: the modal names EVERYONE with their standing, because this is where the required
 * reviewer decides whether to wait — "not answered" and "not approved" have to read differently.
 *
 * ADR-0038: approving THIS task does not depend on the parent deliverable's state.
 */
export function ReviewerModal({ item, onClose }: { item: AwaitingReviewItem; onClose: () => void }) {
  const { t } = useTranslation()

  return (
    <Modal onClose={onClose} card={false} testId={`awaiting-review-modal-${item.subTaskId}`}>
      <div className="dialog dialog-wide" role="dialog" aria-modal="true">
        <h2>{item.deliverableName ?? item.title}</h2>
        <p className="muted">
          {/* I53.15: which task, on which project, before who did it. */}
          <span data-testid={`awaiting-review-modal-context-${item.subTaskId}`}>
            {item.title}{item.campaignName ? ` · ${item.campaignName}` : ''}{' · '}
          </span>
          {t('awaitingReview.by', { name: item.assigneeName ?? '—' })}
          {' · '}
          <WaitingOn reviewers={item.reviewers} testId={`awaiting-review-modal-waiting-on-${item.subTaskId}`} />
        </p>
        <p className="muted" data-testid={`awaiting-review-modal-reviewers-${item.subTaskId}`}>
          {t('reviewers.heading')}{': '}
          <ReviewerNames reviewers={item.reviewers} testId={`awaiting-review-modal-reviewer-${item.subTaskId}`} />
        </p>

        {/* ADR-0059 d.9: a MANUAL task has no version chain and never will, so the reviewer reads
            the maker's account and writes back in the same thread. A standalone task (ADR-0034) has
            no deliverable, so no version chain to review. */}
        {item.reviewMode === 'manual' ? (
          <TaskReviewThread subTaskId={item.subTaskId} role="reviewer" />
        ) : (
          item.deliverableId && <ReviewPanel deliverableId={item.deliverableId} subTaskId={item.subTaskId} showRules />
        )}

        <div className="dialog-actions">
          <Button variant="secondary" onClick={onClose}>
            {t('awaitingReview.close')}
          </Button>
        </div>
        <ReviewActions
          subTaskId={item.subTaskId}
          reviewers={item.reviewers}
          onSettled={onClose}
          testIdPrefix="awaiting-review"
        />
      </div>
    </Modal>
  )
}
