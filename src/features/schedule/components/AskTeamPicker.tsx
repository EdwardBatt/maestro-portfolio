import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePermissions } from '../../../app/permissions'
import { iraqDay } from '../../../lib/time/iraq'
import { isWorkingDay, localDayOf } from '../../../lib/capacity/working-week.ts'
import { blocksWholeDay, internalHoursOn } from '../../../lib/capacity/blocked-time.ts'
import { useAskAnswerers } from '../../../lib/task-asks/api'
import { useScheduleBlackouts, useScheduleBookings, useScheduleResources, type ScheduleResource } from '../api/schedule-api'
import { dayLoad, internalLoad } from '../lib/day-load.ts'
import { weekdayName } from '../lib/day-words.ts'
import { Avatar } from './Avatar'

/** What an ask names (ADR-0139 d.2): the team, one of its people or nobody ("the lead decides"), a note, the day. */
export interface AskChoice {
  teamId: string
  assigneeId: string | null
  note: string
  neededBy: string | null
}

const DAY = 86_400_000

/**
 * "Ask another team…" (mock-up 1, Figma SC-04 → SC-15): the team first, then — with their free hours on
 * the day asked for — one of its people, or "Anyone — Amira decides", the answerer named as the server
 * names them (`assignment_request_approvers`, ADR-0139 d.3). Self-sufficient: it reads the calendars
 * itself, so any surface that passes `onAsk` to the people picker gets the whole flow.
 *
 * The viewer's own team is not offered — that is booked, not asked (hint `book_directly`).
 */
export function AskTeamPicker({
  neededBy,
  onAsk,
  onBack,
  testId,
}: {
  neededBy: string | null
  onAsk: (choice: AskChoice) => void
  onBack?: () => void
  testId: string
}) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const { scope, teamId: myTeam } = usePermissions()
  const resources = useScheduleResources()
  const day = neededBy ?? iraqDay(Date.now())
  const span = useMemo(() => {
    const s = Date.parse(`${day}T00:00:00Z`)
    return { start: s, end: s + DAY }
  }, [day])
  const bookings = useScheduleBookings(span)
  const blackouts = useScheduleBlackouts(span)

  const people = useMemo(() => (resources.data ?? []).filter((r) => r.kind === 'human' && r.userId != null), [resources.data])
  const teamOf = (r: ScheduleResource) => r.personTeamId ?? r.teamId
  const teams = useMemo(() => {
    const names = new Map<string, string>()
    for (const r of resources.data ?? []) if (r.teamId && r.teamName) names.set(r.teamId, r.teamName)
    const m = new Map<string, { id: string; name: string; people: ScheduleResource[] }>()
    for (const r of people) {
      const tm = teamOf(r)
      if (!tm) continue
      // A team lead's own team is booked, not asked.
      if (scope === 'team' && tm === myTeam) continue
      if (!m.has(tm)) m.set(tm, { id: tm, name: names.get(tm) ?? r.teamName ?? '—', people: [] })
      m.get(tm)!.people.push(r)
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [people, resources.data, scope, myTeam])

  const [teamId, setTeamId] = useState<string | null>(null)
  const team = teams.find((x) => x.id === teamId) ?? null
  const answerers = useAskAnswerers(team?.people[0]?.id ?? null)
  const lead = answerers.data?.[0]?.name ?? null
  const leadName = lead ?? null

  const freeOn = (r: ScheduleResource) => {
    const working = (s: number) => (r.office ? isWorkingDay(localDayOf(s + 43_200_000, r.office.timezone), r.office) : true)
    const mine = (blackouts.data ?? []).filter((b) => b.resourceId === r.id)
    const cell = (bookings.data ?? []).filter((b) => b.resourceId === r.id && b.start < span.end && b.end > span.start)
    const load = dayLoad(r, [...cell, ...internalLoad(internalHoursOn(mine, span.start, working))], {
      nonWorking: !working(span.start),
      onLeave: blocksWholeDay(mine, span.start),
    })
    return load
  }
  const dayWord = lang === 'ar' ? weekdayName(day, lang) : `${weekdayName(day, lang).slice(0, 3)} ${Number(day.slice(8))}`

  return (
    <div className="sc-people sc-ask-pick" data-testid={testId}>
      {onBack && (
        <button type="button" className="sc-ask-back" onClick={onBack} data-testid={`${testId}-back`}>
          ‹ {t('schedule.asks.pick.back')}
        </button>
      )}
      <label className="sc-ask-team">
        <span className="sc-pop-title">{t('schedule.asks.pick.team')}</span>
        <select value={teamId ?? ''} onChange={(e) => setTeamId(e.target.value || null)} data-testid={`${testId}-team`}>
          <option value="">{t('schedule.asks.pick.chooseTeam')}</option>
          {teams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
        </select>
      </label>
      {team && (
        <>
          <p className="sc-pop-title">{t('schedule.asks.pick.whoFree', { day: dayWord })}</p>
          <ul className="sc-people-list" role="listbox" aria-label={t('schedule.asks.pick.team')}>
            <li>
              <button type="button" role="option" aria-selected={false} className="sc-person sc-person-anyone"
                onClick={() => onAsk({ teamId: team.id, assigneeId: null, note: '', neededBy: day })} data-testid={`${testId}-anyone`}>
                <span className="sc-anyone-dot" aria-hidden="true" />
                <span className="sc-person-text">
                  <span className="sc-person-name">{lead ? t('schedule.asks.pick.anyone', { lead: leadName }) : t('schedule.asks.pick.anyoneNoName')}</span>
                  <span className="sc-person-sub">{t('schedule.asks.pick.anyoneSub')}</span>
                </span>
              </button>
            </li>
            {team.people.map((r) => {
              const load = freeOn(r)
              const words = load.state === 'leave' ? t('schedule.sc.cell.leave') : load.state === 'off' ? t('schedule.sc.cell.off')
                : load.state === 'over' ? t('schedule.sc.cell.over', { n: load.overHours }) : load.state === 'full' ? t('schedule.sc.cell.full')
                  : t('schedule.sc.cell.free', { n: load.freeHours })
              return (
                <li key={r.id}>
                  <button type="button" role="option" aria-selected={false} className="sc-person"
                    onClick={() => onAsk({ teamId: team.id, assigneeId: r.userId, note: '', neededBy: day })} data-testid={`${testId}-${r.id}`}>
                    <Avatar id={r.id} name={r.name} size={22} />
                    <span className="sc-person-text">
                      <span className="sc-person-name">{r.name}</span>
                      {r.jobTitle && <span className="sc-person-sub">{r.jobTitle}</span>}
                    </span>
                    <span className={`sc-person-free${load.state === 'free' && load.freeHours >= 4 ? '' : ' is-low'}`}>{words}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="sc-ask-note" data-testid={`${testId}-note`}>
            <strong>{lead ? t('schedule.asks.pick.answers', { lead: leadName }) : t('schedule.asks.pick.answersNoName')}</strong>{' '}
            {t('schedule.asks.pick.nothingBooked', { team: team.name })}
          </p>
        </>
      )}
      {!team && teams.length === 0 && !resources.isLoading && <p className="sc-pop-empty">{t('schedule.asks.pick.noTeams')}</p>}
    </div>
  )
}
