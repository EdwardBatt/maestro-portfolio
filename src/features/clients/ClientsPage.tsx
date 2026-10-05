import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { usePermissions } from '../../app/permissions'
import { useAuth } from '../../app/auth-context'
import {
  useAskToActivate,
  useClients,
  useContactCounts,
  useCountries,
  usePeopleNames,
  type ClientRow,
} from './api/clients-api'
import { useClientWork, type ClientWork } from './api/client-work'
import { lastActivityLabel, onTimeTone, profilePct, type ActivityLabel } from './lib/client-profile'
import { formatIraqDate } from '../../lib/time/iraq'

/**
 * The clients list (ADR-0123 d.8, Figma CV-01). Active clients with what their work is doing — brands,
 * live campaigns, what needs the viewer, how much is on time, when it last moved — and, below, the
 * DRAFTS: started, not activated, never offered for work (d.2). Anyone who manages clients starts one
 * and continues it; only the account director activates it, and anyone else asks (d.1).
 *
 * An account manager's Active tab is THEIR clients ("Your clients"); when they have none it shows every
 * client rather than an empty page (the UI never blocks).
 */
type Tab = 'active' | 'drafts' | 'all'
const TABS: readonly Tab[] = ['active', 'drafts', 'all']

export function ClientsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'active'
  const { can, scope } = usePermissions()
  const { session } = useAuth()
  const myId = session?.user.id ?? null
  const clients = useClients()
  const work = useClientWork(myId)
  const canManage = can('clients:manage')

  if (clients.isError) return <p className="form-error">{t('clients.loadFailed')}</p>

  const all = (clients.data ?? []).filter((c) => !c.isInternal)
  const active = all.filter((c) => c.status === 'active')
  const drafts = all.filter((c) => c.status === 'draft')
  const asAm = scope === 'account'
  const mine = asAm ? active.filter((c) => c.accountManagerId === myId) : active
  const fellBack = asAm && mine.length === 0 && active.length > 0
  const shownActive = tab === 'drafts' ? [] : tab === 'all' || fellBack ? active : mine
  const shownDrafts = drafts
  const counts: Record<Tab, number> = { active: fellBack ? active.length : mine.length, drafts: drafts.length, all: all.length }

  return (
    <div className="cl-page" data-testid="surface-clients">
      <div className="cl-list-head">
        <div>
          <h1 className="cl-title">{t(asAm ? 'clients.list.titleMine' : 'clients.list.title')}</h1>
          <p className="cl-sub">{t('clients.list.sub')}</p>
        </div>
        {canManage && (
          <button type="button" className="cl-new" onClick={() => navigate('/clients/new')} data-testid="client-register">
            {t('clients.list.new')}
          </button>
        )}
      </div>

      <div className="cl-tabs" role="tablist" aria-label={t('clients.list.title')}>
        {TABS.map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            className="cl-tab"
            aria-selected={tab === k}
            onClick={() => setParams(k === 'active' ? {} : { tab: k }, { replace: true })}
            data-testid={`clients-tab-${k}`}
          >
            {t(`clients.list.tab.${k}`, { count: counts[k] })}
          </button>
        ))}
      </div>

      <div className="cl-table" data-testid="clients-table">
        {clients.isLoading ? (
          <p className="muted" data-testid="clients-loading">{t('clients.loading')}</p>
        ) : (
          <>
            {tab !== 'drafts' && (
              <>
                <div className="cl-th" aria-hidden="true">
                  <span>{t('clients.list.col.client')}</span>
                  <span className="cl-w160">{t('clients.list.col.accountManager')}</span>
                  <span className="cl-w80">{t('clients.list.col.brands')}</span>
                  <span className="cl-w80">{t('clients.list.col.live')}</span>
                  <span className="cl-w90">{t('clients.list.col.needsYou')}</span>
                  <span className="cl-w110">{t('clients.list.col.onTime')}</span>
                  <span className="cl-w130">{t('clients.list.col.lastActivity')}</span>
                  <span className="cl-w60" />
                </div>
                {fellBack && tab === 'active' && <p className="cl-drafts-label"><span>{t('clients.list.noneYours')}</span></p>}
                {shownActive.length === 0 && <p className="cl-empty" data-testid="clients-empty">{t('clients.list.emptyActive')}</p>}
                {shownActive.map((c) => <ActiveRow key={c.id} client={c} work={work.of(c.id)} myId={myId} />)}
              </>
            )}
            {shownDrafts.length > 0 && (
              <>
                <p className="cl-drafts-label" data-testid="clients-drafts-label">
                  <strong>{t('clients.list.drafts')}</strong>
                  <span>{t('clients.list.draftsNote')}</span>
                </p>
                <DraftRows drafts={shownDrafts} myId={myId} />
              </>
            )}
            {tab === 'drafts' && shownDrafts.length === 0 && <p className="cl-empty" data-testid="clients-empty">{t('clients.list.emptyDrafts')}</p>}
          </>
        )}
      </div>
    </div>
  )
}

function useActivityText() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'ar' ? 'ar' : 'en'
  return (iso: string | null, now: number) => {
    const l: ActivityLabel | null = lastActivityLabel(iso, now, locale)
    if (!l) return '—'
    return 'text' in l ? l.text : t(`clients.list.${l.key}`, { count: l.count })
  }
}

function ActiveRow({ client, work, myId }: { client: ClientRow; work: ClientWork; myId: string | null }) {
  const { t, i18n } = useTranslation()
  const countries = useCountries()
  const activity = useActivityText()
  const tone = onTimeTone(work)
  const country = countries.data?.find((c) => c.code === client.countryCode)
  const meta = client.businessTypes.length
    ? client.businessTypes.map((b) => t(`clients.businessType.${b}`)).join(' · ')
    : country ? (i18n.language === 'ar' ? country.nameAr : country.nameEn) : ''
  return (
    <Link to={`/clients/${client.id}`} className="cl-tr is-link" data-testid={`client-row-${client.id}`}>
      <span className="cl-client">
        <span className={`cl-tile${tone === 'ok' ? '' : ` tone-${tone}`}`} aria-hidden="true" />
        <span className="cl-client-text">
          <span className="cl-client-name">{client.name}</span>
          <span className="cl-client-meta">{meta}</span>
        </span>
      </span>
      {/* I69.1 (Edward, 30 Sep, A): whose client this is — CV-01 was drawn for the account manager's own list and named nobody. */}
      <span className="cl-w160 cl-am" data-testid={`client-am-${client.id}`}>
        {client.accountManagerId && client.accountManagerId === myId ? t('clients.list.amYou') : client.accountManagerName ?? '—'}
      </span>
      <span className="cl-w80 cl-num">{client.brandCount}</span>
      <span className="cl-w80 cl-num" data-testid={`client-live-${client.id}`}>{work.live}</span>
      <span className={`cl-w90 cl-num ${work.needsYou > 0 ? 'is-alert' : 'is-zero'}`} data-testid={`client-needs-${client.id}`}>{work.needsYou}</span>
      <span className={`cl-w110 cl-meter tone-${tone}`} data-testid={`client-ontime-${client.id}`}>
        <span className="cl-meter-text">{work.unfinished ? t('clients.list.ofTotal', { n: work.onTime, total: work.unfinished }) : t('clients.list.nothingLive')}</span>
        <span className="cl-meter-track"><span className="cl-meter-fill" style={{ display: 'block', inlineSize: `${work.unfinished ? (work.onTime / work.unfinished) * 100 : 0}%` }} /></span>
      </span>
      <span className="cl-w130 cl-when">{activity(work.lastActivity ?? client.activatedAt ?? client.createdAt, Date.now())}</span>
      <span className="cl-w60 cl-open">{t('clients.list.open')}</span>
    </Link>
  )
}

function DraftRows({ drafts, myId }: { drafts: ClientRow[]; myId: string | null }) {
  const names = usePeopleNames(drafts.map((d) => d.createdById).filter((x): x is string => !!x))
  const counts = useContactCounts()
  return (
    <>
      {drafts.map((d) => (
        <DraftRow key={d.id} draft={d} myId={myId} starter={d.createdById ? names.data?.get(d.createdById) ?? null : null}
          contacts={counts.data?.get(d.id) ?? { total: 0, signsOff: 0 }} />
      ))}
    </>
  )
}

function DraftRow({ draft, myId, starter, contacts }: { draft: ClientRow; myId: string | null; starter: string | null; contacts: { total: number; signsOff: number } }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'ar' ? 'ar' : 'en'
  const navigate = useNavigate()
  const { can } = usePermissions()
  const ask = useAskToActivate()
  const director = can('clients:approve')
  const canManage = can('clients:manage')
  const basics = !!draft.countryCode && !!draft.accountManagerId
  const pct = profilePct({
    basics, businessTypes: draft.businessTypes.length, brands: draft.brandCount,
    contacts: contacts.total, signsOff: contacts.signsOff, rules: draft.rules.length,
  })
  const doneSteps = [
    basics && t('clients.wizard.step.basics'),
    draft.brandCount > 0 && t('clients.wizard.step.brands'),
    contacts.total > 0 && t('clients.wizard.step.people'),
    draft.rules.length > 0 && t('clients.wizard.step.rules'),
  ].filter((s): s is string => !!s)
  const firstOpen = !basics ? 1 : draft.brandCount === 0 ? 2 : contacts.total === 0 ? 3 : draft.rules.length === 0 ? 4 : 6
  const day = (iso: string) => formatIraqDate(iso, locale === 'ar' ? 'ar' : 'en')
  const list = (xs: string[]) => new Intl.ListFormat(locale === 'ar' ? 'ar' : 'en-GB', { type: 'conjunction' }).format(xs)
  const who = draft.createdById && draft.createdById === myId ? t('clients.list.byYou') : starter ?? t('clients.list.bySomeone')
  const asked = draft.activationRequestedAt
  const meta = [
    t('clients.list.started', { who, day: day(draft.createdAt) }),
    doneSteps.length ? t('clients.list.stepsDone', { steps: list(doneSteps) }) : null,
    director ? t('clients.list.yoursToActivate') : asked ? t('clients.list.asked', { day: day(asked) }) : t('clients.list.waiting'),
  ].filter(Boolean).join(' · ')

  return (
    <div className="cl-tr is-draft" data-testid={`client-draft-${draft.id}`}>
      <span className="cl-client">
        <span className="cl-tile tone-amber" aria-hidden="true" />
        <span className="cl-client-text">
          <span className="cl-client-name">{draft.name}</span>
          <span className="cl-client-meta">{meta}</span>
        </span>
      </span>
      <span className="cl-w110 cl-meter tone-amber">
        <span className="cl-meter-text">{t('clients.list.profilePct', { pct })}</span>
        <span className="cl-meter-track"><span className="cl-meter-fill" style={{ display: 'block', inlineSize: `${pct}%` }} /></span>
      </span>
      {canManage && (
        <button type="button" className="cl-amber-btn is-row" onClick={() => navigate(`/clients/${draft.id}/register?step=${firstOpen}`)} data-testid={`client-draft-continue-${draft.id}`}>
          {t('clients.list.continue')}
        </button>
      )}
      {director ? (
        <button type="button" className="cl-amber-link is-row" onClick={() => navigate(`/clients/${draft.id}/register?step=6`)} data-testid={`client-draft-review-${draft.id}`}>
          {t('clients.list.reviewActivate')}
        </button>
      ) : canManage ? (
        <button type="button" className="cl-amber-link is-row" disabled={ask.isPending} onClick={() => ask.mutate(draft.id)} data-testid={`client-draft-ask-${draft.id}`}>
          {t(asked ? 'clients.list.askAgain' : 'clients.list.ask')}
        </button>
      ) : null}
    </div>
  )
}
