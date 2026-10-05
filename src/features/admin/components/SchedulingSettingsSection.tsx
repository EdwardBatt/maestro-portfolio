import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import {
  DEFAULT_SCHEDULING_SETTINGS,
  useSchedulingSettings,
  useUpdateSchedulingSettings,
  type SchedulingSettings,
} from '../../../lib/settings/scheduling-settings-api'

/**
 * The scheduling numbers (I41.10, ADR-0075 d.5) as an editable section of Admin → Organization.
 *
 * Three integers: working days between delivery and go-live, working days between commencement
 * and delivery, and the review buffer an extension request's arithmetic subtracts. Defaults are
 * the measured 2 / 4 / 1; a tenant that never opens this behaves exactly as ADR-0075 describes.
 * Presentation only — the row and its bounds live in `tenant_reminder_settings`.
 */
export function SchedulingSettingsSection({ onSaved, onError }: { onSaved: () => void; onError: (err: unknown) => void }) {
  const { t } = useTranslation()
  const settings = useSchedulingSettings()
  const update = useUpdateSchedulingSettings()
  const [draft, setDraft] = useState<SchedulingSettings>(DEFAULT_SCHEDULING_SETTINGS)
  const [touched, setTouched] = useState(false)

  // A slow read must not overwrite what somebody has started typing (traps.md).
  useEffect(() => {
    if (settings.data && !touched) setDraft(settings.data)
  }, [settings.data, touched])

  const num = (v: string, fallback: number) => {
    const n = Number(v)
    return Number.isInteger(n) && n >= 0 ? n : fallback
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    update.mutate(draft, {
      onSuccess: () => {
        setTouched(false)
        onSaved()
      },
      onError,
    })
  }

  return (
    <>
      <h2 className="org-section-heading">{t('admin.org.scheduling.heading')}</h2>
      <p className="muted">{t('admin.org.scheduling.intro')}</p>
      {settings.isError ? (
        <p className="form-error" data-testid="scheduling-settings-failed">{t('admin.org.scheduling.loadFailed')}</p>
      ) : (
        <form className="org-settings-form" onSubmit={submit} data-testid="scheduling-settings-form">
          <label>
            {t('admin.org.scheduling.deliveryDays')}
            <input
              type="number"
              min={0}
              max={60}
              value={draft.rule.deliveryDaysBeforeGoLive}
              onChange={(e) => {
                setTouched(true)
                setDraft((d) => ({ ...d, rule: { ...d.rule, deliveryDaysBeforeGoLive: num(e.target.value, d.rule.deliveryDaysBeforeGoLive) } }))
              }}
              data-testid="scheduling-delivery-days"
            />
            <span className="muted">{t('admin.org.scheduling.deliveryDaysHint')}</span>
          </label>
          <label>
            {t('admin.org.scheduling.commenceDays')}
            <input
              type="number"
              min={0}
              max={120}
              value={draft.rule.commenceDaysBeforeDelivery}
              onChange={(e) => {
                setTouched(true)
                setDraft((d) => ({ ...d, rule: { ...d.rule, commenceDaysBeforeDelivery: num(e.target.value, d.rule.commenceDaysBeforeDelivery) } }))
              }}
              data-testid="scheduling-commence-days"
            />
            <span className="muted">{t('admin.org.scheduling.commenceDaysHint')}</span>
          </label>
          <label>
            {t('admin.org.scheduling.reviewBuffer')}
            <input
              type="number"
              min={0}
              max={30}
              value={draft.reviewBufferWorkingDays}
              onChange={(e) => {
                setTouched(true)
                setDraft((d) => ({ ...d, reviewBufferWorkingDays: num(e.target.value, d.reviewBufferWorkingDays) }))
              }}
              data-testid="scheduling-review-buffer"
            />
            <span className="muted">{t('admin.org.scheduling.reviewBufferHint')}</span>
          </label>
          <div>
            <Button variant="primary" type="submit" busy={update.isPending} disabled={!touched} data-testid="scheduling-settings-save">
              {t('common.save')}
            </Button>
          </div>
        </form>
      )}
    </>
  )
}
