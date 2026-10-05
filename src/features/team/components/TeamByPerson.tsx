import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { workstreamHue } from '../../../lib/campaigns/workstream-hue'
import { isWorkingDay, localDayOf } from '../../../lib/capacity/working-week.ts'
import type { ScheduleBooking, ScheduleResource } from '../../schedule/api/schedule-api'
import type { TeamTask } from '../api/team-view-api'
import type { TeamLoadPerson } from '../api/team-api'
import { freeDaysOf, personLine, taskLabel, type Section, type WeekDay } from '../lib/team-view'

/**
 * By person (Figma L3b): each person's week — their %, their tasks with the day, and one plain line
 * (at the ceiling · waiting on an input · nothing booked · the days they are free). The name opens
 * the Schedule filtered to them, on this week — assigning and moving stay there (Q31).
 */
export interface TeamByPersonProps {
  sections: readonly Section[]
  days: readonly WeekDay[]
  tasks: readonly TeamTask[]
  bookings: readonly ScheduleBooking[]
  resources: ReadonlyMap<string, ScheduleResource>
  titles: ReadonlyMap<string, string>
  weekIso: string
}

export function TeamByPerson(props: TeamByPersonProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'ar' ? 'ar' : 'en-GB'
  const weekday = (epoch: number) => new Date(epoch).toLocaleDateString(locale, { weekday: 'short', timeZone: 'UTC' })
  const list = (items: string[]) => new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items)

  const card = (p: TeamLoadPerson) => {
    const r = props.resources.get(p.id)
    const mine = props.tasks.filter((x) => r?.userId != null && x.assigneeId === r.userId)
    const dayOf = (task: TeamTask) => {
      const b = props.bookings
        .filter((x) => x.subTaskId === task.id && x.resourceId === p.id)
        .sort((a, c) => a.start - c.start)[0]
      if (b) return weekday(b.start)
      return task.dueAt ? weekday(Date.parse(task.dueAt)) : null
    }
    const free = freeDaysOf(p.id, props.bookings, props.days, (d) =>
      r?.office ? isWorkingDay(localDayOf(d.epoch + 43_200_000, r.office.timezone), r.office) : true,
    )
    const line = personLine(p, mine, free.map((d) => weekday(d.epoch)))
    const title = r?.userId ? props.titles.get(r.userId) : undefined
    return (
      <article key={p.id} className={`tv-card${p.level !== 'ok' ? ' tv-card-over' : ''}${p.utilPct === 0 ? ' tv-card-idle' : ''}`} data-testid={`team-person-${p.id}`}>
        <header className="tv-card-head">
          <span className={`tv-avatar${p.level !== 'ok' ? ' tv-avatar-over' : ''}`} aria-hidden="true" />
          <Button
            variant="link"
            to={`/schedule?who=${encodeURIComponent(p.name)}&on=${props.weekIso}`}
            data-testid={`team-person-open-${p.id}`}
          >
            {p.name}
          </Button>
          {title && <span className="muted tv-role">{title}</span>}
          <span className={`tv-pct${p.level !== 'ok' ? ' tv-pct-over' : ''}`}>{p.utilPct}%</span>
        </header>
        <div className="load-track" aria-hidden="true">
          <div className={`load-fill ${p.level}`} style={{ inlineSize: `${Math.min(p.utilPct, 100)}%` }} />
        </div>
        {mine.length > 0 && (
          <ul className="tv-card-tasks">
            {mine.map((task) => (
              <li key={task.id}>
                <i className="tv-dot" data-hue={task.workstreamId ? workstreamHue(task.workstreamId) : undefined} aria-hidden="true" />
                <span className="tv-card-task">{taskLabel(task)}</span>
                <span className="muted">{dayOf(task) ?? '—'}</span>
              </li>
            ))}
          </ul>
        )}
        {line && (
          <p className={line.kind === 'ceiling' ? 'tv-line tv-line-over' : 'tv-line muted'} data-testid={`team-person-line-${p.id}`}>
            {line.kind === 'ceiling'
              ? t('teamView.person.ceiling')
              : line.kind === 'waiting'
                ? t('teamView.person.waiting', { what: line.on })
                : line.kind === 'nothing'
                  ? t('teamView.person.nothing')
                  : t('teamView.person.free', { days: list(line.days) })}
          </p>
        )}
      </article>
    )
  }

  return (
    <div className="tv-people" data-testid="team-by-person">
      {props.sections.map((s) => (
        <section key={s.key} className="tv-people-section">
          {s.kind !== 'all' && (
            <h2 className="tv-group">
              {s.kind === 'none' ? t('teamView.noTeam') : s.label}
              <span className="muted"> · {t('teamView.pct', { pct: s.pct })}</span>
            </h2>
          )}
          <div className="tv-cards">{s.people.map(card)}</div>
        </section>
      ))}
    </div>
  )
}
