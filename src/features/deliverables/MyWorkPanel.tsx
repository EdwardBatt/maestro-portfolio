import { formatIraqDate, formatIraqDateTime, iraqDay } from '../../lib/time/iraq'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/Button'
import { Link } from 'react-router'
import { useAuth } from '../../app/auth-context'
import { usePermissions } from '../../app/permissions'
import { useCampaignFolderRoot } from '../../lib/assets/folders'
import {
  useMyAssignedWork,
  useStartSubTask,
  useTaskListRules,
  type AssignedWorkItem,
} from './api/deliverables-api'
import { useCampaignReferencesFolderId, useReferenceFiles, useTaskBrief } from './api/task-page-api'
import { byDeadlineThenPriority, isFinished, listOf, type WorkList } from './lib/my-work'
import { isChangesRequested, taskPageHref } from './lib/needs-you'
import { WaitingOn } from '../../components/WaitingOn'
import { PriorityMark } from '../../components/PriorityMark'
import { sortReviewers, type TaskReviewer } from '../../lib/reviewers/task-reviewers'
import { useLatestExtensionByTask, type ExtensionEvent } from './api/extensions-api'
import { ExtensionControl } from './components/ExtensionControl'

/** Every reviewer on the task, mandatory first. Used once the task is no longer in review, where
 *  "who is outstanding" has stopped being the interesting question and "who reviews this" is. */
const reviewerNames = (rs: TaskReviewer[]) =>
  rs.length === 0 ? '—' : sortReviewers(rs).map((r) => r.name ?? '—').join(', ')

/**
 * Creative "My Work" (ADR-0024, I2.2 · fulfils M6.2), in the lists ADR-0105 d.1 names:
 * **Today · This week · Later · Waiting on someone else · Completed (folded)** (I59.10).
 *
 * ADR-0030 (I8): Start stays on the card, so a task can be started from the list. Everything else
 * the four row pop-ups did — the Deliverable and Review-feedback reads, Submit (upload + send), Ask
 * for more time — is on the task page (ADR-0105 d.3, I59.11), which **Open** goes to. The card
 * keeps every fact the row showed, and adds chips to the brief, the rules, the Library folder and
 * the reference set where each exists.
 */

const LISTS: { key: Exclude<WorkList, 'done'>; testId: string; headingKey: string }[] = [
  // Today shows only when it has something, like the other lists (plan View 2, "When not empty" —
  // I59 Track 6); the greeting above says when nothing is open.
  { key: 'today', testId: 'today-tasks-panel', headingKey: 'myWork.todayHeading' },
  { key: 'week', testId: 'week-tasks-panel', headingKey: 'needsYou.list.week' },
  { key: 'later', testId: 'later-tasks-panel', headingKey: 'needsYou.list.later' },
  { key: 'waiting', testId: 'waiting-tasks-panel', headingKey: 'needsYou.list.waiting' },
]

export function MyWorkLists() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const myId = session?.user.id ?? null
  const work = useMyAssignedWork(myId)

  const items = work.data ?? []
  const now = Date.now()
  const by = new Map<WorkList, AssignedWorkItem[]>()
  for (const it of items) {
    const l = listOf(it, now)
    by.set(l, [...(by.get(l) ?? []), it])
  }
  const open = items.filter((it) => !isFinished(it))
  // ADR-0088 d.10: the card carries the ask's pending / answered line. One read for every list.
  const extensions = useLatestExtensionByTask(open.map((it) => it.subTaskId))

  if (work.isLoading) return <p className="muted" data-testid="today-tasks-loading">…</p>
  if (work.isError) return <p className="form-error" data-testid="my-work-load-error">{t('myWork.loadFailed')}</p>

  const done = by.get('done') ?? []

  return (
    <>
      {LISTS.map((l) => {
        // The order the lists are read in (I54.15): deadline first, priority breaks the tie.
        const list = byDeadlineThenPriority(by.get(l.key) ?? [])
        if (list.length === 0) return null
        return (
          <section key={l.key} className={`my-work-panel ${l.key}-tasks-panel`} data-testid={l.testId}>
            <header className="schedule-bar">
              <h2>{t(l.headingKey)} <span className="muted">({list.length})</span></h2>
            </header>
            <ul className="my-work-list">
              {list.map((it) => (
                <TaskCard key={it.subTaskId} item={it} extension={extensions.data?.get(it.subTaskId)} />
              ))}
            </ul>
          </section>
        )
      })}

      {done.length > 0 && (
        // Folded shut (Q7): "Completed (4)" opens to the list it always was.
        <details className="my-work-panel completed-tasks-panel" data-testid="completed-tasks-panel">
          <summary className="schedule-bar" data-testid="completed-tasks-toggle">
            <h2>{t('myWork.completedHeading')} <span className="muted">({done.length})</span></h2>
          </summary>
          <ul className="my-work-list">
            {done.map((it) => <TaskCard key={it.subTaskId} item={it} />)}
          </ul>
        </details>
      )}
    </>
  )
}

/** One task on My Work (Figma M1). Every fact the row showed; Start; Open → the task page. */
export function TaskCard({ item, extension }: { item: AssignedWorkItem; extension?: ExtensionEvent }) {
  const { t } = useTranslation()
  const { session } = useAuth()
  const start = useStartSubTask()
  const changesRequested = isChangesRequested(item)
  const finished = isFinished(item)

  return (
    <li className="task-card" data-testid={`my-work-item-${item.subTaskId}`}>
      <div className="my-work-item">
        {/* Figma M1: the title, and the status and the due date as two shaded pills at its end. */}
        <div className="task-card-head">
          <span className="my-work-title">
            {item.title}
            {/* I54.15: beside the title — priority is read when deciding what to pick up. */}
            {item.priority && <PriorityMark priority={item.priority} testId={`my-work-priority-${item.subTaskId}`} />}
          </span>
          <span className="my-work-tail">
            {/* ADR-0059 d.9: only manual is marked — digital is what every task has always been. */}
            {item.reviewMode === 'manual' && (
              <span className="state-badge" data-testid={`my-work-review-mode-${item.subTaskId}`}>{t('reviewMode.manual')}</span>
            )}
            {/* The assignee's OWN task status, for every task (I73.1, Edward 2 Oct, A): a campaign task sent
                for review reads "In review", though its piece stays "In progress" until every task is done; a
                sent-back task reads "Changes requested". Only a piece approved as a whole says so instead. */}
            {item.deliverableState === 'approved' ? (
              <span className={`state-badge state-${item.deliverableState}`}>{t(`deliverables.state.${item.deliverableState}`)}</span>
            ) : (
              <span className={`state-badge ${changesRequested ? 'state-changes' : `task-status-${item.status}`}`} data-testid={`my-work-status-${item.subTaskId}`}>
                {changesRequested ? t('myWork.changesRequested') : t(`deliverables.subStatus.${item.status}`)}
              </span>
            )}
            {/* A task booked across several days shows its span (ADR-0076 d.6: Iraq days). */}
            <span className="my-work-due muted">
              {item.dueAt && item.startsAt && iraqDay(item.startsAt) !== iraqDay(item.dueAt)
                ? t('myWork.dueSpan', { from: iraqDay(item.startsAt), to: formatIraqDateTime(item.dueAt) })
                : item.dueAt
                  ? t('myWork.due', { date: formatIraqDateTime(item.dueAt) })
                  : t('myWork.noDue')}
            </span>
            {/* ADR-0088 d.1: the plan and the commitment, both, when they disagree. */}
            {item.committedDueAt && item.dueAt && iraqDay(item.committedDueAt) !== iraqDay(item.dueAt) && (
              <span className="my-work-due cell-warn" data-testid={`my-work-committed-${item.subTaskId}`}>
                {t('deadlineExtension.committed', { date: formatIraqDate(item.committedDueAt) })}
              </span>
            )}
          </span>
        </div>
        <span className="my-work-meta muted">
          {item.isAdhoc || !item.campaignId ? t('myWork.adhoc') : item.deliverableName}
          {item.campaignName ? ` · ${item.campaignName}` : ''}
          {item.discipline ? ` · ${item.discipline}` : ''}
          {/* One upload per round, so the round IS the version: V1 is round 1. */}
          {item.deliverableId ? ` · v${item.revisionRound + 1}` : ''}
        </span>
        {/* Who gave me this, and who decides whether it is done. ADR-0043 d.8: while in review this
            names the people who have NOT acted — "With Inas". */}
        <span className="my-work-people muted" data-testid={`my-work-people-${item.subTaskId}`}>
          {t('myWork.assignedBy', { name: item.assignerName ?? '—' })}
          {' · '}
          {item.status === 'review' && item.reviewers.some((r) => r.approvedAt == null) ? (
            <WaitingOn reviewers={item.reviewers} testId={`my-work-waiting-on-${item.subTaskId}`} />
          ) : (
            t('myWork.reviewedBy', { name: reviewerNames(item.reviewers) })
          )}
        </span>
      </div>

      {/* ADR-0088 d.10: the ask's pending line and then its answer stay on the card; asking and
          withdrawing are on the task page. */}
      {!finished && extension && (
        <ExtensionControl
          subTaskId={item.subTaskId}
          taskTitle={item.title}
          latest={extension}
          canRequest={false}
          viewerId={session?.user.id ?? null}
          committedDueAt={item.committedDueAt}
          deliverableDueAt={item.deliverableDueAt}
          goLiveAt={item.goLiveAt}
          lineOnly
          testId={`my-work-extension-${item.subTaskId}`}
        />
      )}

      {/* Figma M1: the chips, and the large Open at the end of the same row. */}
      <div className="task-card-foot">
        <TaskChips item={item} />

        <div className="my-work-actions">
          {item.status === 'todo' && item.deliverableState !== 'approved' && (
            <Button
              type="button"
              variant="secondary" size="sm"
              busy={start.isPending}
              data-testid={`my-work-start-${item.subTaskId}`}
              onClick={() => start.mutate(item.subTaskId)}
            >
              {start.isPending ? t('myWork.action.starting') : t('myWork.action.start')}
            </Button>
          )}
          <Button to={taskPageHref(item.subTaskId)} variant="primary" className="task-card-open" data-testid={`my-work-open-${item.subTaskId}`}>
            {t('taskPage.open')}
          </Button>
        </div>
      </div>

      {start.error && (
        <p className="form-error" data-testid={`my-work-error-${item.subTaskId}`}>
          {(start.error as Error).message || t('myWork.actionFailed')}
        </p>
      )}
    </li>
  )
}

/**
 * The card's chips (Figma M1): The brief · N rules · Library folder · Reference set — only the ones
 * that exist. The brief and the rules open their place on the task page; the folder and the set
 * open the Library for whoever may browse it (`assets:view`), and the task page's attachments for
 * everyone else. Each read is keyed by campaign, so cards of one campaign share it.
 */
function TaskChips({ item }: { item: AssignedWorkItem }) {
  const { t } = useTranslation()
  const { can } = usePermissions()
  const campaignId = item.campaignId
  const brief = useTaskBrief(campaignId, item.deliverableId ?? null)
  const rules = useTaskListRules(campaignId, item.deliverableId ?? null)
  const folder = useCampaignFolderRoot(campaignId)
  const refsFolder = useCampaignReferencesFolderId(campaignId)
  const refs = useReferenceFiles(refsFolder.data ?? null)

  const page = taskPageHref(item.subTaskId)
  const library = (folderId: string) =>
    item.clientId ? `/library?client=${encodeURIComponent(item.clientId)}&folder=${encodeURIComponent(folderId)}` : null
  const canBrowse = can('assets:view')
  const ruleCount = rules.data?.length ?? 0
  const folderHref = folder.data && canBrowse ? library(folder.data.id) : null
  const refCount = refs.data?.length ?? 0
  const refsHref = refsFolder.data && canBrowse ? library(refsFolder.data) : null

  const chips = [
    brief.data && brief.data.some((f) => f.value.trim()) && { id: 'brief', to: `${page}#task-brief`, label: t('taskPage.chip.brief') },
    ruleCount > 0 && { id: 'rules', to: `${page}#task-rules`, label: t('taskPage.chip.rules', { count: ruleCount }) },
    folderHref && { id: 'folder', to: folderHref, label: t('taskPage.chip.folder') },
    refCount > 0 && { id: 'references', to: refsHref ?? `${page}#task-attached`, label: t('taskPage.chip.references') },
  ].filter((c): c is { id: string; to: string; label: string } => !!c)

  if (chips.length === 0) return null
  return (
    <div className="task-chips" data-testid={`my-work-chips-${item.subTaskId}`}>
      {chips.map((c) => (
        <Link key={c.id} to={c.to} className={`task-chip task-chip-${c.id}`} data-testid={`my-work-chip-${c.id}-${item.subTaskId}`}>
          {c.label}
        </Link>
      ))}
    </div>
  )
}
