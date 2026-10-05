import { useEffect, useRef, useState } from 'react'
import { InfoTip } from '../../../components/InfoTip'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { FillerWarning } from '../../../components/FillerWarning'
import { BriefIngestPanel } from '../../campaigns/components/BriefIngestPanel'
import { DocumentFiling } from '../../campaigns/components/DocumentFiling'
import type { BriefUsage, SingleExecutionIngestResult } from '../api/intake-api'
import { filledCount, requiredBriefKeys, splitBriefFields, type TemplateField } from '../lib/single-job'
import { ResponseClock } from './ResponseClock'
import type { ClientRule } from '../../../lib/brief/rules'

/**
 * SJ-v3-02 — The brief (Figma `B · SINGLE JOB — BRIEF FIRST`, 22 Sep), on ADR-0084.
 *
 * One page, written from the template chosen on SJ-v3-01 — any of the tenant's own, not only
 * `single_execution` — with a rail on the inline-start naming its parts and how far each is:
 * **1 · The essentials** (the first four fields), **2 · The rest**, **Dos and don'ts**,
 * **Attachments**. Above the fields, "Got a brief already? Drop it here" — a document is read into
 * the empty fields and the person reviews each before moving on (d.6). The required field is the
 * template's (d.6a, now per template). "What could stop this" stays as a free-text reminder for
 * the owner (d.8), at the end of the rest. Attachments file into the job's References (d.7).
 *
 * The request's own words stay in view under the rail — the brief is written FROM that line (d.5).
 *
 * **Dos and don'ts.** The Figma inherits seven locked rules from the client and the campaign.
 * Nothing on a client, a brand or a campaign holds such rules today (ADR-0084 d.5: nothing is
 * prefilled), so the section says so in one quiet line — never an empty box that looks broken.
 *
 * Presentation only. The ingest is passed in, built against the template's own keys; the merge,
 * the "reviewed" bookkeeping and the autosave are the wizard's.
 */
export interface BriefStepProps {
  templateName: string
  templateNameAlt: string | null
  departmentName: string
  clientName: string
  /** The client's past use of this template, for the foot line. */
  usage: BriefUsage | null
  /** Dos and don'ts the job inherits — the client's, and the campaign's when one was picked. Locked here. */
  rules: ClientRule[]
  /** Where the rules come from, for the sentence under them: "From Kite and from LUMA Season 2." */
  rulesFrom: string[]
  words: string
  askedBy: string
  clockStart: string | null
  /** 'saving' while a debounced write is in flight, 'saved' after one, null before any. */
  saveState: 'saving' | 'saved' | null
  fields: TemplateField[]
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  /** Fields the last ingest filled that nobody has looked at yet (ADR-0044 §5 marker). */
  unreviewed: readonly string[]
  onKeep: (key: string) => void
  risk: string
  onRiskChange: (value: string) => void
  ingest: (text: string) => Promise<SingleExecutionIngestResult>
  onIngested: (result: SingleExecutionIngestResult, file: File | null) => void
  ingestStatus: { text: string; warning: boolean } | null
  /** The job's folder tree, for attachments. Null until the folders are known. */
  filing: { clientId: string; rootId: string; canManage: boolean } | null
  missing: readonly string[]
  /** ADR-0111 d.3 / E10 (I59.27): the tenant's own filler words. Every field with text is warned
   *  beside when it holds only placeholder; the database refuses at release. */
  fillerWords?: readonly string[]
}

export function BriefStep({
  templateName,
  templateNameAlt,
  departmentName,
  clientName,
  usage,
  rules,
  rulesFrom,
  words,
  askedBy,
  clockStart,
  saveState,
  fields,
  values,
  onChange,
  unreviewed,
  onKeep,
  risk,
  onRiskChange,
  ingest,
  onIngested,
  ingestStatus,
  filing,
  missing,
  fillerWords = [],
}: BriefStepProps) {
  const { t, i18n } = useTranslation()
  const ar = i18n.language === 'ar'
  const { essentials, rest } = splitBriefFields(fields)
  const required = requiredBriefKeys(fields)
  const essentialsDone = filledCount(values, essentials)
  const restDone = filledCount(values, rest)
  const prefilled = unreviewed.length > 0

  // The rail highlights the section on screen (the Figma's "1 · The essentials" in the hue). A
  // click marks it at once; scrolling follows with an observer over the four sections.
  const SECTIONS = ['essentials', 'rest', 'rules', 'attachments'] as const
  const [active, setActive] = useState<(typeof SECTIONS)[number]>('essentials')
  // A click wins over the observer for a moment: the smooth scroll passes through the sections
  // above the target, and without this the rail would flicker through them.
  const clicked = useRef<number>(0)
  const jump = (id: (typeof SECTIONS)[number]) => {
    setActive(id)
    clicked.current = Date.now()
    document.getElementById(`sj-brief-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const seen = new Map<string, number>()
    const io = new IntersectionObserver(
      (entries) => {
        if (Date.now() - clicked.current < 900) return
        for (const e of entries) seen.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0)
        const best = SECTIONS.map((k) => [k, seen.get(`sj-brief-${k}`) ?? 0] as const).sort((a, b) => b[1] - a[1])[0]
        if (best && best[1] > 0) setActive(best[0])
      },
      { rootMargin: '-20% 0px -55% 0px', threshold: [0, 0.25, 0.5, 1] },
    )
    for (const k of SECTIONS) {
      const el = document.getElementById(`sj-brief-${k}`)
      if (el) io.observe(el)
    }
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const navItem = (k: (typeof SECTIONS)[number]) => `sj-brief-nav-item${active === k ? ' is-active' : ''}`

  const renderField = (f: TemplateField, rows: number) => {
    const marked = unreviewed.includes(f.key)
    const isRequired = required.includes(f.key)
    const filled = (values[f.key] ?? '').trim().length > 0
    return (
      <div key={f.key} className={`brief-field${filled ? ' is-filled' : ''}`} data-testid={`sj-brief-field-${f.key}`}>
        <label className="brief-field-label" htmlFor={`sj-field-${f.key}`}>
          <span className="brief-field-name">{ar ? f.ar || f.en : f.en}</span>
          {(ar ? f.en : f.ar) && <span className="brief-field-alt" dir="auto">{ar ? f.en : f.ar}</span>}
          {isRequired && <span className="tag tag-accent">{t('field.required')}</span>}
        </label>
        <textarea
          id={`sj-field-${f.key}`}
          rows={rows}
          value={values[f.key] ?? ''}
          placeholder={f.guidance || undefined}
          aria-describedby={marked ? `sj-mark-${f.key}` : undefined}
          aria-invalid={missing.includes(f.key) || undefined}
          onChange={(e) => onChange(f.key, e.target.value)}
          data-testid={`sj-field-${f.key}`}
        />
        <FillerWarning text={values[f.key]} extraWords={fillerWords} testId={`sj-field-${f.key}-filler`} />
        {marked && (
          <span className="brief-filled-mark" id={`sj-mark-${f.key}`} data-testid={`sj-filled-mark-${f.key}`}>
            {t('campaigns.ingest.marker')}
            <Button variant="secondary" size="sm" icon="check" onClick={() => onKeep(f.key)} data-testid={`sj-filled-keep-${f.key}`}>
              {t('campaigns.ingest.confirm')}
            </Button>
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="sj-step" data-testid="sj-brief">
      <div className="sj-head">
        <div>
          <h1 className="sj-head-title sj-brief-title">
            {templateName}
            {/* Three spans, not one joined string: an Arabic name at the start of a Latin line
                would otherwise pull the count and the note into its own direction. */}
            <span className="tag tag-hue sj-brief-title-tag" data-testid="sj-brief-template-tag">
              {templateNameAlt && <><span dir="auto">{templateNameAlt}</span><span>{' · '}</span></>}
              <span>{t('intake.brief.fieldsCount', { n: fields.length })}</span>
              <span>{' · '}</span>
              <span>{t('intake.brief.fromTemplate')}</span>
            </span>
          </h1>
          <p className="sj-head-sub">{prefilled ? t('intake.brief.onePagePrefilled') : t('intake.brief.onePage')}</p>
        </div>
        <div className="sj-head-side">
          <ResponseClock variant="chip" startIso={clockStart} testId="sj-clock" />
          {saveState && (
            <span className="muted sj-save-state" role="status" data-testid="sj-brief-save-state">
              {t(saveState === 'saving' ? 'intake.brief.saving' : 'intake.brief.saved')}
            </span>
          )}
        </div>
      </div>

      <div className="sj-brief-layout">
        {/* The rail: the page's parts and how far each is. Anchors, not steps. */}
        <aside className="sj-brief-rail">
          <nav className="sj-brief-nav" aria-label={t('intake.brief.onThisPage')} data-testid="sj-brief-nav">
            <button type="button" className={navItem('essentials')} aria-current={active === 'essentials' || undefined} onClick={() => jump('essentials')} data-testid="sj-brief-nav-essentials">
              <span>{t('intake.brief.essentials')}</span>
              <span className="sj-brief-nav-count">{t('intake.brief.ofCount', { n: essentialsDone, total: essentials.length })}</span>
            </button>
            <button type="button" className={navItem('rest')} aria-current={active === 'rest' || undefined} onClick={() => jump('rest')} data-testid="sj-brief-nav-rest">
              <span>{t('intake.brief.theRest')}</span>
              <span className="sj-brief-nav-count">{t('intake.brief.ofCount', { n: restDone, total: rest.length })}</span>
            </button>
            <button type="button" className={navItem('rules')} aria-current={active === 'rules' || undefined} onClick={() => jump('rules')} data-testid="sj-brief-nav-rules">
              <span>{t('intake.brief.rules')}</span>
              <span className="sj-brief-nav-count">{t('intake.brief.rulesInherited', { n: rules.length })}</span>
            </button>
            <button type="button" className={navItem('attachments')} aria-current={active === 'attachments' || undefined} onClick={() => jump('attachments')} data-testid="sj-brief-nav-attachments">
              <span>{t('intake.brief.attachments')}</span>
              <span className="sj-brief-nav-count">{t('intake.brief.fromLibrary')}</span>
            </button>
          </nav>

          {/* d.5: the line the brief is written from, so it never needs scrolling back for. */}
          <div className="intake-words-block sj-brief-words">
            <span className="field-name">{t('intake.brief.theirWords')}</span>
            <blockquote className="intake-words" data-testid="sj-brief-words">{words}</blockquote>
            {askedBy && <p className="intake-words-by">{t('intake.brief.askedBy', { name: askedBy })}</p>}
            {departmentName && <p className="intake-words-by">{t('intake.brief.forDepartment', { department: departmentName })}</p>}
          </div>
        </aside>

        <div className="sj-brief-main">
          {/* d.6: a document read into the EMPTY fields; every filled one is marked until kept. */}
          <BriefIngestPanel<SingleExecutionIngestResult>
            compact
            ingest={ingest}
            onIngested={onIngested}
            statusMessage={ingestStatus?.text ?? null}
            statusIsWarning={ingestStatus?.warning}
          />

          <section className="sj-brief-section is-essentials" id="sj-brief-essentials" data-testid="sj-brief-essentials">
            <header className="sj-brief-section-head">
              <h2>{t('intake.brief.essentials')}</h2>
              <span className="tag tag-hue">{t('intake.brief.ofCount', { n: essentialsDone, total: essentials.length })}</span>
            </header>
            {essentials.map((f) => renderField(f, f.key === 'task' ? 3 : 2))}
          </section>

          <section className="sj-brief-section" id="sj-brief-rest" data-testid="sj-brief-rest">
            <header className="sj-brief-section-head">
              <h2>{t('intake.brief.theRest')}</h2>
              <span className="tag tag-neutral">{t('intake.brief.ofCount', { n: restDone, total: rest.length })}</span>
            </header>
            {rest.map((f) => renderField(f, 2))}
            {/* d.8: a reminder, never a dependency. The owner sees it above the task list (ADR-0090
                d.7) and attaches the real dependency to the right task there. */}
            <div className="brief-field" data-testid="sj-brief-field-risk">
              <label className="brief-field-label" htmlFor="sj-risk">
                <span className="brief-field-name">{t('intake.brief.risk')}</span>
                <span className="brief-field-alt">{t('intake.brief.riskWho')}</span>
              </label>
              <textarea id="sj-risk" rows={2} value={risk} placeholder={t('intake.brief.riskHint')} onChange={(e) => onRiskChange(e.target.value)} data-testid="sj-risk" />
              <FillerWarning text={risk} extraWords={fillerWords} testId="sj-risk-filler" />
            </div>
          </section>

          <section className="sj-brief-section is-quiet" id="sj-brief-rules" data-testid="sj-brief-rules">
            <header className="sj-brief-section-head">
              <h2>{t('intake.brief.rules')}</h2>
              <span className="tag tag-neutral">{t('intake.brief.rulesInheritedTag', { n: rules.length })}</span>
            </header>
            {rules.length > 0 ? (
              <>
                <ul className="sj-rules" data-testid="sj-brief-rules-list">
                  {rules.map((r, i) => (
                    <li key={i} className="sj-rule">
                      <span className={`rule-pill rule-${r.kind} is-on`}>{t(r.kind === 'do' ? 'clients.rules.do' : 'clients.rules.dont')}</span>
                      <span className="sj-rule-text" dir="auto">{r.text}</span>
                    </li>
                  ))}
                </ul>
                <p className="muted sj-brief-section-note">{t('intake.brief.rulesFrom', { from: rulesFrom.join(', ') })}</p>
              </>
            ) : (
              <p className="muted sj-brief-section-note">{t('intake.brief.rulesNone', { client: clientName })}</p>
            )}
          </section>

          <section className="sj-brief-section" id="sj-brief-attachments" data-testid="sj-brief-attachments-section">
            <header className="sj-brief-section-head">
              <h2>
                {t('intake.brief.attachments')}
                <InfoTip label={t('intake.brief.attachments')} lines={[t('intake.brief.attachmentsHint')]} testId="sj-attachments-hint" />
              </h2>
              <span className="tag tag-neutral">{t('intake.brief.fromLibrary')}</span>
            </header>
            {/* d.7: reference material, not proof — into the same References folder the proof went. */}
            {filing ? (
              <DocumentFiling
                clientId={filing.clientId}
                rootId={filing.rootId}
                title=""
                canManage={filing.canManage}
                testId="sj-attachments"
              />
            ) : (
              <p className="muted sj-brief-section-note">{t('intake.brief.attachmentsSoon')}</p>
            )}
          </section>

          <p className="sj-brief-foot" data-testid="sj-brief-usage">
            {usage
              ? t('intake.brief.usedThis', { campaign: usage.lastCampaign, n: usage.count, client: clientName })
              : t('intake.brief.notUsedThis', { client: clientName })}
          </p>
        </div>
      </div>
    </div>
  )
}
