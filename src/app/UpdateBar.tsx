import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppVersion } from './useAppVersion'
import { Button } from '../components/Button'

/**
 * "A new version is available" — the bar that ends a tab quietly running last week's code.
 *
 * Edward, 6 Sep. See `useAppVersion` for what detects it; this decides nothing and only says so.
 *
 * **It never reloads on its own, and it can be dismissed.** Somebody is always half-way through a
 * brief, and a page that reloads under a person is worse than the staleness it fixes. Dismissing is
 * per-tab and not remembered: the next check has nothing new to say — the flag is already set — but
 * a genuinely new deploy arrives as a new build id and the bar returns.
 *
 * **Above everything, and pushing the page down rather than covering it.** A floating toast over
 * the top-right is where notifications live, and this is not a notification: it is a statement
 * about the page itself.
 */
export function UpdateBar() {
  const { t } = useTranslation()
  const { updateAvailable } = useAppVersion()
  const [dismissed, setDismissed] = useState(false)

  if (!updateAvailable || dismissed) return null

  return (
    <div className="update-bar notice notice-warn" role="status" data-testid="update-bar">
      <span className="update-bar-text">{t('app.update.available')}</span>
      <Button
        variant="primary"
        onClick={() => window.location.reload()}
        data-testid="update-bar-reload"
      >
        {t('app.update.reload')}
      </Button>
      <Button
        variant="link"
        onClick={() => setDismissed(true)}
        data-testid="update-bar-dismiss"
      >
        {t('app.update.later')}
      </Button>
    </div>
  )
}
