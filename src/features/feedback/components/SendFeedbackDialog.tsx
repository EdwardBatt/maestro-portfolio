import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import { z } from 'zod'
import { useSubmitFeedback, type FeedbackCategory } from '../api/feedback-api'
import { APP_VERSION } from '../../../lib/version'
import { Modal } from '../../../components/Modal'
import { Button } from '../../../components/Button'

const CATEGORIES: FeedbackCategory[] = ['bug', 'idea', 'other']
const MessageInput = z.object({ message: z.string().trim().min(1).max(4000) })

/**
 * Send feedback (alpha launch). Reachable from every page via the shell. The
 * category + message are the only inputs; the current page and app version are
 * derived, not asked (AGENTS §5 "derive, don't ask"). Submits under RLS as the
 * signed-in user; the dev note reminds people their input shapes the build.
 */
export function SendFeedbackDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const location = useLocation()
  const submit = useSubmitFeedback()
  const [category, setCategory] = useState<FeedbackCategory>('idea')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const form = new FormData(e.currentTarget)
    const parsed = MessageInput.safeParse({ message: form.get('message') })
    if (!parsed.success) {
      setError(t('feedback.messageRequired'))
      return
    }
    try {
      await submit.mutateAsync({
        category,
        message: parsed.data.message,
        pagePath: location.pathname,
      })
      setSent(true)
    } catch {
      setError(t('feedback.failed'))
    }
  }

  return (
    <Modal onClose={onClose} card={false}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('feedback.title')}
        data-testid="feedback-dialog"
       
        onSubmit={onSubmit}
      >
        <h2>{t('feedback.title')}</h2>
        <p className="muted">{t('feedback.intro')}</p>

        {sent ? (
          <>
            <p className="form-ok" data-testid="feedback-sent">{t('feedback.sent')}</p>
            <div className="dialog-actions">
              <Button variant="secondary" onClick={onClose} data-testid="feedback-close">
                {t('feedback.close')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <label>
              {t('feedback.category')}
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
                data-testid="feedback-category"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{t(`feedback.category_${c}`)}</option>
                ))}
              </select>
            </label>
            <label>
              {t('feedback.message')}
              <textarea name="message" rows={5} data-testid="feedback-message" />
            </label>
            <p className="muted feedback-meta">
              {t('feedback.context', { page: location.pathname, version: APP_VERSION })}
            </p>
            {error && <p className="form-error" role="alert" data-testid="feedback-error">{error}</p>}
            <div className="dialog-actions">
              <Button variant="secondary" onClick={onClose} data-testid="feedback-cancel">
                {t('schedule.cancel')}
              </Button>
              <Button variant="primary" type="submit" disabled={submit.isPending} data-testid="feedback-submit">
                {submit.isPending ? t('feedback.sending') : t('feedback.submit')}
              </Button>
            </div>
          </>
        )}
      </form>
    </Modal>
  )
}
