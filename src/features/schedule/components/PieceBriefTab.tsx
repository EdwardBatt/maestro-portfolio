import { useTranslation } from 'react-i18next'
import { useTaskListRules } from '../../deliverables/api/deliverables-api'
import { usePieceBrief } from '../api/book-api'
import { dayLong } from '../lib/day-words.ts'
import { iraqDay } from '../../../lib/time/iraq'
import { useLanguageWords } from '../../admin/api/deliverable-types-api'

/**
 * The Brief tab of the booking window (SC-07): what the piece is, in the brief's own words, and the
 * rules it carries. Read only — the deliverable is changed from the campaign, by its account manager
 * (ADR-0141), so the tab says where to go rather than offering an edit it cannot honour.
 */
export function PieceBriefTab({ deliverableId, hours }: { deliverableId: string; hours: number }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const brief = usePieceBrief(deliverableId)
  const rules = useTaskListRules(brief.data?.campaignId ?? null, deliverableId)
  // ADR-0117 addendum (Q18): the deliverable's languages, named as the organisation names them.
  const languageList = useLanguageWords()

  if (brief.isLoading) return <p className="muted" data-testid="book-brief-loading">…</p>
  const b = brief.data
  if (!b) return <p className="muted" data-testid="book-brief-none">{t('schedule.sc.brief.none')}</p>

  const what = [lang === 'ar' ? (b.typeNameAr ?? b.typeName) : b.typeName, b.channel, b.quantity > 1 ? t('schedule.sc.brief.quantity', { n: b.quantity }) : null, b.format, b.orientation]
    .filter(Boolean).join(' · ')
  const lines: [string, string | null][] = [
    [t('schedule.sc.brief.brief'), [b.campaignName, b.accountManagerName ? t('schedule.sc.brief.writtenBy', { name: b.accountManagerName }) : null, b.approvedAt ? dayLong(iraqDay(b.approvedAt), lang) : null].filter(Boolean).join(' · ') || null],
    [t('schedule.sc.brief.what'), what || null],
    [t('schedule.sc.brief.language'), languageList.words(b.languages) || null],
    [t('schedule.sc.brief.task'), [b.name, b.notes].filter(Boolean).join('. ') || null],
    [t('schedule.sc.brief.idea'), b.contentIdea],
    [t('schedule.sc.brief.due'), b.dueAt ? `${dayLong(iraqDay(b.dueAt), lang)} · ${t('schedule.sc.aboutHours', { n: hours })}` : null],
  ]
  const ruleList = rules.data ?? []

  return (
    <div className="sc-brief" data-testid="book-brief">
      <dl className="sc-brief-table">
        {lines.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="sc-brief-row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {ruleList.length > 0 && (
        <div className="sc-rules" data-testid="book-brief-rules">
          <p className="sc-rules-title">{t('schedule.sc.brief.rules', { n: ruleList.length })}</p>
          <ul>
            {ruleList.map((r, i) => (
              <li key={i}>{r.kind === 'dont' ? t('schedule.sc.brief.dont', { text: r.text }) : r.text}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="sc-foot-note">{t('schedule.sc.brief.readOnly', { name: b.accountManagerName ?? t('schedule.sc.brief.theAm') })}</p>
    </div>
  )
}
