import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../../components/Button'
import { useReplyToQuestion } from '../../api/requests-api'
import { errorText } from '../../lib/requests-text'
import { RequestDialog } from './RequestDialog'

/**
 * Reply (plan View 6, ADR-0113 d.2): the question, and a reply box. The reply goes back to the
 * asker by notification and email, and is logged under the piece's Questions.
 */
export function ReplyDialog({
  questionId,
  askerName,
  question,
  pieceLabel,
  onClose,
  testId = 'reply',
}: {
  questionId: string
  askerName: string | null
  question: string
  pieceLabel: string | null
  onClose: () => void
  testId?: string
}) {
  const { t } = useTranslation()
  const reply = useReplyToQuestion()
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)

  function send() {
    setError(null)
    reply.mutate({ questionId, body }, { onSuccess: onClose, onError: (e) => setError(errorText(e, t('requests.failed'))) })
  }

  return (
    <RequestDialog
      testId={testId}
      title={t('requests.reply.title')}
      subtitle={pieceLabel}
      told={askerName}
      error={error}
      onClose={onClose}
      actions={
        <>
          <Button variant="primary" busy={reply.isPending} disabled={!body.trim() || reply.isPending} onClick={send} data-testid={`${testId}-send`}>
            {t('requests.reply.send')}
          </Button>
          <Button variant="secondary" onClick={onClose} data-testid={`${testId}-cancel`}>{t('common.cancel')}</Button>
        </>
      }
    >
      <blockquote className="rq-quote" data-testid={`${testId}-question`}>
        <b>{askerName ?? '—'}</b> <span dir="auto">{question}</span>
      </blockquote>
      <label>
        {t('requests.reply.yours')}
        <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} data-testid={`${testId}-body`} dir="auto" />
      </label>
    </RequestDialog>
  )
}
