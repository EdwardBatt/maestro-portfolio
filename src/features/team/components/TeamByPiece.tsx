import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { formatIraqShortDate } from '../../../lib/time/iraq'
import type { ScheduleResource } from '../../schedule/api/schedule-api'
import type { TeamTask } from '../api/team-view-api'
import { applyPieceFilter, barState, durationSince, isLate, sortByPiece, taskLabel, timeInState, type PieceFilter } from '../lib/team-view'

/**
 * By piece (Figma L3c): every task on the team — piece · task, with whom, where it is, its hours,
 * how long it has been where it is ("For", real time — I59 E2), its due — sorted by what bites first (unassigned and late, then by due). Move and Assign open the
 * Schedule filtered, because assigning stays there (Q31, ADR-0105 d.5).
 */

export interface TeamByPieceProps {
  tasks: readonly TeamTask[]
  /** userId → the person's resource, for the name and the Schedule filter */
  byUser: ReadonlyMap<string, ScheduleResource>
  filter: PieceFilter
  atRiskTaskIds: ReadonlySet<string>
  departmentId: string | null
  weekIso: string
  now: number
}

export function TeamByPiece(props: TeamByPieceProps) {
  const { t, i18n } = useTranslation()
  const loc = i18n.language === 'ar' ? 'ar' : 'en'
  const rows = sortByPiece(applyPieceFilter(props.tasks, props.filter, props.atRiskTaskIds), props.now)

  const where = (task: TeamTask) => {
    if (!task.assigneeId) return 'unassigned'
    const s = barState(task)
    if (s) return s
    return task.status === 'in_progress' ? 'inProgress' : 'notStarted'
  }

  /** "For": time in the current state, real time (E2); a dash when that state has no clock. */
  const forText = (task: TeamTask) => {
    const s = timeInState(task)
    if (!s?.since) return '—'
    const d = durationSince(s.since, props.now)
    const duration =
      d.unit === 'underHour' ? t('teamView.piece.duration.underHour') : t(`teamView.piece.duration.${d.unit}`, { count: d.count })
    return t(`teamView.piece.since.${s.state}`, { duration })
  }

  const moveHref = (task: TeamTask, who: ScheduleResource | undefined) => {
    const q = new URLSearchParams()
    if (task.campaignId) {
      q.set('view', 'project')
      q.set('campaign', task.campaignId)
    }
    if (who) q.set('who', who.name)
    q.set('on', props.weekIso)
    return `/schedule?${q.toString()}`
  }
  const assignHref = (task: TeamTask) => {
    const q = new URLSearchParams()
    const dept = task.departmentId ?? props.departmentId
    if (dept) q.set('dept', dept)
    q.set('on', props.weekIso)
    return `/schedule?${q.toString()}`
  }

  if (rows.length === 0) return <p className="muted" data-testid="team-by-piece-empty">{t('teamView.piece.empty')}</p>

  return (
    <table className="data-table tv-pieces" data-testid="team-by-piece">
      <thead>
        <tr>
          <th>{t('teamView.piece.piece')}</th>
          <th>{t('teamView.piece.with')}</th>
          <th>{t('teamView.piece.where')}</th>
          <th>{t('teamView.piece.for')}</th>
          <th>{t('teamView.piece.due')}</th>
          <th><span className="sr-only">{t('teamView.piece.action')}</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((task) => {
          const who = task.assigneeId ? props.byUser.get(task.assigneeId) : undefined
          const late = isLate(task, null, props.now)
          const w = where(task)
          const due = task.committedDueAt ?? task.dueAt
          return (
            <tr key={task.id} className={task.assigneeId == null || late ? 'tv-piece-urgent' : ''} data-testid={`team-piece-${task.id}`}>
              <td>{taskLabel(task)}</td>
              <td className={task.assigneeId ? '' : 'tv-nobody'}>{who ? who.name : t('teamView.piece.nobody')}</td>
              <td><span className={`tv-where tv-where-${w}`}>{t(`teamView.piece.state.${w}`)}</span></td>
              <td data-testid={`team-piece-for-${task.id}`}>{forText(task)}</td>
              <td className={late ? 'tv-late' : ''}>{due ? formatIraqShortDate(due, loc) : '—'}</td>
              <td>
                {task.assigneeId ? (
                  <Button variant="link" to={moveHref(task, who)} data-testid={`team-piece-move-${task.id}`}>
                    {t('teamView.piece.move')}
                  </Button>
                ) : (
                  <Button variant="link" to={assignHref(task)} data-testid={`team-piece-assign-${task.id}`}>
                    {t('teamView.piece.assign')}
                  </Button>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
