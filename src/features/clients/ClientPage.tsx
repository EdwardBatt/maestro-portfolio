import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { usePermissions } from '../../app/permissions'
import { useAuth } from '../../app/auth-context'
import { formatIraqDate, iraqDay } from '../../lib/time/iraq'
import { useBrandFiles, useBrands, useClientContacts, useClients, useCountries, type ClientRow } from './api/clients-api'
import { useClientWork, type ClientCampaign } from './api/client-work'
import { weekLabel } from './lib/client-profile'
import { BrandsCard } from './components/BrandsCard'
import { PeopleCard } from './components/PeopleCard'
import { RulesCard } from './components/RulesCard'
import { Chip } from './components/parts'
import { Button } from '../../components/Button'
import personAvatar from './assets/people-avatar.svg'
import { pieceThreatensDeadline } from '../../lib/campaigns/pulse'
import { amendmentsOf, useAmendmentSummary } from '../../lib/amendments/amendment-summary'

/**
 * A client's page (ADR-0123 d.8, Figma CV-02): who they are and what their work is doing. Overview —
 * the live campaigns and the brands on the left, the people and the dos and don'ts on the right — and a
 * tab for each: Campaigns, Brands, People, Dos and don'ts (the same editors as registration), Library.
 * Everything is read from what Maestro already records.
 */
type Tab = 'overview' | 'campaigns' | 'brands' | 'people' | 'rules' | 'library'
const TABS: readonly Tab[] = ['overview', 'campaigns', 'brands', 'people', 'rules', 'library']

export function ClientPage() {
  const { t } = useTranslation()
  const { clientId = '' } = useParams()
  const clients = useClients()
  const client = clients.data?.find((c) => c.id === clientId && !c.isInternal) ?? null
  if (clients.isLoading) return <p className="muted">{t('clients.loading')}</p>
  if (clients.isError) return <p className="form-error">{t('clients.loadFailed')}</p>
  if (!client) return <p className="form-error" data-testid="client-not-found">{t('clients.notFound')}</p>
  return <Page client={client} />
}

function Page({ client }: { client: ClientRow }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'ar' ? 'ar' : 'en'
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'overview'
  const { can } = usePermissions()
  const { session } = useAuth()
  const myId = session?.user.id ?? null
  const countries = useCountries()
  const brands = useBrands()
  const contacts = useClientContacts(client.id)
  const work = useClientWork(myId).of(client.id)
  // ADR-0142 d.3 (I74.20): the client's amendments this month and their hours — no allowance yet (M10).
  const amendMonth = useAmendmentSummary(iraqDay(Date.now()))
  const amends = amendmentsOf(amendMonth.data, 'client', client.id)
  const director = can('clients:approve')
  const canManage = can('clients:manage')
  const active = client.status === 'active'
  const country = countries.data?.find((c) => c.code === client.countryCode) ?? null
  const mine = (brands.data ?? []).filter((b) => b.clientId === client.id)
  const people = contacts.data ?? []
  const live = work.campaigns.filter((c) => c.row.status === 'pending_approval' || c.row.status === 'approved')

  const sub = [
    ...client.businessTypes.map((b) => t(`clients.businessType.${b}`)),
    t('clients.page.brands', { count: mine.length }),
    t('clients.page.liveCampaigns', { count: work.live }),
    work.unfinished ? t('clients.page.onTime', { n: work.onTime, total: work.unfinished }) : null,
    amends ? t('amendments.monthLine', { count: amends.amendments, hours: amends.hours }) : null,
  ].filter(Boolean).join(' · ')

  const tabLabel = (k: Tab) =>
    k === 'campaigns' ? t('clients.page.tab.campaigns', { count: work.campaigns.length })
      : k === 'brands' ? t('clients.page.tab.brands', { count: mine.length })
        : k === 'people' ? t('clients.page.tab.people', { count: people.length })
          : k === 'rules' ? t('clients.page.tab.rules', { count: client.rules.length })
            : t(`clients.page.tab.${k}`)

  return (
    <div className="cl-page" data-testid="client-page">
      <div className="cl-list-head">
        <div>
          <div className="cl-head-row">
            <h1 className="cl-title">{client.name}</h1>
            <Chip tone={active ? 'ok' : 'amber'} size={9} testId="client-status">{t(active ? 'clients.page.active' : 'clients.page.draft')}</Chip>
            {country && <Chip tone="neutral" size={9}>{`${locale === 'ar' ? country.nameAr : country.nameEn} · ${weekLabel(country.workingDays, locale)}`.toLocaleUpperCase()}</Chip>}
            {/* I69.1 (Edward, 30 Sep, A): the account manager is named for everyone; CV-02 only said "you are the AM". */}
            {client.accountManagerId === myId
              ? <Chip tone="violet" size={9} testId="client-am-chip">{t('clients.page.youAreAm')}</Chip>
              : client.accountManagerName && (
                <Chip tone="neutral" size={9} testId="client-am-chip">{t('clients.page.am', { name: client.accountManagerName })}</Chip>
              )}
          </div>
          <p className="cl-sub" data-testid="client-sub">{sub}</p>
        </div>
        {active ? (
          <div className="cl-head-actions">
            {/* I69.2 (Edward, 30 Sep, A): the registration steps edit an active client (ADR-0123); nothing linked to them. */}
            {canManage && (
              <Button variant="secondary" icon="edit" onClick={() => navigate(`/clients/${client.id}/register?step=1`)} data-testid="client-edit">
                {t('clients.page.edit')}
              </Button>
            )}
            {can('projects:manage') && (
              <button type="button" className="cl-new" onClick={() => navigate(`/campaigns/new-job?client=${client.id}`)} data-testid="client-new-job">
                {t('clients.page.newJob', { name: client.name })}
              </button>
            )}
          </div>
        ) : (
          canManage && (
            <button type="button" className="cl-new" onClick={() => navigate(`/clients/${client.id}/register?step=${director ? 6 : 1}`)} data-testid="client-continue">
              {t(director ? 'clients.list.reviewActivate' : 'clients.page.continue')}
            </button>
          )
        )}
      </div>

      <div className="cl-tabs" role="tablist" aria-label={client.name}>
        {TABS.map((k) => (
          <button key={k} type="button" role="tab" className="cl-tab is-tight" aria-selected={tab === k}
            onClick={() => setParams(k === 'overview' ? {} : { tab: k }, { replace: true })} data-testid={`client-tab-${k}`}>
            {tabLabel(k)}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="cl-overview">
          <div className="cl-main">
            <section className="cl-panel" data-testid="client-live">
              <h2 className="cl-panel-title">{t('clients.page.liveTitle')}</h2>
              {live.length === 0 ? <p className="cl-panel-note">{t('clients.page.noLive')}</p> : live.map((c) => <CampaignRow key={c.row.id} c={c} locale={locale} />)}
            </section>
            <section className="cl-panel" data-testid="client-brand-tiles">
              <div className="cl-panel-head">
                <h2 className="cl-panel-title">{t('clients.brands.title')}</h2>
                {canManage && (
                  <button type="button" className="cl-link is-accent" style={{ marginInlineStart: 'auto' }} onClick={() => setParams({ tab: 'brands' }, { replace: true })} data-testid="client-add-brand">
                    {t('clients.page.addBrand')}
                  </button>
                )}
              </div>
              <BrandTiles clientId={client.id} brands={mine.map((b) => ({ id: b.id, name: b.name }))} />
            </section>
          </div>
          <aside className="cl-side">
            <section className="cl-panel is-side" data-testid="client-people-panel">
              <h2 className="cl-panel-title">{t('clients.page.peopleAt', { name: client.name })}</h2>
              <p className="cl-panel-note">{t('clients.page.peopleNote')}</p>
              {people.length === 0 && <p className="cl-panel-foot">{t('clients.review.none')}</p>}
              {people.map((p) => (
                <div key={p.id} className="cl-person">
                  <img src={personAvatar} width={26} height={26} alt="" />
                  <span className="cl-person-text">
                    <span className="cl-person-name">{p.name}</span>
                    <span className="cl-person-meta">
                      {[p.roleTitle, p.canRequest && t('clients.review.asks'), p.signsOff && t('clients.review.signsOff'), p.isCopied && t('clients.review.copied')].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </div>
              ))}
            </section>
            <section className="cl-panel is-side is-rules" data-testid="client-rules-panel">
              <div className="cl-panel-head">
                <h2 className="cl-panel-title">{t('clients.rules.panelTitle')}</h2>
                {active && <Chip tone="neutral">{t('clients.rules.locked')}</Chip>}
              </div>
              {client.rules.length === 0 && <p className="cl-panel-foot">{t('clients.review.none')}</p>}
              {client.rules.map((r, i) => (
                <div key={i} className="cl-rule-mini">
                  <span className={`cl-tag is-small ${r.kind === 'do' ? 'is-do' : 'is-dont'}`}>{t(r.kind === 'do' ? 'clients.rules.doTag' : 'clients.rules.dontTag')}</span>
                  <span className="cl-rule-mini-text" dir="auto">{r.text}</span>
                </div>
              ))}
              <p className="cl-panel-foot">{t('clients.page.rulesFoot')}</p>
            </section>
          </aside>
        </div>
      )}

      {tab === 'campaigns' && (
        <section className="cl-panel" style={{ marginBlockStart: 20 }} data-testid="client-campaigns">
          <h2 className="cl-panel-title">{t('clients.page.tab.campaigns', { count: work.campaigns.length })}</h2>
          {work.campaigns.length === 0 ? <p className="cl-panel-note">{t('clients.page.noCampaigns')}</p> : work.campaigns.map((c) => <CampaignRow key={c.row.id} c={c} locale={locale} />)}
        </section>
      )}
      {tab === 'brands' && <div className="cl-body"><div className="cl-main"><BrandsCard clientId={client.id} clientName={client.name} canEdit={canManage} /></div></div>}
      {tab === 'people' && <div className="cl-body"><div className="cl-main"><PeopleCard clientId={client.id} canEdit={canManage} /></div></div>}
      {tab === 'rules' && (
        <div className="cl-body"><div className="cl-main"><RulesCard clientId={client.id} rules={client.rules} locked={active && !director} canEdit={canManage} /></div></div>
      )}
      {tab === 'library' && (
        <section className="cl-panel" style={{ marginBlockStart: 20 }} data-testid="client-library">
          <h2 className="cl-panel-title">{t('clients.page.tab.library')}</h2>
          <p className="cl-panel-note">{t('clients.page.libraryNote', { name: client.name })}</p>
          <div><Link className="cl-link is-accent" to={`/library?client=${client.id}`} data-testid="client-open-library">{t('clients.page.openLibrary')}</Link></div>
        </section>
      )}
    </div>
  )
}

function BrandTiles({ clientId, brands }: { clientId: string; brands: { id: string; name: string }[] }) {
  const { t } = useTranslation()
  const files = useBrandFiles(clientId)
  if (brands.length === 0) return <p className="cl-panel-note">{t('clients.review.none')}</p>
  return (
    <div className="cl-brand-tiles">
      {brands.map((b) => {
        const f = files.data?.get(b.id)
        const n = f?.files ?? 0
        const folders = f?.folders.length ?? 0
        return (
          <Link key={b.id} to={`/library?client=${clientId}`} className={`cl-brand-tile${n === 0 ? ' is-empty' : ''}`} data-testid={`client-brand-tile-${b.id}`}>
            <span className="cl-brand-tile-name">{b.name}</span>
            <span className="cl-brand-tile-meta">
              {n === 0 ? t('clients.page.emptyFolders', { count: folders }) : t('clients.page.filesFolders', { files: t('clients.brands.files', { count: n }), folders: t('clients.page.folders', { count: folders }) })}
            </span>
          </Link>
        )
      })}
    </div>
  )
}

/** One campaign on the client's page: the frame's coloured bar, what it is, the one thing to know. */
function CampaignRow({ c, locale }: { c: ClientCampaign; locale: 'en' | 'ar' }) {
  const { t } = useTranslation()
  const now = Date.now()
  const pieces = c.pieces.filter((p) => p.state !== 'archived')
  const delivered = pieces.filter((p) => p.state === 'delivered').length
  const atRisk = pieces.filter((p) => pieceThreatensDeadline(p, { now })).length
  const nobody = c.row.status === 'approved'
    ? pieces.filter((p) => p.state !== 'approved' && p.state !== 'delivered' && p.taskListApprovedAt != null
      && p.tasks.some((x) => x.status !== 'done' && x.status !== 'cancelled' && !x.assigneeId)).length
    : 0
  const state = pieces.length > 0 && delivered === pieces.length ? 'delivered' : nobody > 0 ? 'nobody' : atRisk > 0 ? 'atRisk' : 'onTrack'
  const tone = state === 'nobody' ? 'risk' : state === 'atRisk' ? 'amber' : 'ok'
  const today = iraqDay(now)
  const phases = [...c.phases].sort((a, b) => a.number - b.number)
  const current = phases.find((p) => p.startsOn <= today && today <= p.endsOn) ?? phases.find((p) => p.startsOn > today) ?? phases[phases.length - 1]
  const day = (iso: string) => formatIraqDate(iso, locale === 'ar' ? 'ar' : 'en')
  const meta = [
    c.hasPhases && current ? t('clients.page.phaseOf', { n: current.number, total: phases.length, name: current.name }) : t('clients.page.singlePhase'),
    t('clients.page.goLive', { day: c.row.goLiveAt ? day(c.row.goLiveAt) : '—' }),
    t('clients.page.pieces', { count: pieces.length }),
    state === 'nobody' ? t('clients.page.unassigned', { count: nobody })
      : atRisk > 0 ? t('clients.page.atRisk', { count: atRisk })
        : delivered > 0 ? t('clients.page.delivered', { count: delivered }) : null,
  ].filter(Boolean).join(' · ')
  return (
    <div className="cl-camp" data-testid={`client-campaign-${c.row.id}`}>
      <span className={`cl-camp-bar tone-${tone}`} aria-hidden="true" />
      <span className="cl-camp-text">
        <span className="cl-camp-name">{c.row.name}</span>
        <span className="cl-camp-meta">{meta}</span>
      </span>
      <Chip tone={tone}>{t(`clients.page.state.${state}`)}</Chip>
      <Link className="cl-link is-accent" to={`/campaigns/${c.row.id}`}>{t('clients.list.open')}</Link>
    </div>
  )
}

