import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../app/auth-context'
import { usePermissions } from '../../app/permissions'
import { NewsFeed } from '../news/NewsFeed'
import { useMe } from './api/dashboard-data'
import { ChipSelect } from './components/blocks'
import { weekStartOf } from './lib/figures'
import { pickView, type DashboardView } from './lib/pick-view'
import { ALL, ClientView, CompanyView, LeadView, MemberView, type ViewProps, type WeekChoice } from './views'
import { formatCalendarDay } from '../../lib/time/iraq'

const DAY_MS = 24 * 60 * 60 * 1000

const VIEWS: Record<DashboardView, (p: ViewProps) => React.JSX.Element> = {
  admin: CompanyView,
  traffic: CompanyView,
  clevel: CompanyView,
  director: ClientView,
  account: ClientView,
  department: LeadView,
  team: LeadView,
  member: MemberView,
}

/**
 * The Dashboard (ADR-0122, I61) — one page for every signed-in person, the view chosen from their reach and
 * permissions, never their role's name (d.2). The shape is Figma section H: who is looking, the page title, one
 * sentence that is the conclusion, and on the right the week's dates, "This week ⌄" and "Filter"; then the top bar
 * of problems, two charts, a breakdown, and what to touch today. Every view shows only what the person already
 * reaches elsewhere (d.6); the reads are the Team page's, the campaigns list's and Needs you's own.
 */
export function RoleDashboardPage() {
  const { t, i18n } = useTranslation()
  const { session } = useAuth()
  const myId = session?.user.id ?? null
  const perms = usePermissions()
  const me = useMe(myId)
  const view = pickView(perms)
  const [verdict, setVerdict] = useState('')
  const onVerdict = useCallback((text: string) => setVerdict((prev) => (prev === text ? prev : text)), [])
  const [clients, setClients] = useState<string[]>([])
  const onClients = useCallback((names: string[]) => setClients((prev) => (prev.join('|') === names.join('|') ? prev : names)), [])
  const [week, setWeek] = useState<WeekChoice>('0')
  const [client, setClient] = useState<string>(ALL)

  // The clock is read once when the page opens, so every figure reads the same moment; the week follows the chip.
  const [now] = useState(() => Date.now())
  const weekStart = useMemo(() => weekStartOf(now) + Number(week) * 7 * DAY_MS, [now, week])
  const range = useMemo(() => {
    // I66.8: both ends as every date reads — "Sun, 27 Sep – Thu, 1 Oct".
    const day = (ms: number) => formatCalendarDay(new Date(ms).toISOString().slice(0, 10), i18n.language === 'ar' ? 'ar' : 'en')
    return `${day(weekStart)} – ${day(weekStart + 4 * DAY_MS)}`
  }, [weekStart, i18n.language])

  if (!perms.ready || !myId) return <p data-testid="dashboard-loading">…</p>
  if (perms.failed) return <p className="form-error">{t('roleDashboard.loadFailed')}</p>

  const View = VIEWS[view]
  const who = [me.data?.name, me.data?.jobTitle ?? perms.roleName].filter(Boolean).join(' · ')

  return (
    <section className="db-page" data-testid="surface-role-dashboard" data-view={view}>
      <header className="db-head">
        <div className="db-head-text">
          <span className="db-who">{who}</span>
          <h1 className="db-title">{t('roleDashboard.title')}</h1>
          <p className="db-verdict" data-testid="db-verdict">{verdict}</p>
        </div>
        <div className="db-head-chips">
          <span className="db-chip db-chip-static" data-testid="db-week">{range}</span>
          <ChipSelect id="db-week-choice" label={t('roleDashboard.chip.week')} value={week} onChange={setWeek}
            options={[{ value: '-1', label: t('roleDashboard.chip.lastWeek') }, { value: '0', label: t('roleDashboard.thisWeek') }, { value: '1', label: t('roleDashboard.chip.nextWeek') }]} />
          {clients.length > 0 && (
            <ChipSelect id="db-filter" label={t('roleDashboard.chip.filter')} value={client} onChange={setClient}
              options={[{ value: ALL, label: t('roleDashboard.chip.filter') }, ...clients.map((c) => ({ value: c, label: c }))]} />
          )}
        </div>
      </header>
      <div className="db-body">
        {/* re-mounted per person: view-as (ADR-0120) swaps the session, and each view keeps its own state */}
        <View key={`${myId}-${view}`} view={view} myId={myId} weekStart={weekStart} week={week} onWeek={setWeek}
          client={client} onClient={setClient} now={now} onVerdict={onVerdict} onClients={onClients} />
      </div>
      <NewsFeed />
    </section>
  )
}
