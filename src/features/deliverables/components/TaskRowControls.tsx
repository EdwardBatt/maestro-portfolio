import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { ConfirmDialog } from '../../../components/ConfirmDialog'
import { WaitingOn } from '../../../components/WaitingOn'
import { formatIraqDateTime } from '../../../lib/time/iraq'
import { translateScheduleWarning } from '../../../lib/bookings/schedule-outcome'
import {
  fetchCancelImpact,
  useAssignableUsers,
  useCancelSubTask,
  useDeliverable,
  useRemoveSubTask,
  useRequestChangesSubTask,
  useReviewers,
  type SubTaskRow,
} from '../api/deliverables-api'
import { usePendingInputs, useRequirementCandidates, useTaskDependencies } from '../api/requirements-api'
import { failed, type Banner } from '../DeliverablesPage'
import { RequiredInput } from './RequiredInput'
import { ReinstateDialog } from './ReinstateDialog'
import { ReopenDialog } from './ReopenDialog'
import { reopenDoneText } from '../lib/reopen-text'
import { Modal } from '../../../components/Modal'
import { ReviewPanel } from '../ReviewPanel'
import { TaskReviewThread } from '../TaskReviewThread'
import { ReviewActions } from './ReviewActions'

/**
 * The task-list row's own controls, beside the one task editor on the task page (I74 fix-up). When
 * the row (DeliverableDetail, `onlyTaskId`) gave way to `TaskEditorInline` (ADR-0140 d.1) the editor
 * carried every DETAIL of the task — but not the row's status changes (Request changes, Re-open),
 * cancel/reinstate, or the Required input cell. They come back here with the behaviour and the test
 * ids the row had; the database still decides reach and names who can when it refuses.
 */
export function TaskRowControls({
  deliverableId,
  taskId,
  canReview,
  onBanner,
}: {
  deliverableId: string
  taskId: string
  canReview: boolean
  onBanner: (b: Banner) => void
}) {
  const { t } = useTranslation()
  const detail = useDeliverable(deliverableId)
  const users = useAssignableUsers()
  const reviewerOptions = useReviewers()
  const cancelTask = useCancelSubTask()
  const removeTask = useRemoveSubTask()
  const requestChanges = useRequestChangesSubTask()
  const dependencies = useTaskDependencies(deliverableId)
  const candidates = useRequirementCandidates(deliverableId)
  const pendingInputs = usePendingInputs(deliverableId)
  const outstandingInputs = useMemo(
    () => (pendingInputs.data ?? []).filter((i) => i.satisfiedAt === null).map((i) => i.description),
    [pendingInputs.data],
  )
  // I52.12 / ADR-0112 d.1: the task's own review — opened from its row, as the old row opened it (I74 fix-up).
  const [reviewOpen, setReviewOpen] = useState(false)
  const [pendingCancel, setPendingCancel] = useState<
    { id: string; title: string; assigneeName: string | null; dueAt: string | null; bookings: number; isPlan: boolean; isAdhoc: boolean } | null
  >(null)
  const [pendingReinstate, setPendingReinstate] = useState<SubTaskRow | null>(null)
  const [reopening, setReopening] = useState<SubTaskRow | null>(null)

  const d = detail.data
  const s = d?.subTasks.find((x) => x.id === taskId)
  if (!d || !s) return null

  const fail = (err: unknown) => onBanner(failed(err, t('deliverables.actionFailed'), t('deliverables.outsideReach'), t))

  // ADR-0068 d.2/d.3: what it costs is fetched first, because the wording depends on it.
  async function armCancel(task: SubTaskRow) {
    try {
      const impact = await fetchCancelImpact(task.id)
      setPendingCancel({
        id: task.id, title: task.title, assigneeName: task.assigneeName, dueAt: task.dueAt,
        bookings: impact.bookings, isPlan: impact.isPlan, isAdhoc: impact.isAdhoc,
      })
    } catch (err) {
      fail(err)
    }
  }

  function onConfirmCancel() {
    const pending = pendingCancel
    if (!pending) return
    setPendingCancel(null)
    if (pending.isPlan) {
      removeTask.mutate(pending.id, { onSuccess: () => onBanner({ kind: 'ok', text: t('deliverables.removedDeleted') }), onError: fail })
      return
    }
    cancelTask.mutate(pending.id, { onSuccess: () => onBanner({ kind: 'ok', text: t('deliverables.cancelledOk') }), onError: fail })
  }

  return (
    <div className="task-row-controls" data-testid={`subtask-row-${s.id}`}>
      <div className="task-row-controls-line">
        <span className={`state-badge state-${s.status}`} data-testid={`subtask-status-${s.id}`}>
          {t(`deliverables.subStatus.${s.status}`)}
        </span>
        {s.status === 'review' && <WaitingOn reviewers={s.reviewers} blockingOnly testId={`subtask-waiting-on-${s.id}`} />}
        <span className="row-actions">
          {/* Edward, 27 Sep: always shown, greyed out until there is something to look at. */}
          {s.status !== 'cancelled' && (() => {
            const reviewable = s.status === 'review' || s.status === 'done' || (s.revisionRound ?? 0) > 0
            return (
              <Button variant="link" size="sm" disabled={!reviewable}
                title={reviewable ? undefined : t('deliverables.openReviewNothingYet')}
                onClick={() => setReviewOpen(true)} data-testid={`subtask-review-open-${s.id}`}>
                {t('deliverables.openReview')}
              </Button>
            )
          })()}
          {canReview && s.status === 'review' && (
            <Button
              variant="secondary" tone="caution" size="sm" icon="undo"
              disabled={requestChanges.isPending}
              onClick={() => requestChanges.mutate(s.id, { onSuccess: () => onBanner({ kind: 'ok', text: t('deliverables.changesRequested') }), onError: fail })}
              data-testid={`subtask-request-changes-${s.id}`}
            >
              {t('deliverables.action.requestChanges')}
            </Button>
          )}
          {s.status === 'done' && (
            <Button variant="secondary" size="sm" icon="undo" onClick={() => setReopening(s)} data-testid={`subtask-reopen-${s.id}`}>
              {t('reopen.action')}
            </Button>
          )}
          {s.status !== 'cancelled' ? (
            <Button variant="link" className="danger" disabled={cancelTask.isPending} onClick={() => void armCancel(s)} data-testid={`subtask-cancel-${s.id}`}>
              {t('deliverables.cancelTask')}
            </Button>
          ) : (
            <Button variant="secondary" size="sm" icon="undo" onClick={() => setPendingReinstate(s)} data-testid={`subtask-reinstate-${s.id}`}>
              {t('deliverables.reinstateTask')}
            </Button>
          )}
        </span>
      </div>
      <div className="task-row-controls-input">
        <span className="task-row-controls-label">{t('requirements.column')}</span>
        <RequiredInput
          subTaskId={s.id}
          deliverableId={deliverableId}
          dependencies={dependencies.data ?? []}
          candidates={candidates.data ?? []}
          externalInputs={outstandingInputs}
          canManage
        />
      </div>

      {pendingReinstate && (
        <ReinstateDialog
          task={pendingReinstate}
          users={users.data ?? []}
          reviewerOptions={reviewerOptions.data ?? []}
          onDone={(r) => {
            if (r.scheduleWarning) return onBanner({ kind: 'error', text: translateScheduleWarning(t, r.scheduleWarning)! })
            onBanner({ kind: 'ok', text: t(r.assigned ? 'deliverables.reinstate.assignedOk' : 'deliverables.reinstatedOk') })
          }}
          onFailed={fail}
          onClose={() => setPendingReinstate(null)}
        />
      )}
      {reviewOpen && (
        <Modal onClose={() => setReviewOpen(false)} card={false} testId={`subtask-review-modal-${s.id}`}>
          <div className="dialog dialog-wide" role="dialog" aria-modal="true" aria-label={s.title}>
            <h2>{s.title}</h2>
            <p className="muted">
              {t('awaitingReview.by', { name: s.assigneeName ?? '—' })}
              {' · '}
              <span className={`state-badge state-${s.status}`}>{t(`deliverables.subStatus.${s.status}`)}</span>
            </p>
            {s.reviewMode === 'manual' ? (
              <TaskReviewThread subTaskId={s.id} role={canReview ? 'reviewer' : 'maker'} />
            ) : (
              <ReviewPanel deliverableId={deliverableId} subTaskId={s.id} isReadOnly={!canReview || s.status !== 'review'} allowUpload={false} showRules />
            )}
            <div className="dialog-actions">
              <Button variant="secondary" onClick={() => setReviewOpen(false)} data-testid={`subtask-review-close-${s.id}`}>
                {t('awaitingReview.close')}
              </Button>
            </div>
            {canReview && s.status === 'review' && (
              <ReviewActions subTaskId={s.id} reviewers={s.reviewers ?? []} onSettled={() => setReviewOpen(false)} testIdPrefix="subtask-review" />
            )}
          </div>
        </Modal>
      )}
      {reopening && (
        <ReopenDialog
          deliverableId={deliverableId}
          deliverableName={d.name}
          taskId={reopening.id}
          onDone={(r) => onBanner({ kind: 'ok', text: reopenDoneText(t, r) })}
          onFailed={(err) => onBanner(failed(err, t('reopen.failed'), t('reopen.outsideReach'), t))}
          onClose={() => setReopening(null)}
        />
      )}
      {pendingCancel && (
        <ConfirmDialog
          title={t(pendingCancel.isPlan ? 'deliverables.confirmRemoveTitle' : 'deliverables.confirmCancelTitle')}
          message={t(pendingCancel.isPlan ? 'deliverables.confirmRemoveBody' : 'deliverables.confirmCancelBody', { title: pendingCancel.title })}
          detail={
            pendingCancel.isPlan
              ? [t('deliverables.confirmRemoveNothingLost')]
              : [
                  pendingCancel.assigneeName
                    ? t('deliverables.confirmCancelAssignee', { name: pendingCancel.assigneeName })
                    : t('deliverables.confirmCancelUnassigned'),
                  pendingCancel.dueAt
                    ? t('deliverables.confirmCancelDue', { date: formatIraqDateTime(pendingCancel.dueAt) })
                    : t('deliverables.confirmCancelNoDue'),
                  t('deliverables.confirmCancelBookings', { n: pendingCancel.bookings }),
                  t(pendingCancel.isAdhoc ? 'deliverables.confirmCancelAdhocFinal' : 'deliverables.confirmCancelUndo'),
                ]
          }
          confirmLabel={t(pendingCancel.isPlan ? 'deliverables.remove' : 'deliverables.cancelTask')}
          busy={cancelTask.isPending || removeTask.isPending}
          onConfirm={onConfirmCancel}
          onCancel={() => setPendingCancel(null)}
          testId="subtask-cancel-confirm"
        />
      )}
    </div>
  )
}
