import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { NoticeBox } from '../../../components/NoticeBox'
import { formatIraqDateTime } from '../../../lib/time/iraq'
import { useApproveDeliverableTasks, useTaskListReminder, useTaskListRules } from '../api/deliverables-api'

/**
 * "What could stop this" from the brief (SJ-03, ADR-0084 d.8), above an unapproved task list: a reminder to attach the
 * real dependency to the right task, dismissable, never itself a dependency (ADR-0090 d.7). Shared by the window below
 * and, since I71.7 (Edward, 1 Oct, A), the campaign page's piece panel — lost there when ADR-0132 d.8 retired the window.
 */
export function TaskListRiskReminder({
  campaignId,
  departmentId,
  canDismiss,
  testId = 'task-list-risk',
}: {
  campaignId: string | null
  departmentId: string | null
  canDismiss: boolean
  testId?: string
}) {
  const { t } = useTranslation()
  const reminder = useTaskListReminder(campaignId, departmentId)
  const [dismissed, setDismissed] = useState(false)
  // d.7: until the owner dismisses it. The dismissal is per visit — a reminder that could be silenced for good would be a
  // record, not a prompt.
  if (!reminder.data || dismissed) return null
  return (
    <div className="task-list-risk" data-testid={testId}>
      <NoticeBox testId={`${testId}-note`} lines={[`${t('intake.held.risk')} ${reminder.data}`, t('intake.held.riskHint')]} />
      {canDismiss && (
        <Button variant="secondary" onClick={() => setDismissed(true)} data-testid={`${testId}-dismiss`}>
          {t('notice.close')}
        </Button>
      )}
    </div>
  )
}

/**
 * The owner approves the task list before anyone is assigned (ADR-0090 d.7).
 *
 * Shown on a single job's deliverable only (d.6): the generated list is a proposal until the owner
 * says otherwise, and `tg_sub_task_assignment_gate` refuses assignment until they do (d.3). While
 * `tasks_approved_at` is null the block carries **Approve task list**; once stamped it carries the
 * stamp. Above the list, the "what could stop this" text from SJ-03 (ADR-0084 d.8) — a reminder
 * to attach the real dependency to the right task, dismissable, never itself a dependency.
 *
 * `canApprove` is the caller's reading of d.4 — the owner, or `deliverable_owner:manage` — used
 * only to decide whether to OFFER the button. The RPC decides, from the row and from grants.
 */
export function TaskListApproval({
  deliverableId,
  campaignId,
  departmentId,
  ownerName,
  tasksApprovedAt,
  approverName,
  canApprove,
  onError,
}: {
  deliverableId: string
  campaignId: string | null
  departmentId: string | null
  ownerName: string | null
  tasksApprovedAt: string | null
  approverName: string | null
  canApprove: boolean
  onError: (text: string) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'ar' ? 'ar' : 'en'
  const rules = useTaskListRules(campaignId, deliverableId)
  const approve = useApproveDeliverableTasks()

  return (
    <div data-testid="task-list-approval">
      {!tasksApprovedAt && <TaskListRiskReminder campaignId={campaignId} departmentId={departmentId} canDismiss={canApprove} />}

      {/* SJ-v3: the rules the job carries, locked — what the account manager saw, verbatim. */}
      {rules.data && rules.data.length > 0 && (
        <div className="task-list-rules" data-testid="task-list-rules">
          <span className="task-list-rules-head">{t('intake.review.rules')} <span className="tag tag-neutral">{t('intake.review.locked')}</span></span>
          <ul className="sj-rules">
            {rules.data.map((r, i) => (
              <li key={i} className="sj-rule">
                <span className={`rule-pill rule-${r.kind} is-on`}>{t(r.kind === 'do' ? 'clients.rules.do' : 'clients.rules.dont')}</span>
                <span className="sj-rule-text" dir="auto">{r.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="task-list-approval">
        {tasksApprovedAt ? (
          <span className="task-list-approval-stamp" data-testid="task-list-approved">
            {approverName
              ? t('intake.held.approvedBy', { name: approverName, when: formatIraqDateTime(tasksApprovedAt, locale) })
              : t('intake.held.approvedAt', { when: formatIraqDateTime(tasksApprovedAt, locale) })}
          </span>
        ) : canApprove ? (
          <>
            <Button
              type="button"
              variant="primary"
              tone="approve"
              busy={approve.isPending}
              onClick={() =>
                approve.mutate(deliverableId, {
                  onError: () => onError(t('intake.held.approveFailed')),
                })
              }
              data-testid="task-list-approve"
            >
              {t('intake.held.approveList')}
            </Button>
            <span className="muted">{t('intake.held.approveWhat')}</span>
          </>
        ) : (
          <span className="held-label" data-testid="task-list-held">
            {ownerName
              ? t('intake.held.awaitingReview', { owner: ownerName })
              : t('intake.held.awaitingReviewNoOwner')}
          </span>
        )}
      </div>
    </div>
  )
}
