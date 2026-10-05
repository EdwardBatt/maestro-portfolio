import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { useAuth } from '../../app/auth-context'
import { useTeams } from '../admin/api/admin-api'
import { DayGrid, buildColumns } from './components/DayGrid'
import { MonthOverview } from './components/MonthOverview'
import { BookingDialog, type BookingDraft } from './components/BookingDialog'
import { daySpan } from './lib/day-span.ts'
import { EditBookingDialog } from './components/EditBookingDialog'
import { AssignmentRequestDialog } from './components/AssignmentRequestDialog'
import { usePendingAssignmentRequests } from '../../lib/assignment-requests/api'
import type { AssignmentRequest } from '../../lib/assignment-requests/requests'
import { loadPctToHours } from '../../lib/capacity/day-hours.ts'
import { useWriteScope } from './hooks/use-write-scope.ts'
import { rankByName } from '../../lib/search/rank-by-name'
import { Button, BusyNote, IconButton } from '../../components/Button'
import {
  useCampaigns,
  useCampaignPhaseOptions,
  useReassignTaskToResource,
  useRescheduleBooking,
  useScheduleBlackouts,
  useScheduleBookings,
  useScheduleResources,
  useTaskCommitments,
  type ScheduleBooking,
} from './api/schedule-api'
import { Modal } from '../../components/Modal'
import { ChangeAskDialog } from '../campaigns/components/ChangeAskDialog'
import { usePermissions } from '../../app/permissions'
import { useToBook } from './api/book-api'
import { ToBookPanel } from './components/ToBookPanel'
import { WeekMenu } from './components/WeekMenu'
import { BookTasksDialog } from './components/BookTasksDialog'
import { AsksBelowSlot, AsksFromTeamsSlot, UndoToast } from './components/ScheduleAsksSide'
import { useAsksISent } from '../../lib/task-asks/api'
import type { TaskAsk } from '../../lib/task-asks/asks'
import { piecesInReach, NO_FILTER, type ToBookFilter, type ToBookPiece } from './lib/to-book.ts'
import { resourceInReach, viewerReach } from './lib/team-reach.ts'
import { workingRange } from './lib/week-menu.ts'
import { weekWord } from './lib/week-menu.ts'
import { dayLong, spanWords } from './lib/day-words.ts'
import { iraqDay } from '../../lib/time/iraq'

const DAY = 86_400_000
/**
 * I74.6 (ADR-0139 d.6): the Schedule opens on the viewer's own team - `team`. `master` is everyone,
 * kept one click away (a lead still looks across); the other three views are unchanged.
 */
type ViewMode = 'team' | 'master' | 'mine' | 'project' | 'month'
const VIEWS: ViewMode[] = ['team', 'master', 'mine', 'project', 'month']

function startOfWeekUtc(now = Date.now()): number {
  const d = new Date(now)
  d.setUTCHours(0, 0, 0, 0)
  // Week starts on SUNDAY (working week Sun–Fri, MENA). getUTCDay(): 0=Sun..6=Sat.
  return d.getTime() - d.getUTCDay() * DAY
}

/** Distinct {id,name} pairs pulled off the resource list — filter options stay
 * in step with what's actually schedulable, no extra queries. */
function distinct(pairs: [string | null, string | null][]): { id: string; name: string }[] {
  const m = new Map<string, string>()
  for (const [id, name] of pairs) if (id) m.set(id, name ?? id)
  return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
}

const NO_PHASES: { id: string; number: number; name: string }[] = []

export function SchedulePage() {
  const { t, i18n } = useTranslation()
  const { session } = useAuth()
  const myId = session?.user.id ?? null
  const [params, setParams] = useSearchParams()

  const askedView = (VIEWS.includes(params.get('view') as ViewMode) ? params.get('view') : null) as ViewMode | null
  const fDept = params.get('dept') ?? ''
  const fTeam = params.get('team') ?? ''
  const fKind = params.get('kind') ?? ''
  // Typed, not chosen. The dropdowns narrow by structure — department, team, office — and none of
  // them answers "where is Sarah", which is the question somebody actually has when they are
  // looking at forty rows. Mirrored in the URL like every other filter, so a narrowed grid is
  // still a shareable link.
  const fName = params.get('who') ?? ''
  const fOffice = params.get('office') ?? ''
  const fCampaign = params.get('campaign') ?? ''
  // ADR-0096 d.12: within a phased campaign, narrow to one phase. Offered only when the campaign in
  // view has phases; a phase that no longer exists falls back to all of them.
  const fPhaseRaw = params.get('phase') ?? ''

  const setParam = useCallback(
    (key: string, val: string) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (val) next.set(key, val)
          else next.delete(key)
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  // Clear every filter in ONE update — separate setParam calls would clobber
  // each other (same snapshot bug as the department filter), leaving only the
  // last one applied.
  const clearFilters = useCallback(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const k of ['dept', 'team', 'kind', 'office', 'campaign', 'phase', 'who']) next.delete(k)
        return next
      },
      { replace: true },
    )
  }, [setParams])

  // Department + team must change ATOMICALLY: two separate setParam calls each
  // receive the same pre-update snapshot, so the second (clearing team) would
  // clobber the first (setting dept) and the department filter would never apply.
  const setDeptFilter = useCallback(
    (val: string) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (val) next.set('dept', val)
          else next.delete('dept')
          next.delete('team') // team belongs to a department; reset when it changes
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  // `?on=YYYY-MM-DD` opens the week containing that day rather than this one (I30.7). A clash email
  // is about a specific date, and landing on the current week means landing away from the problem.
  // Read once as the initial anchor, not kept in sync: the arrows move the week afterwards, and a
  // URL that fought them would snap the grid back every render.
  const [start, setStart] = useState(() => {
    const on = params.get('on')
    const t = on ? Date.parse(`${on}T00:00:00Z`) : NaN
    return Number.isFinite(t) ? startOfWeekUtc(t) : startOfWeekUtc()
  })
  // ADR-0132 d.7: the span is kept as `?days=` beside `?on=`, both read once and written back on change
  // (never read again, so the URL cannot fight the arrows) — Back from a page opened here returns to them.
  const [days, setDays] = useState(() => {
    const d = Number(params.get('days'))
    return d === 14 || d === 28 ? d : 7
  })
  useEffect(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (start === startOfWeekUtc()) next.delete('on')
        else next.set('on', new Date(start).toISOString().slice(0, 10))
        if (days === 7) next.delete('days')
        else next.set('days', String(days))
        return next
      },
      { replace: true },
    )
  }, [start, days, setParams])
  const [draft, setDraft] = useState<BookingDraft | null>(null)
  const { can, ready: permissionsReady, refusalFor, routeFor, failed: permissionsFailed } = useWriteScope()
  const [refusal, setRefusal] = useState<{ key: string; params: Record<string, string> } | null>(null)
  const [pendingMove, setPendingMove] = useState<
    { booking: ScheduleBooking; targetResourceId: string; targetIsoDate: string } | null
  >(null)
  const [editing, setEditing] = useState<ScheduleBooking | null>(null)
  const [viewingRequest, setViewingRequest] = useState<AssignmentRequest | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  /** Something that went right and needs saying — a request sent (ADR-0087 d.12). */
  const [notice, setNotice] = useState<string | null>(null)
  /** I74.21/22: the piece picked from To book, and the day clicked with it - the booking window. */
  const [picked, setPicked] = useState<ToBookPiece | null>(null)
  const [booking, setBooking] = useState<{ piece: ToBookPiece; isoDate: string; resourceId: string | null } | null>(null)
  const [toBookFilter, setToBookFilter] = useState<ToBookFilter>(NO_FILTER)
  /** I74.4: the toast after booking (SC-18) and the ask being looked at (SC-19). */
  const [toast, setToast] = useState<{ text: string; undo: { subTaskIds: string[]; requestIds: string[] } | null } | null>(null)
  const closeToast = useCallback(() => setToast(null), [])
  const say = useCallback((text: string) => setToast({ text, undo: null }), [])
  const [seeingAsk, setSeeingAsk] = useState<TaskAsk | null>(null)
  const perms = usePermissions()
  const reach = useMemo(() => viewerReach(perms.scope, perms.departmentId, perms.teamId), [perms.scope, perms.departmentId, perms.teamId])
  // Edward, 4 Oct (I74.30): someone whose role books nobody directly — a team member, an account manager — has no team
  // to show, so "Your team" is not offered and the page opens on Everyone, which is what it showed under that name.
  const hasTeamView = reach.kind !== 'none'
  const view: ViewMode = askedView === 'team' && !hasTeamView ? 'master' : (askedView ?? (hasTeamView ? 'team' : 'master'))
  const toBook = useToBook({ live: true })

  const window = useMemo(() => ({ start, end: start + days * DAY }), [start, days])
  const columns = useMemo(() => buildColumns(start, days), [start, days])

  // ADR-0105 d.5 (I59.13): the Schedule and the team timeline write the same assignments, so both
  // refresh every 20 seconds and on returning to the tab. The Schedule never refreshed before.
  const LIVE = { live: true }
  const resources = useScheduleResources(LIVE)
  const bookings = useScheduleBookings(window, LIVE)
  const blackouts = useScheduleBlackouts(window, LIVE)
  // ADR-0087 d.11: pending requests are drawn from their own table, never from `bookings`.
  const requests = usePendingAssignmentRequests(window, LIVE)
  // ADR-0139 d.6: the viewer's own asks of other teams — the left column's cards and the grid's ⏳ chips.
  const asksSent = useAsksISent(myId, LIVE)
  // I59.13: each task chip's span and committed date, for the drop's past-commitment warning (L6).
  const commitments = useTaskCommitments(
    useMemo(() => (bookings.data ?? []).map((b) => b.subTaskId).filter((x): x is string => x != null), [bookings.data]),
    LIVE,
  )
  // ADR-0141 d.2/d.5 (I74.16): a move past the date opens the one change form, filled in — never the retired extension.
  const [askingExtension, setAskingExtension] = useState<{ subTaskId: string; deliverableId: string; landsOn: string } | null>(null)
  const campaigns = useCampaigns()
  const phaseOptionsQuery = useCampaignPhaseOptions(view === 'project' && fCampaign ? fCampaign : null)
  const phaseOptions = phaseOptionsQuery.data ?? NO_PHASES
  const fPhase = fPhaseRaw && phaseOptions.some((p) => p.id === fPhaseRaw) ? fPhaseRaw : ''
  const reschedule = useRescheduleBooking()
  const reassign = useReassignTaskToResource()

  const enrichedBookings = useMemo(() => {
    const names = new Map((campaigns.data ?? []).map((c) => [c.id, c.name]))
    return (bookings.data ?? []).map((b) => ({
      ...b,
      campaignName: b.campaignId ? (names.get(b.campaignId) ?? null) : null,
    }))
  }, [bookings.data, campaigns.data])

  // Filter option lists derived from the resource pool.
  const allResources = useMemo(() => resources.data ?? [], [resources.data])

  // A resource tagged only with a team still belongs to that team's department
  // (ADR-0014 hierarchy-aware). Resolve each resource's EFFECTIVE department so
  // the department filter/options include team-only resources.
  const teams = useTeams()
  const teamDept = useMemo(() => {
    const m = new Map<string, { id: string | null; name: string | null }>()
    for (const tm of teams.data ?? []) m.set(tm.id, { id: tm.departmentId, name: tm.departmentName })
    return m
  }, [teams.data])
  const effDept = useCallback(
    (r: { departmentId: string | null; departmentName: string | null; teamId: string | null }): [string | null, string | null] => {
      if (r.departmentId) return [r.departmentId, r.departmentName]
      if (r.teamId) {
        const d = teamDept.get(r.teamId)
        if (d?.id) return [d.id, d.name]
      }
      return [null, null]
    },
    [teamDept],
  )

  const deptOptions = useMemo(() => distinct(allResources.map((r) => effDept(r))), [allResources, effDept])
  const teamOptions = useMemo(
    () =>
      distinct(
        allResources
          .filter((r) => !fDept || effDept(r)[0] === fDept)
          .map((r) => [r.teamId, r.teamName] as [string | null, string | null]),
      ),
    [allResources, fDept, effDept],
  )
  const officeOptions = useMemo(
    () => distinct(allResources.map((r) => [r.officeId, r.office?.name ?? null] as [string | null, string | null])),
    [allResources],
  )

  // Resource rows visible under the current view + filters.
  const visibleResources = useMemo(() => {
    let list = allResources
    if (view === 'mine') list = list.filter((r) => r.userId != null && r.userId === myId)
    // ADR-0139 d.6: the viewer's own team. Nobody to show (an account manager, or a lead whose team has
    // no calendars yet) falls back to everyone - a view never dead-ends.
    if (view === 'team') {
      const mine = list.filter((r) => resourceInReach(r, effDept(r)[0], reach))
      if (mine.length > 0) list = mine
    }
    if (fKind) list = list.filter((r) => r.kind === fKind)
    if (fDept) list = list.filter((r) => effDept(r)[0] === fDept)
    if (fTeam) list = list.filter((r) => r.teamId === fTeam)
    if (fOffice) list = list.filter((r) => r.officeId === fOffice)
    if (view === 'project' && fCampaign) {
      const withBookings = new Set(
        enrichedBookings.filter((b) => b.campaignId === fCampaign && (!fPhase || b.phaseId === fPhase)).map((b) => b.resourceId),
      )
      list = list.filter((r) => withBookings.has(r.id))
    }
    // LAST, and deliberately: the name search narrows what the structural filters already chose,
    // so "Production, then Sarah" reads the way it is written and clearing the name leaves the
    // department filter standing.
    //
    // Only the FILTERING half of `rankByName` matters here — `DayGrid` regroups by department and
    // re-sorts alphabetically within each, so the ranking is discarded. That is right for a
    // calendar: a grid whose rows jump about as somebody types is harder to read, not easier, and
    // the ordering people rely on is the org chart.
    return rankByName(list, fName, (r) => r.name)
  }, [allResources, view, myId, fKind, fDept, fTeam, fOffice, fCampaign, fPhase, fName, enrichedBookings, effDept, reach])

  /** The people Who offers in the booking window: the viewer's team, else every person (never empty). */
  const teamPeople = useMemo(() => {
    const humans = allResources.filter((r) => r.kind === 'human' && r.userId != null)
    const mine = humans.filter((r) => resourceInReach(r, effDept(r)[0], reach))
    return mine.length > 0 ? mine : humans
  }, [allResources, effDept, reach])
  /** "Only your team's pieces" (SC-02b) - or every piece when the viewer has no team to narrow to. */
  const toBookPieces = useMemo(() => {
    const all = toBook.data ?? []
    if (reach.kind === 'none') return all
    return piecesInReach(all, reach)
  }, [toBook.data, reach])
  const thisWeek = startOfWeekUtc()

  const gridBookings = useMemo(
    () => (view === 'project' && fCampaign
      ? enrichedBookings.filter((b) => b.campaignId === fCampaign && (!fPhase || b.phaseId === fPhase))
      : enrichedBookings),
    [enrichedBookings, view, fCampaign, fPhase],
  )

  // ADR-0039 d.1/d.2: a drag moves the WORK. The booking write updates the task's span through the
  // envelope trigger, so date-only moves need no extra handling here.
  const applyMove = useCallback(
    (booking: ScheduleBooking, targetResourceId: string, targetIsoDate: string) => {
      setBanner(null)
      const target = allResources.find((r) => r.id === targetResourceId)
      const hours = booking.loadPct != null ? loadPctToHours(booking.loadPct) : (booking.end - booking.start) / 3600_000
      const span = daySpan(targetIsoDate, hours, target?.office?.timezone ?? 'UTC')
      reschedule.mutate(
        {
          bookingId: booking.id,
          expectedState: booking.state,
          startsAt: new Date(span.start).toISOString(),
          endsAt: new Date(span.end).toISOString(),
          resourceId: targetResourceId !== booking.resourceId ? targetResourceId : undefined,
        },
        {
          onError: (err) => {
            const code = (err as { code?: string }).code
            setBanner(code === 'exclusive_conflict' ? t('schedule.assess.exclusive_conflict') : t('schedule.moveFailed'))
          },
        },
      )
    },
    [reschedule, allResources, t],
  )

  // ADR-0039 d.6, the actual reassignment. The confirmation has always described this correctly;
  // until now the confirm button only moved the booking row, leaving the task with its original
  // owner. Routing it through update_task_assignment moves `assignee_id`, which is what notifies
  // the new assignee, resets the hand-arranged flag, re-materialises their calendar and puts the
  // move through ADR-0040's authority check.
  //
  // The drop day moves the dates too: the task starts on the day it was dropped and keeps its
  // span length. Dragging days has always worked on the same-resource path (the booking write
  // syncs the task's span via ADR-0039's envelope trigger) and a cross-resource drag must not
  // silently lose it.
  const applyReassign = useCallback(
    (booking: ScheduleBooking, targetResourceId: string, targetIsoDate: string) => {
      setBanner(null)
      setNotice(null)
      const target = allResources.find((r) => r.id === targetResourceId)
      if (!target?.userId) {
        setBanner(t('schedule.reassign.noUser', { name: target?.name ?? '' }))
        return
      }
      reassign.mutate(
        {
          subTaskId: booking.subTaskId!,
          targetUserId: target.userId,
          targetIsoDate,
          timezone: target.office?.timezone ?? 'UTC',
        },
        {
          // ADR-0087 d.12: the server may have recorded a REQUEST rather than moved the work. The
          // chip stays where it was until the lead answers, and the person who dragged it is told
          // that is what happened rather than left looking at a chip that did not move.
          onSuccess: (row) => {
            if (row?.outcome === 'requested') {
              setNotice(t('schedule.request.sent', { department: target.departmentName ?? target.teamName ?? '' }))
            }
          },
          onError: (err) => {
            const e = err as { code?: string; message?: string; hint?: string }
            setBanner(
              e.code === '42501'
                ? (e.hint === 'unplaced_resource'
                    ? t('schedule.refusal.unplaced', { name: target.name })
                    : t('schedule.outOfScope'))
                : (e.message ?? t('schedule.moveFailed')),
            )
          },
        },
      )
    },
    [reassign, allResources, t],
  )

  // Dragging ACROSS resources reassigns a task — it changes who is accountable, notifies them, and
  // discards any hand-arranged schedule. Too much to happen on a mouse slip, so it is confirmed.
  // A plain reservation (no task behind it) just moves.
  const onChipMove = useCallback(
    (booking: ScheduleBooking, targetResourceId: string, targetIsoDate: string) => {
      const crossResource = targetResourceId !== booking.resourceId
      if (crossResource && booking.subTaskId) {
        setPendingMove({ booking, targetResourceId, targetIsoDate })
        return
      }
      applyMove(booking, targetResourceId, targetIsoDate)
    },
    [applyMove],
  )

  if (resources.isLoading) return <p data-testid="schedule-loading">…</p>
  if (resources.isError) return <p className="form-error">{t('schedule.loadFailed')}</p>

  const anyFilter = fDept || fTeam || fKind || fOffice || fName || (view === 'project' && fCampaign)

  const word = weekWord(start, thisWeek)
  const humansShown = visibleResources.filter((r) => r.kind === 'human').length
  const lang = i18n.language
  // The same working span the week button says ("4 – 8 Oct"), not seven calendar days.
  const weekSpan = workingRange(start, visibleResources.find((r) => r.office)?.office?.workingDays)
  const subtitle = view === 'master'
    // I74.30: "Everyone" is not "your" people; and someone who books nobody has nothing to pick.
    ? t('schedule.sc.subEveryone', { week: spanWords(weekSpan.from, weekSpan.to, lang) })
    : view === 'team'
    ? t(word === 'next' ? 'schedule.sc.subNext' : word === 'last' ? 'schedule.sc.subLast' : word === 'this' ? 'schedule.sc.subThis' : 'schedule.sc.subWeek',
      { count: humansShown, week: spanWords(weekSpan.from, weekSpan.to, lang) })
    : null
  const pickedDue = picked?.dueAt ? iraqDay(picked.dueAt) : null
  // Edward, 4 Oct: the person and the day clicked on the grid come into the window already chosen.
  const openBooking = (isoDate: string, piece: ToBookPiece | null = picked, resourceId: string | null = null) => {
    if (!piece) return
    setRefusal(null)
    setBooking({ piece, isoDate, resourceId })
  }

  return (
    <section data-testid="surface-schedule" className="sc-page">
      <header className="sc-head">
        <div className="sc-head-text">
          <h1>{t('schedule.sc.title')}</h1>
          {subtitle && <p className="sc-sub" data-testid="schedule-subtitle">{subtitle}</p>}
        </div>
        <div className="sc-head-right">
          {start !== thisWeek && (
            <Button variant="link" onClick={() => setStart(thisWeek)} data-testid="nav-today">{t('schedule.sc.week.back')}</Button>
          )}
          <WeekMenu
            start={start}
            thisWeek={thisWeek}
            people={visibleResources}
            onGo={setStart}
            onPrev={() => setStart((s) => s - days * DAY)}
            onNext={() => setStart((s) => s + days * DAY)}
          />
        </div>
      </header>

      {/* The views, the span and the filters the Schedule has always had - kept, one quiet row down,
          because a lead still looks across the agency and Traffic still narrows by office. */}
      <div className="sc-tools">
        <div className="view-switcher" role="tablist" aria-label={t('schedule.views.label')} data-testid="view-switcher">
          {VIEWS.filter((v) => v !== 'team' || hasTeamView).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              className={view === v ? 'active' : ''}
              onClick={() => setParam('view', v)}
              data-testid={`view-${v}`}
            >
              {t(v === 'team' ? 'schedule.sc.view.team' : v === 'master' ? 'schedule.sc.view.everyone' : `schedule.views.${v}`)}
            </button>
          ))}
        </div>
        <div className="schedule-zoom" role="group" aria-label={t('schedule.zoom')}>
          <button type="button" className={days === 7 ? 'active' : ''} onClick={() => setDays(7)} data-testid="zoom-week">{t('schedule.week')}</button>
          <button type="button" className={days === 14 ? 'active' : ''} onClick={() => setDays(14)} data-testid="zoom-fortnight">{t('schedule.twoWeeks')}</button>
          <button type="button" className={days === 28 ? 'active' : ''} onClick={() => setDays(28)} data-testid="zoom-month">{t('schedule.fourWeeks')}</button>
        </div>
        {/* I49.70: a control belonging to another role is absent, not dead - the same
            `bookings:create` the cell's "+" reads. Offered until the grants are known, so a slow
            read does not hide it from someone who holds it; the server decides either way. */}
        {view !== 'month' && (!permissionsReady || can('bookings:create')) && (
          <Button variant="secondary" size="sm" onClick={() => setDraft({})} data-testid="new-booking">
            + {t('schedule.newBooking')}
          </Button>
        )}
      </div>

      {/* L2.1 filter bar (state mirrored in the URL for shareable links) */}
      <div className="filter-bar sc-filters" data-testid="filter-bar">
        {view === 'project' && (
          <label>
            {t('schedule.filters.project')}
            <select value={fCampaign} onChange={(e) => setParam('campaign', e.target.value)} data-testid="filter-project">
              <option value="">{t('schedule.filters.selectProject')}</option>
              {(campaigns.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        {view === 'project' && fCampaign && phaseOptions.length > 0 && (
          <label>
            {t('campaigns.phases.phase')}
            <select value={fPhase} onChange={(e) => setParam('phase', e.target.value)} data-testid="filter-phase">
              <option value="">{t('campaigns.phases.allPhases')}</option>
              {phaseOptions.map((p) => <option key={p.id} value={p.id}>{p.number}. {p.name}</option>)}
            </select>
          </label>
        )}
        <label>
          {t('schedule.filters.who')}
          <input
            type="search"
            value={fName}
            onChange={(e) => setParam('who', e.target.value)}
            placeholder={t('schedule.filters.whoPlaceholder')}
            data-testid="filter-who"
          />
        </label>
        <label>
          {t('schedule.filters.kind')}
          <select value={fKind} onChange={(e) => setParam('kind', e.target.value)} data-testid="filter-kind">
            <option value="">{t('schedule.filters.all')}</option>
            <option value="human">{t('admin.resources.kinds.human')}</option>
            <option value="equipment">{t('admin.resources.kinds.equipment')}</option>
            <option value="room">{t('admin.resources.kinds.room')}</option>
          </select>
        </label>
        <label>
          {t('schedule.filters.department')}
          <select value={fDept} onChange={(e) => setDeptFilter(e.target.value)} data-testid="filter-department">
            <option value="">{t('schedule.filters.all')}</option>
            {deptOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label>
          {t('schedule.filters.team')}
          <select value={fTeam} onChange={(e) => setParam('team', e.target.value)} data-testid="filter-team">
            <option value="">{t('schedule.filters.all')}</option>
            {teamOptions.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
          </select>
        </label>
        <label>
          {t('schedule.filters.office')}
          <select value={fOffice} onChange={(e) => setParam('office', e.target.value)} data-testid="filter-office">
            <option value="">{t('schedule.filters.all')}</option>
            {officeOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        {anyFilter && (
          <Button variant="link" onClick={() => clearFilters()} data-testid="filter-clear">
            {t('schedule.filters.clear')}
          </Button>
        )}
      </div>

      {/* A failed grant fetch leaves can() false, which is correct for enforcement and looks exactly
          like "you are not allowed" on screen - every button dead, no explanation. Say what actually
          happened, because the answer is "reload", not "ask an admin for permissions". */}
      {permissionsFailed && (
        <p className="form-error" role="alert" data-testid="schedule-permissions-failed">
          {t('schedule.permissionsFailed')}
        </p>
      )}

      {banner && <p className="form-error" role="alert" data-testid="schedule-banner">{banner}</p>}
      {notice && <p className="notice notice-ok" role="status" data-testid="schedule-notice">{notice}</p>}

      {/* A drag has no button to put a spinner in, and the chip does not move until the server
          agrees - so the move looked like nothing had happened at all. */}
      {reschedule.isPending && <BusyNote text={t('schedule.movingBooking')} />}

      <div className="sc-layout">
        {/* I74.21: what is waiting for someone, beside the week it goes into (Figma L SC-01) — with the asks
            between teams around it (I74.4, SC-18 / SC-29), the makers' asks for more time and Block time. */}
        <div className="sc-side" data-testid="schedule-side">
          <AsksFromTeamsSlot people={teamPeople} onSaid={say} />
          {(!permissionsReady || can('bookings:create')) && (
            <ToBookPanel
              pieces={toBookPieces}
              loading={toBook.isLoading}
              failed={toBook.isError}
              pickedId={picked?.deliverableId ?? null}
              onPick={setPicked}
              filter={toBookFilter}
              onFilter={setToBookFilter}
            />
          )}
          <AsksBelowSlot
            asksSent={asksSent.data ?? []}
            people={teamPeople}
            blockPeople={allResources}
            onSaid={say}
            seeing={seeingAsk}
            onSee={setSeeingAsk}
            onAskAgain={(a) => {
              const piece = toBookPieces.find((p) => p.deliverableId === a.deliverableId) ?? (toBook.data ?? []).find((p) => p.deliverableId === a.deliverableId) ?? null
              if (piece) { setPicked(piece); openBooking(a.neededBy ?? iraqDay(Date.now()), piece) }
              else say(t('schedule.asks.sent.backInToBook', { task: a.taskTitle }))
            }}
          />
        </div>
        <div className="sc-main">
          {picked && (
            <div className="sc-picked" data-testid="schedule-picked">
              <p className="sc-picked-line">
                <span className="sc-dot" aria-hidden="true" />
                <strong>{picked.name}</strong>
                <span className="sc-picked-meta">
                  {[picked.clientName ?? picked.campaignName, t('schedule.sc.hours', { n: picked.hours }), pickedDue ? t('schedule.sc.toBook.dueOn', { day: dayLong(pickedDue, lang) }) : null].filter(Boolean).join(' · ')}
                </span>
              </p>
              <p className="sc-picked-sub">
                {t('schedule.sc.picked.sub', { count: picked.tasks.length, hours: picked.hours, due: pickedDue ? dayLong(pickedDue, lang) : '-' })}
              </p>
              <IconButton icon="close" size="sm" label={t('schedule.sc.picked.drop')} className="sc-picked-x" onClick={() => setPicked(null)} data-testid="schedule-picked-close" />
            </div>
          )}

          {view === 'project' && !fCampaign ? (
            <p className="muted" data-testid="schedule-pick-project">{t('schedule.filters.selectProjectHint')}</p>
          ) : view === 'mine' && visibleResources.length === 0 ? (
            <p className="muted" data-testid="schedule-no-mine">{t('schedule.noLinkedResource')}</p>
          ) : visibleResources.length === 0 ? (
            <p className="muted" data-testid="schedule-empty">{anyFilter ? t('schedule.noMatches') : t('schedule.empty')}</p>
          ) : view === 'month' ? (
            <MonthOverview resources={visibleResources} bookings={gridBookings} columns={columns} />
          ) : (
            <DayGrid
              resources={visibleResources}
              bookings={gridBookings}
              blackouts={blackouts.data ?? []}
              columns={columns}
              onAdd={(resourceId, isoDate) => { setRefusal(null); setDraft({ resourceId, isoDate }) }}
              onChipClick={setEditing}
              onChipMove={onChipMove}
              onBlocked={(r, action) => setRefusal(refusalFor(r, action))}
              requests={requests.data ?? []}
              onRequestClick={setViewingRequest}
              commitments={commitments.data}
              onAskExtension={(b, landsOn) => b.subTaskId && b.deliverableId && setAskingExtension({ subTaskId: b.subTaskId, deliverableId: b.deliverableId, landsOn })}
              picking={picked != null}
              onCellPick={(r, isoDate) => openBooking(isoDate, picked, r)}
              onPieceDrop={(pieceId, dropR, isoDate) => {
                const piece = toBookPieces.find((p) => p.deliverableId === pieceId) ?? null
                if (piece) { setPicked(piece); openBooking(isoDate, piece, dropR) }
              }}
              dueIso={pickedDue}
              meUserId={myId}
              asksSent={asksSent.data ?? []}
              onAskClick={(a) => { if (a.status === 'pending') setSeeingAsk(a) }}
            />
          )}

          {view !== 'month' && (
            picked ? (
              <p className="sc-legend-hint" data-testid="schedule-pick-hint">{t('schedule.sc.picked.hint')}</p>
            ) : (
              <div className="sc-legend" data-testid="schedule-legend" aria-label={t('schedule.legend.title')}>
                <p className="sc-legend-keys">
                  <span className="sc-legend-key is-free">{t('schedule.sc.legend.freeKey')}</span>{t('schedule.sc.legend.free')}
                  <span className="sc-legend-key is-full">{t('schedule.sc.cell.full')}</span>{t('schedule.sc.legend.full')}
                  <span className="sc-legend-key is-over">{t('schedule.sc.legend.overKey')}</span>{t('schedule.sc.legend.over')}
                  <span className="sc-legend-key is-requested"><span className="chip chip-requested legend-swatch" /></span>{t('schedule.legend.requested')}
                </p>
                <p className="sc-legend-hint">{t('schedule.sc.legend.hint')}</p>
              </div>
            )
          )}
        </div>
      </div>

      {booking && (
        <BookTasksDialog
          piece={booking.piece}
          isoDate={booking.isoDate}
          resourceId={booking.resourceId}
          team={teamPeople}
          allResources={allResources}
          onClose={() => setBooking(null)}
          onBooked={(summary, undo) => { setToast({ text: summary, undo: undo ?? null }); setPicked(null) }}
        />
      )}
      {draft && (
        <BookingDialog
          draft={draft}
          resources={visibleResources.length ? visibleResources : allResources}
          bookings={enrichedBookings}
          blackouts={blackouts.data ?? []}
          onClose={() => setDraft(null)}
        />
      )}
      {pendingMove && (
        <Modal onClose={() => setPendingMove(null)} card={false}>
          <div className="dialog" role="dialog" aria-modal="true" data-testid="reassign-confirm"
           >
            <h2>{t('schedule.reassign.title')}</h2>
            {(() => {
              const target = allResources.find((r) => r.id === pendingMove.targetResourceId)
              const params = {
                task: pendingMove.booking.taskName ?? pendingMove.booking.bookingTitle ?? '',
                name: target?.name ?? '',
                department: target?.departmentName ?? target?.teamName ?? '',
              }
              // ADR-0087 d.2: word it as what will happen — a request, when the target is outside
              // the dragger's reach — so nobody confirms a move and then wonders why nothing moved.
              const asksFirst = target != null && routeFor(target) === 'request'
              return (
                <p className="muted" data-testid="reassign-body">
                  {t(asksFirst ? 'schedule.reassign.bodyRequest' : 'schedule.reassign.body', params)}
                </p>
              )
            })()}
            <div className="dialog-actions">
              <Button variant="secondary" data-testid="reassign-cancel"
                onClick={() => setPendingMove(null)}>
                {t('schedule.reassign.cancel')}
              </Button>
              <Button variant="primary" type="button" busy={reassign.isPending} data-testid="reassign-confirm-apply"
                onClick={() => {
                  applyReassign(pendingMove.booking, pendingMove.targetResourceId, pendingMove.targetIsoDate)
                  setPendingMove(null)
                }}>
                {t('schedule.reassign.confirm')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* A refusal is a decision about this person and this calendar. It belongs in front of them
          with the real reason, not as a status strip above the grid they were already looking at —
          and never as one hardcoded sentence about teams shown to everybody (see lib/write-scope). */}
      {refusal && (
        <Modal onClose={() => setRefusal(null)} card={false}>
          <div
            className="dialog notice-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-label={t('schedule.refusal.title')}
           
            data-testid="schedule-refusal"
          >
            <h2>{t('schedule.refusal.title')}</h2>
            <p data-testid="schedule-refusal-body">{t(refusal.key, refusal.params)}</p>
            <div className="dialog-actions">
              <Button variant="secondary" onClick={() => setRefusal(null)} data-testid="schedule-refusal-close">
                {t('schedule.refusal.close')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ADR-0141 d.2 (I74.14): the move past the date opens the one change form to the account manager, filled in with
          the day the move would have ended on and the task that moved. The server decides who may ask. */}
      {askingExtension && (
        <ChangeAskDialog
          deliverableId={askingExtension.deliverableId}
          fromSubTaskId={askingExtension.subTaskId}
          initialDueDay={askingExtension.landsOn}
          onClose={() => setAskingExtension(null)}
          testId="schedule-change-ask"
        />
      )}

      {editing && (
        <EditBookingDialog booking={editing} resources={allResources} bookings={enrichedBookings} onClose={() => setEditing(null)} />
      )}
      {viewingRequest && (
        <AssignmentRequestDialog
          request={viewingRequest}
          resources={allResources}
          bookings={enrichedBookings}
          onClose={() => setViewingRequest(null)}
        />
      )}
      {toast && <UndoToast text={toast.text} undo={toast.undo} onClose={closeToast} />}
    </section>
  )
}
