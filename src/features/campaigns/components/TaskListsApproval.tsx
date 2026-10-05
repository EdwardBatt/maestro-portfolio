import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { InfoTip } from '../../../components/InfoTip'
import { formatIraqDateTime } from '../../../lib/time/iraq'
import { useApproveDeliverableTasks, type CampaignTask } from '../../deliverables/api/deliverables-api'
import { PieceTasks } from './PieceTasks'

/**
 * **Task lists to approve** — the second gate, on the department's tab (ADR-0100 d.2/d.9).
 *
 * When the campaign is approved, each piece's owner is told the work is theirs (the
 * `campaign_approved` mail) and must accept its task list before any of it can be assigned. This
 * is where they do it. Edward, 23 Sep: *"The deliverable owner is typically going to be one .. max
 * 2 people per department, they can review all tasks for all deliverables on one page … then they
 * can approve all or selected ones."*
 *
 * IN THE WIZARD'S LOOK (Edward, 24 Sep: *"needs to follow the same style as the UI we are
 * implementing"*). The same groups as The work step — a card per workstream, its colour bar, its
 * department and size — and the same rows: a tick, the code and name, the owner, and the task
 * list itself one press away, in order, with each task's hours. The owner is being asked to agree
 * to that list; showing only a count would ask them to agree to something they cannot see.
 *
 * Partial is the state to design for: some of a department's work can be ready and some not, so
 * every row says where it stands — approved and when, waiting on whom, or nothing to approve yet.
 *
 * The department BRIEF is not here. It is retired (ADR-0100 d.6): the legacy record is kept where a
 * campaign has one, but nothing on this tab asks for one to be written.
 */
export interface ApprovableDeliverable {
  id: string
  name: string
  /** I56.9. Null on work created before codes existed. */
  code?: string | null
  /** ADR-0099 d.1: its group, or null. */
  workstreamId?: string | null
  /** Null until its owner accepts it. */
  tasksApprovedAt: string | null
  ownerName: string | null
  /** How many live tasks are on the list. */
  taskCount: number
  /** The list itself, in order. Absent where the caller did not read it. */
  tasks?: Pick<CampaignTask, 'id' | 'title' | 'hours'>[]
  /** The server's answer (`can_approve_tasks`): the owner, the department's leads, Traffic and the Power Admin. */
  canApprove: boolean
  /** The viewer owns it — "Approve all mine" takes only these (Edward, 5 Oct, A). */
  isMine: boolean
}

export interface ApprovalGroup {
  id: string
  name: string
  departmentName: string | null
}

export function TaskListsApproval({
  deliverables,
  groups = [],
  testId,
  onError,
  canEdit = false,
}: {
  deliverables: ApprovableDeliverable[]
  /** The campaign's workstreams. Empty draws one list with no group headers (ADR-0101 d.9). */
  groups?: readonly ApprovalGroup[]
  testId: string
  onError?: (message: string) => void
  /**
   * I57.45: whether this viewer may change the lists (`project_tasks:manage`, the same grant the
   * Deliverables page edits under; the database still decides reach). A list waiting for approval
   * then opens as an editor — review, edit, approve (ADR-0090).
   */
  canEdit?: boolean
}) {
  const { t } = useTranslation()
  const approve = useApproveDeliverableTasks()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<Set<string>>(new Set())

  const waiting = deliverables.filter((d) => d.tasksApprovedAt == null)
  // "Approve all mine" takes only what this person OWNS (Edward, 5 Oct, A): since I74.51 a lead may approve a
  // colleague's list too, but that is a deliberate tick or the list's own Approve, never a side effect of the bulk
  // button. Ticks stay on whatever the server lets her answer — offering one it would refuse is a dead end.
  const mine = waiting.filter((d) => d.isMine && d.canApprove && d.taskCount > 0)
  const answerable = waiting.filter((d) => d.canApprove && d.taskCount > 0)

  const flip = (set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) =>
    set((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const run = (ids: string[]) => {
    for (const id of ids) {
      approve.mutate(id, { onError: (e) => onError?.(e instanceof Error ? e.message : String(e)) })
    }
    setPicked(new Set())
  }

  if (deliverables.length === 0) return null

  // A stable order — by code, then name. The caller's rows are read in creation order, and pieces
  // made in one statement share a timestamp, so approving one reshuffled the list under the cursor.
  const ordered = [...deliverables].sort(
    (a, b) => (a.code ?? '').localeCompare(b.code ?? '', undefined, { numeric: true }) || a.name.localeCompare(b.name),
  )

  const known = new Set(groups.map((g) => g.id))
  const sections: { id: string; name: string | null; departmentName: string | null; items: ApprovableDeliverable[] }[] =
    groups.length === 0
      ? [{ id: '__all__', name: null, departmentName: null, items: ordered }]
      : [
          ...groups
            .map((g) => ({ ...g, items: ordered.filter((d) => d.workstreamId === g.id) }))
            .filter((g) => g.items.length > 0),
          ...(() => {
            const loose = ordered.filter((d) => !d.workstreamId || !known.has(d.workstreamId))
            return loose.length > 0 ? [{ id: '__ungrouped__', name: t('taskLists.ungrouped'), departmentName: null, items: loose }] : []
          })(),
        ]

  return (
    <section className="task-lists" data-testid={testId}>
      <header className="task-lists-head">
        <h3 className="task-lists-title">{t('taskLists.heading')}</h3>
        <InfoTip label={t('taskLists.tipLabel')} lines={[t('taskLists.intro')]} testId={`${testId}-tip`} />
        <span className="proposal-gap" />
        {waiting.length === 0 ? (
          <span className="state-badge state-approved" data-testid={`${testId}-all-done`}>
            {t('taskLists.allAccepted')}
          </span>
        ) : (
          <span className="task-lists-waiting" data-testid={`${testId}-waiting`}>
            {t('taskLists.waiting', { count: waiting.length, total: deliverables.length })}
          </span>
        )}
      </header>

      {sections.map((sec) => (
        <div className="proposal-group task-lists-group" key={sec.id} data-testid={`${testId}-group-${sec.id}`}>
          {sec.name && (
            <div className="proposal-group-head">
              <span className="proposal-group-bar" aria-hidden="true" />
              <span className="proposal-group-title">{sec.name}</span>
              {sec.departmentName && <span className="proposal-chip">{sec.departmentName}</span>}
              <span className="proposal-gap" />
              <span className="proposal-group-actions">{t('taskLists.groupCount', { count: sec.items.length })}</span>
            </div>
          )}
          <ul className="proposal-rows">
            {sec.items.map((d) => {
              const accepted = d.tasksApprovedAt != null
              const pickable = !accepted && d.canApprove && d.taskCount > 0
              const title = d.code ? `${d.code} · ${d.name}` : d.name
              const expanded = open.has(d.id)
              // An approved list is read here; a waiting one is edited here — by whoever may approve it
              // AND holds the task grant, so nobody is offered an edit the database would refuse.
              const editable = canEdit && !accepted && d.canApprove
              return (
                <li key={d.id} className="task-lists-item" data-testid={`${testId}-row-${d.id}`}>
                  <div className="proposal-row task-lists-row">
                    <span className="task-lists-pick">
                      {pickable && (
                        <input
                          type="checkbox"
                          checked={picked.has(d.id)}
                          onChange={() => flip(setPicked, d.id)}
                          aria-label={t('taskLists.pickLabel', { name: title })}
                          data-testid={`${testId}-pick-${d.id}`}
                        />
                      )}
                    </span>
                    <span className="task-lists-text">
                      <span className="proposal-row-name">{title}</span>
                      <span className="proposal-row-meta task-lists-owner">{t('taskLists.owner', { name: d.ownerName ?? '—' })}</span>
                    </span>
                    {(d.taskCount > 0 || editable) && (
                      <button
                        type="button"
                        className="proposal-link task-lists-toggle"
                        aria-expanded={expanded}
                        onClick={() => flip(setOpen, d.id)}
                        data-testid={`${testId}-toggle-${d.id}`}
                      >
                        {editable
                          ? d.taskCount > 0 ? t('taskLists.edit.toggle', { n: d.taskCount }) : t('taskLists.edit.toggleEmpty')
                          : t('taskLists.taskCount', { count: d.taskCount })}{' '}
                        {expanded ? '▴' : '▾'}
                      </button>
                    )}
                    <span className="task-lists-state">
                      {accepted ? (
                        <span className="state-badge state-approved" data-testid={`${testId}-accepted-${d.id}`}>
                          {t('taskLists.acceptedOn', { when: formatIraqDateTime(d.tasksApprovedAt!) })}
                        </span>
                      ) : d.taskCount === 0 ? (
                        // Nothing to accept yet — said plainly rather than a disabled button somebody
                        // presses twice and wonders about.
                        <span className="muted" data-testid={`${testId}-empty-${d.id}`}>{t('taskLists.noTasksYet')}</span>
                      ) : d.canApprove ? (
                        <Button
                          variant="primary"
                          tone="approve"
                          size="sm"
                          busy={approve.isPending}
                          onClick={() => run([d.id])}
                          data-testid={`${testId}-approve-${d.id}`}
                        >
                          {t('taskLists.approveOne')}
                        </Button>
                      ) : (
                        // Not theirs to answer — and the row says whose, so nobody has to ask.
                        <span className="muted" data-testid={`${testId}-not-yours-${d.id}`}>
                          {t('taskLists.waitingOn', { name: d.ownerName ?? '—' })}
                        </span>
                      )}
                    </span>
                  </div>
                  {/* ADR-0140 (I74.12): the owner reviews and edits the suggested list with the piece panel's own task
                      list — rename, hours, waits-for, remove with undo, add your own, and each row's pencil opening the
                      one task editor (every detail). It replaced the deliverables page's task table (27 Sep), so the
                      list is edited the same way wherever it is met. */}
                  {expanded && editable && (
                    <div className="task-lists-table" data-testid={`${testId}-editor-${d.id}`}>
                      <PieceTasks
                        deliverableId={d.id}
                        markTaskId={null}
                        embedded
                        onBanner={(b) => { if (b.kind === 'error') onError?.(b.text) }}
                        testId={`${testId}-tasks-${d.id}`}
                      />
                    </div>
                  )}
                  {expanded && !editable && (
                    <ol className="task-lists-tasks" data-testid={`${testId}-tasks-${d.id}`}>
                      {(d.tasks ?? []).map((task) => (
                        <li key={task.id}>
                          <span className="task-lists-task">{task.title}</span>
                          {task.hours != null && <span className="task-lists-hours">{t('taskLists.hours', { hours: task.hours })}</span>}
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}

      {answerable.length > 0 && (
        <div className="task-lists-actions">
          {mine.length > 0 && (
            <Button variant="primary" tone="approve" busy={approve.isPending} onClick={() => run(mine.map((d) => d.id))} data-testid={`${testId}-approve-all`}>
              {t('taskLists.approveAll', { count: mine.length })}
            </Button>
          )}
          <Button
            variant="primary"
            tone="approve"
            disabled={picked.size === 0}
            busy={approve.isPending}
            onClick={() => run([...picked])}
            data-testid={`${testId}-approve-picked`}
          >
            {t('taskLists.approvePicked', { count: picked.size })}
          </Button>
        </div>
      )}
    </section>
  )
}
