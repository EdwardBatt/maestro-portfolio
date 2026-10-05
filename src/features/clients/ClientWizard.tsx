import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { usePermissions } from '../../app/permissions'
import { useCampaignList } from '../campaigns/api/campaign-api'
import { useAttributeValues, useDeliverableTypes } from '../admin/api/deliverable-types-api'
import { DEFAULT_SCHEDULING_SETTINGS, useSchedulingSettings } from '../../lib/settings/scheduling-settings-api'
import {
  BUSINESS_TYPES,
  useAccountManagers,
  useActivateClient,
  useAskToActivate,
  useBrands,
  useClientContacts,
  useClients,
  useCountries,
  useSaveBasics,
  type BusinessType,
  type ClientRow,
  type Country,
} from './api/clients-api'
import { profilePct, weekLabel, weekendOf } from './lib/client-profile'
import { Button } from '../../components/Button'
import { BrandsCard } from './components/BrandsCard'
import { PeopleCard } from './components/PeopleCard'
import { RulesCard } from './components/RulesCard'
import { Card, Chip, FieldLabel, Footer, Gauge, MultiSelect, NextButton, Stepper } from './components/parts'
import check from './assets/review-check.svg'
import bullet from './assets/bullet.svg'

/**
 * Registering a client in six steps (ADR-0123, Figma section J CL-v3-01 … 06).
 *
 * `/clients/new` is the Basics step of a client that does not exist yet; its Next saves the DRAFT and
 * every later step is `/clients/:id/register?step=n`, so a draft can be left and continued (CV-01's
 * "Continue"). Brands, people and rules save as they are added. Only the account director activates
 * (d.1); anyone else asks. On an active client the same steps edit it, and the rules are locked for
 * everyone but the director (d.5).
 */
export function ClientWizard() {
  const { t } = useTranslation()
  const { clientId } = useParams()
  const [params, setParams] = useSearchParams()
  const clients = useClients()
  const client = clientId ? clients.data?.find((c) => c.id === clientId && !c.isInternal) ?? null : null
  const step = clientId ? Math.min(6, Math.max(1, Number(params.get('step') ?? '1') || 1)) : 1

  if (clientId && clients.isLoading) return <p className="muted">{t('clients.loading')}</p>
  if (clients.isError) return <p className="form-error">{t('clients.loadFailed')}</p>
  if (clientId && !client) return <p className="form-error" data-testid="client-not-found">{t('clients.notFound')}</p>

  return <Wizard key={client?.id ?? 'new'} client={client} step={step} onStep={(n) => setParams({ step: String(n) })} />
}

function Wizard({ client, step, onStep }: { client: ClientRow | null; step: number; onStep: (n: number) => void }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'ar' ? 'ar' : 'en'
  const navigate = useNavigate()
  const { can } = usePermissions()
  const director = can('clients:approve')
  const canEdit = can('clients:manage')
  const countries = useCountries()
  const brands = useBrands()
  const contacts = useClientContacts(client?.id ?? null)

  const mine = (brands.data ?? []).filter((b) => b.clientId === client?.id)
  const people = contacts.data ?? []
  const country = countries.data?.find((c) => c.code === client?.countryCode) ?? null
  const basicsDone = !!client && !!client.name && !!client.countryCode && !!client.accountManagerId
  const pct = profilePct({
    basics: basicsDone,
    businessTypes: client?.businessTypes.length ?? 0,
    brands: mine.length,
    contacts: people.length,
    signsOff: people.filter((p) => p.signsOff).length,
    rules: client?.rules.length ?? 0,
  })
  const active = client?.status === 'active'
  const done = (n: number) =>
    n === 1 ? basicsDone
      : n === 2 ? mine.length > 0
        : n === 3 ? people.length > 0
          : n === 4 ? (client?.rules.length ?? 0) > 0
            : n === 5 ? basicsDone && (step > 5 || active)
              : active

  const go = (n: number) => onStep(n)
  const next = () => go(step + 1)
  const back = () => go(step - 1)
  const page = (title: string, sub: string, body: React.ReactNode, foot: React.ReactNode) => (
    <div className="cl-page" data-testid="client-wizard" data-step={step}>
      {/* I69.2: editing an active client (reached from its page's "Edit client") has a way back to that page. */}
      {client && active && (
        <Button variant="secondary" size="sm" icon="chevron-left" className="back-button" to={`/clients/${client.id}`} data-testid="client-edit-back">
          {t('clients.wizard.backTo', { name: client.name })}
        </Button>
      )}
      <div className="cl-crumb">
        <span>{client ? t('clients.crumbOf', { name: client.name }) : t('clients.crumbNew')}</span>
        {client && !active && <span className="cl-saved" data-testid="client-saved-draft">{t('clients.wizard.savedDraft')}</span>}
      </div>
      <div className="cl-top">
        <Stepper current={step} done={done} onGo={client ? go : null} />
        <Gauge pct={pct} active={active} />
      </div>
      <h1 className="cl-title" data-testid="client-step-title">{title}</h1>
      <p className="cl-sub">{sub}</p>
      {body}
      {foot}
    </div>
  )

  const stepFoot = (nextKey: string, hintKey: string, skippable: boolean) => (
    <Footer hint={t(hintKey)}>
      <NextButton label={t(nextKey)} onClick={next} testId="client-next" />
      <button type="button" className="cl-back" onClick={back} data-testid="client-back">{t('clients.wizard.back')}</button>
      {skippable && <button type="button" className="cl-skip" onClick={next} data-testid="client-skip">{t('clients.wizard.skip')}</button>}
    </Footer>
  )

  if (step === 1 || !client) {
    return <BasicsStep client={client} director={director} page={page} onSaved={(id) => navigate(`/clients/${id}/register?step=2`, { replace: !client })} />
  }
  if (step === 2) {
    return page(t('clients.brands.heading'), t('clients.brands.sub'),
      <div className="cl-body"><div className="cl-main"><BrandsCard clientId={client.id} clientName={client.name} canEdit={canEdit} /></div></div>,
      stepFoot('clients.wizard.nextPeople', 'clients.brands.hint', true))
  }
  if (step === 3) {
    return page(t('clients.people.heading'), t('clients.people.sub'),
      <div className="cl-body"><div className="cl-main"><PeopleCard clientId={client.id} canEdit={canEdit} /></div></div>,
      stepFoot('clients.wizard.nextRules', 'clients.people.hint', true))
  }
  if (step === 4) {
    return page(t('clients.rules.heading'), t('clients.rules.sub'),
      <div className="cl-body"><div className="cl-main"><RulesCard clientId={client.id} rules={client.rules} locked={active && !director} canEdit={canEdit} /></div></div>,
      stepFoot('clients.wizard.nextHow', 'clients.rules.hint', true))
  }
  if (step === 5) {
    return page(t('clients.how.heading'), t('clients.how.sub'),
      <HowWeWork client={client} country={country} locale={locale} />,
      stepFoot('clients.wizard.nextReview', 'clients.how.hint', false))
  }
  return <ReviewStep client={client} country={country} brandNames={mine.map((b) => b.shortName || b.name)} people={people} director={director} page={page} onGo={go} />
}

type PageFn = (title: string, sub: string, body: React.ReactNode, foot: React.ReactNode) => React.ReactElement

// ---------------------------------------------------------------- CL-v3-01 Basics

function BasicsStep({ client, director, page, onSaved }: { client: ClientRow | null; director: boolean; page: PageFn; onSaved: (id: string) => void }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'ar' ? 'ar' : 'en'
  const navigate = useNavigate()
  const isActive = client?.status === 'active'
  const countries = useCountries()
  const managers = useAccountManagers()
  const clients = useClients()
  const brands = useBrands()
  const campaigns = useCampaignList()
  const save = useSaveBasics()
  const [name, setName] = useState(client?.name ?? '')
  const [countryCode, setCountryCode] = useState(client?.countryCode ?? '')
  const [managerId, setManagerId] = useState(client?.accountManagerId ?? '')
  const [types, setTypes] = useState<BusinessType[]>(client?.businessTypes ?? [])
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const country = countries.data?.find((c) => c.code === countryCode) ?? null
  const norm = (s: string) => s.trim().toLocaleLowerCase()
  const key = norm(name)
  const clientHit = key ? (clients.data ?? []).find((c) => c.id !== client?.id && !c.isInternal && norm(c.name) === key) : undefined
  const brandHit = key && !clientHit
    ? (brands.data ?? []).find((b) => b.clientId !== client?.id && (norm(b.name) === key || norm(b.shortName ?? '') === key))
    : undefined
  const brandCampaigns = brandHit ? (campaigns.data ?? []).filter((c) => c.brandName === brandHit.name && c.clientName === brandHit.clientName).length : 0
  const showCheck = (clientHit || brandHit) && dismissed !== key
  const ready = !!name.trim() && !!countryCode && !!managerId

  function submit() {
    if (!ready) return
    setError(null)
    save.mutate({ id: client?.id ?? null, name, countryCode, accountManagerId: managerId, businessTypes: types }, {
      onSuccess: onSaved,
      onError: (e) => setError(t((e as { code?: string }).code === '23505' ? 'clients.duplicate' : 'clients.saveFailed')),
    })
  }

  const typeOptions = BUSINESS_TYPES.map((b) => ({ value: b, label: t(`clients.businessType.${b}`) }))

  return page(
    t('clients.basics.heading'),
    t('clients.basics.sub'),
    <div className="cl-body">
      <div className="cl-main">
        <Card title={t('clients.basics.card')} testId="client-basics">
          <div className="cl-field">
            <FieldLabel label={t('clients.basics.name')} required htmlFor="client-name" />
            <input id="client-name" className="cl-input is-required" value={name} onChange={(e) => setName(e.target.value)} data-testid="client-name" />
          </div>
          <div className="cl-row2">
            <div className="cl-field">
              <FieldLabel label={t('clients.basics.country')} required htmlFor="client-country" />
              <select id="client-country" className="cl-input is-required" value={countryCode} onChange={(e) => setCountryCode(e.target.value)} data-testid="client-country">
                <option value="" disabled>{t('clients.basics.pickCountry')}</option>
                {(countries.data ?? []).map((c) => <option key={c.code} value={c.code}>{locale === 'ar' ? c.nameAr : c.nameEn}</option>)}
              </select>
              {country && (
                <span className="cl-hint" data-testid="client-country-week">
                  {t('clients.basics.week', { week: weekLabel(country.workingDays, locale), weekend: weekLabel(weekendOf(country.workingDays), locale) })}
                </span>
              )}
            </div>
            <div className="cl-field">
              <FieldLabel label={t('clients.basics.businessType')} htmlFor="client-types" />
              <MultiSelect id="client-types" values={types} options={typeOptions} onChange={setTypes} placeholder={t('clients.basics.pickTypes')} testId="client-types" />
            </div>
          </div>
          <div className="cl-field">
            <FieldLabel label={t('clients.basics.accountManager')} required htmlFor="client-am" />
            <select id="client-am" className="cl-input is-required" value={managerId} onChange={(e) => setManagerId(e.target.value)} data-testid="client-am">
              <option value="" disabled>{t('clients.basics.pickManager')}</option>
              {(managers.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <span className="cl-hint">{t('clients.basics.managerHint')}</span>
          </div>
          {error && <p className="cl-error" role="alert" data-testid="client-basics-error">{error}</p>}
        </Card>
      </div>
      <aside className="cl-side">
        {showCheck && (
          <div className="cl-check" data-testid="client-duplicate">
            <div><Chip tone="amber">{t('clients.basics.checkFirst')}</Chip></div>
            <p className="cl-check-title">
              {clientHit ? t('clients.basics.isClient', { name: name.trim() }) : t('clients.basics.isBrand', { name: name.trim(), client: brandHit!.clientName })}
            </p>
            <p className="cl-check-body">
              {clientHit
                ? t('clients.basics.isClientBody', { name: clientHit.name })
                : t(brandCampaigns ? 'clients.basics.isBrandBody' : 'clients.basics.isBrandBodyBare', { client: brandHit!.clientName, brand: brandHit!.shortName || brandHit!.name, count: brandCampaigns })}
            </p>
            <div className="cl-check-actions">
              <button
                type="button"
                className="cl-amber-btn"
                onClick={() => navigate(`/clients/${clientHit?.id ?? brandHit!.clientId}`)}
                data-testid="client-duplicate-open"
              >
                {clientHit ? t('clients.basics.open', { name: clientHit.name }) : t('clients.basics.open', { name: `${brandHit!.clientName} · ${brandHit!.shortName || brandHit!.name}` })}
              </button>
              <button type="button" className="cl-amber-link" onClick={() => setDismissed(key)} data-testid="client-duplicate-different">
                {t('clients.basics.different')}
              </button>
            </div>
          </div>
        )}
        {/* I69.2: the draft / activation note is about registering; an active client being edited is neither. */}
        {!isActive && (
          <div className="cl-note">
            <p className="cl-note-title">{t(director ? 'clients.basics.directorTitle' : 'clients.basics.draftTitle')}</p>
            <p className="cl-note-body">{t(director ? 'clients.basics.directorBody' : 'clients.basics.draftBody')}</p>
          </div>
        )}
      </aside>
    </div>,
    <Footer hint={t(isActive ? 'clients.basics.hintActive' : 'clients.basics.hint')}>
      <NextButton label={t('clients.wizard.nextBrands')} onClick={submit} disabled={!ready || save.isPending} testId="client-next" />
      <button type="button" className="cl-back" onClick={() => navigate(isActive ? `/clients/${client!.id}` : '/clients')} data-testid="client-cancel">{t('clients.cancel')}</button>
    </Footer>,
  )
}

// ---------------------------------------------------------------- CL-v3-05 How we work

const OWN_SHOWN = 8

function HowWeWork({ client, country, locale }: { client: ClientRow; country: Country | null; locale: 'en' | 'ar' }) {
  const { t, i18n } = useTranslation()
  const types = useDeliverableTypes()
  const values = useAttributeValues()
  const settings = useSchedulingSettings()
  const fallbackDays = (settings.data ?? DEFAULT_SCHEDULING_SETTINGS).rule.commenceDaysBeforeDelivery
  const activeTypes = (types.data ?? []).filter((d) => d.isActive)
  const rows = useMemo(
    () => activeTypes
      .map((d) => ({ id: d.id, name: (i18n.language === 'ar' && d.nameAr) || d.nameEn, days: d.leadTimeHours ? Math.max(1, Math.ceil(d.leadTimeHours / 8)) : null }))
      .sort((a, b) => (a.days ?? fallbackDays) - (b.days ?? fallbackDays) || a.name.localeCompare(b.name)),
    [activeTypes, i18n.language, fallbackDays],
  )
  const own = rows.filter((r) => r.days != null)
  const onDefault = rows.length - own.length
  const limits = activeTypes.map((d) => d.revisionLimit).filter((n): n is number => n != null)
  const rounds = limits.length === 0 ? null : Math.min(...limits) === Math.max(...limits) ? String(limits[0]) : `${Math.min(...limits)}–${Math.max(...limits)}`
  const languages = (values.data ?? []).filter((v) => v.attribute === 'language' && v.isActive).map((v) => (locale === 'ar' && v.labelAr) || v.labelEn)
  const countryName = country ? (locale === 'ar' ? country.nameAr : country.nameEn) : ''
  const am = client.accountManagerName ?? '—'

  const fact = (label: string, chip: string, value: string, testId: string) => (
    <div className="cl-fact" data-testid={testId}>
      <div className="cl-label-row">
        <span className="cl-fact-label">{label}</span>
        <Chip tone="neutral" size={7}>{chip}</Chip>
      </div>
      <span className="cl-fact-value">{value}</span>
    </div>
  )

  return (
    <div className="cl-body">
      <div className="cl-main">
        <Card title={t('clients.how.leadTimes')} count={t('clients.how.globalReadOnly')} testId="client-lead-times">
          {/* The types with a lead time of their own (the first eight, shortest first), then one row for
              everything on the default — the catalogue runs to hundreds of types. */}
          {own.slice(0, OWN_SHOWN).map((r) => (
            <div key={r.id} className="cl-kv">
              <span className="cl-kv-key">{r.name}</span>
              <span className="cl-kv-value">{t('clients.how.days', { count: r.days! })}</span>
            </div>
          ))}
          {own.length > OWN_SHOWN && <p className="cl-footnote">{t('clients.how.moreOwn', { count: own.length - OWN_SHOWN })}</p>}
          {onDefault > 0 && (
            <div className="cl-kv" data-testid="client-lead-default">
              <span className="cl-kv-key">{own.length ? t('clients.how.everythingElse', { count: onDefault }) : t('clients.how.everyType', { count: onDefault })}</span>
              <span className="cl-kv-value">{t('clients.how.defaultDays', { count: fallbackDays })}</span>
            </div>
          )}
          <p className="cl-footnote">{t('clients.how.leadNote')}</p>
        </Card>
      </div>
      <div className="cl-main">
        <Card title={t('clients.how.derived')} testId="client-derived">
          {fact(t('clients.how.workingWeek'), t('clients.how.from', { country: countryName.toLocaleUpperCase() }),
            country ? weekLabel(country.workingDays, locale, 'long') : '—', 'client-how-week')}
          {fact(t('clients.how.weekend'), t('clients.how.from', { country: countryName.toLocaleUpperCase() }),
            country ? weekLabel(weekendOf(country.workingDays), locale, 'long') || '—' : '—', 'client-how-weekend')}
          {fact(t('clients.how.approves'), t('clients.how.theAm'), am, 'client-how-approves')}
          {fact(t('clients.how.records'), t('clients.how.theAm'), am, 'client-how-records')}
          {fact(t('clients.how.rounds'), t('clients.how.roundsChip'), rounds ?? '—', 'client-how-rounds')}
          {fact(t('clients.how.language'), t('clients.how.languageChip'), languages.join(' · ') || '—', 'client-how-language')}
        </Card>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- CL-v3-06 Review and activate

function ReviewStep({ client, country, brandNames, people, director, page, onGo }: {
  client: ClientRow
  country: Country | null
  brandNames: string[]
  people: { name: string; canRequest: boolean; signsOff: boolean; isCopied: boolean }[]
  director: boolean
  page: PageFn
  onGo: (n: number) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'ar' ? 'ar' : 'en'
  const navigate = useNavigate()
  const activate = useActivateClient()
  const ask = useAskToActivate()
  const [error, setError] = useState<string | null>(null)
  const active = client.status === 'active'
  const week = country ? weekLabel(country.workingDays, locale) : '—'
  const countryName = country ? (locale === 'ar' ? country.nameAr : country.nameEn) : ''
  const types = client.businessTypes.map((b) => t(`clients.businessType.${b}`))
  const roleOf = (p: (typeof people)[number]) =>
    [p.canRequest && t('clients.review.asks'), p.signsOff && t('clients.review.signsOff'), p.isCopied && t('clients.review.copied')].filter(Boolean).join(t('clients.review.and'))

  const sections: { key: string; step: number; done: boolean; meta: string }[] = [
    { key: 'basics', step: 1, done: true, meta: t('clients.review.basicsMeta') },
    { key: 'brands', step: 2, done: brandNames.length > 0, meta: brandNames.length ? t('clients.review.brandsMeta', { brands: brandNames.join(' · ') }) : t('clients.review.none') },
    { key: 'people', step: 3, done: people.length > 0, meta: people.length ? people.map((p) => (roleOf(p) ? `${p.name} (${roleOf(p)})` : p.name)).join(' · ') : t('clients.review.none') },
    { key: 'rules', step: 4, done: client.rules.length > 0, meta: client.rules.length ? t('clients.review.rulesMeta', { count: client.rules.length }) : t('clients.review.none') },
    { key: 'howWeWork', step: 5, done: true, meta: t('clients.review.howMeta', { week }) },
  ]

  function onActivate() {
    setError(null)
    activate.mutate(client.id, {
      onSuccess: () => navigate(`/clients/${client.id}`),
      onError: (e) => setError(t((e as { code?: string }).code === '23514' ? 'clients.review.missing' : 'clients.saveFailed')),
    })
  }

  const asked = client.activationRequestedAt
  const primary = active
    ? <NextButton label={t('clients.review.done')} onClick={() => navigate(`/clients/${client.id}`)} testId="client-done" />
    : director
      ? <NextButton label={t('clients.review.activate', { name: client.name })} onClick={onActivate} disabled={activate.isPending} testId="client-activate" />
      : <NextButton label={t(asked ? 'clients.review.askAgain' : 'clients.review.ask')} onClick={() => ask.mutate(client.id)} disabled={ask.isPending} testId="client-ask" />

  return page(
    active ? client.name : t(director ? 'clients.review.heading' : 'clients.review.headingAsk', { name: client.name }),
    active ? t('clients.review.subActive') : t('clients.review.sub'),
    <div className="cl-body">
      <div className="cl-main">
        <div className="cl-summary" data-testid="client-summary">
          <div className="cl-summary-chips">
            {country && <Chip tone="purple" size={9}>{`${countryName} · ${week}`.toLocaleUpperCase()}</Chip>}
            <Chip tone="neutral" size={9}>{t('clients.review.brandsChip', { count: brandNames.length })}</Chip>
            <Chip tone="neutral" size={9}>{t('clients.review.contactsChip', { count: people.length })}</Chip>
            <Chip tone="neutral" size={9}>{t('clients.review.rulesChip', { count: client.rules.length })}</Chip>
          </div>
          <p className="cl-summary-name">{client.name}</p>
          <p className="cl-summary-sub">{[...types, t('clients.review.amIs', { name: client.accountManagerName ?? '—' })].join(' · ')}</p>
        </div>
        {sections.map((s) => (
          <div key={s.key} className="cl-section" data-testid={`client-review-${s.key}`}>
            {s.done ? <img src={check} width={14} height={14} alt="" /> : <span className="cl-dot-todo" aria-hidden="true" />}
            <div className="cl-section-text">
              <span className="cl-section-name">{t(`clients.wizard.step.${s.key}`)}</span>
              <span className="cl-section-meta">{s.meta}</span>
            </div>
            <button type="button" className="cl-link" onClick={() => onGo(s.step)} data-testid={`client-review-edit-${s.key}`}>{t('clients.edit')}</button>
          </div>
        ))}
        {error && <p className="cl-error" role="alert" data-testid="client-review-error">{error}</p>}
      </div>
      <aside className="cl-side">
        <div className="cl-note">
          <p className="cl-note-title">{t('clients.review.whatTitle')}</p>
          <ul className="cl-note-list">
            {[
              t('clients.review.what1', { name: client.name }),
              brandNames.length ? t('clients.review.what2', { name: client.name, brand: brandNames[0] }) : t('clients.review.what2None', { name: client.name }),
              t('clients.review.what3'),
              t('clients.review.what4', { am: client.accountManagerName ?? '—', name: client.name }),
            ].map((line) => (
              <li key={line}><img src={bullet} width={5} height={5} alt="" />{line}</li>
            ))}
          </ul>
        </div>
        {!active && (
          <div className="cl-quiet">
            <p className="cl-quiet-title">{t('clients.review.notReady')}</p>
            <p className="cl-quiet-body">{t('clients.review.notReadyBody')}</p>
          </div>
        )}
      </aside>
    </div>,
    <Footer
      hint={active ? t('clients.review.hintActive') : director ? t('clients.review.hintDirector') : asked ? t('clients.review.hintAsked') : t('clients.review.hintAsk')}
    >
      {primary}
      <button type="button" className="cl-back" onClick={() => onGo(5)} data-testid="client-back">{t('clients.wizard.back')}</button>
    </Footer>,
  )
}
