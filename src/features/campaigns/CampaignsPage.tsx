import { useEffect, useMemo, useRef, useState } from 'react'
import { formatIraqDate, formatIraqShortDate } from '../../lib/time/iraq'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { usePermissions } from '../../app/permissions'
import { useAuth } from '../../app/auth-context'
import { PromoteDialog } from './components/PromoteDialog'
import { BusyDialog, NoticeDialog } from '../../components/Notice'
import { useCampaignList, useMyDrafts, useDiscardCampaignDraft, useCloseOutCampaign, useReopenCampaign, type CampaignListRow, type CampaignStatus } from './api/campaign-api'
import { useCampaignPulse } from './api/campaign-pulse-api'
import { buildCards, optionsOf, type CampaignCard, type Scope, type Timing } from './lib/campaign-cards'
import { openNewRequest } from '../intake/lib/new-request'
import { shortcutLabel } from '../intake/lib/shortcut'
import { usePromoteSingleJob } from '../intake/api/intake-api'
import { Button, DeleteButton, IconButton } from '../../components/Button'
import { Tag } from '../../components/Tag'

/** Stable empty fallback, so a query that has not resolved does not invalidate the memos below. */
const NO_ROWS: CampaignListRow[] = []

/** I48.1: a draft matches the search when the (lower-cased) query is a substring of its name, brand
 *  or client. Module-scoped so it is stable and the filter memos need not list it. */
const matchesQuery = (c: CampaignListRow, ql: string) =>
  ql === '' || [c.name, c.brandName, c.clientName].some((v) => (v ?? '').toLowerCase().includes(ql))

const STATUSES: readonly CampaignStatus[] = ['approved', 'pending_approval', 'closed']

/**
 * Campaigns — where everyone finds the work (Figma CG-00, I57.3).
 *
 * **Everyone sees every campaign** (Edward, 12 Sep, confirmed 24 Sep); most people only read it —
 * the write actions stay with `projects:manage`. The list opens on **Mine** (the account manager's
 * own, and any campaign I own a piece of, hold a task on, review or own a workstream of) with one
 * press to All; an empty Mine shows All and says so in one line, never an empty page.
 *
 * Each campaign is a card: its name, where it is in time, how many pieces are delivered, today's
 * status badge, and the ALERTS as separate badges, each only above zero (Edward: *"there are more
 * alerts than status"*) — at risk (ADR-0075), waiting on client (the temporary rule), tasks
 * unassigned, task lists to approve. The numbers come from `lib/campaigns/pulse`; the choice of
 * cards from `lib/campaign-cards`. This file is the layout.
 *
 * ADR-0067 d.3: a `draft` is a wizard somebody walked away from, not a campaign. It is listed
 * **separately, as unfinished**. Drafts are **never swept** (d.7): the only way one goes is by hand,
 * and the database refuses even that once anything is filed under it.
 */
export function CampaignsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { can } = usePermissions()
  const { session } = useAuth()
  const me = session?.user.id ?? null
  const canManage = can('projects:manage')
  const { data, isLoading, isError } = useCampaignList()
  const pulse = useCampaignPulse()
  const discard = useDiscardCampaignDraft()
  const closeOut = useCloseOutCampaign()
  const reopen = useReopenCampaign()
  // ADR-0086 d.9: Promote is offered for single jobs only — `kind` comes with the row, a stored
  // fact (d.8).
  const promote = usePromoteSingleJob()
  const [promoting, setPromoting] = useState<CampaignListRow | null>(null)
  const [armed, setArmed] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  // ADR-0092 d.3: a rule-based refusal (documents filed, work still open) is NOT reportable; an
  // unexpected failure is. The banner carries which.
  const [banner, setBanner] = useState<{ message: string; reportable: boolean; cause?: unknown } | null>(null)
  // I61.17: a dashboard card opens the list already narrowed — `?alert=atRisk|late`, and `&client=` when the
  // dashboard was on one client. It opens on All: the card counted every campaign in the viewer's reach.
  // I66.2: the approval cards open it on `?status=draft|pending_approval` or `?alert=taskLists`; `&scope=mine` when
  // the card counted only the viewer's own.
  const [params, setParams] = useSearchParams()
  const linkedAlert = params.get('alert')
  const linkedStatus = params.get('status')
  const [alert, setAlert] = useState<'' | 'atRisk' | 'late' | 'taskLists'>(
    linkedAlert === 'atRisk' || linkedAlert === 'late' || linkedAlert === 'taskLists' ? linkedAlert : '')
  const [query, setQuery] = useState(params.get('q') ?? '')
  const [scope, setScope] = useState<Scope>(
    params.get('scope') === 'mine' ? 'mine' : params.get('scope') === 'all' || linkedAlert || linkedStatus ? 'all' : 'mine')
  const [client, setClient] = useState(params.get('client') ?? '')
  const [accountManager, setAccountManager] = useState(params.get('am') ?? '')
  const [status, setStatus] = useState<CampaignStatus | ''>(
    linkedStatus === 'draft' || (STATUSES as readonly string[]).includes(linkedStatus ?? '') ? (linkedStatus as CampaignStatus) : '')
  // ADR-0091 d.5: closed campaigns leave the active list; a toggle brings them back.
  const [showClosed, setShowClosed] = useState(false)
  // ADR-0132 d.7: the filters are written back to the URL (read once above), so Back from a campaign returns
  // to the list as it was left.
  useEffect(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        const put = (k: string, v: string) => (v ? next.set(k, v) : next.delete(k))
        put('alert', alert)
        put('status', status)
        put('scope', scope === 'mine' ? 'mine' : 'all')
        put('client', client)
        put('am', accountManager)
        put('q', query)
        return next
      },
      { replace: true },
    )
  }, [alert, status, scope, client, accountManager, query, setParams])

  const rows = data ?? NO_ROWS
  const q = query.trim().toLowerCase()
  // "Now" for the alerts, taken once per load: a minute's drift is not worth a re-render loop.
  const now = useMemo(() => Date.now(), [pulse.dataUpdatedAt]) // eslint-disable-line react-hooks/exhaustive-deps
  const { cards, mineFellBack, closedCount } = useMemo(
    () => buildCards(rows, pulse.data, me, { scope, query: q, client, accountManager, status, showClosed, alert }, now),
    [rows, pulse.data, me, scope, q, client, accountManager, status, showClosed, alert, now],
  )
  const clients = useMemo(() => optionsOf(rows, (r) => r.clientName), [rows])
  const managers = useMemo(() => optionsOf(rows, (r) => r.accountManagerName), [rows])
  // Filtered to "Unfinished briefs" (I66.2), the drafts are all the page shows, narrowed to the client and, on
  // Mine, to the ones I started.
  // Mine is the drafts I started or whose account manager I am.
  const onlyDrafts = status === 'draft'
  const myDrafts = useMyDrafts(onlyDrafts && scope === 'mine' ? me : null)
  const drafts = useMemo(() => {
    const started = new Set(myDrafts.data ?? [])
    const mineDraft = (c: CampaignListRow) => started.has(c.id) || (me != null && pulse.data?.get(c.id)?.accountManagerId === me)
    // Narrowed to another status or an alert, the page shows what was counted — no drafts beside it.
    if ((status !== '' && !onlyDrafts) || alert !== '') return []
    return rows.filter((c) => c.status === 'draft' && matchesQuery(c, q)
      && (!onlyDrafts || ((!client || c.clientName === client) && (scope === 'all' || mineDraft(c)))))
  }, [rows, q, status, alert, onlyDrafts, client, scope, me, myDrafts.data, pulse.data])
  const hasAny = rows.length > 0
  const filtering = q !== '' || client !== '' || accountManager !== '' || status !== '' || alert !== ''

  function onDiscard(id: string) {
    if (armed !== id) {
      setArmed(id)
      return
    }
    setArmed(null)
    discard.mutate(id, {
      onError: (err) => {
        // The database refuses this once documents are filed under the draft, because the
        // cascade would take them with it. That is a sentence, not a failure to retry.
        const code = (err as { code?: string }).code
        setBanner({
          message: t(code === '23514' ? 'campaigns.drafts.hasDocuments' : 'campaigns.drafts.discardFailed'),
          reportable: code !== '23514',
        })
      },
    })
  }

  /** ADR-0091 / I48.9: close out a finished campaign. The RPC refuses while work is unfinished;
   *  that refusal is shown in plain words (I48.10), not a generic failure. Reversible via reopen. */
  function onCloseOut(c: CampaignListRow) {
    setMenuFor(null)
    closeOut.mutate(c.id, {
      onError: (err) => {
        const code = (err as { code?: string }).code
        setBanner({ message: t(code === '23514' ? 'campaigns.closeOut.hasOpenWork' : 'campaigns.closeOut.failed'), reportable: code !== '23514' })
      },
    })
  }

  function onReopen(c: CampaignListRow) {
    setMenuFor(null)
    reopen.mutate(c.id, { onError: (err) => setBanner({ message: t('campaigns.closeOut.reopenFailed'), reportable: true, cause: err }) })
  }

  /**
   * SJ-A2 (ADR-0086 d.10/d.11): promotion sets `kind = 'campaign'`. Nothing is copied. One-way, and
   * the dialog says so first. It lands on the campaign page, not in the wizard (ADR-0086 addendum,
   * 11 Sep): the campaign page is where an approved campaign gains departments and deliverables.
   */
  function onPromote(row: CampaignListRow) {
    promote.mutate(row.id, {
      onSuccess: () => {
        setPromoting(null)
        navigate(`/campaigns/${row.id}`)
      },
      onError: (err) => {
        setPromoting(null)
        setBanner({ message: t('intake.promote.failed'), reportable: true, cause: err })
      },
    })
  }

  return (
    <section data-testid="surface-campaigns">
      {/* ADR-0092 d.1 / I48.8: each of these spans requests and leaves the list in a state nobody
          should act on — a blocking "please wait", not a spinner in a row. */}
      {promote.isPending && <BusyDialog text={t('campaigns.busy.promoting')} testId="campaigns-busy" />}
      {closeOut.isPending && <BusyDialog text={t('campaigns.busy.closingOut')} testId="campaigns-busy" />}
      {reopen.isPending && <BusyDialog text={t('campaigns.busy.reopening')} testId="campaigns-busy" />}
      <header className="schedule-bar">
        <h1>{t('campaigns.title')}</h1>
        {/* ADR-0082 d.7: New opens the one door, not the wizard. Only `projects:manage` raises work. */}
        {canManage && (
          <Button variant="primary" onClick={openNewRequest} data-testid="campaigns-new-brief">
            + {t('intake.new')}
            <kbd className="kbd-hint">{shortcutLabel(navigator.platform ?? '')}</kbd>
          </Button>
        )}
      </header>
      <p className="muted">{t('campaigns.intro')}</p>

      {hasAny && (
        <div className="campaign-filters" data-testid="campaigns-filters">
          <div className="scope-switch" role="group" aria-label={t('campaigns.cards.scopeLabel')}>
            {(['mine', 'all'] as const).map((s) => (
              <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)} data-testid={`campaigns-scope-${s}`}>
                {t(`campaigns.cards.${s}`)}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('campaigns.cards.searchPlaceholder')}
            aria-label={t('campaigns.searchLabel')}
            data-testid="campaigns-search"
          />
          <select
            value={client}
            onChange={(e) => setClient(e.target.value)}
            aria-label={t('campaigns.cards.filterClient')}
            className={client ? 'is-set' : undefined}
            data-testid="campaigns-filter-client"
          >
            <option value="">{t('campaigns.cards.anyClient')}</option>
            {clients.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={accountManager}
            onChange={(e) => setAccountManager(e.target.value)}
            aria-label={t('campaigns.cards.filterAccountManager')}
            className={accountManager ? 'is-set' : undefined}
            data-testid="campaigns-filter-am"
          >
            <option value="">{t('campaigns.cards.anyAccountManager')}</option>
            {managers.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as CampaignStatus | '')}
            aria-label={t('campaigns.cards.filterStatus')}
            className={status ? 'is-set' : undefined}
            data-testid="campaigns-filter-status"
          >
            <option value="">{t('campaigns.cards.anyStatus')}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{t(`campaigns.status.${s}`)}</option>)}
            {canManage && <option value="draft">{t('campaigns.cards.statusUnfinished')}</option>}
          </select>
          <select
            value={alert}
            onChange={(e) => setAlert(e.target.value as '' | 'atRisk' | 'late' | 'taskLists')}
            aria-label={t('campaigns.cards.filterAlert')}
            className={alert ? 'is-set' : undefined}
            data-testid="campaigns-filter-alert"
          >
            <option value="">{t('campaigns.cards.anyAlert')}</option>
            <option value="atRisk">{t('campaigns.cards.alertAtRisk')}</option>
            <option value="late">{t('campaigns.cards.alertLate')}</option>
            <option value="taskLists">{t('campaigns.cards.alertTaskLists')}</option>
          </select>
          {closedCount > 0 && (
            <label className="list-search-toggle">
              <input
                type="checkbox"
                checked={showClosed}
                onChange={(e) => setShowClosed(e.target.checked)}
                data-testid="campaigns-show-closed"
              />
              {t('campaigns.showClosed', { count: closedCount })}
            </label>
          )}
        </div>
      )}

      {banner && (
        <NoticeDialog
          kind="error"
          message={banner.message}
          testId="campaigns-banner"
          reportable={banner.reportable}
          reportCause={banner.cause}
          reportWhere="Campaigns"
          onClose={() => setBanner(null)}
        />
      )}

      {promoting && (
        <PromoteDialog
          name={promoting.name}
          busy={promote.isPending}
          onConfirm={() => onPromote(promoting)}
          onCancel={() => setPromoting(null)}
        />
      )}

      {isError ? (
        <p className="form-error">{t('campaigns.loadFailed')}</p>
      ) : isLoading || (pulse.isLoading && scope === 'mine') ? (
        <p className="muted" data-testid="campaigns-loading">…</p>
      ) : cards.length === 0 && drafts.length === 0 && filtering ? (
        // A search that matched nothing is not an empty product — keep the box, say so in one line.
        <p className="muted" data-testid="campaigns-no-matches">{t('campaigns.noMatches', { query: query.trim() })}</p>
      ) : cards.length === 0 && drafts.length === 0 ? (
        <div className="empty-state" data-testid="campaigns-empty">
          <p>{t('campaigns.emptyTitle')}</p>
          <p className="muted">{t('campaigns.emptyHint')}</p>
          {canManage && (
            <Button variant="primary" onClick={openNewRequest} data-testid="campaigns-empty-cta">
              + {t('intake.new')}
            </Button>
          )}
        </div>
      ) : (
        <>
          {mineFellBack && <p className="campaign-card-note" data-testid="campaigns-mine-fallback">{t('campaigns.cards.mineEmpty')}</p>}
          {cards.length > 0 && (
            <ul className="campaign-cards" aria-label={t('campaigns.cards.list')} data-testid="campaigns-cards">
              {cards.map((c) => (
                <CampaignCardItem
                  key={c.row.id}
                  card={c}
                  canManage={canManage}
                  canReopenWork={can('project_tasks:manage')}
                  menuOpen={menuFor === c.row.id}
                  onMenu={(open) => setMenuFor(open ? c.row.id : null)}
                  onPromote={() => {
                    setMenuFor(null)
                    setPromoting(c.row)
                  }}
                  onCloseOut={() => onCloseOut(c.row)}
                  onReopen={() => onReopen(c.row)}
                  busy={closeOut.isPending || reopen.isPending}
                />
              ))}
            </ul>
          )}

          {canManage && drafts.length > 0 && (
            <section className="campaign-drafts" data-testid="campaigns-drafts">
              <h2 className="org-section-heading">{t('campaigns.drafts.heading')}</h2>
              <p className="muted">{t('campaigns.drafts.intro')}</p>
              <table className="data-table" data-testid="campaigns-drafts-table">
                <thead>
                  <tr>
                    <th>{t('campaigns.colName')}</th>
                    <th>{t('campaigns.colClient')}</th>
                    <th>{t('campaigns.colBrand')}</th>
                    {/* I51.1: an unfinished brief is somebody's — say whose, since when, and who
                        last touched it. Edward: the list "lacked information". */}
                    <th>{t('campaigns.colAccountManager')}</th>
                    <th>{t('campaigns.drafts.colStarted')}</th>
                    <th>{t('campaigns.drafts.colLastEdited')}</th>
                    <th>{t('admin.users.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((c) => (
                    <tr key={c.id} data-testid={`campaign-draft-row-${c.id}`}>
                      <td>{c.name}</td>
                      <td>{c.clientName}</td>
                      <td>{c.brandName ?? '—'}</td>
                      <td>{c.accountManagerName ?? <span className="muted">—</span>}</td>
                      <td data-testid={`campaign-draft-started-${c.id}`}>
                        {c.createdByName ?? <span className="muted">{t('campaigns.drafts.unknownPerson')}</span>}
                        {c.createdAt && <span className="muted"> · {formatIraqDate(c.createdAt)}</span>}
                      </td>
                      <td data-testid={`campaign-draft-edited-${c.id}`}>
                        {c.updatedByName
                          ? <>{c.updatedByName}{c.updatedAt && <span className="muted"> · {formatIraqDate(c.updatedAt)}</span>}</>
                          : <span className="muted">{t('campaigns.drafts.neverEdited')}</span>}
                      </td>
                      <td className="row-actions">
                        {/* Resuming is the point of keeping these. A single job's draft (ADR-0085
                            d.8) resumes in its own flow, not the builder. */}
                        <Button
                          to={c.kind === 'single_job' ? `/campaigns/new-job?job=${c.id}` : `/campaigns/new?draft=${c.id}`}
                          variant="primary" size="sm"
                          data-testid={`campaign-draft-resume-${c.id}`}
                        >
                          {t('campaigns.drafts.resume')}
                        </Button>
                        <DeleteButton
                          armed={armed === c.id}
                          label={t('campaigns.drafts.discard')}
                          confirm={t('library.confirmDelete')}
                          size="sm"
                          disabled={discard.isPending}
                          onClick={() => onDiscard(c.id)}
                          data-testid={`campaign-draft-discard-${c.id}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </section>
  )
}

function CampaignCardItem({
  card,
  canManage,
  canReopenWork,
  menuOpen,
  onMenu,
  onPromote,
  onCloseOut,
  onReopen,
  busy,
}: {
  card: CampaignCard
  canManage: boolean
  /** ADR-0103: `project_tasks:manage` — may re-open finished work, so a closed campaign. */
  canReopenWork: boolean
  menuOpen: boolean
  onMenu: (open: boolean) => void
  onPromote: () => void
  onCloseOut: () => void
  onReopen: () => void
  busy: boolean
}) {
  const { t } = useTranslation()
  const { row: c, pulse } = card
  const menuRef = useRef<HTMLDivElement>(null)

  // The menu closes on a press anywhere else and on Escape — the two ways a person leaves one.
  useEffect(() => {
    if (!menuOpen) return
    const away = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onMenu(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onMenu(false)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [menuOpen, onMenu])

  const isJob = c.kind === 'single_job'
  const canPromote = canManage && isJob
  const canCloseOut = canManage && c.status === 'approved'
  // ADR-0103 d.1: re-opening is the project_tasks:manage grant with reach — leads too, not only
  // those who manage projects. Offered to them; the server answers for the rest, in words.
  const canReopen = canReopenWork && c.status === 'closed'
  const hasMenu = canPromote || canCloseOut || canReopen
  const pct = pulse && pulse.total > 0 ? Math.round((pulse.delivered / pulse.total) * 100) : 0

  return (
    <li className="campaign-card" data-testid={`campaign-row-${c.id}`}>
      <div className="campaign-card-main">
        <Link to={`/campaigns/${c.id}`} className="campaign-card-name" data-testid={`campaign-open-${c.id}`}>
          {c.name}
        </Link>
        {canManage && isJob && (
          <span className="muted" data-testid={`campaign-kind-${c.id}`}> · {t('intake.similar.kindJob')}</span>
        )}
        <div className="campaign-card-line" data-testid={`campaign-line-${c.id}`}>
          {/* Each part isolated, so a Latin name inside an Arabic line keeps its place in the order. */}
          {[c.clientName, c.brandName, timingText(card.timing, t), c.accountManagerName]
            .filter((v): v is string => !!v)
            .map((v, i) => <span key={i}>{i > 0 && ' · '}<bdi>{v}</bdi></span>)}
        </div>
      </div>
      <div className="campaign-card-side">
        {pulse && pulse.total > 0 && (
          <span className="campaign-progress" data-testid={`campaign-progress-${c.id}`}>
            <span
              className="campaign-progress-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={pulse.total}
              aria-valuenow={pulse.delivered}
              aria-label={t('campaigns.cards.progressLabel', { done: pulse.delivered, total: pulse.total })}
            >
              <span style={{ inlineSize: `${pct}%` }} />
            </span>
            {t('campaigns.cards.progress', { done: pulse.delivered, total: pulse.total })}
          </span>
        )}
        <span className="campaign-card-badges">
          <span className={`state-badge state-${c.status}`} data-testid={`campaign-status-${c.id}`}>
            {t(`campaigns.status.${c.status}`)}
          </span>
          {pulse && pulse.atRisk > 0 && (
            <span data-testid={`campaign-alert-risk-${c.id}`}><Tag tone="breach">{t('campaigns.cards.atRisk', { count: pulse.atRisk })}</Tag></span>
          )}
          {pulse && pulse.waitingOnClient > 0 && (
            <span data-testid={`campaign-alert-client-${c.id}`}><Tag tone="warn">{t('campaigns.cards.waitingOnClient', { count: pulse.waitingOnClient })}</Tag></span>
          )}
          {pulse && pulse.tasksUnassigned > 0 && c.status === 'approved' && (
            <span data-testid={`campaign-alert-unassigned-${c.id}`}><Tag tone="warn">{t('campaigns.cards.tasksUnassigned', { count: pulse.tasksUnassigned })}</Tag></span>
          )}
          {pulse && pulse.taskListsToApprove > 0 && c.status === 'approved' && (
            <span data-testid={`campaign-task-lists-${c.id}`}><Tag tone="accent">{t('campaigns.cards.taskListsToApprove', { count: pulse.taskListsToApprove })}</Tag></span>
          )}
        </span>
        {/* A release whose approval half failed sits here; the flow picks it up. A main action, so
            it stays on the card rather than in the menu. */}
        {canManage && isJob && c.status === 'pending_approval' && (
          <Button to={`/campaigns/new-job?job=${c.id}`} variant="primary" size="sm" data-testid={`campaign-job-continue-${c.id}`}>
            {t('campaigns.drafts.resume')}
          </Button>
        )}
        <Button to={`/campaigns/${c.id}`} variant="link" size="sm" data-testid={`campaign-action-open-${c.id}`}>
          {t('campaigns.open')}
        </Button>
        {hasMenu && (
          <div className="campaign-card-menu" ref={menuRef}>
            <IconButton
              icon="more"
              size="sm"
              label={t('campaigns.cards.more', { name: c.name })}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              onClick={() => onMenu(!menuOpen)}
              data-testid={`campaign-menu-${c.id}`}
            />
            {menuOpen && (
              <div className="campaign-card-menu-list" role="menu">
                {canPromote && (
                  <Button variant="secondary" size="sm" role="menuitem" onClick={onPromote} data-testid={`campaign-promote-${c.id}`}>
                    {t('intake.promote.action')}
                  </Button>
                )}
                {/* I48.9 (ADR-0091): close out a finished campaign / reopen a closed one. */}
                {canCloseOut && (
                  <Button variant="secondary" size="sm" icon="archive" role="menuitem" disabled={busy} onClick={onCloseOut} data-testid={`campaign-close-out-${c.id}`}>
                    {t('campaigns.closeOut.action')}
                  </Button>
                )}
                {canReopen && (
                  <Button variant="secondary" size="sm" icon="undo" role="menuitem" disabled={busy} onClick={onReopen} data-testid={`campaign-reopen-${c.id}`}>
                    {t('campaigns.closeOut.reopen')}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

function timingText(timing: Timing, t: (k: string, o?: Record<string, unknown>) => string): string {
  const day = (d: string) => formatIraqShortDate(d.length === 10 ? `${d}T12:00:00Z` : d)
  switch (timing.kind) {
    case 'job':
      return timing.dueAt ? t('campaigns.cards.timingJob', { date: day(timing.dueAt) }) : t('campaigns.cards.timingJobNoDate')
    case 'phase':
      return t('campaigns.cards.timingPhase', { name: timing.name, number: timing.number, of: timing.of })
    case 'before_phases':
      return t('campaigns.cards.timingBefore', { name: timing.name, date: day(timing.startsOn) })
    case 'after_phases':
      return t('campaigns.cards.timingAfter', { of: timing.of })
    case 'single':
      return timing.goLiveAt ? t('campaigns.cards.timingSingle', { date: day(timing.goLiveAt) }) : t('campaigns.cards.timingSingleNoDate')
  }
}
