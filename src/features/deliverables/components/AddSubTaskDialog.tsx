import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { Modal } from '../../../components/Modal'
import { ReviewerPicker } from '../../../components/ReviewerPicker'
import { endOfWorkingDay } from '../../../lib/time/iraq'
import { REVIEW_MODES, reviewModeLabelKey, type ReviewMode } from '../../../lib/review/review-mode'
import { lacksRequiredReviewer, type ReviewerAppointment } from '../../../lib/reviewers/task-reviewers'
import { useUpsertSubTask, type ReviewerOption } from '../api/deliverables-api'
import { DateField } from '../../../components/DateField'

/**
 * Adding a task to a deliverable (I51.5).
 *
 * Was an eight-field row under the task table — every field live at once, none of them labelled,
 * Edward: *"the Add sub task row is a mess."* Now a button and this dialog. **The task name is the
 * only required field**; everything else is optional and says so. One rule survives from the row,
 * because it is the database's and not the form's: naming an assignee means naming a reviewer
 * (ADR-0089 d.3 — a live assigned task has somebody to review it). A task with no assignee saves
 * on its name alone.
 *
 * The field test ids are the row's, unchanged, so every spec that filled the row fills the dialog.
 */
export interface AddSubTaskDialogProps {
  deliverableId: string
  users: { id: string; name: string; departmentId: string | null; teamId: string | null }[]
  reviewerOptions: ReviewerOption[]
  slaProfiles: { id: string; name: string; turnaroundHours: number | null }[]
  onSaved: (r: { scheduleWarning?: string }) => void
  onFailed: (err: unknown) => void
  onClose: () => void
}

export function AddSubTaskDialog({
  deliverableId, users, reviewerOptions, slaProfiles, onSaved, onFailed, onClose,
}: AddSubTaskDialogProps) {
  const { t } = useTranslation()
  const upsert = useUpsertSubTask()
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState('')
  const [reviewers, setReviewers] = useState<ReviewerAppointment[]>([])
  const [hours, setHours] = useState('')
  const [slaProfileId, setSlaProfileId] = useState('')
  const [due, setDue] = useState('')
  const [reviewMode, setReviewMode] = useState<ReviewMode>('digital')
  const [error, setError] = useState<string | null>(null)

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!title.trim()) return setError(t('deliverables.addTask.nameRequired'))
    if (assignee && reviewers.length === 0) return setError(t('schedule.fieldError.reviewer'))
    if (lacksRequiredReviewer(reviewers)) return setError(t('reviewers.oneRequired'))
    // E11 (I59): a task is assigned only with its hours — said here, not left to the database.
    if (assignee && !(Number(hours) > 0)) return setError(t('deliverables.addTask.hoursRequired'))
    const u = users.find((x) => x.id === assignee)
    upsert.mutate(
      {
        deliverableId,
        title,
        assigneeId: assignee || null,
        reviewers,
        departmentId: u?.departmentId ?? null,
        teamId: u?.teamId ?? null,
        slaHours: hours ? Number(hours) : null,
        slaProfileId: slaProfileId || null,
        reviewMode,
        // ADR-0076 d.3: the DUE date is the close of that day; `startsAt` stays at its start.
        dueAt: due ? endOfWorkingDay(due).toISOString() : null,
        startsAt: due ? new Date(`${due}T00:00:00Z`).toISOString() : null,
      },
      {
        onSuccess: (r) => { onSaved(r); onClose() },
        // A refusal is worded on the page's banner (ADR-0092 — with Report where it is a failure), so
        // the dialog steps aside rather than sit over the sentence that explains it.
        onError: (err) => { onFailed(err); onClose() },
      },
    )
  }

  return (
    <Modal onClose={onClose} card={false}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('deliverables.addSubTask')}
        onSubmit={onSubmit}
        data-testid="subtask-add-form"
      >
        <h2>{t('deliverables.addSubTask')}</h2>
        <p className="muted">{t('deliverables.addTask.intro')}</p>

        <label>
          {t('deliverables.subTitle')}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            autoFocus
            data-testid="subtask-title"
          />
        </label>

        <label>
          <span>{t('schedule.assignee')} <span className="muted">{t('deliverables.addTask.optional')}</span></span>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} data-testid="subtask-assignee">
            <option value="">{t('deliverables.unassigned')}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </label>

        <div className="field">
          <span className="field-label">
            {t('reviewers.label')}{' '}
            <span className="muted">{assignee ? t('deliverables.addTask.reviewerNeeded') : t('deliverables.addTask.optional')}</span>
          </span>
          {/* Only people who can moderate reviews, never the assignee (no self-review). */}
          <ReviewerPicker
            options={reviewerOptions}
            value={reviewers}
            onChange={setReviewers}
            excludeUserId={assignee || null}
            testId="subtask-reviewer"
          />
        </div>

        <div className="dialog-row">
          <label>
            <span>{t('deliverables.slaProfileLabel')} <span className="muted">{t('deliverables.addTask.optional')}</span></span>
            <select value={slaProfileId} onChange={(e) => setSlaProfileId(e.target.value)} data-testid="subtask-sla-profile">
              <option value="">{t('deliverables.slaProfileInherit')}</option>
              {slaProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.turnaroundHours != null ? ` · ${t('deliverables.slaHoursValue', { hours: p.turnaroundHours })}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('deliverables.addTask.hours')} <span className="muted">{assignee ? t('deliverables.addTask.reviewerNeeded') : t('deliverables.addTask.optional')}</span></span>
            <input
              type="number" min="0.5" step="0.5" value={hours}
              onChange={(e) => setHours(e.target.value)}
              placeholder={t('deliverables.slaOverridePlaceholder')}
              data-testid="subtask-hours"
            />
          </label>
        </div>

        <div className="dialog-row">
          <label>
            <span>{t('deliverables.subDue')} <span className="muted">{t('deliverables.addTask.optional')}</span></span>
            <DateField value={due} onChange={(v) => setDue(v)} data-testid="subtask-due" />
          </label>
          {/* ADR-0059 d.4: a hand-added task has no workflow step to propose a mode, so the person
              says which it is; `digital` is the default because it is right for most work. */}
          <label>
            {t('reviewMode.column')}
            <select
              value={reviewMode}
              onChange={(e) => setReviewMode(e.target.value as ReviewMode)}
              data-testid="subtask-review-mode"
            >
              {REVIEW_MODES.map((m) => (
                <option key={m} value={m}>{t(reviewModeLabelKey(m))}</option>
              ))}
            </select>
          </label>
        </div>

        {error && <p className="form-error" role="alert" data-testid="subtask-add-error">{error}</p>}

        <div className="dialog-actions">
          <Button variant="secondary" type="button" onClick={onClose} data-testid="subtask-add-cancel">
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" busy={upsert.isPending} disabled={upsert.isPending} data-testid="subtask-add-submit">
            {t('deliverables.addSubTask')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
