import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { Modal } from '../../../components/Modal'
import { ReviewerPicker } from '../../../components/ReviewerPicker'
import { appointmentsOf, lacksRequiredReviewer, type ReviewerAppointment } from '../../../lib/reviewers/task-reviewers'
import { useReinstateSubTask, useUpsertSubTask, type ReviewerOption, type SubTaskRow } from '../api/deliverables-api'

/**
 * Reinstating a cancelled task asks "assign to whom?" in the same step (I52.7).
 *
 * Reinstate brings a task back with no assignee and no calendar (ADR-0068 d.5). Until 17 Sep the
 * only person told was the one who had lost it — who cannot assign anything. Edward: *"the
 * reinstatement requires action… it cannot be assigned by a team member."* The person pressing
 * Reinstate holds the authority to cancel, which is the authority to assign, so the picker opens
 * here and the task goes straight back onto somebody's calendar through the ordinary assignment
 * path — the assignee gets the ordinary *assigned* mail, nobody gets a "reinstated" one.
 *
 * *Reinstate unassigned* is still offered: the task comes back on the list and the leads in reach
 * and the deliverable's owner are told it needs assigning (`sub_task_reinstate` without
 * `p_assigning`).
 *
 * Naming an assignee means naming a reviewer (ADR-0089 d.3): the task's own reviewers are kept and
 * offered; a task that never had any is asked for one.
 */
export interface ReinstateDialogProps {
  task: SubTaskRow
  users: {
    id: string
    name: string
    departmentId: string | null
    teamId: string | null
  }[]
  reviewerOptions: ReviewerOption[]
  onDone: (r: { assigned: boolean; scheduleWarning?: string }) => void
  onFailed: (err: unknown) => void
  onClose: () => void
}

export function ReinstateDialog({ task, users, reviewerOptions, onDone, onFailed, onClose }: ReinstateDialogProps) {
  const { t } = useTranslation()
  const reinstate = useReinstateSubTask()
  const upsert = useUpsertSubTask()
  const [assignee, setAssignee] = useState('')
  const [reviewers, setReviewers] = useState<ReviewerAppointment[]>(() => appointmentsOf(task.reviewers))
  const [error, setError] = useState<string | null>(null)
  const busy = reinstate.isPending || upsert.isPending

  function fail(err: unknown) {
    // A refusal is worded on the page's banner (ADR-0092), so the dialog steps aside.
    onFailed(err)
    onClose()
  }

  function reinstateUnassigned() {
    setError(null)
    reinstate.mutate(
      { id: task.id },
      {
        onSuccess: () => {
          onDone({ assigned: false })
          onClose()
        },
        onError: fail,
      },
    )
  }

  function reinstateAndAssign(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!assignee) return setError(t('deliverables.reinstate.assigneeRequired'))
    if (reviewers.length === 0) return setError(t('schedule.fieldError.reviewer'))
    if (lacksRequiredReviewer(reviewers)) return setError(t('reviewers.oneRequired'))
    const u = users.find((x) => x.id === assignee)
    // Two calls, in order: back to `todo` (told nobody — `p_assigning`), then the assignment, which
    // books the calendar and notifies the assignee exactly as any assignment does.
    reinstate.mutate(
      { id: task.id, assigning: true },
      {
        onError: fail,
        onSuccess: () => {
          upsert.mutate(
            {
              id: task.id,
              deliverableId: task.deliverableId,
              title: task.title,
              assigneeId: assignee,
              reviewers,
              departmentId: u?.departmentId ?? null,
              teamId: u?.teamId ?? null,
            },
            {
              onSuccess: (r) => {
                onDone({ assigned: true, scheduleWarning: r.scheduleWarning })
                onClose()
              },
              onError: fail,
            },
          )
        },
      },
    )
  }

  return (
    <Modal onClose={onClose} card={false}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('deliverables.reinstate.title')}
        onSubmit={reinstateAndAssign}
        data-testid="subtask-reinstate-form"
      >
        <h2>{t('deliverables.reinstate.title')}</h2>
        <p className="muted">{t('deliverables.reinstate.intro', { title: task.title })}</p>

        <label>
          <span>{t('schedule.assignee')}</span>
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            autoFocus
            data-testid="subtask-reinstate-assignee"
          >
            <option value="">{t('deliverables.reinstate.choose')}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>

        <div className="field">
          <span className="field-label">{t('reviewers.label')}</span>
          <ReviewerPicker
            options={reviewerOptions}
            value={reviewers}
            onChange={setReviewers}
            excludeUserId={assignee || null}
            testId="subtask-reinstate-reviewer"
          />
        </div>

        {error && (
          <p className="form-error" role="alert" data-testid="subtask-reinstate-error">
            {error}
          </p>
        )}

        <div className="dialog-actions">
          <Button
            variant="secondary"
            type="button"
            onClick={onClose}
            disabled={busy}
            data-testid="subtask-reinstate-cancel"
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="secondary"
            type="button"
            onClick={reinstateUnassigned}
            busy={reinstate.isPending && !upsert.isPending}
            disabled={busy}
            data-testid="subtask-reinstate-unassigned"
          >
            {t('deliverables.reinstate.unassigned')}
          </Button>
          <Button variant="primary" type="submit" busy={busy} disabled={busy} data-testid="subtask-reinstate-assign">
            {t('deliverables.reinstate.assign')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
