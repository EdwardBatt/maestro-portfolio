import { useTranslation } from 'react-i18next'
import type { CandidateAssessment } from '../../../lib/capacity/types.ts'
import { formatCalendarDay } from '../../../lib/time/iraq'

export interface DayProblem {
  /** office-local ISO date of the affected instance */
  isoDate: string
  assessment: CandidateAssessment
}

/**
 * The single gentle warning of warn-and-allow (§4.1): a ⚠ glyph, the affected
 * DAY named per finding, the consequence stated plainly, and proceed offered.
 * Status colors carry state only (maestro-design).
 */
export function AssessmentNotice({ problems, resourceName }: { problems: DayProblem[]; resourceName: string }) {
  const { t } = useTranslation()
  const bad = problems.filter((p) => p.assessment.level !== 'ok')
  if (bad.length === 0) return null

  const worst = bad.some((p) => ['over_ceiling', 'conflict'].includes(p.assessment.level))
  const fmtDate = (iso: string) => formatCalendarDay(iso)

  return (
    <div className={worst ? 'notice notice-breach' : 'notice notice-warn'} role="alert" data-testid="assessment-notice">
      <span className="notice-icon" aria-hidden="true">⚠</span>
      <ul>
        {bad.map((p) => (
          <li key={p.isoDate}>
            <strong>{fmtDate(p.isoDate)}</strong>
            {' — '}
            {p.assessment.reasons
              .map((reason) =>
                reason === 'over_warn_threshold' || reason === 'over_ceiling'
                  ? t(`schedule.assess.${reason}`, { name: resourceName, pct: p.assessment.projectedPeakPct })
                  : reason === 'non_working_day'
                    ? t('schedule.assess.non_working_day_short')
                    : t(`schedule.assess.${reason}`),
              )
              .join(' ')}
          </li>
        ))}
      </ul>
    </div>
  )
}
