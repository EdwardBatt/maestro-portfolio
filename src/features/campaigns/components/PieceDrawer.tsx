import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { statusBadgeOf } from '../lib/piece-status'
import { Button, IconButton } from '../../../components/Button'
import { Modal } from '../../../components/Modal'
import { ProgressBar, ProgressTip } from '../../../components/DeliverableProgress'
import { formatIraqShortDate } from '../../../lib/time/iraq'
import { isOverdue } from '../../../lib/campaigns/status'
import type { CampaignTask, DeliverableRow } from '../../deliverables/api/deliverables-api'
import { formatPlanDay } from '../../../lib/timing/plan-back'
import { requestLine, type ChangeRequestRow } from '../lib/change-request'

/**
 * A piece, opened (Figma CG-04, I57.16) — the drawer every view of a campaign opens: the Grid's
 * Open, a Board card, a Timeline bar, a Season-map square, a Where-is-everything row.
 *
 * Edward, 24 Sep: every view shows the PIECE and its OWNER; the breakdown by task is here. **"The
 * whole story" IS the piece's task list** — each task with its own assignee, status and date, in the
 * order they are worked — because the tasks under one piece can be several people's. The frame's
 * single "With Zubaida · for 2 days" line becomes the owner: the lead accountable for the piece.
 *
 * ADR-0132 (I68.2): for those who may edit the piece, `editor` (the `PiecePanel`) takes the story's place —
 * the piece's fields and its task list are edited here, and the Deliverables window is no longer where that
 * happens ("Open in Deliverables" is gone, d.8). Everyone else reads the story as before. Assigning stays on
 * the Schedule and the Team page (Edward).
 *
 * ADR-0110 (I59.23): the newest change request on the piece is shown with where it stands —
 * "Change requested · waiting on Fadia", pushed back (her words and date), declined (the reason),
 * or its outcome. Answering it is Needs you's.
 */
export interface DrawerBriefLine {
  label: string
  value: string
}

export function PieceDrawer({
  piece,
  phaseName,
  workstreamName,
  brief,
  onEdit,
  onReopen = null,
  changeRequest = null,
  editor = null,
  markTaskId = null,
  amendCount = 0,
  onClose,
  testId = 'piece-drawer',
}: {
  piece: DeliverableRow
  phaseName: string | null
  workstreamName: string | null
  /** The campaign brief's lines the piece is made from — the frame's "The brief". */
  brief: readonly DrawerBriefLine[]
  /** Offered to those who may edit the piece (CG-E1); null for everyone else. */
  onEdit: (() => void) | null
  /** ADR-0103: re-open this finished piece — offered only to those who may (the page's mirror). */
  onReopen?: (() => void) | null
  /** ADR-0110: the newest change request on the piece (`useCampaignChangeRequests`), or null. */
  changeRequest?: ChangeRequestRow | null
  /** ADR-0132 d.2: for those who may edit the piece, the editor (`PiecePanel`) replaces the read-only story. */
  editor?: ReactNode
  /** The task the person came from (`?task=`), marked in the read-only story too. */
  markTaskId?: string | null
  /** ADR-0142 d.3 (I74.20): the piece's client amendments — "Amend 2". */
  amendCount?: number
  onClose: () => void
  testId?: string
}) {
  const { t } = useTranslation()
  const tasks = (piece.taskList ?? []).filter((x) => x.status !== 'cancelled')
  const late = isOverdue(piece, Date.now())
  const sub = [piece.typeName, piece.channel, phaseName, workstreamName].filter(Boolean).join(' · ')

  return (
    <Modal onClose={onClose} testId={`${testId}-modal`} labelledById={`${testId}-title`} card={false}>
      <aside className={`ws-drawer piece-drawer${editor ? ' is-editor' : ''}`} data-testid={testId}>
        <div className="ws-drawer-body">
          {/* I67.6: the ✕ is the first thing the dialog focuses — never the status pill, whose card would open over the name. */}
          <IconButton icon="close" size="sm" className="piece-drawer-x" label={t('campaigns.drawer.close')} onClick={onClose} data-testid={`${testId}-x`} />
          <div className="ws-drawer-chips">
            {piece.code && <span className="tag tag-accent" data-testid={`${testId}-code`}>{piece.code}</span>}
            <ProgressTip
              progress={piece.progress}
              status={statusBadgeOf(piece).approved ? t('campaigns.board.columns.approved') : t(`deliverables.phase.${piece.progress.phase}`)}
              testId={`progress-tip-${piece.id}`}
            >
              <span className={`state-badge state-${statusBadgeOf(piece).key}`} data-testid={`${testId}-status`}>
                {statusBadgeOf(piece).approved ? t('campaigns.board.columns.approved') : t(`deliverables.phase.${piece.progress.phase}`)}
              </span>
            </ProgressTip>
            <ProgressBar progress={piece.progress} testId={`progress-bar-${piece.id}`} />
            {amendCount > 0 && (
              <span className="tag tag-amend" data-testid={`${testId}-amend`}>{t('amendments.badge', { count: amendCount })}</span>
            )}
            {piece.dueAt && (
              <span className={`tag ${late ? 'tag-breach' : 'tag-neutral'}`} data-testid={`${testId}-due`}>
                {t(late ? 'campaigns.drawer.wasDue' : 'campaigns.drawer.due', { date: formatIraqShortDate(piece.dueAt) })}
              </span>
            )}
          </div>

          <h2 id={`${testId}-title`} className="ws-drawer-title">{piece.name}</h2>
          {sub && <p className="ws-drawer-sub" data-testid={`${testId}-sub`}>{sub}</p>}

          <div className="piece-owner" data-testid={`${testId}-owner`}>
            <span className="piece-owner-name">
              {piece.ownerName
                ? t('campaigns.drawer.ownedBy', { name: piece.ownerName })
                : <span className="cell-warn">{t('campaigns.page.noOwner')}</span>}
            </span>
            {piece.discipline && <span className="muted"> · {piece.discipline}</span>}
          </div>

          {changeRequest && (
            <ChangeRequestNote request={changeRequest} ownerName={piece.ownerName} testId={`${testId}-change-request`} />
          )}

          {editor ?? (
          <section className="piece-story" aria-labelledby={`${testId}-story`}>
            <h3 id={`${testId}-story`} className="piece-section-title">{t('campaigns.drawer.story')}</h3>
            {tasks.length === 0 ? (
              <p className="muted" data-testid={`${testId}-no-tasks`}>{t('campaigns.drawer.noTasks')}</p>
            ) : (
              <ol className="piece-story-list" data-testid={`${testId}-tasks`}>
                {tasks.map((task) => (
                  <li key={task.id} className={`piece-story-step is-${task.status}${task.id === markTaskId ? ' is-marked' : ''}`} data-testid={`${testId}-task-${task.id}`}>
                    <span className="piece-story-dot" aria-hidden="true" />
                    <span className="piece-story-main">
                      <span className="piece-story-title">{task.title}</span>
                      <span className="piece-story-line" data-testid={`${testId}-task-line-${task.id}`}>
                        {taskLine(task, t)}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
          )}

          {brief.length > 0 && (
            <section className="piece-brief" aria-labelledby={`${testId}-brief`} data-testid={`${testId}-brief`}>
              <h3 id={`${testId}-brief`} className="piece-section-title">{t('campaigns.drawer.brief')}</h3>
              <dl>
                {brief.map((b) => (
                  <div key={b.label}>
                    <dt>{b.label}</dt>
                    <dd dir="auto">{b.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>

        <footer className="ws-drawer-foot">
          {onEdit && !editor && (
            <Button variant="secondary" icon="edit" onClick={onEdit} data-testid={`${testId}-edit`}>
              {t('campaigns.grid.edit')}
            </Button>
          )}
          {onReopen && (
            <Button variant="secondary" icon="undo" onClick={onReopen} data-testid={`${testId}-reopen`}>
              {t('reopen.action')}
            </Button>
          )}
          <Button variant="primary" onClick={onClose} data-testid={`${testId}-close`}>
            {t('campaigns.drawer.close')}
          </Button>
        </footer>
      </aside>
    </Modal>
  )
}

/** ADR-0110: where the piece's change request stands, in one line — and her words on a push-back. */
function ChangeRequestNote({ request, ownerName, testId }: { request: ChangeRequestRow; ownerName: string | null; testId: string }) {
  const { t, i18n } = useTranslation()
  const line = requestLine(request, ownerName)
  return (
    <section className={`piece-change-request is-${request.status}`} data-testid={testId} data-status={request.status}>
      <p className="piece-change-request-line" data-testid={`${testId}-line`}>{t(line.key, line.values)}</p>
      {request.status === 'pushed_back' && request.counterText && (
        <p className="piece-change-request-words" dir="auto" data-testid={`${testId}-counter`}>
          “{request.counterText}”
          {request.counterDate ? ` · ${t('changeRequest.counterDate', { date: formatPlanDay(request.counterDate, i18n.language === 'ar' ? 'ar' : 'en') })}` : ''}
        </p>
      )}
    </section>
  )
}

/** "Zubaida · In progress · due Wed 23" — who has it, where it is, and the date that matters. */
function taskLine(task: CampaignTask, t: (k: string, o?: Record<string, unknown>) => string): string {
  const who = task.assigneeName ?? t('campaigns.drawer.unassigned')
  const where = t(`deliverables.subStatus.${task.status}`)
  const when = task.status === 'done' || !task.dueAt ? null : t('campaigns.drawer.taskDue', { date: formatIraqShortDate(task.dueAt) })
  return [who, where, when].filter(Boolean).join(' · ')
}
