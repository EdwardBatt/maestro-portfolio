import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from './auth-context'
import { Button } from '../components/Button'

/** ADR-0120: while a Power Admin views as a person, the bar that says so, with the way out. */
export function ViewAsBanner() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { viewAs, stopViewAs } = useAuth()
  if (!viewAs) return null
  return (
    <div className="preview-banner" role="status" data-testid="view-as-banner">
      <span>{t('dev.viewingAsBanner', { name: viewAs.name })}</span>
      <Button
        variant="link"
        data-testid="view-as-banner-exit"
        onClick={() => { stopViewAs(); queryClient.clear(); navigate('/') }}
      >
        {t('dev.exitPerson')}
      </Button>
    </div>
  )
}
