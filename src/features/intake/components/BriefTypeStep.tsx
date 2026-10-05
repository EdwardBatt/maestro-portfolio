import { useMemo, useState } from 'react'
import { InfoTip } from '../../../components/InfoTip'
import { useTranslation } from 'react-i18next'
import { Field } from '../../../components/Field'
import { TemplateCard } from '../../../components/TemplateCard'
import { AddBrandDialog } from '../../campaigns/components/AddBrandDialog'
import { BriefReceiptPanel, type ReceiptDraft } from '../../campaigns/components/BriefReceiptPanel'
import type { BriefTemplate } from '../../admin/api/brief-templates-api'
import type { BriefUsage } from '../api/intake-api'
import { REQUEST_SOURCES, type RequestDraft } from '../lib/single-job'
import { briefTypeLook } from './brief-type-icons'
import { ResponseClock } from './ResponseClock'
import { suggestedNames, useClientPeople } from '../../../lib/clients/people'

/**
 * SJ-v3-01 — What are we making? (Figma `B · SINGLE JOB — BRIEF FIRST`, 22 Sep.)
 *
 * Say who it is for — client, then brand, with "add one" in the brand list (SJ-A3, ADR-0086 d.1) —
 * and, in the same row, how the request came in (Edward, 22 Sep): who asked (free text, ADR-0083
 * d.1), how it arrived (d.5), and the receipt path reused whole — the model reads the screenshot, a
 * person confirms (ADR-0066, d.2). Then pick the kind of brief from the tenant's OWN templates: every active one with fields, not
 * a fixed six (Edward, 22 Sep: *"we have 13 templates and the ability to add more"*). A card names
 * the template in both languages, describes it in a line, says which departments write from it
 * and how many fields it asks, and where this client last had one. The search box narrows the
 * grid; an empty match falls back to a one-line note, never a dead end.
 *
 * Presentation only. Every list arrives as a prop; the choice goes back up through `onChange`.
 */

/** Sentinel for the brand dropdown's "register one" row. Not a uuid, so it cannot collide. */
const ADD_BRAND = '__add_brand__'

export interface BriefTypeStepProps {
  value: RequestDraft
  onChange: (next: RequestDraft) => void
  clients: { id: string; name: string }[]
  brands: { id: string; name: string; clientId: string }[]
  onBrandAdded: (brandId: string) => void
  receipt: ReceiptDraft
  onReceiptChange: (next: ReceiptDraft) => void
  /** The screenshot already filed against the job, for a resumed one. */
  filedUrl: string | null
  /** The confirmed arrival, as an instant, once the receipt is complete and confirmed. */
  clockStart: string | null
  templates: BriefTemplate[]
  /** How many dos-and-don'ts the client's profile carries — they come with the choice. */
  rulesCount: number
  /** Per brief type, this client's past use of it. Empty until a client is chosen. */
  usage: Record<string, BriefUsage>
  /** True once the job exists — the client can no longer be moved (its folders are filed). */
  clientLocked: boolean
  /** Fields the last Next found missing, so each can be pointed at rather than listed. */
  missing: readonly (keyof RequestDraft)[]
}

export function BriefTypeStep({
  value,
  onChange,
  clients,
  brands,
  onBrandAdded,
  receipt,
  onReceiptChange,
  filedUrl,
  clockStart,
  templates,
  rulesCount,
  usage,
  clientLocked,
  missing,
}: BriefTypeStepProps) {
  const { t, i18n } = useTranslation()
  const ar = i18n.language === 'ar'
  const [addingBrand, setAddingBrand] = useState(false)
  const [query, setQuery] = useState('')

  const set = <K extends keyof RequestDraft>(key: K, v: RequestDraft[K]) => onChange({ ...value, [key]: v })
  const isMissing = (k: keyof RequestDraft) => missing.includes(k)

  const brandsForClient = useMemo(() => brands.filter((b) => b.clientId === value.clientId), [brands, value.clientId])
  const clientName = clients.find((c) => c.id === value.clientId)?.name ?? ''
  // ADR-0123 d.4: the client's people, those who may ask first; a typed name is still accepted.
  const people = useClientPeople(value.clientId || null)
  const askers = suggestedNames(people.data ?? [], 'canRequest')
  const brandName = brandsForClient.find((b) => b.id === value.brandId)?.name ?? ''

  // ADR-0048 d.2: a template with no fields is unselectable — it would generate an empty brief.
  // The Execution brief leads (ADR-0084 named it for a single job); the rest keep the admin
  // list's order, by name.
  const usable = useMemo(
    () => templates
      .filter((x) => x.isActive && x.fields.length > 0)
      .sort((a, b) => Number(b.briefType === 'single_execution') - Number(a.briefType === 'single_execution')),
    [templates],
  )
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return usable
    const hit = usable.filter((x) =>
      [x.nameEn, x.nameAr ?? '', x.descriptionEn ?? '', x.descriptionAr ?? '', x.briefType, ...x.departments.map((d) => d.name)]
        .some((s) => s.toLowerCase().includes(q)),
    )
    return hit
  }, [usable, query])

  return (
    <div className="sj-step" data-testid="sj-brief-type">
      <div className="sj-head">
        <div>
          <h1 className="sj-head-title">{t('intake.briefType.title')}</h1>
          <p className="sj-head-sub">{t('intake.briefType.intro')}</p>
        </div>
        <div className="sj-head-side">
          <label className="sj-search">
            <SearchGlyph />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('intake.briefType.search')}
              aria-label={t('intake.briefType.search')}
              data-testid="sj-brief-search"
            />
          </label>
        </div>
      </div>

      {/* SJ-v3-01: one card — for whom on top, how it came in beneath it, each heading on one line
          and each group's fields in one row. */}
      <section className="sj-for-whom" data-testid="sj-for-whom">
        <div className="sj-for-whom-group">
          <div className="sj-for-whom-head">
            <span className="sj-for-whom-title">{t('intake.briefType.forWhom')}</span>
            {value.clientId && (
              <span className="sj-inherits" data-testid="sj-inherits">
                <span className="tag tag-ok">{t('intake.briefType.inherits')}</span>
                <span className="sj-inherits-text">
                  {t('intake.briefType.inheritsLine', { count: rulesCount, library: brandName || clientName })}
                </span>
              </span>
            )}
          </div>
          <div className="sj-for-whom-fields">
        <Field label={t('intake.request.client')} required hint={clientLocked ? t('intake.request.clientLocked') : undefined}>
          <select
            value={value.clientId}
            disabled={clientLocked}
            onChange={(e) => onChange({ ...value, clientId: e.target.value, brandId: '' })}
            aria-invalid={isMissing('clientId') || undefined}
            data-testid="sj-client"
          >
            <option value="" disabled>{t('campaigns.wizard.selectClient')}</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label={t('intake.request.brand')}>
          {/* SJ-A3 / S4 (ADR-0086 d.1): "add one" is IN the dropdown and opens the existing dialog. */}
          <select
            value={value.brandId}
            disabled={!value.clientId}
            onChange={(e) => {
              if (e.target.value === ADD_BRAND) { setAddingBrand(true); return }
              set('brandId', e.target.value)
            }}
            data-testid="sj-brand"
          >
            <option value="">{t('campaigns.wizard.brandNone')}</option>
            {brandsForClient.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            <option value={ADD_BRAND}>{t('campaigns.wizard.brandAdd')}</option>
          </select>
        </Field>
          </div>
        </div>

        {/* ADR-0083 d.1/d.2/d.5 — the evidence, exactly as the request step held it. */}
        <div className="sj-for-whom-group sj-evidence" data-testid="sj-evidence">
          <div className="sj-for-whom-head">
            <span className="sj-for-whom-title">
              {t('intake.briefType.evidence')}
              {/* SJ-v3-01b: "the long explanation lives here, not on the page". */}
              <InfoTip
                label={t('campaigns.receipt.tipLabel')}
                title={t('campaigns.receipt.tipTitle')}
                lines={[t('campaigns.receipt.intro'), t('campaigns.receipt.cropHint')]}
                testId="receipt-crop-hint"
              />
            </span>
            <ResponseClock variant="chip" startIso={clockStart} testId="sj-clock" />
          </div>
          <BriefReceiptPanel
            compact value={receipt} onChange={onReceiptChange} filedUrl={filedUrl}
            proofLabel={t('intake.briefType.proof')}
            leading={
              <>
                <Field label={t('intake.request.askedBy')}>
                  <input value={value.askedBy} onChange={(e) => set('askedBy', e.target.value)} placeholder={t('intake.request.askedByHint')} list="sj-asked-by-people" data-testid="sj-asked-by" />
                  <datalist id="sj-asked-by-people" data-testid="sj-asked-by-people">
                    {askers.map((n) => <option key={n} value={n} />)}
                  </datalist>
                </Field>
                <Field label={t('intake.request.source')}>
                  <select value={value.source} onChange={(e) => set('source', e.target.value as RequestDraft['source'])} data-testid="sj-source">
                    <option value="">{t('campaigns.wizard.noneChosen')}</option>
                    {REQUEST_SOURCES.map((s) => <option key={s} value={s}>{t(`intake.source.${s}`)}</option>)}
                  </select>
                </Field>
              </>
            }
          />
          <Field label={t('intake.request.words')} required hint={t('intake.request.wordsHint')}>
            <textarea rows={2} value={value.words} onChange={(e) => set('words', e.target.value)} aria-invalid={isMissing('words') || undefined} data-testid="sj-words" />
          </Field>
        </div>
      </section>

      {/* The kind of brief — the tenant's own templates */}
      {shown.length > 0 ? (
        <div className="sj-brief-grid" role="group" aria-label={t('intake.briefType.kindOfBrief')} aria-invalid={isMissing('briefType') || undefined} data-testid="sj-brief-grid">
          {shown.map((x, i) => {
            const look = briefTypeLook(x.briefType, i)
            const used = usage[x.briefType]
            const departments = x.departments.map((d) => d.name).join(' · ')
            return (
              <TemplateCard
                key={x.id}
                icon={look.icon}
                hue={look.hue}
                title={(ar && x.nameAr) || x.nameEn}
                alt={ar ? x.nameEn : x.nameAr}
                description={(ar && x.descriptionAr) || x.descriptionEn || undefined}
                badge={departments || t('intake.briefType.noDepartment')}
                badgeQuiet={!departments}
                count={t('intake.briefType.fields', { n: x.fields.length })}
                note={
                  !value.clientId
                    ? undefined
                    : used
                      ? t('intake.briefType.usedFor', { campaign: used.lastCampaign, n: used.count })
                      : t('intake.briefType.notUsed', { client: clientName })
                }
                noteQuiet={!used}
                selected={value.briefType === x.briefType}
                onClick={() => set('briefType', x.briefType)}
                testId={`sj-brief-card-${x.briefType}`}
              />
            )
          })}
        </div>
      ) : (
        <p className="sj-brief-empty" data-testid="sj-brief-empty">
          {usable.length === 0 ? t('intake.briefType.noTemplates') : t('intake.briefType.noMatch', { query })}
        </p>
      )}

      {addingBrand && value.clientId && (
        <AddBrandDialog
          clientId={value.clientId}
          clientName={clientName}
          onCreated={(brandId) => {
            setAddingBrand(false)
            onBrandAdded(brandId)
          }}
          onCancel={() => setAddingBrand(false)}
        />
      )}
    </div>
  )
}

function SearchGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8.6 8.6L11 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
