import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { useAuth } from '../../../app/auth-context'
import {
  approvalCompletesTask,
  approvalWaitsFor,
  sendBackWaitsFor,
  reviewerRole,
  type TaskReviewer,
} from '../../../lib/reviewers/task-reviewers'
import {
  useApproveSubTask,
  useMyResponseKind,
  useRequestChangesSubTask,
  useRespondSubTask,
} from '../api/deliverables-api'

/** ADR-0089 d.7: `public.sub_task_approve` refuses the completing approval with this code. */
const WAITING_FOR_ANSWERS = '55089'

/**
 * The reviewer's own actions on a task in review (ADR-0043, ADR-0089 d.5–d.7).
 *
 * One implementation behind two doors — the reviewer inbox on My Work and the ad-hoc panel on the
 * Deliverables page (I40.27) — so they cannot offer different things. What is offered follows
 * from the kind of reviewer the signed-in person is on THIS task:
 *
 *   * a REQUIRED reviewer gets *Request changes* and *Approve*. Approve is withheld — with a
 *     message naming exactly who has not answered — while their approval would complete the task
 *     and an optional reviewer is still silent. There is no *Approve anyway*: Edward chose the hard
 *     wait, and the way through is whoever manages the task removing the silent reviewer by name.
 *     Request changes is never withheld: an assignee getting a real problem earlier is right.
 *   * an OPTIONAL reviewer gets *Request changes* and *Done* — reading *Done — feedback left* or
 *     *Done — no comment*, whichever the server would record, because that is what it records.
 *
 * Presentation only: the database decides all of it (`sub_task_approve`, `sub_task_respond`); this
 * keeps the screen from offering a press the database will refuse, and turns the one refusal it
 * cannot anticipate (a race) into the same message.
 */
export function ReviewActions({
  subTaskId,
  reviewers,
  onSettled,
  testIdPrefix = 'review-actions',
}: {
  subTaskId: string
  reviewers: TaskReviewer[]
  /** Called after any action succeeds — the modal closes on it. */
  onSettled?: () => void
  testIdPrefix?: string
}) {
  const { t } = useTranslation()
  const { session } = useAuth()
  const me = session?.user.id ?? null
  const approve = useApproveSubTask()
  const respond = useRespondSubTask()
  const requestChanges = useRequestChangesSubTask()
  const [error, setError] = useState<string | null>(null)

  const mine = reviewers.find((r) => r.userId === me) ?? null
  // Somebody not appointed is refused by the database whatever is rendered; the callers already
  // hide these controls from them. A lone unmarked reviewer is the required one (d.2).
  const role = mine ? reviewerRole(mine, reviewers) : 'required'
  const kind = useMyResponseKind(role === 'optional' ? subTaskId : null)
  const waitsFor = approvalWaitsFor(reviewers, me)
  // ADR-0089 addendum d.14: the send-back is held by the same missing answers (minus the caller's).
  const sendBackWaits = sendBackWaitsFor(reviewers, me)
  // ADR-0043 d.5: does MY approval finish this, or does the work still owe somebody else's? The
  // database decides; this only changes the label, so a reviewer is not told they signed something
  // off when a mandatory colleague has not looked at it yet.
  const completes = approvalCompletesTask(reviewers, me)
  const busy = approve.isPending || respond.isPending || requestChanges.isPending
  const owed = waitsFor.length > 0 ? waitsFor : sendBackWaits
  const waitingMessage = owed.length > 0
    ? t('awaitingReview.waitingForAnswers', { names: owed.map((r) => r.name ?? '—').join(', ') })
    : null

  function fail(err: unknown) {
    const e = err as { code?: string; message?: string } | null
    // The one refusal the screen cannot anticipate: an optional reviewer appointed after this
    // rendered. Same words as the proactive message, so it never reads as a different rule.
    if (e?.code === WAITING_FOR_ANSWERS) {
      setError(waitingMessage ?? e.message ?? t('awaitingReview.actionFailed'))
      return
    }
    setError(e?.message || t('awaitingReview.actionFailed'))
  }

  function onApprove() {
    setError(null)
    approve.mutate(subTaskId, { onSuccess: onSettled, onError: fail })
  }
  function onRespond() {
    setError(null)
    respond.mutate(subTaskId, { onSuccess: onSettled, onError: fail })
  }
  function onRequestChanges() {
    setError(null)
    requestChanges.mutate(subTaskId, { onSuccess: onSettled, onError: fail })
  }

  return (
    <>
      {waitingMessage && (
        <p className="muted" data-testid={`${testIdPrefix}-waiting-for-answers-${subTaskId}`}>
          {waitingMessage}
        </p>
      )}
      {error && (
        <p className="form-error" data-testid={`${testIdPrefix}-error-${subTaskId}`}>{error}</p>
      )}
      <div className="dialog-actions review-actions">
        <Button
          type="button"
          variant="secondary"
          tone="caution"
          icon="undo"
          busy={requestChanges.isPending}
          disabled={busy || sendBackWaits.length > 0}
          data-testid={`${testIdPrefix}-request-changes-${subTaskId}`}
          onClick={onRequestChanges}
        >
          {t('deliverables.action.requestChanges')}
        </Button>
        {role === 'optional' ? (
          <Button
            type="button"
            variant="primary"
            busy={respond.isPending}
            disabled={busy}
            data-testid={`${testIdPrefix}-respond-${subTaskId}`}
            onClick={onRespond}
          >
            {respond.isPending
              ? t('awaitingReview.answering')
              : kind.data === 'feedback'
                ? t('awaitingReview.doneFeedback')
                : t('awaitingReview.doneNoComment')}
          </Button>
        ) : (
          <Button
            type="button"
            variant="arrow"
            tone="approve"
            busy={approve.isPending}
            // ADR-0089 d.7: withheld, not merely relabelled, while the answers are outstanding.
            disabled={busy || waitsFor.length > 0}
            data-testid={`${testIdPrefix}-approve-${subTaskId}`}
            onClick={onApprove}
          >
            {approve.isPending
              ? t('awaitingReview.approving')
              : completes
                ? t('awaitingReview.approve')
                : t('awaitingReview.approveMyPart')}
          </Button>
        )}
      </div>
    </>
  )
}
