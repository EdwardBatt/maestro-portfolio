import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { hasRequiredReviewer, type ReviewerAppointment } from '../lib/reviewers/task-reviewers'
import { IconButton } from './Button'

/**
 * Choose who reviews a task, and which of them cannot be skipped (ADR-0043 d.5).
 *
 * Shared rather than feature-private because two surfaces appoint reviewers — the Deliverables
 * breakdown form and the schedule's task edit modal — and ADR-0042 already settled that two surfaces
 * over one fact must go through one writer or they drift apart in what they permit.
 *
 * ADR-0089 d.3: every task with reviewers has at least one REQUIRED one, and the database refuses
 * several with none marked. This picker makes that unreachable from a screen: the first person
 * added is required when nobody is, and the last required mark cannot be unticked — to move it from
 * A to B, tick B, and then A can be unticked. The database's message is the safety net, not the
 * experience.
 *
 * Presentation only (AGENTS.md §2). It knows nothing about permissions: the caller passes the
 * eligible people (`users_holding_permission('reviews','moderate')`), and the database refuses
 * anything else regardless of what this renders.
 */
export function ReviewerPicker({
  options,
  value,
  onChange,
  excludeUserId = null,
  disabled = false,
  testId = 'reviewer-picker',
  selectClassName,
}: {
  /** Eligible reviewers — people who hold reviews:moderate. */
  options: { id: string; name: string }[]
  value: ReviewerAppointment[]
  onChange: (next: ReviewerAppointment[]) => void
  /** The task's assignee. Nobody reviews their own work, so they are never offered. */
  excludeUserId?: string | null
  disabled?: boolean
  testId?: string
  /** Presentation only: the add-a-reviewer select's class, so a window can give it its own field look (e.g. `sc-select`). */
  selectClassName?: string
}) {
  const { t } = useTranslation()
  const chosen = new Set(value.map((v) => v.userId))
  const available = options.filter((o) => o.id !== excludeUserId && !chosen.has(o.id))
  const nameOf = (id: string) => options.find((o) => o.id === id)?.name ?? id
  const requiredCount = value.filter((v) => v.isMandatory).length

  // Excluding the assignee from the OPTIONS is only half of it: pick a reviewer, then make that
  // same person the assignee, and a stale appointment is still sitting in the form. It would be
  // submitted and refused by the database with a message about a choice the person can no longer
  // see. Drop it here instead, when the assignee changes.
  useEffect(() => {
    if (excludeUserId != null && value.some((v) => v.userId === excludeUserId)) {
      onChange(value.filter((v) => v.userId !== excludeUserId))
    }
  }, [excludeUserId, value, onChange])

  function add(userId: string) {
    if (!userId || chosen.has(userId)) return
    // ADR-0089 d.3: the first person added is the required one when nobody is yet. Somebody added
    // to a list that already has a required reviewer is optional, as before.
    onChange([...value, { userId, isMandatory: !hasRequiredReviewer(value) }])
  }
  function remove(userId: string) {
    onChange(value.filter((v) => v.userId !== userId))
  }
  function toggleMandatory(userId: string) {
    const target = value.find((v) => v.userId === userId)
    // The last required mark cannot be unticked (ADR-0089 d.3): tick the other person first.
    if (target?.isMandatory && requiredCount <= 1) return
    onChange(value.map((v) => (v.userId === userId ? { ...v, isMandatory: !v.isMandatory } : v)))
  }

  return (
    <div className="reviewer-picker" data-testid={testId}>
      <select
        // Not a multi-select box: chosen reviewers need a per-person mandatory toggle next to them,
        // which a <select multiple> has nowhere to put. Pick one at a time, each becoming a row.
        value=""
        className={selectClassName}
        disabled={disabled || available.length === 0}
        aria-label={t('reviewers.label')}
        data-testid={`${testId}-add`}
        onChange={(e) => { add(e.target.value); e.currentTarget.value = '' }}
      >
        <option value="">{t('reviewers.pick')}</option>
        {available.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>

      {value.length === 0 ? (
        <p className="muted" data-testid={`${testId}-empty`}>{t('reviewers.none')}</p>
      ) : (
        <ul className="reviewer-list">
          {value.map((v) => {
            const lastRequired = v.isMandatory && requiredCount <= 1
            return (
              <li key={v.userId} data-testid={`${testId}-row-${v.userId}`}>
                <span className="reviewer-name">{nameOf(v.userId)}</span>
                <label
                  className="reviewer-mandatory"
                  title={t(lastRequired ? 'reviewers.lastRequiredHint' : 'reviewers.mandatoryHint')}
                >
                  <input
                    type="checkbox"
                    checked={v.isMandatory}
                    disabled={disabled || lastRequired}
                    data-testid={`${testId}-mandatory-${v.userId}`}
                    onChange={() => toggleMandatory(v.userId)}
                  />
                  {t('reviewers.mandatory')}
                </label>
                <IconButton
                  icon="close"
                  danger
                  size="sm"
                  disabled={disabled}
                  label={t('reviewers.remove', { name: nameOf(v.userId) })}
                  data-testid={`${testId}-remove-${v.userId}`}
                  onClick={() => remove(v.userId)}
                />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
