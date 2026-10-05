import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { usePermissions } from '../../app/permissions'
import { NewsFeed } from '../news/NewsFeed'
import { Button, IconButton } from '../../components/Button'
import { useWorkDepartments, useTeams } from '../admin/api/admin-api'
import { useTeamLoad, type TeamLoadPerson } from './api/team-api'
import { useAtRiskTaskIds, useJobTitles, useTeamMemberIds, useTeamViewTasks } from './api/team-view-api'
import { useScheduleBlackouts, useScheduleBookings, useScheduleResources } from '../schedule/api/schedule-api'
import { useAtRiskCount } from '../campaigns/api/use-at-risk-count'
import { groupPct, inNobodyYet, resolveScope, sectionsFor, startOfWeekUtc, weekDays, type PieceFilter } from './lib/team-view'
import { TeamTimeline, TeamTimelineKey } from './components/TeamTimeline'
import { TeamByPerson } from './components/TeamByPerson'
import { TeamByPiece } from './components/TeamByPiece'
import { TeamLoadTab } from './components/TeamLoadTab'
import { formatCalendarDay } from '../../lib/time/iraq'

/**
 * The team / department view — tier 2 of ADR-0018, built by ADR-0105 d.4 (I59.12) over today's
 * Team page, at the same route and the same `team:view` gate.
 *
 * Surface lines:
 *  - Team lead / deputy — their team: who is on what this week, who has room, what nobody has yet.
 *  - Department lead — the same over the whole department, people under their team (team % on each
 *    heading) and "No team".
 *  - Any other role holding `team:view` — the same for a department they pick.
 *  - A team- or department-scoped role with no team yet — today's message, never the whole org.
 *
 * Engine line: nothing is derived here that matters — the % is the Team page's existing load rule,
 * At risk is ADR-0075's engine over the campaigns' read, and every move goes through the Schedule's
 * own reassignment and checks (ADR-0105 d.5). Everything refreshes every 20 seconds and on focus.
 */
const TABS = ['timeline', 'person', 'piece', 'load'] as const
type Tab = (typeof TABS)[number]
const FILTERS = ['atRisk', 'unassigned', 'review'] as const
const DAY_MS = 86_400_000
const LIVE = { live: true }

export function TeamPage() {
  const { t } = useTranslation()
  const { scope, teamId, departmentId } = usePermissions()
  const [params, setParams] = useSearchParams()
  // ADR-0115: the Team page is about production work — a department that takes none is not offered.
  const departments = useWorkDepartments()
  const teams = useTeams()

  const picked = params.get('dept')
  const view = useMemo(
    () => resolveScope({ scope, teamId, departmentId }, picked, departments.data ?? []),
    [scope, teamId, departmentId, picked, departments.data],
  )
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'timeline'
  const filterRaw = params.get('filter')
  const filter: PieceFilter = (FILTERS as readonly string[]).includes(filterRaw ?? '') ? (filterRaw as PieceFilter) : null
  const workstream = params.get('ws')

  const setMany = useCallback(
    (patch: Record<string, string | null>) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(patch)) {
            if (v) next.set(k, v)
            else next.delete(k)
          }
          return next
        },
        { replace: true },
      ),
    [setParams],
  )

  // The week, as the Schedule keeps it: Sunday-start, arrows back and forward, "This week" home.
  // `?on=YYYY-MM-DD` opens the week of that day, read once (the arrows move it afterwards).
  const [weekStart, setWeekStart] = useState(() => {
    const on = params.get('on')
    const at = on ? Date.parse(`${on}T00:00:00Z`) : NaN
    return Number.isFinite(at) ? startOfWeekUtc(at) : startOfWeekUtc()
  })
  const now = Date.now()
  const isThisWeek = weekStart === startOfWeekUtc(now)
  // ADR-0132 d.7: the week is written back to `?on=` (read once above, so it never fights the arrows), so a
  // page opened from here returns to the same week with Back.
  useEffect(() => {
    setMany({ on: isThisWeek ? null : new Date(weekStart).toISOString().slice(0, 10) })
  }, [weekStart, isThisWeek, setMany])
  const days = useMemo(() => weekDays(weekStart), [weekStart])
  const window = useMemo(() => ({ start: weekStart, end: weekStart + 7 * DAY_MS }), [weekStart])
  const weekIso = days[0]!.isoDate

  // Three weeks of load: this one for every tab, the next two for Load (L3d).
  const load = useTeamLoad(new Date(weekStart + DAY_MS / 2), LIVE)
  const load2 = useTeamLoad(new Date(weekStart + 7 * DAY_MS + DAY_MS / 2), LIVE)
  const load3 = useTeamLoad(new Date(weekStart + 14 * DAY_MS + DAY_MS / 2), LIVE)

  const sections = useMemo(() => sectionsFor(load.groups, view), [load.groups, view])
  const people = useMemo(() => sections.flatMap((s) => s.people), [sections])

  const resourcesQ = useScheduleResources(LIVE)
  const resources = useMemo(() => new Map((resourcesQ.data ?? []).map((r) => [r.id, r])), [resourcesQ.data])
  const bookingsQ = useScheduleBookings(window, LIVE)
  const blackouts = useScheduleBlackouts(window, LIVE)

  const userIds = useMemo(
    () => people.map((p) => resources.get(p.id)?.userId).filter((u): u is string => u != null),
    [people, resources],
  )
  const byUser = useMemo(() => {
    const m = new Map<string, NonNullable<ReturnType<typeof resources.get>>>()
    for (const p of people) {
      const r = resources.get(p.id)
      if (r?.userId) m.set(r.userId, r)
    }
    return m
  }, [people, resources])
  const rowIds = useMemo(() => new Set(people.map((p) => p.id)), [people])
  const bookings = useMemo(() => bookingsQ.data ?? [], [bookingsQ.data])
  const bookedTaskIds = useMemo(
    () => [...new Set(bookings.filter((b) => rowIds.has(b.resourceId) && b.subTaskId).map((b) => b.subTaskId!))],
    [bookings, rowIds],
  )
  const placed = view.kind === 'team' || view.kind === 'department'
  // E1: a team's "Nobody yet" is the work on pieces its members own — read from the team itself,
  // so an owner with no row on screen still counts.
  const members = useTeamMemberIds(view.kind === 'team' ? view.id : null)
  const teamOwners = useMemo<ReadonlySet<string>>(() => new Set(members.data ?? []), [members.data])
  const tasksQ = useTeamViewTasks(
    {
      assigneeIds: userIds,
      bookedTaskIds,
      ownerIds: view.kind === 'team' ? [...teamOwners] : [],
      departmentId: view.kind === 'department' ? view.id : null,
    },
    window,
    placed && !load.isLoading && !resourcesQ.isLoading && !(view.kind === 'team' && members.isLoading),
  )
  // Work on screen: the people's own, and the work nobody has yet in this scope (E1).
  const tasks = useMemo(
    () =>
      (tasksQ.data ?? []).filter((x) =>
        x.assigneeId == null ? inNobodyYet(x, view, teamOwners) : userIds.includes(x.assigneeId)),
    [tasksQ.data, userIds, view, teamOwners],
  )
  const titles = useJobTitles(userIds)

  // At risk: pieces late or at risk (ADR-0075) whose owner is among the people shown — the same
  // read and test as the campaigns list (I57.13).
  const owners = useMemo<ReadonlySet<string>>(() => new Set(userIds), [userIds])
  const atRisk = useAtRiskCount(owners)
  const atRiskTaskIds = useAtRiskTaskIds(owners)

  if (load.isLoading || departments.isLoading) return <p data-testid="team-loading">…</p>
  if (load.isError) return <p className="form-error">{t('team.loadFailed')}</p>

  const scopeName =
    view.kind === 'team'
      ? (teams.data ?? []).find((x) => x.id === view.id)?.name ?? people[0]?.teamName ?? ''
      : view.kind === 'department'
        ? (departments.data ?? []).find((d) => d.id === view.id)?.name ?? ''
        : ''
  const heading = isThisWeek
    ? t('teamView.titleThisWeek', { name: scopeName })
    : t('teamView.titleWeekOf', {
        name: scopeName,
        date: formatCalendarDay(new Date(weekStart).toISOString().slice(0, 10)),
      })

  const unassignedCount = tasks.filter((x) => x.assigneeId == null).length
  const inReview = tasks.filter((x) => x.status === 'review').length
  const openTab = (next: Tab, f: PieceFilter = null) => setMany({ tab: next === 'timeline' ? null : next, filter: f })

  const weekPeople = (groups: typeof load.groups) => {
    const m = new Map<string, TeamLoadPerson>()
    for (const g of groups) for (const p of g.people) m.set(p.id, p)
    return m
  }

  return (
    <section data-testid="surface-team" className="team-view">
      <header className="tv-header">
        <div className="tv-header-text">
          <h1 data-testid="team-title">{placed ? heading : t('team.healthTitle')}</h1>
          <p className="muted">{t(`teamView.intro.${tab}`)}</p>
        </div>
        <div className="tv-header-tools">
          {view.kind === 'department' && view.picker && (
            <label className="tv-picker">
              <span>{t('teamView.department')}</span>
              <select
                value={view.id}
                onChange={(e) => setMany({ dept: e.target.value })}
                data-testid="team-department-picker"
              >
                {(departments.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </label>
          )}
          {placed && (
            <div className="tv-weeknav" role="group" aria-label={t('teamView.week')}>
              <IconButton
                icon="chevron-left"
                className="tv-arrow"
                label={t('schedule.previous')}
                onClick={() => setWeekStart((s) => s - 7 * DAY_MS)}
                data-testid="team-week-prev"
              />
              <Button variant="secondary" size="sm" disabled={isThisWeek} onClick={() => setWeekStart(startOfWeekUtc())} data-testid="team-week-today">
                {t('teamView.thisWeek')}
              </Button>
              <IconButton
                icon="chevron-right"
                className="tv-arrow"
                label={t('schedule.next')}
                onClick={() => setWeekStart((s) => s + 7 * DAY_MS)}
                data-testid="team-week-next"
              />
            </div>
          )}
        </div>
      </header>

      {view.kind === 'unplaced' && <p className="form-error" data-testid="team-unassigned">{t('team.noTeamAssigned')}</p>}
      {view.kind === 'empty' && <p className="muted" data-testid="team-empty">{t('team.empty')}</p>}

      {placed && (
        <>
          <div className="tv-figures" data-testid="team-kpis">
            <Button variant="secondary" className="tv-figure" onClick={() => openTab('load')} data-testid="team-figure-team">
              <span className="stat-label">{t('teamView.figure.team')}</span>
              <span className="stat-value" data-testid="team-kpi-load">
                {t('teamView.figure.teamValue', { count: people.length, pct: groupPct(people) })}
              </span>
            </Button>
            <Button variant="secondary" className="tv-figure" onClick={() => openTab('piece', 'atRisk')} data-testid="team-figure-at-risk">
              <span className="stat-label">{t('teamView.figure.atRisk')}</span>
              <span className="stat-value" data-testid="team-kpi-at-risk">{atRisk ?? '—'}</span>
            </Button>
            <Button variant="secondary" className="tv-figure" onClick={() => openTab('piece', 'unassigned')} data-testid="team-figure-unassigned">
              <span className="stat-label">{t('teamView.figure.unassigned')}</span>
              <span className="stat-value" data-testid="team-kpi-unassigned">{tasksQ.data ? unassignedCount : '—'}</span>
            </Button>
            <Button variant="secondary" className="tv-figure" onClick={() => openTab('piece', 'review')} data-testid="team-figure-review">
              <span className="stat-label">{t('teamView.figure.review')}</span>
              <span className="stat-value" data-testid="team-kpi-review">{tasksQ.data ? inReview : '—'}</span>
            </Button>
          </div>

          <div className="tv-tabbar">
          <div className="tv-tabs" role="tablist" aria-label={t('teamView.tabs')}>
            {TABS.map((x) => (
              <Button
                key={x}
                variant="secondary"
                size="sm"
                role="tab"
                aria-selected={tab === x}
                className={tab === x ? 'tv-tab tv-tab-on' : 'tv-tab'}
                onClick={() => openTab(x)}
                data-testid={`team-tab-${x}`}
              >
                {t(`teamView.tab.${x}`)}
              </Button>
            ))}
            {filter && tab === 'piece' && (
              <span className="tv-filter-chip" data-testid="team-filter">
                {t(`teamView.filter.${filter}`)}
                <IconButton icon="close" size="sm" label={t('teamView.filter.clear')} onClick={() => setMany({ filter: null })} data-testid="team-filter-clear" />
              </span>
            )}
          </div>
          {tab === 'timeline' && (
            <TeamTimelineKey
              sections={sections}
              days={days}
              tasks={tasks}
              bookings={bookings}
              workstream={workstream}
              onWorkstream={(id) => setMany({ ws: id })}
              now={now}
            />
          )}
          </div>

          {tasksQ.isError && <p className="form-error" data-testid="team-tasks-failed">{t('teamView.tasksFailed')}</p>}
          {people.length === 0 && <p className="muted" data-testid="team-empty">{t('team.empty')}</p>}

          {tab === 'timeline' && (
            <TeamTimeline
              sections={sections}
              days={days}
              tasks={tasks}
              bookings={bookings}
              blackouts={blackouts.data ?? []}
              resources={resources}
              titles={titles.data ?? new Map()}
              workstream={workstream}
              onWorkstream={(id) => setMany({ ws: id })}
              now={now}
            />
          )}
          {tab === 'person' && (
            <TeamByPerson
              sections={sections}
              days={days}
              tasks={tasks}
              bookings={bookings}
              resources={resources}
              titles={titles.data ?? new Map()}
              weekIso={weekIso}
            />
          )}
          {tab === 'piece' && (
            <TeamByPiece
              tasks={tasks}
              byUser={byUser}
              filter={filter}
              atRiskTaskIds={atRiskTaskIds}
              departmentId={view.kind === 'department' ? view.id : people[0]?.departmentId ?? null}
              weekIso={weekIso}
              now={now}
            />
          )}
          {tab === 'load' && (
            <TeamLoadTab
              sections={sections}
              weeks={[
                { startIso: weekIso, people: weekPeople(load.groups) },
                { startIso: weekDays(weekStart + 7 * DAY_MS)[0]!.isoDate, people: weekPeople(load2.groups) },
                { startIso: weekDays(weekStart + 14 * DAY_MS)[0]!.isoDate, people: weekPeople(load3.groups) },
              ]}
            />
          )}
        </>
      )}

      <NewsFeed />
    </section>
  )
}
