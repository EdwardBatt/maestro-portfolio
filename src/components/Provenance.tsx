import { useTranslation } from 'react-i18next'
import { formatIraqDate } from '../lib/time/iraq'

/**
 * Who made this and who last changed it (I51.1).
 *
 * One muted line under a record's heading: *Created by Mira Adel · 10 Sep 2026 · Last edited by
 * Ali Hassan · 12 Sep 2026*. The names come from `created_by` / `updated_by`, filled by trigger on
 * every tenant table since `20260916120000`; a row the audit log never saw says "not recorded"
 * rather than inventing a name. Nothing to edit here — it is a fact about the row.
 */
export interface ProvenanceProps {
  createdByName: string | null
  createdAt: string | null
  updatedByName: string | null
  updatedAt: string | null
  testId?: string
}

export function Provenance({ createdByName, createdAt, updatedByName, updatedAt, testId = 'provenance' }: ProvenanceProps) {
  const { t } = useTranslation()
  if (!createdAt && !createdByName && !updatedByName) return null
  return (
    <p className="muted provenance" data-testid={testId}>
      <span data-testid={`${testId}-created`}>
        {t('provenance.createdBy', { name: createdByName ?? t('provenance.notRecorded') })}
        {createdAt ? ` · ${formatIraqDate(createdAt)}` : ''}
      </span>
      {updatedByName && (
        <span data-testid={`${testId}-updated`}>
          {' · '}
          {t('provenance.editedBy', { name: updatedByName })}
          {updatedAt ? ` · ${formatIraqDate(updatedAt)}` : ''}
        </span>
      )}
    </p>
  )
}
