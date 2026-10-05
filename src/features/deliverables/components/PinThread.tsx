import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, IconButton } from '../../../components/Button'
import { useReplyToPin, useSetPinDone, type PinScope, type ReviewComment } from '../api/review-api'

/**
 * ADR-0112 d.2 (I59.29) — what happens under a pin: the maker's replies, "Done by <name>", the
 * reviewer's Re-open, and — for the task's assignee — Mark done / Undo / Reply.
 *
 * Built to be placed: the review screens render `PinThread` under each pin, and the task page (M2 /
 * M4) can render it too, passing `makerActions` for the assignee. Who may do what is the database's
 * (RLS + `app.tg_review_feedback_done_guard`); these controls are offered to the person the rule is
 * for, and a refusal is said in one line beside them, never reported.
 *
 * The hooks live in `PinControls`, not here, so a surface that shows no control never mounts a
 * mutation.
 */
export interface PinThreadProps {
  pin: ReviewComment
  /** Every reply to this pin, oldest first (`review_feedback.parent_id = pin.id`). */
  replies: readonly ReviewComment[]
  /** Which list the pin lives in — a version's comments or a manual task's notes. */
  scope: PinScope
  /** The reviewer: the pin's author or a `reviews:moderate` holder. Offers Re-open on a done pin. */
  canReopen: boolean
  /** The task's assignee: offers Mark done, Undo (their own done), and Reply. */
  makerActions?: boolean
  /** The viewer's id, to tell their own done (Undo) from somebody else's. */
  myId: string | null
  /** A formatter for when a reply was written, in the reader's clock (the panel's own). */
  stamp?: (iso: string) => string | null
}

export function PinThread({ pin, replies, scope, canReopen, makerActions = false, myId, stamp }: PinThreadProps) {
  const { t } = useTranslation()
  const done = Boolean(pin.doneAt)
  const showControls = makerActions || (done && canReopen)
  if (!done && replies.length === 0 && !showControls) return null

  return (
    <div className="pin-thread" data-testid={`pin-thread-${pin.id}`}>
      {done && (
        <span className="pin-done" data-testid={`pin-done-${pin.id}`}>
          {pin.doneByName ? t('reviewPins.doneBy', { name: pin.doneByName }) : t('reviewPins.done')}
        </span>
      )}
      {replies.length > 0 && (
        <ul className="pin-replies" data-testid={`pin-replies-${pin.id}`}>
          {replies.map((r) => {
            const when = stamp?.(r.createdAt) ?? null
            return (
              <li key={r.id} className="pin-reply" data-testid={`pin-reply-${r.id}`}>
                <span className="review-comment-meta muted">
                  <span>{r.authorName ?? '—'}</span>
                  {when && <time className="review-comment-time" dateTime={r.createdAt}>{when}</time>}
                </span>
                <span className="review-comment-body" dir="auto">{r.body}</span>
              </li>
            )
          })}
        </ul>
      )}
      {showControls && (
        <PinControls pin={pin} scope={scope} canReopen={canReopen} makerActions={makerActions} myId={myId} />
      )}
    </div>
  )
}

/** The buttons, and the one line that says why a press was refused. */
export function PinControls({
  pin,
  scope,
  canReopen,
  makerActions = false,
  myId,
}: Pick<PinThreadProps, 'pin' | 'scope' | 'canReopen' | 'makerActions' | 'myId'>) {
  const { t } = useTranslation()
  const setDone = useSetPinDone(scope)
  const reply = useReplyToPin(scope)
  const [replying, setReplying] = useState(false)
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const done = Boolean(pin.doneAt)

  const onFail = (err: unknown) =>
    setError(t((err as { code?: string }).code === '42501' ? 'reviewPins.refused' : 'reviewPins.failed'))

  function mark(next: boolean) {
    setError(null)
    setDone.mutate({ id: pin.id, done: next }, { onError: onFail })
  }

  function send(e: React.FormEvent) {
    e.preventDefault()
    const text = body.trim()
    if (!text) return
    setError(null)
    reply.mutate(
      { pinId: pin.id, body: text },
      { onSuccess: () => { setBody(''); setReplying(false) }, onError: onFail },
    )
  }

  return (
    <div className="pin-controls">
      <div className="pin-actions">
        {makerActions && !done && (
          <Button variant="secondary" size="sm" icon="check" busy={setDone.isPending} onClick={() => mark(true)} data-testid={`pin-mark-done-${pin.id}`}>
            {t('reviewPins.markDone')}
          </Button>
        )}
        {/* Settled 25 Sep: the maker can undo their OWN done; somebody else's is the reviewer's. */}
        {makerActions && done && pin.doneById === myId && (
          <Button variant="secondary" size="sm" icon="undo" busy={setDone.isPending} onClick={() => mark(false)} data-testid={`pin-undo-${pin.id}`}>
            {t('reviewPins.undo')}
          </Button>
        )}
        {canReopen && done && (
          <Button variant="secondary" size="sm" icon="refresh" busy={setDone.isPending} onClick={() => mark(false)} data-testid={`pin-reopen-${pin.id}`}>
            {t('reviewPins.reopen')}
          </Button>
        )}
        {makerActions && !replying && (
          <Button variant="secondary" size="sm" onClick={() => setReplying(true)} data-testid={`pin-reply-open-${pin.id}`}>
            {t('reviewPins.reply')}
          </Button>
        )}
      </div>
      {makerActions && replying && (
        <form className="pin-reply-form" onSubmit={send} data-testid={`pin-reply-form-${pin.id}`}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('reviewPins.replyPlaceholder')}
            aria-label={t('reviewPins.reply')}
            dir="auto"
            rows={2}
            data-testid={`pin-reply-body-${pin.id}`}
          />
          <div className="pin-reply-form-actions">
            <Button variant="primary" size="sm" type="submit" busy={reply.isPending} disabled={!body.trim()} data-testid={`pin-reply-submit-${pin.id}`}>
              {t('reviewPins.send')}
            </Button>
            <IconButton
              icon="close"
              size="sm"
              label={t('reviewPins.cancel')}
              onClick={() => { setReplying(false); setBody('') }}
              data-testid={`pin-reply-cancel-${pin.id}`}
            />
          </div>
        </form>
      )}
      {error && <p className="field-error" role="alert" data-testid={`pin-error-${pin.id}`}>{error}</p>}
    </div>
  )
}
