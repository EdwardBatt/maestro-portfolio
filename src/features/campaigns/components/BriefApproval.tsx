import { useTranslation } from 'react-i18next'
import { stampFormatter } from '../../../lib/time/iraq'

/**
 * A legacy department brief's approval, READ ONLY (ADR-0104 d.4, 25 Sep).
 *
 * ADR-0100 retired department briefs on campaigns; the ones that exist stay as the record of what a
 * department was asked to do, and no screen writes one. This used to carry Approve and Re-open
 * (ADR-0070 d.1–d.3, I51.3), but the only caller had passed `canApprove={false}` since ADR-0100, so
 * both were code no person could reach (I57.40). What is left says who approved it and when.
 *
 * A single job's brief is corrected by hand on the Brief view instead (ADR-0104 d.3).
 */
export interface BriefApprovalProps {
  approvedAt: string
  approvedByName: string | null
  testId: string
}

export function BriefApproval({ approvedAt, approvedByName, testId }: BriefApprovalProps) {
  const { t, i18n } = useTranslation()
  const fmt = stampFormatter(i18n.language === 'ar' ? 'ar' : 'en')
  const d = new Date(approvedAt)
  const when = Number.isNaN(d.getTime()) ? '' : fmt.format(d)

  return (
    <div className="brief-approval" data-testid={`${testId}-approved`}>
      <p className="muted brief-approved">
        ✓{' '}
        {approvedByName
          ? t('briefApproval.approvedBy', { name: approvedByName, when })
          : t('briefApproval.approvedAt', { when })}
        {' · '}
        <span data-testid={`${testId}-locked`}>{t('briefApproval.locked')}</span>
      </p>
    </div>
  )
}
