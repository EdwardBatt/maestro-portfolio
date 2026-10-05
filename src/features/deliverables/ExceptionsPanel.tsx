import { useTranslation } from 'react-i18next'
import { useAuth } from '../../app/auth-context'
import { usePermissions } from '../../app/permissions'
import { useMyDrafts } from '../campaigns/api/campaign-api'
import { useAwaitingMyReview, useMyAssignedWork } from './api/deliverables-api'
import { usePendingApprovals } from './api/pending-approvals-api'
import { isDueToday, isOverdue, openWork } from './lib/my-work'

/**
 * The exceptions strip on My Work: what needs attention, at a glance, above the task lists.
 *
 * Every count is over OPEN work only — the same `openWork` predicate the lists use, so the strip and
 * the lists can never disagree. (Counting the raw query would include completed tasks, which the
 * Completed panel needs but a "tasks assigned" figure must not: it would only ever grow.)
 *
 * The counts deliberately overlap. A task can be overdue *and* in review; this is a triage summary,
 * not a partition, and forcing precedence would hide the second fact.
 *
 * I66.2 (Edward, 29 Sep): three approval exceptions, only what waits on ME — the briefs I started and have
 * not sent, the briefs waiting for my approval, and the task lists I may approve (`my_pending_approvals`, the
 * same rows as Needs you's cards). The two brief figures show to whoever may raise work (`projects:manage`,
 * the grant the database asks of both); nobody else can ever owe one.
 */
export function ExceptionsPanel() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const myId = session?.user.id ?? null

  const { can } = usePermissions()
  const raisesWork = can('projects:manage')

  const work = useMyAssignedWork(myId)
  const awaiting = useAwaitingMyReview(myId)
  const approvals = usePendingApprovals(myId != null)
  const drafts = useMyDrafts(raisesWork ? myId : null)
  const owed = (kind: 'campaign' | 'task_list') => (approvals.data ?? []).filter((a) => a.kind === kind).length

  const mine = openWork(work.data ?? [])
  const stats = [
    { key: 'assigned', tone: '', value: mine.length },
    { key: 'overdue', tone: 'error-text', value: mine.filter((it) => isOverdue(it.dueAt)).length },
    { key: 'dueToday', tone: 'warning-text', value: mine.filter((it) => isDueToday(it.dueAt)).length },
    // ADR-0043 d.8: these were ONE number, "in review", adding work I submitted to work waiting on
    // ME to review. They are opposite problems — one is waiting on somebody else, one is waiting on
    // me — and a reviewer holding up three mandatory sign-offs should see that as its own figure
    // rather than folded into a total they cannot act on.
    { key: 'inReview', tone: 'info-text', value: mine.filter((it) => it.status === 'review').length },
    { key: 'toReview', tone: 'warning-text', value: awaiting.data?.length ?? 0 },
    { key: 'notStarted', tone: '', value: mine.filter((it) => it.status === 'todo').length },
    ...(raisesWork
      ? [
          { key: 'unfinishedBriefs', tone: 'warning-text', value: drafts.data?.length ?? 0 },
          { key: 'briefsAwaiting', tone: 'warning-text', value: owed('campaign') },
        ]
      : []),
    { key: 'taskListsNotApproved', tone: 'warning-text', value: owed('task_list') },
  ]

  return (
    <div className="exceptions-panel" data-testid="exceptions-panel">
      {stats.map((s) => (
        <div className="exception-stat" key={s.key} data-testid={`exception-${s.key}`}>
          <span className={`stat-value ${s.tone}`.trim()}>{s.value}</span>
          <span className="stat-label">{t(`exceptions.${s.key}`)}</span>
        </div>
      ))}
    </div>
  )
}
