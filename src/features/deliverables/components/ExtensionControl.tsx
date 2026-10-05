import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import { classifyExtension } from '../../../lib/deadlines/extension-arithmetic'
import { useExtensionContext } from '../../../lib/deadlines/use-extension-context'
import { formatDeadline, iraqDay } from '../../../lib/time/iraq'
import {
  isRefused,
  useDecideExtension,
  useWithdrawExtension,
  type ExtensionEvent,
} from '../api/extensions-api'
import { arithmeticText } from '../lib/extension-text'

/**
 * The state of the ask on one task, and the acts available on it (ADR-0088 d.8, d.10).
 *
 * ADR-0141 d.5 (I74.16): the per-task extension is RETIRED. No new request is offered here — a piece's date is asked
 * of the account manager through the one change form (`ChangeAskDialog`), and a maker asks her own lead for more time.
 * A request already pending still shows its line, can be withdrawn, and is answered where it was (Approve / Refuse).
 *
 * One line: "extension requested to 18 Sep, awaiting Nadia" while pending; then the answer. Beside
 * it, "Ask for more time" for whoever may ask, Withdraw for the requester, and Approve / Refuse for
 * whoever may answer — all read from the view's own flags (ADR-0037), never decided here.
 *
 * PENDING IS NOT A STATUS (d.8). Nothing on the task changes while a request waits; this line is
 * the only sign of it, the way ADR-0075 d.4's feed says "waiting" without the task entering a
 * state. The at-risk arithmetic keeps reading the current commitment until the answer comes.
 */
export interface ExtensionControlProps {
  subTaskId: string
  taskTitle: string
  /** The task's latest extension event, if any. */
  latest: ExtensionEvent | undefined
  /** Whether THIS viewer may ask — the assignee on their own row, or the reschedule authority. */
  canRequest: boolean
  viewerId: string | null
  committedDueAt: string | null
  deliverableDueAt: string | null
  goLiveAt: string | null
  /** Names the approver for the ask dialog when no event exists yet to carry it. */
  approverName?: string | null
  /** Show Approve / Refuse inline where the viewer may answer (campaign page, task table). */
  showDecision?: boolean
  /** I59.10: the pending / answered line only — My Work's task card. Asking and withdrawing are on
   *  the task page (ADR-0105 d.3). */
  lineOnly?: boolean
  testId: string
}

export function ExtensionControl({
  latest,
  viewerId,
  showDecision = false,
  lineOnly = false,
  testId,
}: ExtensionControlProps) {
  const { t, i18n } = useTranslation()
  const loc = i18n.language === 'ar' ? 'ar' : 'en'
  const withdraw = useWithdrawExtension()
  const [error, setError] = useState<string | null>(null)

  const pending = latest?.isPending ? latest : null
  const when = (iso: string | null) => (iso ? formatDeadline(iso, loc) : '—')

  const line = (() => {
    if (!latest) return null
    if (pending) {
      return pending.approverName
        ? t('deadlineExtension.pendingLine', { date: when(pending.toAt), name: pending.approverName })
        : t('deadlineExtension.pendingLineNoApprover', { date: when(pending.toAt) })
    }
    if (latest.eventType === 'extension_approved')
      return t('deadlineExtension.approvedLine', { date: when(latest.toAt), name: latest.actorName ?? '—' })
    if (latest.eventType === 'extension_refused')
      return t('deadlineExtension.refusedLine', { date: when(latest.toAt), name: latest.actorName ?? '—' })
    if (latest.eventType === 'extension_withdrawn') return t('deadlineExtension.withdrawnLine')
    return null
  })()

  const canWithdraw = !lineOnly && !!pending && (pending.actorId === viewerId || pending.viewerCanRequest)

  return (
    <div className="extension-control" data-testid={testId}>
      {line && (
        <span
          className={pending ? 'cell-warn' : 'muted'}
          data-testid={`${testId}-line`}
          data-state={pending ? 'pending' : latest?.eventType}
        >
          {line}
          {pending && pending.actorId !== viewerId && pending.actorName
            ? ` · ${t('deadlineExtension.requestedBy', { name: pending.actorName })}`
            : ''}
          {pending?.reason ? ` — “${pending.reason}”` : ''}
        </span>
      )}

      {canWithdraw && (
        <Button
          type="button"
          variant="secondary" size="sm"
          busy={withdraw.isPending}
          onClick={() => {
            setError(null)
            withdraw.mutate(pending.requestId, {
              onError: (err) => setError((err as Error).message || t('deadlineExtension.failed')),
            })
          }}
          data-testid={`${testId}-withdraw`}
        >
          {t('deadlineExtension.withdraw')}
        </Button>
      )}

      {!lineOnly && showDecision && pending?.viewerCanDecide && (
        <ExtensionDecision request={pending} testId={`${testId}-decide`} />
      )}

      {error && <p className="form-error" data-testid={`${testId}-error`}>{error}</p>}
    </div>
  )
}

/**
 * Approve or refuse a pending request (d.3, d.6). Shown only where the view says the viewer may;
 * the RPC refuses anyone else with a sentence. The arithmetic the approver decides on is shown
 * beside the buttons — the whole point of d.7 is that they see what accepting costs.
 */
export function ExtensionDecision({ request, testId }: { request: ExtensionEvent; testId: string }) {
  const { t } = useTranslation()
  const decide = useDecideExtension()
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const extensionContext = useExtensionContext({ deliverableId: request.deliverableId })
  const arithmetic = request.toAt
    ? classifyExtension({
        requestedDay: iraqDay(request.toAt),
        deliverableDueAt: request.deliverableDueAt,
        goLiveAt: request.goLiveAt,
        ...extensionContext,
      })
    : null

  function answer(approve: boolean) {
    setError(null)
    decide.mutate(
      { requestId: request.requestId, approve, note: note.trim() || null },
      {
        onError: (err) =>
          setError(
            isRefused(err) ? t('deadlineExtension.refused') : (err as Error).message || t('deadlineExtension.failed'),
          ),
      },
    )
  }

  return (
    <div className="extension-decision" data-testid={testId}>
      {arithmetic && (
        <span
          className={arithmetic.severity === 'fine' ? 'muted' : 'cell-warn'}
          data-testid={`${testId}-arithmetic`}
          data-severity={arithmetic.severity}
        >
          {arithmeticText(arithmetic, !!request.deliverableDueAt, t)}
        </span>
      )}
      <input
        type="text"
        value={note}
        placeholder={t('deadlineExtension.decisionNote')}
        aria-label={t('deadlineExtension.decisionNote')}
        onChange={(e) => setNote(e.target.value)}
        data-testid={`${testId}-note`}
      />
      <Button
        type="button"
        variant="primary" tone="approve" size="sm"
        busy={decide.isPending && decide.variables?.approve === true}
        disabled={decide.isPending}
        onClick={() => answer(true)}
        data-testid={`${testId}-approve`}
      >
        {t('deadlineExtension.approve')}
      </Button>
      <Button
        type="button"
        variant="secondary" tone="caution" size="sm"
        busy={decide.isPending && decide.variables?.approve === false}
        disabled={decide.isPending}
        onClick={() => answer(false)}
        data-testid={`${testId}-refuse`}
      >
        {t('deadlineExtension.refuse')}
      </Button>
      {error && <p className="form-error" data-testid={`${testId}-error`}>{error}</p>}
    </div>
  )
}
