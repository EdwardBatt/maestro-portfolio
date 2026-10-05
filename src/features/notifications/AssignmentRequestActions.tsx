import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Button } from '../../components/Button'
import { usePendingAssignmentRequest } from '../../lib/assignment-requests/api'

/**
 * ADR-0087 d.11, ADR-0139 — the answer under an `assignment_requested` inbox item (and its Needs-you card).
 *
 * A door into the same answer, not a second implementation: one click on Approve / Refuse could no longer
 * answer an ask (a "the lead decides" ask names nobody, and a no needs its reason), so the button opens the
 * answer window the lead gets on the Schedule — Book / Offer another day / Say no — exactly as My work's
 * ask card does (`/schedule?ask=<id>`, Figma L SC-28 → SC-29). No authority is decided here: the Schedule
 * opens only an ask the server lists as hers to answer. Once the ask is no longer pending (answered by the
 * other lead, withdrawn, superseded) the line says so.
 */
export function AssignmentRequestActions({ subTaskId, onOpen }: { subTaskId: string; onOpen?: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const pending = usePendingAssignmentRequest(subTaskId)

  if (pending.isLoading) return null
  const request = pending.data
  if (!request) {
    return <p className="muted notif-actions" data-testid={`notif-request-closed-${subTaskId}`}>{t('notifications.requestClosed')}</p>
  }

  return (
    <div className="notif-actions" data-testid={`notif-request-actions-${subTaskId}`}>
      <span className="muted">
        {t('schedule.request.askedBy', { name: request.requesterName ?? '' })}
        {request.resourceName ? ` · ${request.resourceName}` : ''}
      </span>
      <Button type="button" variant="primary" size="sm"
        onClick={() => { onOpen?.(); navigate(`/schedule?ask=${request.id}`) }} data-testid={`notif-request-answer-${subTaskId}`}>
        {t('myWork.asks.answer')}
      </Button>
    </div>
  )
}
