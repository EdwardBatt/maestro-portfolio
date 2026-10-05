import { useTranslation } from 'react-i18next'
import { isFiller } from '../lib/brief/filler'

/**
 * ADR-0111 addendum / E10 (I59.27): a warning beside a brief field whose text is only placeholder —
 * "“TBD” is placeholder text — write the real thing." Every field with text is checked; a blank one
 * says nothing (blank is its own rule).
 *
 * A warning, never a refusal: the database refuses at release and at approval, and this only says
 * so before the press (warn-and-allow, AGENTS.md §5). Presentation only — the tenant's own words
 * arrive as a prop.
 */
export function FillerWarning({
  text,
  extraWords = [],
  testId,
}: {
  text: string | null | undefined
  extraWords?: readonly string[]
  testId?: string
}) {
  const { t } = useTranslation()
  if (!isFiller(text, extraWords)) return null
  const shown = (text ?? '').trim()
  return (
    <span className="form-warn filler-warn" role="status" data-testid={testId}>
      {t('escalations.filler.warn', { text: shown.length > 40 ? `${shown.slice(0, 40)}…` : shown })}
    </span>
  )
}
