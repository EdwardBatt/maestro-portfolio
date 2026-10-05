import { useEffect } from 'react'
import { useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../app/auth-context'
import { useCurrentUser } from '../../app/useCurrentUser'
import { formatIraqDate } from '../../lib/time/iraq'
import { NewsFeed } from '../news/NewsFeed'
import { MyWorkLists } from '../deliverables/MyWorkPanel'
import { NeedsYouPanel } from '../deliverables/NeedsYouPanel'
import { AsksFromOtherTeams } from '../deliverables/components/AsksFromOtherTeams'
import { AttendanceWidget } from '../attendance/AttendanceWidget'
import { ExceptionsPanel } from '../deliverables/ExceptionsPanel'
import { useMyAssignedWork, useTaskListRules, type AssignedWorkItem } from '../deliverables/api/deliverables-api'
import { byDeadlineThenPriority, openWork } from '../deliverables/lib/my-work'
import { useMyLoad, useTeamLoad } from '../team/api/team-api'
import { isMostBookedInTeam } from './lib/most-booked'

/**
 * My Work (L3.2 → ADR-0105 d.1, I59.10, Figma M1): the same page for every role, showing my own
 * work and what asks me to act.
 *
 * Top to bottom: the greeting and what bites first · attendance (unchanged) · the six counts as a
 * figures row · Needs you · Today · This week · Later · Waiting on someone else · Completed (folded)
 * · news. On the right: Your week (my booked hours per day) and Before you start (the rules of my
 * most urgent task's campaign). Everything on each task beyond Start is on its own page
 * (`/my-work/task/:taskId`).
 */
/**
 * I52.4 (17 Sep): a notification about a task opens My Work with `?task=<id>` — the row is scrolled
 * to and marked, whether it sits in a list or in Needs you (a review keeps `awaiting-review-item-`).
 * The panels load on their own clock, so the page looks for the row for a few seconds rather than
 * once. (The assignee's own notifications now open the task page instead — NotificationInbox.)
 */
function useFocusTask() {
  const [params] = useSearchParams()
  const taskId = params.get('task')
  // I59.45: `kind` names WHICH card — a task can have a review card and a question card at once.
  const kind = params.get('kind')
  useEffect(() => {
    if (!taskId) return
    // Attribute values in double quotes: escape only what could close them (ids are UUIDs).
    const esc = (v: string) => v.replace(/["\\]/g, '\\$&')
    const id = esc(taskId)
    // A Needs you card is found by what it is about (task, deliverable, person) or by its own id
    // (an escalation is keyed by its notification); `kind`, when given, narrows to that card.
    const about = ['data-task', 'data-deliverable', 'data-resource', 'data-id'].map((a) => `[${a}="${id}"]`)
    const card = (k: string) => about.map((a) => `li.ny-card[data-kind="${esc(k)}"]${a}`).join(', ')
    const selector = [
      ...(kind ? [card(kind)] : []),
      `[data-testid="my-work-item-${id}"]`,
      `[data-testid="awaiting-review-item-${id}"]`,
      ...about.map((a) => `li.ny-card${a}`),
    ].join(', ')
    let tries = 0
    const timer = window.setInterval(() => {
      // querySelector takes the FIRST match in document order, so the kind is tried on its own first.
      const el = (kind ? document.querySelector<HTMLElement>(card(kind)) : null) ?? document.querySelector<HTMLElement>(selector)
      tries += 1
      if (el) {
        el.scrollIntoView({ block: 'center' })
        el.setAttribute('data-focused', 'true')
        el.classList.add('is-focused')
        window.clearInterval(timer)
      } else if (tries > 40) {
        window.clearInterval(timer)
      }
    }, 250)
    return () => window.clearInterval(timer)
  }, [taskId, kind])
}

export function MyTasksPage() {
  useFocusTask()
  const { t } = useTranslation()
  const { session } = useAuth()
  const myId = session?.user.id ?? null
  const work = useMyAssignedWork(myId)
  // The most urgent open task not already with somebody else: what the greeting names and whose
  // campaign rules "Before you start" shows.
  const first = byDeadlineThenPriority(openWork(work.data ?? []).filter((it) => it.status !== 'review'))[0] ?? null

  return (
    <section className="my-work-dashboard mw-page" data-testid="surface-my-work">
      <header className="schedule-bar">
        <h1>{t('bookings.myTasks')}</h1>
      </header>

      <Greeting first={first} />

      <div className="my-work-header-row">
        <AttendanceWidget userId={myId} />
        <ExceptionsPanel />
      </div>

      <div className="mw-columns">
        <div className="mw-main">
          <AsksFromOtherTeams />
          <NeedsYouPanel />
          <MyWorkLists />
          <NewsFeed />
        </div>
        <aside className="mw-side" aria-label={t('needsYou.sideLabel')}>
          <YourWeek userId={myId} />
          <BeforeYouStart task={first} />
        </aside>
      </div>
    </section>
  )
}

/** "Good morning, Zubaida" and one line saying what bites first (Figma M1). */
function Greeting({ first }: { first: AssignedWorkItem | null }) {
  const { t, i18n } = useTranslation()
  const me = useCurrentUser()
  const loc = i18n.language.startsWith('ar') ? 'ar' : 'en'
  const hour = new Date().getHours()
  const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
  // full-names: greeting — the page greets its own reader by first name (Figma M1); nobody else is named so.
  const name = me.data?.displayName?.split(/\s+/)[0] ?? ''
  return (
    <div className="mw-greeting" data-testid="my-work-greeting">
      <p className="mw-greeting-hello">{name ? t(`needsYou.greeting.${part}`, { name }) : t(`needsYou.greeting.${part}NoName`)}</p>
      <p className="muted" data-testid="my-work-greeting-line">
        {first
          ? first.dueAt
            ? t('needsYou.bitesFirst', { title: first.title, date: formatIraqDate(first.dueAt, loc) })
            : t('needsYou.bitesFirstNoDate', { title: first.title })
          : t('needsYou.nothingOpen')}
      </p>
    </div>
  )
}

/** My booked hours per day this week against my day, the total and % (ADR-0105 d.1). */
function YourWeek({ userId }: { userId: string | null }) {
  const { t, i18n } = useTranslation()
  const load = useMyLoad(userId)
  // The plan's "one line if I am the most booked" (View 2): the same week, read for the team.
  const team = useTeamLoad()
  const mostBooked = isMostBookedInTeam(team.groups.flatMap((g) => g.people), userId)
  const d = load.data
  if (!d || !d.hasResource) return null
  const dayName = (date: string) =>
    new Intl.DateTimeFormat(i18n.language.startsWith('ar') ? 'ar' : 'en-GB', { weekday: 'short' }).format(new Date(`${date}T12:00:00`))
  const days = d.days.filter((day) => day.working || day.hours > 0)
  return (
    <section className="mw-card mw-week" data-testid="your-week">
      {/* Figma M1: "Your week" and the total as a shaded pill beside it — red once the week is at
          or over my level, neutral below it. */}
      <h2 className="mw-card-title mw-week-title" data-testid="your-week-total">
        {t('needsYou.week.title')}{' '}
        <span className={`mw-week-pill is-${d.level}`}>{t('needsYou.week.booked', { hours: d.bookedHours, pct: d.utilPct })}</span>
      </h2>
      <ul className="mw-week-days">
        {days.map((day) => {
          const pct = Math.min(100, Math.round((day.hours / d.dayHours) * 100))
          const tone = day.hours > d.dayHours ? 'over' : day.hours >= d.dayHours ? 'full' : 'part'
          return (
            <li key={day.date} className="mw-week-day" data-testid={`your-week-day-${day.date}`}>
              <span className="mw-week-name">{dayName(day.date)}</span>
              <span className="mw-week-bar" aria-hidden="true"><i className={`is-${tone}`} style={{ inlineSize: `${pct}%` }} /></span>
              <span className="mw-week-hours">{t('needsYou.week.hours', { hours: day.hours })}</span>
            </li>
          )
        })}
      </ul>
      {d.level !== 'ok' && (
        <p className={`mw-week-note ${d.level === 'over' ? 'error-text' : 'cell-warn'}`} data-testid="your-week-level">
          {t(`needsYou.week.${d.level}`, { pct: d.utilPct, warn: d.warnPct })}
        </p>
      )}
      {mostBooked && (
        <p className="mw-week-note" data-testid="your-week-most-booked">{t('requests.week.mostBooked')}</p>
      )}
    </section>
  )
}

/** The rules of my most urgent task's campaign, in plain lines (Q7, Q26). Shown when it has any. */
function BeforeYouStart({ task }: { task: AssignedWorkItem | null }) {
  const { t } = useTranslation()
  const rules = useTaskListRules(task?.campaignId ?? null, task?.deliverableId ?? null)
  const list = rules.data ?? []
  if (!task || list.length === 0) return null
  return (
    <section className="mw-card mw-rules" data-testid="before-you-start">
      <h2 className="mw-card-title">{t('needsYou.before.title')}</h2>
      <p className="muted" data-testid="before-you-start-line">
        {t('needsYou.before.line', { campaign: task.campaignName ?? task.deliverableName ?? task.title, count: list.length })}
      </p>
      <ul className="task-page-lines task-rules">
        {list.map((r, i) => (
          <li key={i} className={`task-rule task-rule-${r.kind}`} data-testid={`before-you-start-rule-${i}`}>
            <span className="task-rule-kind">{t(`taskPage.ruleKind.${r.kind}`)}</span> <span dir="auto">{r.text}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
