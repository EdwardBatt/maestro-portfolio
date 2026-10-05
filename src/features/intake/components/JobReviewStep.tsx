import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { formatIraqDate, formatIraqDateTime } from '../../../lib/time/iraq'
import { useFolderAssets } from '../../library/api/library-api'
import { RISK_KEY, type RequestDraft, type TemplateField } from '../lib/single-job'
import type { LeadTime } from '../lib/lead-time'
import { ResponseClock } from './ResponseClock'
import type { ClientRule } from '../../../lib/brief/rules'

/**
 * SJ-v3-05 — Review and open (Figma `B · SINGLE JOB — BRIEF FIRST`, 22 Sep), on ADR-0085.
 *
 * Read-only, exactly as it will land on the lead's desk (d.1). Left: the deliverable card in the
 * template's hue — "1 DELIVERABLE", type · channel, Edit, the title, then Quantity / Due / Format /
 * Goes to / Starts / Priority; "How the request came in" — the client's words and who · source ·
 * arrival · proof; "The brief" — every field, two columns. Right: "This goes to" (the department,
 * its lead, the load), "Rules it carries" (none exist on a client today — said in one line), and
 * "Attached" — the receipt screenshot and what was filed into the job's References.
 *
 * The Figma's "after you open it, changes are tracked and she sees them" is not built; the
 * sub-line stops at the desk. The response time is prominent, because this is the screen where
 * that gap ends (d.5).
 */
export interface JobReviewStepProps {
  request: RequestDraft
  clientName: string
  brandName: string | null
  typeName: string | null
  /** I54.33: each further deliverable, as "type · channel". Empty when the job has one. */
  moreNames: string[]
  templateName: string
  fieldsCount: number
  departmentName: string
  ownerName: string | null
  ownerLoadPct: number | null
  clockStart: string | null
  /** True when a screenshot is filed or chosen; the proof line says which. */
  hasProof: boolean
  receiptSubject: string
  /** The job's References folder, for the Attached list. Null until the folders are known. */
  referencesFolderId: string | null
  leadTime: LeadTime | null
  rules: ClientRule[]
  rulesFrom: string[]
  fields: TemplateField[]
  values: Record<string, string>
  risk: string
  onEditRequest: () => void
  onEditBrief: () => void
}

export function JobReviewStep({
  request,
  clientName,
  brandName,
  typeName,
  moreNames,
  templateName,
  fieldsCount,
  departmentName,
  ownerName,
  ownerLoadPct,
  clockStart,
  hasProof,
  receiptSubject,
  referencesFolderId,
  leadTime,
  rules,
  rulesFrom,
  fields,
  values,
  risk,
  onEditRequest,
  onEditBrief,
}: JobReviewStepProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'ar' ? 'ar' : 'en'
  const dash = <span className="muted">—</span>
  const due = request.dueDate ? formatIraqDate(`${request.dueDate}T00:00:00Z`, locale) : null
  const starts = leadTime?.startDay ? formatIraqDate(`${leadTime.startDay}T00:00:00Z`, locale) : null
  const attached = useFolderAssets(referencesFolderId)
  const files = attached.data ?? []
  const initials = (ownerName ?? '').split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
  const arrival = clockStart ? formatIraqDateTime(clockStart, locale) : null

  return (
    <div className="sj-step" data-testid="sj-review">
      <div className="sj-head">
        <div>
          <h1 className="sj-head-title">{t('intake.review.title')}</h1>
          <p className="sj-head-sub">{ownerName ? t('intake.review.subtitleNamed', { owner: ownerName }) : t('intake.review.subtitle', { department: departmentName })}</p>
        </div>
        <ResponseClock variant="chip" prominent startIso={clockStart} testId="sj-clock" />
      </div>

      <div className="sj-review-cols">
        <div className="sj-review-main">
          {/* The deliverable card, in the template's hue */}
          <section className="sj-card sj-card-hued" data-testid="sj-review-request">
            <div className="sj-card-row">
              {/* How many deliverables the job makes — one, plus any added on step 3 (I54.33). */}
              <span className="tag tag-hue" data-testid="sj-review-count">{t('intake.review.oneDeliverable', { count: moreNames.length > 0 ? 1 + moreNames.length : request.quantity })}</span>
              {(typeName || request.channel) && (
                <span className="tag tag-neutral" data-testid="sj-review-type">{[typeName, request.channel].filter(Boolean).join(' · ')}</span>
              )}
              <span className="sj-card-row-fill" />
              <Button variant="link" size="sm" className="sj-hue-link" onClick={onEditRequest} data-testid="sj-review-edit-request">{t('intake.review.edit')}</Button>
            </div>
            <h2 className="sj-review-name" data-testid="sj-review-title">{request.title}</h2>
            <dl className="sj-facts sj-facts-3">
              {/* Column by column, as the Figma reads: quantity · due | format · goes to | starts · priority */}
              <div><dt>{t('intake.request.quantity')}</dt><dd>{request.quantity}</dd></div>
              <div><dt>{t('intake.request.due')}</dt><dd data-testid="sj-review-due">{due ?? dash}</dd></div>
              <div><dt>{t('intake.review.format')}</dt><dd>{request.format || dash}</dd></div>
              <div><dt>{t('intake.review.goesTo')}</dt><dd>{departmentName ? t('intake.review.team', { department: departmentName }) : dash}</dd></div>
              <div><dt>{t('intake.review.starts')}</dt><dd>{starts ?? dash}</dd></div>
              <div><dt>{t('intake.who.priority')}</dt><dd>{request.priority ? t(`intake.who.priorities.${request.priority}`) : dash}{request.reducedScope && <span className="tag tag-rust sj-inline-tag" data-testid="sj-review-reduced-scope">{t('intake.review.reducedScope')}</span>}</dd></div>
            </dl>
            {moreNames.length > 0 && (
              <div className="sj-review-more" data-testid="sj-review-more">
                <span className="sj-review-more-title">{t('intake.review.alsoInJob')}</span>
                <ul>
                  {request.more.map((m, i) => (
                    <li key={i} data-testid={`sj-review-more-${i}`}>
                      {moreNames[i] || t('intake.review.untyped')}{m.quantity > 1 ? ` ×${m.quantity}` : ''}{m.format ? ` · ${m.format}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* How the request came in */}
          <section className="sj-card" data-testid="sj-review-came-in">
            <h2 className="sj-card-title">{t('intake.review.cameIn')}</h2>
            <div className="sj-quote">
              <p className="sj-quote-text" data-testid="sj-review-words">“{request.words}”</p>
              <p className="sj-quote-meta" data-testid="sj-review-proof">
                {[
                  request.askedBy || null,
                  request.source ? t(`intake.source.${request.source}`) : null,
                  arrival,
                  hasProof
                    ? (receiptSubject ? t('intake.review.proofFiledSubject', { subject: receiptSubject }) : t('intake.review.proofFiled'))
                    : clockStart
                      ? t('intake.review.proofNoneClockStarted')
                      : t('intake.review.proofNone'),
                ].filter(Boolean).join(' · ')}
              </p>
            </div>
          </section>

          {/* The brief */}
          <section className="sj-card" data-testid="sj-review-brief">
            <div className="sj-card-row">
              <h2 className="sj-card-title">{t('intake.brief.theBrief')}</h2>
              <span className="sj-card-row-fill" />
              <span className="sj-card-caption">{t('intake.review.fieldsOf', { n: fieldsCount, template: templateName })}</span>
              <Button variant="link" size="sm" className="sj-hue-link" onClick={onEditBrief} data-testid="sj-review-edit-brief">{t('intake.review.edit')}</Button>
            </div>
            <dl className="sj-facts sj-facts-2">
              <div><dt>{t('intake.review.clientBrand')}</dt><dd>{[clientName, brandName].filter(Boolean).join(' · ')}</dd></div>
              {fields.map((f) => (
                <div key={f.key}>
                  <dt>{locale === 'ar' ? f.ar || f.en : f.en}</dt>
                  <dd data-testid={`sj-review-field-${f.key}`}>{(values[f.key] ?? '').trim() || dash}</dd>
                </div>
              ))}
              <div>
                <dt>{t('intake.brief.risk')}</dt>
                <dd data-testid={`sj-review-field-${RISK_KEY}`}>{risk.trim() || dash}</dd>
              </div>
            </dl>
          </section>
        </div>

        <aside className="sj-review-side">
          <section className="sj-card sj-card-soft" data-testid="sj-review-destination">
            <span className="sj-card-eyebrow">{t('intake.review.thisGoesTo')}</span>
            <div className="sj-lead-row is-bare">
              <span className="sj-lead-avatar" aria-hidden="true">{initials || '—'}</span>
              <span className="sj-lead-text">
                <span className="sj-lead-name">{departmentName ? t('intake.review.team', { department: departmentName }) : dash}</span>
                <span className="sj-lead-sub">
                  {ownerName
                    ? ownerLoadPct != null
                      ? t('intake.review.leadBooked', { owner: ownerName, pct: ownerLoadPct })
                      : t('intake.review.leadIs', { owner: ownerName })
                    : t('intake.review.landsNoOwner', { department: departmentName })}
                </span>
              </span>
            </div>
            <p className="sj-goes-to-note" data-testid="sj-review-where">
              {ownerName ? t('intake.review.landsWith', { department: departmentName, owner: ownerName }) : t('intake.review.landsNoOwner', { department: departmentName })}
            </p>
          </section>

          <section className="sj-card" data-testid="sj-review-rules">
            <div className="sj-card-row">
              <h2 className="sj-card-title">{t('intake.review.rules')}</h2>
              <span className="tag tag-neutral">{t('intake.review.locked')}</span>
            </div>
            {rules.length > 0 ? (
              <>
                <ul className="sj-rules" data-testid="sj-review-rules-list">
                  {rules.map((r, i) => (
                    <li key={i} className="sj-rule">
                      <span className={`rule-pill rule-${r.kind} is-on`}>{t(r.kind === 'do' ? 'clients.rules.do' : 'clients.rules.dont')}</span>
                      <span className="sj-rule-text" dir="auto">{r.text}</span>
                    </li>
                  ))}
                </ul>
                <p className="sj-card-note">{t('intake.review.rulesFrom', { from: rulesFrom.join(', '), count: rules.length })}</p>
              </>
            ) : (
              <p className="sj-card-note">{t('intake.review.rulesNone', { client: clientName })}</p>
            )}
          </section>

          <section className="sj-card" data-testid="sj-review-attached">
            <div className="sj-card-row">
              <h2 className="sj-card-title">{t('intake.review.attached')}</h2>
              <span className="sj-card-row-fill" />
              <span className="sj-card-caption">{files.length + (hasProof ? 1 : 0)}</span>
            </div>
            <ul className="sj-attached">
              {hasProof && (
                <li className="sj-attached-item">
                  <span className="sj-attached-icon is-proof" aria-hidden="true" />
                  <span className="sj-attached-text">
                    <span className="sj-attached-name">{receiptSubject || t('intake.review.screenshot')}</span>
                    <span className="sj-attached-sub">{t('intake.review.proofKind')}</span>
                  </span>
                </li>
              )}
              {files.map((f) => (
                <li key={f.id} className="sj-attached-item" data-testid={`sj-attached-${f.id}`}>
                  <span className="sj-attached-icon" aria-hidden="true" />
                  <span className="sj-attached-text">
                    <span className="sj-attached-name">{f.name}</span>
                    <span className="sj-attached-sub">{t('intake.review.fromReferences')}</span>
                  </span>
                </li>
              ))}
              {!hasProof && files.length === 0 && (
                <li className="sj-card-note" data-testid="sj-attached-none">{t('intake.review.attachedNone')}</li>
              )}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}
