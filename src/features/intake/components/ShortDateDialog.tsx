import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { Modal } from '../../../components/Modal'
import type { LeadTime } from '../lib/lead-time'
import { formatDayLong } from '../lib/lead-time'

/**
 * SJ-v3-S2 — Under the lead time (Figma `B · SINGLE JOB — BRIEF FIRST`, 22 Sep).
 *
 * The due date leaves fewer working days than the deliverable type needs. NOT A BLOCK: the job
 * goes out tagged *Reduced scope* — the tag is recorded on the job and shown on the review and
 * to the owner — or the person gives it more time. What reduced scope means is said in plain
 * words; the Figma's "the client signs" is not built (there is no client signature anywhere), so
 * the line says the tag is recorded, which is what is true.
 *
 * Presentation only: the arithmetic in, two choices out.
 */
export function ShortDateDialog({
  dueDay,
  leadTime,
  typeName,
  onContinue,
  onMoreTime,
}: {
  dueDay: string
  leadTime: LeadTime
  typeName: string | null
  onContinue: () => void
  onMoreTime: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'ar' ? 'ar' : 'en'
  const short = leadTime.needsDays - leadTime.hasDays
  // full-names: not a person — the weekday out of a formatted date.
  const dayName = formatDayLong(dueDay, locale).split(' ')[0]

  return (
    <Modal onClose={onMoreTime} labelledById="sj-short-title" testId="sj-short-dialog">
      <header className="flow-dialog-head">
        <span className="tag tag-rust">{t('intake.short.eyebrow')}</span>
        <h2 id="sj-short-title" className="flow-dialog-title">{t('intake.short.title', { day: dayName, n: short })}</h2>
        <p className="flow-dialog-sub">
          {typeName
            ? t('intake.short.intro', { type: typeName, needs: leadTime.needsDays, has: leadTime.hasDays })
            : t('intake.short.introUntyped', { needs: leadTime.needsDays, has: leadTime.hasDays })}
        </p>
      </header>
      <div className="flow-dialog-body">
        <div className="sj-short-stats">
          <span className="sj-short-stat"><span className="sj-short-stat-label">{t('intake.short.needs')}</span><span className="sj-short-stat-value">{t('intake.short.workingDays', { count: leadTime.needsDays })}</span></span>
          <span className="sj-short-stat"><span className="sj-short-stat-label">{t('intake.short.has')}</span><span className="sj-short-stat-value is-short" data-testid="sj-short-has">{t('intake.short.workingDays', { count: leadTime.hasDays })}</span></span>
          <span className="sj-short-stat"><span className="sj-short-stat-label">{t('intake.short.shortBy')}</span><span className="sj-short-stat-value is-short" data-testid="sj-short-by">{t('intake.short.days', { count: short })}</span></span>
        </div>
        <div className="sj-short-means">
          <span className="sj-short-means-head">{t('intake.short.meansHead')}</span>
          <ul>
            <li>{t('intake.short.means1')}</li>
            <li>{t('intake.short.means2')}</li>
            <li>{t('intake.short.means3')}</li>
          </ul>
        </div>
        <p className="sj-short-note">{t('intake.short.note')}</p>
      </div>
      <footer className="flow-dialog-foot">
        <Button type="button" variant="primary" className="btn-rust" onClick={onContinue} data-testid="sj-short-continue">
          {t('intake.short.continue')}
        </Button>
        <Button variant="secondary" onClick={onMoreTime} data-testid="sj-short-more-time">
          {t('intake.short.moreTime')}
        </Button>
      </footer>
    </Modal>
  )
}
