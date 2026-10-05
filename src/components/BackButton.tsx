import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button } from './Button'
import { useBackTarget, type Origin } from '../lib/navigation/origin'

/**
 * **Back, to where you came from** (ADR-0132 d.7, I68.9) — "← Back to Team", "← Back to My Work"… It names
 * the page and returns to it as it was left: the path carries that page's own week, tab, days or filters.
 * With nowhere earlier to go (an email link, a new tab) it uses the fallback the page gives.
 */
export function BackButton({ fallback, testId = 'back-button' }: { fallback?: Origin; testId?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const target = useBackTarget(fallback)
  return (
    <Button variant="secondary" size="sm" icon="chevron-left" className="back-button" onClick={() => navigate(target.path)} data-testid={testId}>
      {t(target.labelKey)}
    </Button>
  )
}
