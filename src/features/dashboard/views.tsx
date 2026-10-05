import { useEffect, useMemo, useState } from 'react'
import { usePermissions } from '../../app/permissions'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useNeedsYouItems } from '../deliverables/api/use-needs-you-items'
import { groupNeedsYou, isChangesRequested, type NeedsYouItem } from '../deliverables/lib/needs-you'
import { needsYouCard, taskPage } from '../../lib/notifications/door'
import { formatIraqDate, iraqDay } from '../../lib/time/iraq'
import { type TeamLoadPerson } from '../team/api/team-api'
import { isLate } from '../team/lib/team-view'
import { useUsers } from '../admin/api/admin-api'
import { useRoleHolderCounts, useRolesAdmin } from '../admin/api/roles-api'
import { useEscalationsReachingNobody } from '../admin/api/escalation-settings-api'
import { useScheduleResources } from '../schedule/api/schedule-api'
import { useBriefRows, useCompanyWork, useLoadWeeks, usePeopleNames, useRevisionLimits, useScopeWork, useWeekBookings } from './api/dashboard-data'
import { spanText } from './lib/span'
import { approvalFigures, reachFor, waitingOnCaption, type ApprovalReach } from './lib/approvals'
import {
  BarList,
  ChipButton,
  ChipSelect,
  DayBars,
  Headline,
  MyDeliverables,
  Panel,
  PanelLink,
  Ring,
  StatRow,
  TouchToday,
  WeekBars,
  type BarRow,
  type MyPiece,
  type StatProps,
  type TouchRow,
} from './components/blocks'
import {
  breakdown,
  campaignTone,
  clashes,
  dueOutcomes,
  goLivesInDanger,
  hoursPerDay,
  isLateTask,
  loadTone,
  nobodyOnIt,
  pct,
  peopleFullPerDay,
  perDay,
  piecesByCampaign,
  threatened,
  trendPct,
  waitingOnClient,
  workStateOf,
  type DashCampaign,
  type DashPiece,
} from './lib/figures'
import type { DashboardView } from './lib/pick-view'
import { workProgress } from '../../lib/deliverables/work-phase'

const DAY_MS = 24 * 60 * 60 * 1000
/** Friday and Saturday are the Baghdad office's days off (ADR-0005) — drawn empty when nothing falls on them. */
const OFF = [false, false, false, false, false, true, true]
const ALL = '__all'

/** The page's week: last, this or next (the frames' "This week ⌄"). */
export type WeekChoice = '-1' | '0' | '1'

export interface ViewProps {
  view: DashboardView
  myId: string
  /** Sunday 00:00 UTC of the chosen week. */
  weekStart: number
  week: WeekChoice
  onWeek: (w: WeekChoice) => void
  /** The client the page is narrowed to (the frames' "Filter" / "All clients ⌄"); ALL for every client. */
  client: string
  onClient: (c: string) => void
  now: number
  /** The page's verdict line and its Filter's choices, set by the view from its own data. */
  onVerdict: (text: string) => void
  onClients: (names: string[]) => void
}

// ------------------------------------------------------------------ shared pieces

/** "Wed, 23 Sep" — a date outside the week, as every date reads (I66.8). */
function dateText(iso: string): string {
  return formatIraqDate(iso)
}

function kindLabel(t: TFunction, kind: string): string {
  return t(`needsYou.kind.${kind}`, { defaultValue: t(`roleDashboard.kind.${kind}`, { defaultValue: kind }) })
}

/** What a Needs you card is about — the task, the piece or the person — for the door to My Work (I59.45). */
function refOf(it: NeedsYouItem) {
  const r = (it.ref ?? {}) as Record<string, unknown>
  const s = (v: unknown) => (typeof v === 'string' && v ? v : null)
  return { task: s(r.subTaskId), piece: s(r.deliverableId), resource: s(r.resourceId) }
}

function WeekChip({ id, week, onWeek }: { id: string; week: WeekChoice; onWeek: (w: WeekChoice) => void }) {
  const { t } = useTranslation()
  return (
    <ChipSelect id={id} label={t('roleDashboard.chip.week')} value={week} onChange={onWeek}
      options={[{ value: '-1', label: t('roleDashboard.chip.lastWeek') }, { value: '0', label: t('roleDashboard.thisWeek') }, { value: '1', label: t('roleDashboard.chip.nextWeek') }]} />
  )
}

function ClientChip({ id, client, onClient, clients, allLabel }: { id: string; client: string; onClient: (c: string) => void; clients: string[]; allLabel: string }) {
  const { t } = useTranslation()
  return (
    <ChipSelect id={id} label={t('roleDashboard.chip.filter')} value={client} onChange={onClient}
      options={[{ value: ALL, label: allLabel }, ...clients.map((c) => ({ value: c, label: c }))]} />
  )
}

/**
 * "What to touch today": the most urgent five of the person's Needs you, each opening where it is answered. The
 * second column names the client and campaign of the piece it is about ("Kite Card · LUMA Season 2"), else what it
 * is; progress is that piece's tasks done.
 */
function useTouchRows(items: readonly NeedsYouItem[], now: number, pieceOf: ReadonlyMap<string, { piece: DashPiece; campaign?: DashCampaign }>): TouchRow[] {
  const { t } = useTranslation()
  return useMemo(() => {
    const rows: TouchRow[] = []
    for (const s of groupNeedsYou(items, now)) {
      for (const it of s.items) {
        const link = it.primary?.type === 'link' ? it.primary : null
        const ref = refOf(it)
        const hit = ref.piece ? pieceOf.get(ref.piece) : undefined
        const tasks = hit?.piece.tasks.filter((x) => x.status !== 'cancelled') ?? []
        const escalates = it.clock.escalatesAt ? Date.parse(it.clock.escalatesAt) : null
        rows.push({
          id: `${it.kind}-${it.id}`,
          title: hit?.piece.name || it.title,
          context: [kindLabel(t, it.kind), hit ? it.title : it.context].filter(Boolean).join(' · '),
          second: hit?.campaign ? `${hit.campaign.clientName} · ${hit.campaign.name}` : kindLabel(t, it.kind),
          waiting: spanText(t, it.since, now),
          waitingBad: s.group === 'today' || (escalates != null && escalates <= now),
          progress: tasks.length ? pct(tasks.filter((x) => x.status === 'done').length, tasks.length) : null,
          work: hit && tasks.length
            ? { progress: workProgress(hit.piece.tasks, hit.piece.state), status: t(`roleDashboard.state.${workStateOf(hit.piece)}`) }
            : null,
          urgent: s.group === 'today',
          action: link ? t(link.labelKey) : t('roleDashboard.touch.open'),
          primary: s.group === 'today',
          to: link ? link.to : needsYouCard(ref.task ?? ref.piece ?? ref.resource ?? it.id, it.kind),
        })
      }
    }
    return rows.slice(0, 5)
  }, [items, now, pieceOf, t])
}

function useDayLabels(weekStart: number) {
  const { i18n } = useTranslation()
  const fmt = new Intl.DateTimeFormat(i18n.language === 'ar' ? 'ar' : 'en-GB', { weekday: 'short', timeZone: 'UTC' })
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(weekStart + i * DAY_MS)))
}

/** "Wk 36" … "This week" (Figma H), newest last. */
function useWeekLabels(weekStart: number, now: number) {
  const { t } = useTranslation()
  const thisWeek = weekStart <= now && now < weekStart + 7 * DAY_MS
  return [3, 2, 1, 0].map((n) => {
    const start = weekStart - n * 7 * DAY_MS
    if (n === 0 && thisWeek) return t('roleDashboard.thisWeek')
    return t('roleDashboard.weekNo', { n: isoWeek(start + 3 * DAY_MS) })
  })
}

function isoWeek(ms: number): number {
  const d = new Date(ms)
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day + 3)
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  return 1 + Math.round(((d.getTime() - first.getTime()) / DAY_MS - 3 + ((first.getUTCDay() + 6) % 7)) / 7)
}

function waitingCard(items: readonly NeedsYouItem[], now: number, t: TFunction): StatProps {
  const oldest = [...items].filter((i) => i.since).sort((a, b) => Date.parse(a.since!) - Date.parse(b.since!))[0]
  return {
    id: 'waiting',
    icon: 'warn',
    label: t('roleDashboard.card.waiting'),
    value: String(items.length),
    caption: items.length === 0
      ? t('roleDashboard.caption.nothingWaiting')
      : oldest
        ? t('roleDashboard.caption.oldestWaited', { span: spanText(t, oldest.since, now) })
        : t('roleDashboard.caption.seeNeedsYou'),
    to: '/my-work',
  }
}

/**
 * The approval exceptions (I66.2): unfinished briefs, briefs awaiting approval, task lists not approved —
 * over the view's own reach, each naming who it waits on. Every card opens the campaigns list narrowed to
 * what it counted, where the viewer may open that list (ADR-0122 d.4).
 */
function ApprovalRow({ reach, myId, client, work }: { reach: ApprovalReach; myId: string; client: string; work: ReturnType<typeof useCompanyWork> }) {
  const { t } = useTranslation()
  const { can } = usePermissions()
  const briefs = useBriefRows()
  const names = usePeopleNames()
  const f = approvalFigures(briefs.data ?? [], work.campaigns, work.pieces, reach, client === ALL ? null : client)
  const nameOf = (id: string) => names.data?.get(id)
  const words = {
    you: t('roleDashboard.caption.you'),
    nobody: t('roleDashboard.caption.nobodyNamed'),
    others: (people: number, count: number) => t('roleDashboard.caption.others', { count: people, items: count }),
  }
  const said = (items: typeof f.unfinished, none: string) => {
    const c = waitingOnCaption(items, nameOf, myId, words)
    return { caption: c?.short ?? t(none), captionTitle: c?.full, captionWraps: true }
  }
  const narrowed = `${client === ALL ? '' : `&client=${encodeURIComponent(client)}`}${reach.kind === 'me' || reach.kind === 'accounts' ? '&scope=mine' : ''}`
  const list = (q: string, allowed: boolean) => (allowed ? `/campaigns?${q}${narrowed}` : undefined)
  const stats: StatProps[] = [
    {
      id: 'unfinished', icon: 'lines', label: t('roleDashboard.card.unfinishedBriefs'), value: String(f.unfinished.length),
      ...said(f.unfinished, 'roleDashboard.caption.noUnfinished'),
      to: list('status=draft', can('projects:manage')),
    },
    {
      id: 'briefs', icon: 'pause', label: t('roleDashboard.card.briefsAwaiting'), value: String(f.briefs.length),
      ...said(f.briefs, 'roleDashboard.caption.noBriefsAwaiting'),
      to: list('status=pending_approval', can('projects:view')),
    },
    {
      id: 'task-lists', icon: 'warn', label: t('roleDashboard.card.taskListsNotApproved'), value: String(f.taskLists.length),
      ...said(f.taskLists, 'roleDashboard.caption.noTaskLists'),
      // I66.6: the task lists themselves, one row each, over the same reach — not the campaigns holding them.
      to: can('project_tasks:manage') ? `/deliverables/task-lists${client === ALL ? '' : `?client=${encodeURIComponent(client)}`}` : undefined,
    },
  ]
  return <StatRow stats={stats} />
}

/** Every piece by id, with its campaign — for the table's client column and progress. */
function usePieceIndex(work: ReturnType<typeof useCompanyWork>) {
  return useMemo(() => {
    const campaign = new Map(work.campaigns.map((c) => [c.id, c]))
    return new Map(work.pieces.map((p) => [p.id, { piece: p, campaign: campaign.get(p.campaignId) }]))
  }, [work.campaigns, work.pieces])
}

function useVerdict(onVerdict: (s: string) => void, text: string) {
  useEffect(() => onVerdict(text), [text, onVerdict])
}

function useClients(onClients: (names: string[]) => void, names: string[]) {
  const key = names.join('|')
  useEffect(() => onClients(key ? key.split('|') : []), [key, onClients])
}

// ------------------------------------------------------------------ Team Member (Figma H DB-M)

export function MemberView({ myId, weekStart, week, onWeek, client, now, onVerdict, onClients }: ViewProps) {
  const { t } = useTranslation()
  const ny = useNeedsYouItems(myId)
  const work = useCompanyWork()
  const index = usePieceIndex(work)
  const touch = useTouchRows(ny.items, now, index)
  const dayLabels = useDayLabels(weekStart)
  const bookings = useWeekBookings(weekStart)
  const lastWeek = useWeekBookings(weekStart - 7 * DAY_MS)
  const resources = useScheduleResources({ live: true })
  const me = (resources.data ?? []).find((r) => r.kind === 'human' && r.userId === myId)
  const [roundsOf, setRoundsOf] = useState<'all' | 'sent' | 'waiting'>('all')

  const clientOf = (campaignId: string | null) => (campaignId ? index.size && work.campaigns.find((c) => c.id === campaignId)?.clientName : undefined) || null
  const all = (ny.work.data ?? []).filter((w) => client === ALL || clientOf(w.campaignId) === client)
  const mine = ny.mine.filter((w) => client === ALL || clientOf(w.campaignId) === client)
  useClients(onClients, [...new Set((ny.work.data ?? []).map((w) => clientOf(w.campaignId)).filter((c): c is string => !!c))].sort())

  const today = iraqDay(now)
  const tomorrow = iraqDay(now + DAY_MS)
  const weekEnd = iraqDay(weekStart + 6 * DAY_MS)
  const dueOf = (w: (typeof mine)[number]) => w.committedDueAt ?? w.dueAt
  const late = mine.filter((w) => isLateTask({ status: w.status, committedDueAt: w.committedDueAt }, now))
  const changes = mine.filter(isChangesRequested)
  const limits = useRevisionLimits(all.map((w) => w.deliverableId).filter((d): d is string => !!d))
  const limitOf = (id: string | null) => (id ? limits.data?.get(id) ?? null : null)

  const lists = useMemo(() => {
    const row = (w: (typeof mine)[number]): MyPiece => {
      const due = dueOf(w)
      const tint = isLateTask({ status: w.status, committedDueAt: w.committedDueAt }, now) || (due && iraqDay(due) <= tomorrow && w.status === 'todo')
        ? 'risk'
        : isChangesRequested(w) ? 'warn' : w.status === 'todo' && w.revisionRound === 0 ? 'new' : 'quiet'
      const day = due ? (iraqDay(due) === today ? t('roleDashboard.today') : iraqDay(due) === tomorrow ? t('roleDashboard.tomorrow') : dayLabels[Math.floor((Date.parse(due) - weekStart) / DAY_MS)] ?? dateText(due)) : null
      const bits = [w.campaignName, day ? t('roleDashboard.member.due', { day }) : null]
      return { id: w.subTaskId, title: w.deliverableName ? `${w.deliverableName} — ${w.title}` : w.title, context: bits.filter(Boolean).join(' · '), tint, to: taskPage(w.subTaskId) }
    }
    const d = (w: (typeof mine)[number]) => (dueOf(w) ? iraqDay(dueOf(w)!) : null)
    return {
      today: mine.filter((w) => { const x = d(w); return x != null && x <= today }).map(row),
      tomorrow: mine.filter((w) => d(w) === tomorrow).map(row),
      week: mine.filter((w) => { const x = d(w); return x != null && x > tomorrow && x <= weekEnd }).map(row),
    }
  }, [mine, now, today, tomorrow, weekEnd, weekStart, dayLabels, t]) // eslint-disable-line react-hooks/exhaustive-deps

  const days = me ? hoursPerDay(bookings.bookings, me.id, weekStart) : [0, 0, 0, 0, 0, 0, 0]
  const hours = days.reduce((a, b) => a + b, 0)
  const before = me ? hoursPerDay(lastWeek.bookings, me.id, weekStart - 7 * DAY_MS).reduce((a, b) => a + b, 0) : 0
  const possible = 5 * 8
  const heaviest = days.indexOf(Math.max(...days))
  const load = pct(hours, possible)

  const nextUp = lists.today[0] ?? lists.tomorrow[0]
  const verdict = late.length > 0
    ? t('roleDashboard.verdict.memberLate', { count: late.length, name: late[0]!.deliverableName ?? late[0]!.title })
    : nextUp
      ? t('roleDashboard.verdict.memberNext', { name: nextUp.title, day: lists.today[0] ? t('roleDashboard.today') : t('roleDashboard.tomorrow') })
      : t('roleDashboard.verdict.memberClear')
  useVerdict(onVerdict, verdict)

  const stats: StatProps[] = [
    waitingCard(ny.items, now, t),
    {
      id: 'changes', icon: 'lines', label: t('roleDashboard.card.changes'), value: String(changes.length),
      caption: changes[0]
        ? t('roleDashboard.caption.roundOf', { name: changes[0].deliverableName ?? changes[0].title, round: changes[0].revisionRound, limit: limitOf(changes[0].deliverableId) ?? '—' })
        : t('roleDashboard.caption.noChanges'),
      to: changes[0] ? taskPage(changes[0].subTaskId) : '/my-work',
    },
    {
      id: 'week', icon: 'clock', label: t('roleDashboard.card.yourWeek'), value: `${load}%`,
      trend: { value: trendPct(hours, before), upIsGood: false },
      caption: t('roleDashboard.caption.hoursOf', { hours: Math.round(hours), possible }),
      to: '/my-work',
    },
    {
      id: 'late', icon: 'done', label: t('roleDashboard.card.late'), value: String(late.length),
      caption: late[0] ? late[0].deliverableName ?? late[0].title : t('roleDashboard.caption.nothingLate'),
      to: late[0] ? taskPage(late[0].subTaskId) : '/my-work',
    },
  ]

  // Where my work is — the pieces I have work on this week, by where my part stands (DB-M 1707:1318).
  const inWeek = all.filter((w) => { const d = dueOf(w); return d ? Date.parse(d) >= weekStart && Date.parse(d) < weekStart + 7 * DAY_MS : false })
  const ring = {
    delivered: inWeek.filter((w) => w.status === 'done').length,
    inProgress: inWeek.filter((w) => w.status === 'in_progress' && !isChangesRequested(w)).length,
    changes: inWeek.filter((w) => isChangesRequested(w)).length,
    notStarted: inWeek.filter((w) => w.status === 'todo' && !isChangesRequested(w)).length,
    waiting: inWeek.filter((w) => w.status === 'review').length,
  }

  // Rounds used — each piece: rounds of changes spent of those allowed (DB-M 1707:1358).
  const rounds: BarRow[] = [...all]
    .filter((w) => roundsOf === 'all' || (roundsOf === 'sent' ? w.revisionRound > 0 || w.status === 'review' || w.status === 'done' : w.status === 'todo' || w.status === 'in_progress'))
    .sort((a, b) => b.revisionRound - a.revisionRound || (dueOf(a) ?? '').localeCompare(dueOf(b) ?? ''))
    .slice(0, 5)
    .map((w) => {
      const limit = limitOf(w.deliverableId)
      const firstTime = w.status === 'done' && w.revisionRound === 0
      const unsent = w.revisionRound === 0 && (w.status === 'todo' || w.status === 'in_progress')
      return {
        id: w.subTaskId,
        name: w.deliverableName ?? w.title,
        note: firstTime ? t('roleDashboard.member.firstTime') : unsent ? t('roleDashboard.member.notSent')
          : t('roleDashboard.member.roundsOf', { round: w.revisionRound, limit: limit ?? '—' }),
        fill: firstTime ? 1 : unsent ? 1 : limit ? pct(w.revisionRound, limit) : 50,
        tone: firstTime ? 'ok' : unsent ? 'empty' : 'warn',
        to: taskPage(w.subTaskId),
      }
    })

  return (
    <>
      <StatRow stats={stats} />
      <ApprovalRow reach={reachFor('member', myId, [])} myId={myId} client={client} work={work} />
      <div className="db-row">
        <MyDeliverables lists={lists} action={<PanelLink to="/chat" id="db-ask">{t('roleDashboard.member.ask')}</PanelLink>} />
        <Panel id="my-week" icon="clock" title={t('roleDashboard.member.weekByDay')} wide action={<WeekChip id="db-week-myweek" week={week} onWeek={onWeek} />}>
          <Headline
            value={t('roleDashboard.hours', { count: Math.round(hours) })}
            trend={{ value: trendPct(hours, before), upIsGood: false }}
            note={hours > 0 ? t('roleDashboard.member.heaviest', { possible, day: dayLabels[heaviest] }) : t('roleDashboard.member.nothingBooked')}
          />
          <DayBars tall values={days} labels={dayLabels} off={OFF} peakLabel={(v) => t('roleDashboard.hours', { count: Math.round(v) })} />
        </Panel>
      </div>
      <div className="db-row">
        <Panel id="my-work-ring" icon="bars" title={t('roleDashboard.member.whereMyWorkIs')} action={<WeekChip id="db-week-ring" week={week} onWeek={onWeek} />}>
          <Ring
            unit={t('roleDashboard.unit.deliverables')}
            parts={[
              { key: 'delivered', label: t('roleDashboard.state.delivered'), value: ring.delivered, tone: 'ink' },
              { key: 'inProgress', label: t('roleDashboard.state.inProgress'), value: ring.inProgress, tone: 'blue' },
              { key: 'changes', label: t('roleDashboard.state.changes'), value: ring.changes, tone: 'warn' },
              { key: 'notStarted', label: t('roleDashboard.state.notStarted'), value: ring.notStarted, tone: 'empty' },
              { key: 'waiting', label: t('roleDashboard.state.waitingOnSomeone'), value: ring.waiting, tone: 'teal' },
            ]}
          />
        </Panel>
        <Panel id="rounds" icon="bars" title={t('roleDashboard.member.rounds')} wide
          action={<ChipSelect id="db-rounds-filter" label={t('roleDashboard.member.rounds')} value={roundsOf} onChange={setRoundsOf}
            options={[{ value: 'all', label: t('roleDashboard.chip.all') }, { value: 'sent', label: t('roleDashboard.chip.sent') }, { value: 'waiting', label: t('roleDashboard.chip.notSent') }]} />}>
          <BarList rows={rounds} empty={t('roleDashboard.member.noRounds')} />
        </Panel>
      </div>
      <TouchToday rows={touch} seeAll="/my-work" secondLabel={t('roleDashboard.touch.col.client')} empty={t('roleDashboard.touch.empty')} />
    </>
  )
}

// ------------------------------------------------------------------ Team Lead / Department Lead (Figma H DB-L)

export function LeadView({ view, myId, weekStart, week, onWeek, client, onClient, now, onVerdict, onClients }: ViewProps) {
  const { t } = useTranslation()
  const ny = useNeedsYouItems(myId)
  const work = useCompanyWork()
  const index = usePieceIndex(work)
  const scope = useScopeWork(weekStart)
  const loadWeeks = useLoadWeeks(weekStart)
  const bookings = useWeekBookings(weekStart)
  const touch = useTouchRows(ny.items, now, index)
  const dayLabels = useDayLabels(weekStart)
  const weekLabels = useWeekLabels(weekStart, now)
  const isDept = view === 'department'
  const [series, setSeries] = useState<string>(ALL)

  const clientOfTask = (x: { campaignId: string | null }) => (x.campaignId ? work.campaigns.find((c) => c.id === x.campaignId)?.clientName ?? null : null)
  useClients(onClients, [...new Set(scope.tasks.map(clientOfTask).filter((c): c is string => !!c))].sort())
  const tasks = scope.tasks.filter((x) => client === ALL || clientOfTask(x) === client)
  const late = tasks.filter((x) => isLate(x, null, now))
  const nobody = tasks.filter((x) => x.assigneeId == null)
  const over = scope.people.filter((p) => p.utilPct >= p.warnPct).sort((a, b) => b.utilPct - a.utilPct)
  const booked = scope.people.reduce((n, p) => n + p.bookedHours, 0)
  const possible = scope.people.reduce((n, p) => n + p.nominalHours, 0)
  const oldestNobody = [...nobody].filter((x) => x.tasksApprovedAt).sort((a, b) => Date.parse(a.tasksApprovedAt!) - Date.parse(b.tasksApprovedAt!))[0]

  // Hours booked over four weeks, one series per team in scope (DB-L: Design, Motion …).
  const teamOf = new Map(scope.people.map((p) => [p.id, p.teamName ?? t('roleDashboard.lead.noTeam')]))
  const teams = [...new Set(scope.people.map((p) => teamOf.get(p.id)!))]
  const tones = ['ink', 'violet', 'blue', 'teal', 'warn']
  const shown = series === ALL ? teams : teams.filter((x) => x === series)
  const weeks = loadWeeks.weeks.map((w, i) => {
    const values: Record<string, number> = {}
    for (const g of w.groups) for (const p of g.people) {
      const team = teamOf.get(p.id)
      if (!team || !shown.includes(team)) continue
      values[team] = Math.round((values[team] ?? 0) + p.bookedHours)
    }
    return { key: String(i), label: weekLabels[i]!, values, now: i === 3 }
  })
  const total = (i: number) => shown.reduce((n, x) => n + (weeks[i]?.values[x] ?? 0), 0)

  // Busiest day: the people in scope booked a full day, each day (DB-L 1707:958).
  const ids = new Set(scope.people.map((p) => p.id))
  const full = peopleFullPerDay(bookings.bookings, ids, weekStart)
  const busiest = full.indexOf(Math.max(...full))

  // The team's work: the pieces its tasks belong to, by where they stand (DB-L 1707:987).
  const pieceIds = [...new Set(tasks.map((x) => x.deliverableId))]
  const byPiece = pieceIds.map((id) => tasks.filter((x) => x.deliverableId === id))
  const pieceState = (ts: typeof tasks) =>
    ts.every((x) => x.status === 'done' || x.status === 'cancelled') ? 'delivered'
      : ts.some((x) => x.blockedSince != null || x.waitingOn != null) ? 'blocked'
        : workProgress(ts).phase === 'in_review' ? 'inReview' // the shared rule (I67.4)
          : ts.some((x) => x.assigneeId == null) ? 'unassigned' : 'inProgress'
  const states = byPiece.map(pieceState)
  const count = (s: string) => states.filter((x) => x === s).length

  // Load by person, with what fills their week (DB-L 1707:1037).
  const people: BarRow[] = [...scope.people].sort((a, b) => b.utilPct - a.utilPct).map((p) => {
    const theirs = tasks.filter((x) => x.assigneeId && x.assigneeId === p.userId)
    const blocked = theirs.some((x) => x.blockedSince != null || x.waitingOn != null)
    const days = hoursPerDay(bookings.bookings, p.id, weekStart).slice(0, 5)
    const free = days.map((h, i) => (h === 0 ? dayLabels[i] : null)).filter(Boolean) as string[]
    const next = [...theirs].filter((x) => x.status !== 'done' && x.committedDueAt).sort((a, b) => a.committedDueAt!.localeCompare(b.committedDueAt!))[0]
    const why = p.bookedHours === 0
      ? t('roleDashboard.lead.nothingBooked')
      : blocked ? t('roleDashboard.lead.blocked')
        : p.utilPct >= 80 && next ? t('roleDashboard.lead.nextDue', { name: next.pieceName || next.title })
          : free.length ? t('roleDashboard.lead.freeOn', { days: free.length > 1 ? `${free[0]}–${free[free.length - 1]}` : free[0] })
            : theirs.length > 0 ? t('roleDashboard.lead.tasks', { count: theirs.length })
              : t('roleDashboard.lead.hoursBooked', { hours: Math.round(p.bookedHours) })
    return {
      id: p.id,
      name: p.name,
      note: p.bookedHours === 0 ? why : `${p.utilPct}% · ${why}`,
      noteTone: p.utilPct >= 80 ? 'bad' : undefined,
      fill: p.utilPct,
      tone: loadTone(p.utilPct, blocked),
      to: '/team?tab=load',
    } satisfies BarRow
  })

  const heaviest = over[0] ?? [...scope.people].sort((a, b) => b.utilPct - a.utilPct)[0]
  const verdict = over.length > 0 && nobody.length > 0
    ? `${t('roleDashboard.verdict.leadOver', { count: over.length, name: heaviest?.name ?? '' })} ${t('roleDashboard.verdict.leadNobody', { count: nobody.length })}`
    : late.length > 0 ? t('roleDashboard.verdict.leadLate', { count: late.length })
      : nobody.length > 0 ? t('roleDashboard.verdict.leadNobody', { count: nobody.length })
        : t('roleDashboard.verdict.leadClear', { name: scope.scopeName })
  useVerdict(onVerdict, verdict)

  const stats: StatProps[] = [
    waitingCard(ny.items, now, t),
    {
      id: 'late', icon: 'done', label: t('roleDashboard.card.late'), value: String(late.length),
      caption: late[0] ? [...new Set(late.map((x) => x.pieceName || x.title))].slice(0, 2).join(' · ') : t('roleDashboard.caption.nothingLate'),
      to: '/team?tab=pieces&filter=atRisk',
    },
    {
      id: 'ceiling', icon: 'person', label: t('roleDashboard.card.atCeiling'), value: String(over.length),
      trend: undefined,
      caption: over.length ? over.slice(0, 2).map((p) => `${p.name} ${p.utilPct}%`).join(' · ') : t('roleDashboard.caption.loadOf', { pct: pct(booked, possible), count: scope.people.length }),
      to: '/team?tab=load',
    },
    {
      id: 'nobody', icon: 'warn', label: t('roleDashboard.card.nobody'), value: String(nobody.length),
      caption: oldestNobody ? t('roleDashboard.caption.oldestWaited', { span: spanText(t, oldestNobody.tasksApprovedAt, now) }) : t('roleDashboard.caption.allAssigned'),
      to: '/team?tab=pieces&filter=unassigned',
    },
  ]

  return (
    <>
      <StatRow stats={stats} />
      <ApprovalRow reach={reachFor(view, myId, scope.userIds)} myId={myId} client={client} work={work} />
      <div className="db-row">
        <Panel id="hours" icon="bars" title={t('roleDashboard.lead.hoursFourWeeks')} wide
          action={teams.length > 1 ? (
            <ChipSelect id="db-hours-filter" label={t('roleDashboard.chip.filter')} value={series} onChange={setSeries}
              options={[{ value: ALL, label: t('roleDashboard.chip.allTeams') }, ...teams.map((x) => ({ value: x, label: x }))]} />
          ) : undefined}>
          <Headline
            value={t('roleDashboard.hours', { count: total(3) })}
            trend={{ value: trendPct(total(3), total(2)), upIsGood: false }}
            note={t('roleDashboard.lead.ofPossible', { possible: Math.round(possible) })}
          />
          <WeekBars weeks={weeks} series={shown.map((x) => ({ key: x, label: x, tone: tones[teams.indexOf(x) % tones.length]! }))} />
        </Panel>
        <Panel id="busiest" icon="clock" title={t('roleDashboard.lead.busiestDay')} action={<WeekChip id="db-week-busiest" week={week} onWeek={onWeek} />}>
          <Headline
            value={full[busiest]! > 0 ? dayLabels[busiest]! : '—'}
            note={full[busiest]! > 0 ? t('roleDashboard.lead.peopleFull', { count: full[busiest] }) : t('roleDashboard.lead.nobodyFull')}
          />
          <DayBars values={full} labels={dayLabels} off={OFF} peakLabel={(v) => t('roleDashboard.lead.nFull', { count: v })} />
        </Panel>
      </div>
      <div className="db-row">
        <Panel id="work-ring" icon="lines" title={isDept ? t('roleDashboard.lead.departmentWork') : t('roleDashboard.lead.teamWork')}
          action={<ClientChip id="db-ring-client" client={client} onClient={onClient} clients={[...new Set(scope.tasks.map(clientOfTask).filter((c): c is string => !!c))].sort()} allLabel={t('roleDashboard.chip.allClients')} />}>
          <Ring
            unit={t('roleDashboard.unit.deliverables')}
            parts={[
              { key: 'inProgress', label: t('roleDashboard.state.inProgress'), value: count('inProgress'), tone: 'blue' },
              { key: 'delivered', label: t('roleDashboard.state.delivered'), value: count('delivered'), tone: 'ink' },
              { key: 'inReview', label: t('roleDashboard.state.inReview'), value: count('inReview'), tone: 'teal' },
              { key: 'unassigned', label: t('roleDashboard.state.unassigned'), value: count('unassigned'), tone: 'warn' },
              { key: 'blocked', label: t('roleDashboard.state.blocked'), value: count('blocked'), tone: 'risk' },
            ]}
          />
        </Panel>
        <Panel id="people" icon="person" title={t('roleDashboard.lead.loadByPerson')} wide action={<WeekChip id="db-week-people" week={week} onWeek={onWeek} />}>
          <BarList rows={people} empty={t('roleDashboard.lead.noPeople')} />
        </Panel>
      </div>
      <TouchToday rows={touch} seeAll="/my-work" secondLabel={t('roleDashboard.touch.col.client')} empty={t('roleDashboard.touch.empty')} />
    </>
  )
}

// ------------------------------------------------------------------ Client Services (Figma H DB-AM)

export function ClientView({ view, myId, weekStart, week, onWeek, client, onClient, now, onVerdict, onClients }: ViewProps) {
  const { t } = useTranslation()
  const ny = useNeedsYouItems(myId)
  const work = useCompanyWork()
  const index = usePieceIndex(work)
  const touch = useTouchRows(ny.items, now, index)
  const dayLabels = useDayLabels(weekStart)
  const weekLabels = useWeekLabels(weekStart, now)
  const director = view === 'director'
  const [newestFirst, setNewestFirst] = useState(false)
  const [live, setLive] = useState<'live' | 'done' | 'all'>('live')

  const mineAll = work.campaigns.filter((c) => director || c.accountManagerId === myId)
  useClients(onClients, [...new Set(mineAll.map((c) => c.clientName))].sort())
  const campaigns = mineAll.filter((c) => client === ALL || c.clientName === client)
  const ids = new Set(campaigns.map((c) => c.id))
  const pieces = work.pieces.filter((p) => ids.has(p.campaignId))
  const byCampaign = piecesByCampaign(pieces)
  const liveP = pieces.filter((p) => p.state !== 'approved' && p.state !== 'delivered')
  const risky = threatened(pieces, now)
  const waiting = waitingOnClient(pieces)
  const danger = goLivesInDanger(campaigns, byCampaign, weekStart, now)
  const dueWeek = pieces.filter((p) => p.dueAt && Date.parse(p.dueAt) >= weekStart && Date.parse(p.dueAt) < weekStart + 7 * DAY_MS)
  const dueDays = perDay(dueWeek.map((p) => p.dueAt), weekStart)
  const peakDay = dueDays.indexOf(Math.max(...dueDays))
  const starts = [3, 2, 1, 0].map((n) => weekStart - n * 7 * DAY_MS)
  const outcomes = dueOutcomes(pieces, starts, now)
  const earlier = dueOutcomes(pieces, [7, 6, 5, 4].map((n) => weekStart - n * 7 * DAY_MS), now)
  const sum = (xs: typeof outcomes) => xs.reduce((n, w) => n + w.onTime + w.late + w.inReview + w.open, 0)
  const nameOf = new Map(campaigns.map((c) => [c.id, c]))

  const thisWeek = outcomes[3]!
  const dueNow = thisWeek.onTime + thisWeek.late + thisWeek.inReview + thisWeek.open
  const riskyThisWeek = risky.filter((p) => dueWeek.includes(p)).length
  const verdict = riskyThisWeek > 0
    ? t('roleDashboard.verdict.clientRisk', { ok: Math.max(0, dueNow - riskyThisWeek), total: dueNow, count: riskyThisWeek })
    : risky.length > 0
      ? t('roleDashboard.verdict.clientEarlierLate', { total: dueNow, count: risky.length })
      : t('roleDashboard.verdict.clientClear', { total: liveP.length })
  useVerdict(onVerdict, ny.items.length > 0 ? `${verdict} ${t('roleDashboard.verdict.andWaiting', { count: ny.items.length })}` : verdict)

  const stats: StatProps[] = [
    waitingCard(ny.items, now, t),
    {
      id: 'risk', icon: 'warn', label: t('roleDashboard.card.atRisk'), value: String(risky.length),
      caption: risky[0] ? `${nameOf.get(risky[0].campaignId)?.name ?? ''} · ${risky[0].name}` : t('roleDashboard.caption.allOnTime'),
      to: risky[0] ? `/campaigns/${risky[0].campaignId}` : '/campaigns',
    },
    {
      id: 'client', icon: 'pause', label: t('roleDashboard.card.waitingOnClient'), value: String(waiting.length),
      caption: waiting.length ? t('roleDashboard.caption.inputsOutstanding', { count: waiting.reduce((n, p) => n + p.outstandingInputs, 0) }) : t('roleDashboard.caption.nothingFromClient'),
      to: waiting[0] ? `/campaigns/${waiting[0].campaignId}` : '/campaigns',
    },
    {
      id: 'golive', icon: 'clock', label: t('roleDashboard.card.goLive'), value: String(danger.length),
      caption: danger[0] ? danger.map((c) => c.name).slice(0, 2).join(' · ') : t('roleDashboard.caption.goLivesSafe'),
      to: danger[0] ? `/campaigns/${danger[0].id}` : '/campaigns',
    },
  ]

  const weeks = outcomes.map((o, i) => ({ key: String(i), label: weekLabels[i]!, values: o as unknown as Record<string, number>, now: i === 3 }))
  if (newestFirst) weeks.reverse()

  // Campaigns (DB-AM 1707:…): delivered of total, and the one thing to know about each. Finished means handed to
  // the client — a set approved inside but not yet signed off is still live, and says so.
  const campaignRows: BarRow[] = campaigns
    .filter((c) => c.status === 'approved')
    .map((c) => {
      const ps = byCampaign.get(c.id) ?? []
      const delivered = ps.filter((p) => p.state === 'delivered').length
      const done = ps.filter((p) => p.state === 'approved' || p.state === 'delivered').length
      const atRisk = threatened(ps, now).length
      const nobody = nobodyOnIt(ps, work.statusOf).length
      const wait = waitingOnClient(ps).length
      const started = ps.filter((p) => p.tasks.some((x) => x.status !== 'todo' && x.status !== 'cancelled')).length
      const finished = ps.length > 0 && delivered === ps.length
      const note = finished ? t('roleDashboard.client.allDone', { count: ps.length })
        : nobody > 0 ? t('roleDashboard.client.nobodyOn', { count: nobody })
          : atRisk > 0 ? t('roleDashboard.client.nAtRisk', { count: atRisk })
            : wait > 0 ? t('roleDashboard.client.waitingSignOff')
              : done > 0 ? t('roleDashboard.client.delivered', { done, total: ps.length })
                : started > 0 ? t('roleDashboard.client.inProgress', { count: started }) : t('roleDashboard.client.notStarted')
      return {
        id: c.id,
        name: director ? `${c.clientName} · ${c.name}` : c.name,
        note,
        noteTone: nobody > 0 || atRisk > 0 ? ('bad' as const) : undefined,
        fill: pct(done, ps.length),
        tone: finished ? 'ok' : campaignTone({ total: ps.length, done: done === ps.length ? ps.length - 1 : done, atRisk, nobody, waiting: wait }),
        to: `/campaigns/${c.id}`,
        finished,
      }
    })
    .filter((r) => live === 'all' || (live === 'done' ? r.finished : !r.finished))
    .slice(0, 6)

  const counts = breakdown(pieces)
  return (
    <>
      <StatRow stats={stats} />
      <ApprovalRow reach={reachFor(view, myId, [])} myId={myId} client={client} work={work} />
      <div className="db-row">
        <Panel id="deliveries" icon="bars" title={t('roleDashboard.client.deliveriesFourWeeks')} wide
          action={<>
            <ClientChip id="db-deliveries-client" client={client} onClient={onClient} clients={[...new Set(mineAll.map((c) => c.clientName))].sort()} allLabel={t('roleDashboard.chip.filter')} />
            <ChipButton id="db-deliveries-sort" pressed={newestFirst} onClick={() => setNewestFirst((v) => !v)}>{t('roleDashboard.chip.sort')}</ChipButton>
          </>}>
          <Headline value={String(sum(outcomes))} trend={{ value: trendPct(sum(outcomes), sum(earlier)), upIsGood: true }}
            note={sum(earlier) > 0 ? t('roleDashboard.client.onLastFour', { delta: `${sum(outcomes) - sum(earlier) >= 0 ? '+' : '−'}${Math.abs(sum(outcomes) - sum(earlier))}` }) : t('roleDashboard.client.dueFourWeeks')} />
          <WeekBars
            weeks={weeks}
            series={[
              { key: 'onTime', label: t('roleDashboard.series.onTime'), tone: 'ink' },
              { key: 'late', label: t('roleDashboard.series.late'), tone: 'violet' },
              { key: 'inReview', label: t('roleDashboard.series.inReview'), tone: 'blue' },
              { key: 'open', label: t('roleDashboard.series.stillOpen'), tone: 'teal' },
            ]}
          />
        </Panel>
        <Panel id="due" icon="clock" title={t('roleDashboard.dueThisWeek')} action={<WeekChip id="db-week-due" week={week} onWeek={onWeek} />}>
          <Headline value={String(dueWeek.length)} note={dueDays[peakDay]! > 0 ? t('roleDashboard.mostOn', { count: dueDays[peakDay], day: dayLabels[peakDay] }) : t('roleDashboard.nothingDue')} />
          <DayBars values={dueDays} labels={dayLabels} off={OFF} peakLabel={(v) => t('roleDashboard.nDue', { count: v })} />
        </Panel>
      </div>
      <div className="db-row">
        <Panel id="work-ring" icon="lines" title={t('roleDashboard.client.whereWorkIs')}
          action={<ClientChip id="db-ring-client" client={client} onClient={onClient} clients={[...new Set(mineAll.map((c) => c.clientName))].sort()} allLabel={t('roleDashboard.chip.allClients')} />}>
          <Ring
            unit={t('roleDashboard.unit.deliverables')}
            parts={[
              { key: 'delivered', label: t('roleDashboard.state.delivered'), value: counts.delivered, tone: 'ink' },
              { key: 'inProgress', label: t('roleDashboard.state.inProgress'), value: counts.inProgress, tone: 'blue' },
              { key: 'notStarted', label: t('roleDashboard.state.notStarted'), value: counts.notStarted, tone: 'empty' },
              { key: 'inReview', label: t('roleDashboard.state.inReview'), value: counts.inReview, tone: 'teal' },
              { key: 'blocked', label: t('roleDashboard.state.blocked'), value: counts.blocked, tone: 'risk' },
            ]}
          />
        </Panel>
        <Panel id="campaigns" icon="bars" title={t('roleDashboard.client.campaigns')} wide
          action={<ChipSelect id="db-campaigns-live" label={t('roleDashboard.client.campaigns')} value={live} onChange={setLive}
            options={[{ value: 'live', label: t('roleDashboard.chip.live') }, { value: 'done', label: t('roleDashboard.chip.finished') }, { value: 'all', label: t('roleDashboard.chip.all') }]} />}>
          <BarList rows={campaignRows} empty={t('roleDashboard.client.noCampaigns')} />
        </Panel>
      </div>
      <TouchToday rows={touch} seeAll="/my-work" secondLabel={t('roleDashboard.touch.col.client')} empty={t('roleDashboard.touch.empty')} />
    </>
  )
}

// ------------------------------------------------------------------ the company views: Traffic, C-Level, Power Admin

export function CompanyView({ view, myId, weekStart, week, onWeek, client, onClient, now, onVerdict, onClients }: ViewProps) {
  const { t } = useTranslation()
  const work = useCompanyWork()
  const loadWeeks = useLoadWeeks(weekStart)
  const booked = useWeekBookings(weekStart)
  // ADR-0122 d.4: every figure opens where it comes from. "Read-only" (d.2) is what the C-level may CHANGE, not
  // where they may look (Edward, 28 Sep: "no drill down capability") — so each link follows the viewer's own
  // permission to open that page, never the view.
  const { can } = usePermissions()
  const canTeam = can('team:view')
  const canCampaigns = can('projects:view')
  // The list opens narrowed to what the card counted (I61.17), on the client the dashboard is filtered to.
  const clientQuery = client === ALL ? '' : `&client=${encodeURIComponent(client)}`
  const readOnly = view === 'clevel'
  const weekLabels = useWeekLabels(weekStart, now)
  const [series, setSeries] = useState<string>(ALL)

  useClients(onClients, [...new Set(work.campaigns.map((c) => c.clientName))].sort())
  const campaigns = work.campaigns.filter((c) => client === ALL || c.clientName === client)
  const cids = new Set(campaigns.map((c) => c.id))
  const pieces = work.pieces.filter((p) => cids.has(p.campaignId))

  const thisWeek = loadWeeks.weeks[3]!
  const people = thisWeek.groups.flatMap((g) => g.people)
  const over = people.filter((p) => p.utilPct >= p.warnPct)
  const hours = people.reduce((n, p) => n + p.bookedHours, 0)
  const possible = people.reduce((n, p) => n + p.nominalHours, 0)
  const companyPct = pct(hours, possible)

  const depts = new Map<string, { name: string; booked: number; possible: number; count: number }>()
  for (const p of people) {
    if (!p.departmentId) continue
    const d = depts.get(p.departmentId) ?? { name: p.departmentName ?? '', booked: 0, possible: 0, count: 0 }
    d.booked += p.bookedHours
    d.possible += p.nominalHours
    d.count += 1
    depts.set(p.departmentId, d)
  }
  const deptList = [...depts.entries()].map(([id, d]) => ({ id, name: d.name, util: pct(d.booked, d.possible), count: d.count })).sort((a, b) => b.util - a.util)
  const deptRows: BarRow[] = deptList.map((d) => ({
    id: d.id,
    name: d.name,
    note: t('roleDashboard.company.deptNote', { pct: d.util, count: d.count }),
    noteTone: d.util >= 100 ? 'bad' : undefined,
    fill: d.util,
    tone: loadTone(d.util),
    to: canTeam ? `/team?dept=${d.id}` : undefined,
  }))
  const pressure = deptList[0]

  // Hours booked over four weeks, one series per department (the frames' shape at company altitude).
  const deptNames = deptList.map((d) => d.name)
  const shown = series === ALL ? deptNames : deptNames.filter((x) => x === series)
  const tones = ['ink', 'violet', 'blue', 'teal', 'warn']
  const weeks = loadWeeks.weeks.map((w, i) => {
    const values: Record<string, number> = {}
    for (const g of w.groups) for (const p of g.people) {
      if (!p.departmentName || !shown.includes(p.departmentName)) continue
      values[p.departmentName] = Math.round((values[p.departmentName] ?? 0) + p.bookedHours)
    }
    return { key: String(i), label: weekLabels[i]!, values, now: i === 3 }
  })
  const total = (i: number) => shown.reduce((n, x) => n + (weeks[i]?.values[x] ?? 0), 0)

  const risky = threatened(pieces, now)
  const riskyCampaigns = new Set(risky.map((p) => p.campaignId))
  const danger = goLivesInDanger(campaigns, piecesByCampaign(pieces), weekStart, now)
  const nobody = nobodyOnIt(pieces, work.statusOf)
  const lateTasks = pieces.flatMap((p) => p.tasks).filter((x) => isLateTask(x, now))
  const found = clashes(booked.bookings.map((b) => ({ id: b.id, resourceId: b.resourceId, start: b.start, end: b.end, loadPct: b.loadPct })), booked.kindOf)
  const clashedResources = [...new Set(found.map((c) => c.resourceId))]

  const verdict = t('roleDashboard.verdict.company', { pct: companyPct }) + (pressure && pressure.util >= 100
    ? ` ${t('roleDashboard.verdict.pressure', { name: pressure.name, pct: pressure.util })}` : '')
  useVerdict(onVerdict, verdict)

  const lateCard: StatProps = {
    id: 'late', icon: 'done', label: t('roleDashboard.card.late'), value: String(lateTasks.length),
    caption: t('roleDashboard.caption.lateAcross', { count: new Set(pieces.filter((p) => p.tasks.some((x) => isLateTask(x, now))).map((p) => p.campaignId)).size }),
    to: canCampaigns ? `/campaigns?alert=late${clientQuery}` : undefined,
  }
  const stats: StatProps[] = view === 'traffic'
    ? [
        {
          id: 'clashes', icon: 'warn', label: t('roleDashboard.card.clashes'), value: String(found.length),
          caption: clashedResources.length ? clashedResources.slice(0, 2).map(booked.nameOf).join(' · ') : t('roleDashboard.caption.noClashes'),
          to: '/schedule',
        },
        {
          id: 'nobody', icon: 'lines', label: t('roleDashboard.card.nobody'), value: String(nobody.length),
          caption: nobody[0] ? t('roleDashboard.caption.acrossCampaigns', { count: new Set(nobody.map((n) => n.piece.campaignId)).size }) : t('roleDashboard.caption.allAssigned'),
          to: '/team?tab=pieces&filter=unassigned',
        },
        {
          id: 'over', icon: 'person', label: t('roleDashboard.card.overCeiling'), value: String(over.length),
          caption: over.length ? [...over].sort((a, b) => b.utilPct - a.utilPct).slice(0, 2).map((p) => `${p.name} ${p.utilPct}%`).join(' · ') : t('roleDashboard.caption.nobodyOver'),
          to: '/team?tab=load',
        },
        lateCard,
      ]
    : [
        {
          id: 'risk', icon: 'warn', label: t('roleDashboard.card.campaignsAtRisk'), value: String(riskyCampaigns.size),
          caption: t('roleDashboard.caption.piecesAtRisk', { count: risky.length }),
          to: canCampaigns ? `/campaigns?alert=atRisk${clientQuery}` : undefined,
        },
        {
          id: 'golive', icon: 'clock', label: t('roleDashboard.card.goLive'), value: String(danger.length),
          caption: danger[0] ? danger.map((c) => c.name).slice(0, 2).join(' · ') : t('roleDashboard.caption.goLivesSafe'),
          to: canCampaigns ? (danger[0] ? `/campaigns/${danger[0].id}` : '/campaigns') : undefined,
        },
        {
          id: 'depts', icon: 'person', label: t('roleDashboard.card.deptsOver'), value: String(deptList.filter((d) => d.util >= 100).length),
          caption: pressure ? t('roleDashboard.caption.pressure', { name: pressure.name, pct: pressure.util }) : '—',
          // The department under the most pressure, on its load — the card names it.
          to: canTeam ? (pressure ? `/team?tab=load&dept=${pressure.id}` : '/team?tab=load') : undefined,
        },
        lateCard,
      ]

  const counts = breakdown(pieces)
  const clientRisk = new Map<string, { client: string; campaigns: Set<string>; pieces: number; worst: Map<string, number> }>()
  for (const p of risky) {
    const c = campaigns.find((x) => x.id === p.campaignId)
    if (!c) continue
    const r = clientRisk.get(c.clientName) ?? { client: c.clientName, campaigns: new Set<string>(), pieces: 0, worst: new Map<string, number>() }
    r.campaigns.add(c.name)
    r.pieces += 1
    r.worst.set(c.id, (r.worst.get(c.id) ?? 0) + 1)
    clientRisk.set(c.clientName, r)
  }
  const clientRows: BarRow[] = [...clientRisk.values()].sort((a, b) => b.pieces - a.pieces).slice(0, 6).map((r) => ({
    id: r.client,
    name: `${r.client} · ${[...r.campaigns].slice(0, 2).join(', ')}`,
    note: t('roleDashboard.client.nAtRisk', { count: r.pieces }),
    noteTone: 'bad',
    fill: pct(r.pieces, Math.max(1, risky.length)),
    tone: 'risk',
    // The client's campaign with the most pieces at risk — where the problem is.
    to: canCampaigns ? `/campaigns/${[...r.worst.entries()].sort((a, b) => b[1] - a[1])[0]![0]}` : undefined,
  }))

  return (
    <>
      {view === 'admin' ? <AdminTopBar late={lateCard} /> : <StatRow stats={stats} />}
      <ApprovalRow reach={reachFor(view, myId, [])} myId={myId} client={client} work={work} />
      <div className="db-row">
        <Panel id="load-weeks" icon="bars" title={t('roleDashboard.company.loadFourWeeks')} wide
          action={<ChipSelect id="db-load-filter" label={t('roleDashboard.chip.filter')} value={series} onChange={setSeries}
            options={[{ value: ALL, label: t('roleDashboard.chip.allDepartments') }, ...deptNames.map((x) => ({ value: x, label: x }))]} />}>
          <Headline
            value={t('roleDashboard.hours', { count: total(3) })}
            trend={{ value: trendPct(total(3), total(2)), upIsGood: false }}
            note={t('roleDashboard.company.people', { count: people.length, over: over.length, free: Math.max(0, Math.round(possible - hours)), pct: companyPct })}
          />
          <WeekBars weeks={weeks} series={shown.map((x) => ({ key: x, label: x, tone: tones[deptNames.indexOf(x) % tones.length]! }))} />
        </Panel>
        <Panel id="depts" icon="person" title={t('roleDashboard.company.deptLoad')} action={<WeekChip id="db-week-depts" week={week} onWeek={onWeek} />}>
          <BarList rows={deptRows} empty={t('roleDashboard.company.noDepts')} />
        </Panel>
      </div>
      <div className="db-row">
        <Panel id="work-ring" icon="lines" title={t('roleDashboard.client.whereWorkIs')}
          action={<ClientChip id="db-ring-client" client={client} onClient={onClient} clients={[...new Set(work.campaigns.map((c) => c.clientName))].sort()} allLabel={t('roleDashboard.chip.allClients')} />}>
          <Ring
            unit={t('roleDashboard.unit.deliverables')}
            parts={[
              { key: 'delivered', label: t('roleDashboard.state.delivered'), value: counts.delivered, tone: 'ink' },
              { key: 'inProgress', label: t('roleDashboard.state.inProgress'), value: counts.inProgress, tone: 'blue' },
              { key: 'notStarted', label: t('roleDashboard.state.notStarted'), value: counts.notStarted, tone: 'empty' },
              { key: 'inReview', label: t('roleDashboard.state.inReview'), value: counts.inReview, tone: 'teal' },
              { key: 'blocked', label: t('roleDashboard.state.blocked'), value: counts.blocked, tone: 'risk' },
            ]}
          />
        </Panel>
        <Panel id="client-risk" icon="warn" title={t('roleDashboard.company.riskByClient')} wide>
          <BarList rows={clientRows} empty={t('roleDashboard.company.noRisk')} />
        </Panel>
      </div>
      {!readOnly && <CompanyTouch myId={myId} now={now} work={work} />}
    </>
  )
}

function CompanyTouch({ myId, now, work }: { myId: string; now: number; work: ReturnType<typeof useCompanyWork> }) {
  const { t } = useTranslation()
  const ny = useNeedsYouItems(myId)
  const index = usePieceIndex(work)
  const touch = useTouchRows(ny.items, now, index)
  return <TouchToday rows={touch} seeAll="/my-work" secondLabel={t('roleDashboard.touch.col.client')} empty={t('roleDashboard.touch.empty')} />
}

/**
 * The Power Admin's top bar: what the system is failing to reach (I61.4 — the rows Maestro records), and late work.
 * Its own component, so the admin-only reads run only for the Power Admin.
 */
function AdminTopBar({ late }: { late: StatProps }) {
  const { t } = useTranslation()
  const nobody = useEscalationsReachingNobody()
  const users = useUsers()
  const roles = useRolesAdmin()
  const holders = useRoleHolderCounts()
  const noRole = (users.data ?? []).filter((u) => u.isActive && !u.roleId)
  const empty = (roles.data ?? []).filter((r) => r.status === 'active' && r.key !== 'client_portal' && (holders.data?.get(r.id) ?? 0) === 0)
  const kinds = nobody.data ?? []
  const stats: StatProps[] = [
    {
      id: 'reach-nobody', icon: 'warn', label: t('roleDashboard.card.reachNobody'), value: String(kinds.length),
      caption: kinds.length ? kinds.slice(0, 2).map((k) => t(`roleDashboard.escalation.${k}`, { defaultValue: k })).join(' · ') : t('roleDashboard.caption.allReached'),
      to: '/admin/organization',
    },
    {
      id: 'no-role', icon: 'person', label: t('roleDashboard.card.noRole'), value: String(noRole.length),
      caption: noRole.length ? noRole.slice(0, 2).map((u) => u.displayName).join(' · ') : t('roleDashboard.caption.everyoneHasRole'),
      to: '/admin/users',
    },
    {
      id: 'empty-roles', icon: 'lines', label: t('roleDashboard.card.emptyRoles'), value: String(empty.length),
      caption: empty.length ? empty.slice(0, 2).map((r) => r.name).join(' · ') : t('roleDashboard.caption.everyRoleHeld'),
      to: '/admin/roles',
    },
  ]
  return <StatRow stats={[...stats, late]} />
}

export type { DashCampaign, DashPiece, TeamLoadPerson }
export { ALL }
