import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/Button'
import { useAuth } from '../../app/auth-context'
import {
  useAddTaskComment,
  useResolveTaskComment,
  useTaskComments,
  type ReviewComment,
} from './api/review-api'
import { hasOwnNoteThisRound, linkDisplayText } from '../../lib/review/review-mode'
import { threadComments } from './lib/pin-thread'
import { PinThread } from './components/PinThread'

/**
 * The manual review surface (ADR-0059 d.9).
 *
 * A shoot day, a print run, an installation or a media placement produces no file, so there is no
 * version to show and no upload control to offer. What there is instead is an account of what
 * happened, written by the person who did it, and a reviewer reading it and either approving or
 * asking for something different.
 *
 * **No empty version rail, deliberately.** Showing the digital surface with nothing in it reads as
 * a missing file — the person hunts for the upload button that was never coming. This component
 * replaces that surface rather than sitting beside it, and says in one line why.
 *
 * The same thread serves both people. The maker's note and the reviewer's reason are the same kind
 * of row in the same table, told apart by their author — which is also how
 * `app.sub_task_request_changes` tells them apart, so what a reviewer sees here and what the
 * database counts are the same thing.
 *
 * **A note may carry a link** (ADR-0059 addendum d.14–d.17). Some manual work does leave something
 * behind, somewhere the system cannot fetch — a Keynote on iCloud, a shared drive — and the maker
 * points the reviewer at it rather than describing where it is. The link is metadata on the note,
 * never a version: nothing is filed, delivered or archived from it, and the sentence under the
 * maker's composer says so once. The note stays required; the link is optional beside it.
 */
export function TaskReviewThread({
  subTaskId,
  round,
  /** What the composer is FOR, which differs by who is looking: the maker is writing the account of
   *  their work, the reviewer is writing the reason they are sending it back. */
  role,
  pinActions = false,
}: {
  subTaskId: string
  /** The round the task is on. Needed only to tell the MAKER whether their note satisfies the
   *  submit gate — a reviewer is not gated on writing one, so their surface does not need it. */
  round?: number
  role: 'maker' | 'reviewer'
  /** ADR-0112 d.2 (I59.29): offer the task's assignee Mark done / Undo / Reply on each note somebody
   *  else wrote. Off unless the surface asks — the task page passes it for the maker. */
  pinActions?: boolean
}) {
  const { t } = useTranslation()
  const { session } = useAuth()
  const myId = session?.user.id ?? null
  const comments = useTaskComments(subTaskId)
  const add = useAddTaskComment(subTaskId)
  const resolve = useResolveTaskComment(subTaskId)
  const [body, setBody] = useState('')
  const [link, setLink] = useState('')

  // ADR-0112 d.2: replies hang under their note; the gate below still reads every row the maker
  // wrote, and a reply (the pin's round, not this one) never satisfies it — as the database says.
  const all = comments.data ?? []
  const { pins: rows, repliesOf } = threadComments(all)
  // Grouped by round, newest round last, so the thread reads in the order it happened — the same
  // shape ReviewPanel gives a version's comments.
  const rounds = [...new Set(rows.map((c) => c.round))].sort((a, b) => a - b)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const text = body.trim()
    if (!text) return
    add.mutate(
      { body: text, linkUrl: link },
      { onSuccess: () => { setBody(''); setLink('') } },
    )
  }

  return (
    <div className="review-comments" data-testid={`task-review-thread-${subTaskId}`}>
      <p className="muted" data-testid={`task-review-manual-note-${subTaskId}`}>
        {t('reviewMode.manualExplainer')}
      </p>

      {comments.isError && (
        <p className="form-error" data-testid={`task-review-load-error-${subTaskId}`}>
          {(comments.error as Error)?.message || t('review.actionFailed')}
        </p>
      )}

      {!comments.isLoading && rows.length === 0 && (
        <p className="muted" data-testid={`task-review-empty-${subTaskId}`}>
          {t('reviewMode.noNotes')}
        </p>
      )}

      {rounds.map((n) => (
        <div className="review-round" key={n} data-testid={`task-review-round-${n}`}>
          <h4 className="review-round-head">{t('review.roundLabel', { n })}</h4>
          <ul className="review-comment-list">
            {rows.filter((c) => c.round === n).map((c: ReviewComment) => (
              <li
                key={c.id}
                className={`review-comment ${c.resolved ? 'is-resolved' : ''}`}
                data-testid={`task-comment-${c.id}`}
              >
                <span className="review-comment-main">
                  <span className="review-comment-meta muted">{c.authorName ?? ''}</span>
                  <span className="review-comment-body">{c.body}</span>
                  {/* d.16: the link, as a link, to whoever is reading — the maker on their own note,
                      the reviewer on the task they are asked to approve. A new tab, because the
                      review is happening THERE and this dialog is where the answer is given. */}
                  {c.linkUrl && (
                    <a
                      className="review-comment-link"
                      href={c.linkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={c.linkUrl}
                      data-testid={`task-comment-link-${c.id}`}
                    >
                      {linkDisplayText(c.linkUrl)}
                    </a>
                  )}
                </span>
                {/* Resolving is the author's or a moderator's — RLS decides, so an ineligible
                    person's click fails loudly rather than the control being guessed at here. */}
                <Button
                  variant="secondary" size="sm"
                  disabled={resolve.isPending}
                  onClick={() => resolve.mutate({ id: c.id, resolved: !c.resolved })}
                  data-testid={`task-comment-resolve-${c.id}`}
                >
                  {c.resolved ? t('review.unresolve') : t('review.resolve')}
                </Button>
                <PinThread
                  pin={c}
                  replies={repliesOf(c.id)}
                  scope={{ subTaskId }}
                  canReopen={role === 'reviewer' || c.authorId === myId}
                  makerActions={pinActions && c.authorId !== myId}
                  myId={myId}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}

      <form className="review-composer" onSubmit={submit} data-testid={`task-review-composer-${subTaskId}`}>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={
            role === 'maker' ? t('reviewMode.makerPlaceholder') : t('reviewMode.reviewerPlaceholder')
          }
          data-testid={`task-comment-body-${subTaskId}`}
        />
        {/* d.16: one optional field beside the note. type="url" for the keyboard and the browser's
            own nudge; the rule that counts (http(s) only) is the database's CHECK, and its refusal
            surfaces through add.isError below like any other. */}
        <label className="review-link-field">
          <span className="muted">{t('reviewMode.linkLabel')}</span>
          <input
            type="url"
            inputMode="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder={t('reviewMode.linkPlaceholder')}
            data-testid={`task-comment-link-input-${subTaskId}`}
          />
        </label>
        {/* d.17: Edward's sentence to offline users, said once, where the link is typed. */}
        {role === 'maker' && (
          <p className="muted review-link-note" data-testid={`task-review-link-note-${subTaskId}`}>
            {t('reviewMode.linkNote')}
          </p>
        )}
        {add.isError && (
          <p className="form-error" data-testid={`task-comment-error-${subTaskId}`}>
            {(add.error as Error)?.message || t('review.actionFailed')}
          </p>
        )}
        <Button variant="primary"
          type="submit"
          busy={add.isPending}
          disabled={!body.trim()}
          data-testid={`task-comment-submit-${subTaskId}`}
        >
          {t('reviewMode.addNote')}
        </Button>
      </form>

      {/* What the submit gate is actually waiting for, said plainly. The maker needs their OWN note
          on THIS round — a reviewer's comment does not let them submit, and neither does last
          round's. Reading the same condition the database enforces (author + round) rather than
          guessing from the count. */}
      {role === 'maker' && round != null && (
        <p className="muted" data-testid={`task-review-gate-${subTaskId}`}>
          {hasOwnNoteThisRound(all, round, myId)
            ? t('reviewMode.readyToSubmit')
            : t('reviewMode.needNote')}
        </p>
      )}
    </div>
  )
}
