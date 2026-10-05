import { useTranslation } from 'react-i18next'
import type { TeamLoadPerson } from '../api/team-api'
import { groupPct, loadSentence, type Section } from '../lib/team-view'
import { formatCalendarDay } from '../../../lib/time/iraq'

/**
 * Load (Figma L3d): this week and the next two — each person's % per week, the team's total per
 * week, and one plain sentence per week saying who is over and who is empty.
 */
export interface LoadWeek {
  /** the week's first day, for the column head */
  startIso: string
  /** every person in view that week, by resource id */
  people: ReadonlyMap<string, TeamLoadPerson>
}

export interface TeamLoadTabProps {
  sections: readonly Section[]
  weeks: readonly LoadWeek[]
}

export function TeamLoadTab({ sections, weeks }: TeamLoadTabProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'ar' ? 'ar' : 'en-GB'
  const list = (items: string[]) => new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items)
  const everyone = sections.flatMap((s) => s.people)
  const head = (iso: string, i: number) => {
    const d = formatCalendarDay(iso)
    return t(i === 0 ? 'teamView.load.thisWeek' : i === 1 ? 'teamView.load.next' : 'teamView.load.after', { date: d })
  }

  const sentence = (w: LoadWeek) => {
    const people = everyone.map((p) => w.people.get(p.id)).filter((p): p is TeamLoadPerson => p != null)
    const { over, empty } = loadSentence(people)
    if (over.length && empty.length) return t('teamView.load.both', { over: list(over), empty: list(empty) })
    if (over.length) return t('teamView.load.overOnly', { over: list(over) })
    if (empty.length) return t('teamView.load.emptyOnly', { empty: list(empty) })
    return t('teamView.load.neither')
  }

  const cell = (p: TeamLoadPerson | undefined) =>
    p ? (
      <div className={`load-cell load-cell-${p.level}${p.utilPct === 0 ? ' load-cell-zero' : ''}`}>
        <div className="load-track" aria-hidden="true">
          <div className={`load-fill ${p.level}`} style={{ inlineSize: `${Math.min(p.utilPct, 100)}%` }} />
        </div>
        <span className={`load-pct ${p.level}`}>{p.utilPct}%</span>
      </div>
    ) : (
      <span className="muted">—</span>
    )

  return (
    <table className="data-table tv-load" data-testid="team-load">
      <thead>
        <tr>
          <th>{t('team.person')}</th>
          {weeks.map((w, i) => <th key={w.startIso}>{head(w.startIso, i)}</th>)}
        </tr>
      </thead>
      <tbody>
        {sections.map((s) => [
          s.kind !== 'all' ? (
            <tr key={`${s.key}-head`} className="tv-load-group">
              <th colSpan={weeks.length + 1}>{s.kind === 'none' ? t('teamView.noTeam') : s.label}</th>
            </tr>
          ) : null,
          ...s.people.map((p) => (
            <tr key={p.id} data-testid={`team-load-row-${p.id}`}>
              <td>{p.name}</td>
              {weeks.map((w) => <td key={w.startIso}>{cell(w.people.get(p.id))}</td>)}
            </tr>
          )),
        ])}
        <tr className="tv-load-total">
          <th>{t('teamView.load.team')}</th>
          {weeks.map((w, i) => {
            const people = everyone.map((p) => w.people.get(p.id)).filter((p): p is TeamLoadPerson => p != null)
            return (
              <td key={w.startIso} data-testid={`team-load-total-${i}`}>
                <strong>{t('teamView.load.booked', { pct: groupPct(people) })}</strong>
                <span className="tv-load-sentence muted" data-testid={`team-load-sentence-${i}`}>{sentence(w)}</span>
              </td>
            )
          })}
        </tr>
      </tbody>
    </table>
  )
}
