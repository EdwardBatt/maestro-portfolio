import { useMemo } from 'react'
import { pieceHref } from '../../lib/navigation/piece-link'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { useAuth } from '../../app/auth-context'
import { formatIraqDate } from '../../lib/time/iraq'
import { Button } from '../../components/Button'
import {
  useApprovalReach,
  useBriefRows,
  useCompanyWork,
  usePeopleNames,
  useTaskListWaiting,
} from '../dashboard/api/dashboard-data'
import { approvalFigures } from '../dashboard/lib/approvals'
import { spanText } from '../dashboard/lib/span'

/**
 * Task lists not approved (I66.6, Edward 29 Sep: "clicking on the task lists not approved should return a
 * filtered view… not all campaigns") — what the Dashboard card counted, one row per list: the piece, its
 * campaign and client, the owner it waits on, and how long it has waited. The same rows as the card, by the
 * same rule (`approvalFigures`) over the same reach (`useApprovalReach`), so the list and the figure agree.
 * `?client=` when the Dashboard was on one client. Oldest first — what has waited longest is the first to chase.
 */
export function TaskListsWaitingPage() {
  const { t, i18n } = useTranslation()
  const loc = i18n.language === 'ar' ? 'ar' : 'en'
  const { session } = useAuth()
  const myId = session?.user.id ?? null
  const [params] = useSearchParams()
  const client = params.get('client')

  const { reach, isLoading: reachLoading } = useApprovalReach(myId)
  const work = useCompanyWork()
  const briefs = useBriefRows()
  const names = usePeopleNames()
  const since = useTaskListWaiting()
  const now = useMemo(() => Date.now(), [since.dataUpdatedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    if (!reach) return []
    const campaign = new Map(work.campaigns.map((c) => [c.id, c]))
    const piece = new Map(work.pieces.map((p) => [p.id, p]))
    return approvalFigures(briefs.data ?? [], work.campaigns, work.pieces, reach, client)
      .taskLists.map((w) => {
        const c = campaign.get(piece.get(w.id)?.campaignId ?? '')
        return { ...w, campaignId: c?.id ?? null, campaign: c?.name ?? '', client: c?.clientName ?? '', since: since.data?.get(w.id) ?? null }
      })
      .sort((a, b) => (a.since ? Date.parse(a.since) : Infinity) - (b.since ? Date.parse(b.since) : Infinity) || a.name.localeCompare(b.name))
  }, [reach, work.campaigns, work.pieces, briefs.data, client, since.data])

  const loading = reachLoading || work.isLoading || since.isLoading
  const owner = (id: string | null) => (id == null ? t('roleDashboard.caption.nobodyNamed') : id === myId ? t('roleDashboard.caption.you') : names.data?.get(id) || '—')

  return (
    <section data-testid="surface-task-lists-waiting">
      <header className="schedule-bar">
        <h1>{t('taskListsWaiting.title')}</h1>
      </header>
      <p className="muted">
        {client ? t('taskListsWaiting.introClient', { client }) : t('taskListsWaiting.intro')}
      </p>

      {work.isError || since.isError ? (
        <p className="form-error">{t('taskListsWaiting.loadFailed')}</p>
      ) : loading ? (
        <p className="muted" data-testid="task-lists-waiting-loading">…</p>
      ) : rows.length === 0 ? (
        <p className="muted" data-testid="task-lists-waiting-empty">{t('taskListsWaiting.empty')}</p>
      ) : (
        <>
          <p data-testid="task-lists-waiting-count">{t('taskListsWaiting.count', { count: rows.length })}</p>
          <table className="data-table" data-testid="task-lists-waiting-table">
            <thead>
              <tr>
                <th>{t('taskListsWaiting.colDeliverable')}</th>
                <th>{t('taskListsWaiting.colCampaign')}</th>
                <th>{t('taskListsWaiting.colClient')}</th>
                <th>{t('taskListsWaiting.colWaitingOn')}</th>
                <th>{t('taskListsWaiting.colWaited')}</th>
                <th><span className="sr-only">{t('taskListsWaiting.colOpen')}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid={`task-list-waiting-row-${r.id}`}>
                  <td dir="auto">{r.name}</td>
                  <td dir="auto">{r.campaign}</td>
                  <td dir="auto">{r.client}</td>
                  <td dir="auto" data-testid={`task-list-waiting-owner-${r.id}`}>{owner(r.on)}</td>
                  <td title={r.since ? formatIraqDate(r.since, loc) : undefined}>{spanText(t, r.since, now)}</td>
                  <td>
                    <Button to={pieceHref(r.campaignId, r.id)} variant="secondary" size="sm" data-testid={`task-list-waiting-open-${r.id}`}>
                      {t('taskListsWaiting.open')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}
