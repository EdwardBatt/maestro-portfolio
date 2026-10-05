import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ScheduleResource } from '../api/schedule-api'
import type { WeekNote } from '../lib/day-load.ts'
import { weekdayName } from '../lib/day-words.ts'
import { Avatar } from './Avatar'
import { AskTeamPicker, type AskChoice } from './AskTeamPicker'

export type { AskChoice }

/** One person in Who (SC-04): their free hours this week and the one thing worth knowing first. */
export interface PersonOption {
  resource: ScheduleResource
  freeHours: number
  /** what a full week would hold — the colour of the hours turns when under half is left */
  weekHours: number
  note: WeekNote
}

const short = (iso: string, lang: string) => (lang === 'ar' ? weekdayName(iso, lang) : weekdayName(iso, lang).slice(0, 3))

function useNoteWords() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  return (note: WeekNote): string | null => {
    switch (note.kind) {
      case 'over': return t('schedule.sc.who.over', { hours: note.hours, day: short(note.isoDate, lang) })
      case 'leave': return t('schedule.sc.who.leave', { day: short(note.isoDate, lang) })
      case 'full': return note.from === note.to
        ? t('schedule.sc.who.fullOne', { day: short(note.from, lang) })
        : t('schedule.sc.who.full', { from: short(note.from, lang), to: short(note.to, lang) })
      case 'free': return note.from === note.to
        ? t('schedule.sc.who.freeOne', { day: short(note.from, lang) })
        : t('schedule.sc.who.free', { from: short(note.from, lang), to: short(note.to, lang) })
      case 'none': return null
    }
  }
}

/**
 * "YOUR TEAM · FREE THIS WEEK" — the viewer's people, most room first, each with a full name (never a
 * nickname). With `onAsk` it also offers "Ask another team…" (ADR-0139, I74.2, mock-up 1): the team,
 * then one of its people or "Anyone — <lead> decides" — nothing is booked until that lead answers.
 *
 * `onAsk` is the stable door every surface uses (the Schedule's booking window, the campaign page's
 * piece panel, a task's Edit). `askOnly` is for a role that books nobody directly (an account
 * manager, the account director): every pick is an ask, and the picker says so.
 */
export function PeoplePicker({
  people,
  selectedId,
  onPick,
  onAsk,
  askDay = null,
  askOnly = false,
  testId,
}: {
  people: PersonOption[]
  selectedId: string | null
  onPick: (resourceId: string) => void
  onAsk?: (choice: { teamId: string; assigneeId: string | null; note: string; neededBy: string | null }) => void
  /** the day the work is needed by — the ask view shows free hours on it */
  askDay?: string | null
  askOnly?: boolean
  testId: string
}) {
  const { t } = useTranslation()
  const noteWords = useNoteWords()
  const [asking, setAsking] = useState(false)
  if (asking && onAsk) {
    return <AskTeamPicker neededBy={askDay} onAsk={onAsk} onBack={() => setAsking(false)} testId={`${testId}-ask`} />
  }
  return (
    <div className="sc-people" data-testid={testId}>
      <p className="sc-pop-title">{t(askOnly ? 'schedule.asks.pick.everyoneTitle' : 'schedule.sc.who.title')}</p>
      {askOnly && <p className="sc-ask-only" data-testid={`${testId}-ask-only`}>{t('schedule.asks.pick.askOnly')}</p>}
      {people.length === 0 && <p className="sc-pop-empty">{t('schedule.sc.who.nobody')}</p>}
      <ul className="sc-people-list" role="listbox" aria-label={t('schedule.sc.who.title')}>
        {people.map((p) => {
          const note = noteWords(p.note)
          const low = p.freeHours < p.weekHours / 2
          return (
            <li key={p.resource.id}>
              <button
                type="button"
                role="option"
                aria-selected={selectedId === p.resource.id}
                className={`sc-person${selectedId === p.resource.id ? ' is-on' : ''}`}
                onClick={() => onPick(p.resource.id)}
                data-testid={`${testId}-${p.resource.id}`}
              >
                <Avatar id={p.resource.id} name={p.resource.name} size={22} />
                <span className="sc-person-text">
                  <span className="sc-person-name">{p.resource.name}</span>
                  <span className="sc-person-sub">{[p.resource.jobTitle, note].filter(Boolean).join(' · ')}</span>
                </span>
                <span className={`sc-person-free${low ? ' is-low' : ''}`}>{t('schedule.sc.hours', { n: p.freeHours })}</span>
              </button>
            </li>
          )
        })}
      </ul>
      {onAsk && (
        <button type="button" className="sc-ask-other" onClick={() => setAsking(true)} data-testid={`${testId}-ask-other`}>
          <span className="sc-ask-other-title">{t('schedule.sc.who.askOther')}</span>
          <span className="sc-person-sub">{t('schedule.sc.who.askOtherSub')}</span>
        </button>
      )}
    </div>
  )
}
