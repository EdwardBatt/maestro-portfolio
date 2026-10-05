import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { buttonClass } from '../../../components/Button'
import { usePermissions } from '../../../app/permissions'
import type { AssignedWorkItem } from '../api/deliverables-api'
import { useUploadVersion, useVersionViewUrl, type MediaVersion, type ReviewComment } from '../api/review-api'
import { useChangesCameBack } from '../hooks/use-changes-came-back'
import { previewKind } from '../lib/media-preview'
import { PinControls } from './PinThread'

/**
 * When the latest round asked for changes — Figma M4 `1586:185`, drawn as the frame draws it: the
 * previous version large with its numbered pins on the left; on the right the To-fix list (who
 * pinned it, what, and Mark done / Undo / Reply per pin — Track 7's `PinControls`, ADR-0112 d.2),
 * the round note, and Upload V<n>. Send V<n> back and Reply to a pin are the page's foot.
 *
 * The assignee answers the pins; everybody else reads them (a reviewer may Re-open a done pin).
 * Upload is a file — a version is a file (ADR-0058); the frame's "Paste a link" tab has no
 * counterpart for a digital task and is not drawn.
 */
export function ChangesCameBack({ item, mine, thisRound, myId }: { item: AssignedWorkItem; mine: boolean; thisRound: number; myId: string | null }) {
  const { t } = useTranslation()
  const { can } = usePermissions()
  const deliverableId = item.deliverableId!
  const { prev, pins, repliesOf, current } = useChangesCameBack(item, thisRound)
  const upload = useUploadVersion(deliverableId, item.subTaskId)
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const who = [...new Set(pins.map((c) => c.authorName).filter(Boolean))].join(', ')
  const canUpload = mine && can('media:manage')
  const canModerate = can('reviews:moderate')

  function doUpload(file: File) {
    setError(null)
    upload.mutate(file, {
      onSuccess: () => { if (fileRef.current) fileRef.current.value = '' },
      onError: (err) => setError((err as Error)?.message || t('review.uploadFailed')),
    })
  }
  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) doUpload(file)
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (upload.isPending) return
    const file = e.dataTransfer.files?.[0]
    if (file) doUpload(file)
  }

  return (
    <section className="task-page-changes" data-testid="task-page-changes">
      <h2 className="sr-only">{t('taskPage.changesTitle')}</h2>
      <div className="task-changes-grid">
        <div className="task-changes-prev" data-testid="task-page-prev-version">
          {prev ? <PreviousFile version={prev} pins={pins} /> : <p className="muted">…</p>}
        </div>

        <div className="task-changes-side">
          <section className="task-page-card task-fix-card">
            <h3 className="task-page-card-title">{t('taskPage.toFix')}</h3>
            {pins.length === 0 ? (
              <p className="muted" data-testid="task-page-to-fix-none">{t('taskPage.noPins')}</p>
            ) : (
              <ol className="task-fix-list" data-testid="task-page-to-fix">
                {pins.map((c, i) => {
                  const done = Boolean(c.doneAt)
                  const makerActions = mine && c.authorId !== myId
                  const canReopen = c.authorId === myId || canModerate
                  const replies = repliesOf(c.id)
                  return (
                    <li
                      key={c.id}
                      className={['task-fix-row', done ? 'is-done' : '', c.resolved ? 'is-resolved' : ''].filter(Boolean).join(' ')}
                      data-testid={`task-page-pin-${c.id}`}
                      data-done={done ? 'true' : undefined}
                    >
                      <span className="task-fix-num" aria-hidden="true">{i + 1}</span>
                      <span className="task-fix-who">{c.authorName ?? '—'}</span>
                      {done && (
                        <span className="task-fix-done" data-testid={`task-page-pin-done-${c.id}`}>
                          {c.doneByName ? t('reviewPins.doneBy', { name: c.doneByName }) : t('reviewPins.done')}
                        </span>
                      )}
                      <span className="task-fix-body" dir="auto">{c.body}</span>
                      {replies.length > 0 && (
                        <ul className="pin-replies task-fix-replies" data-testid={`pin-replies-${c.id}`}>
                          {replies.map((r) => (
                            <li key={r.id} className="pin-reply" data-testid={`pin-reply-${r.id}`}>
                              <span className="review-comment-meta muted"><span>{r.authorName ?? '—'}</span></span>
                              <span className="review-comment-body" dir="auto">{r.body}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {(makerActions || (done && canReopen)) && (
                        <PinControls pin={c} scope={{ mediaRecordId: c.mediaRecordId! }} canReopen={canReopen} makerActions={makerActions} myId={myId} />
                      )}
                    </li>
                  )
                })}
              </ol>
            )}
            <p className="task-fix-note" data-testid="task-page-changes-line">
              {item.revisionLimit
                ? t('needsYou.roundOf', { n: item.revisionRound, limit: item.revisionLimit })
                : t('needsYou.round', { n: item.revisionRound })}
              {who ? ` · ${t('taskPage.pinnedBy', { names: who })}` : ''}
              {item.status === 'todo' ? ` · ${t('taskPage.clockAgain')}` : ''}
            </p>
          </section>

          {(current || canUpload) && (
            <section className="task-page-card task-upload-card">
              <h3 className="task-page-card-title">{t('taskPage.uploadNext', { n: thisRound })}</h3>
              {current ? (
                <p className="task-v-next" data-testid="task-page-next-attached">
                  {t('taskPage.nextAttached', { n: current.version })}
                </p>
              ) : (
                <label
                  className={`task-dropzone${dragOver ? ' is-dragover' : ''}`}
                  data-testid="task-page-upload-next"
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                >
                  <span className="task-dropzone-title">
                    {upload.isPending ? t('myWork.submit.attaching') : t('taskPage.dropNext', { n: thisRound })}
                  </span>
                  {prev && <span className="task-dropzone-sub">{t('taskPage.keptNote', { n: prev.version })}</span>}
                  <input ref={fileRef} type="file" hidden disabled={upload.isPending} onChange={onPick} data-testid="task-page-upload-next-file" />
                </label>
              )}
              {error && <p className="form-error" data-testid="task-page-upload-error">{error}</p>}
            </section>
          )}
        </div>
      </div>
    </section>
  )
}

/** The previous version, large, with each positioned pin numbered as the To-fix list numbers it. */
function PreviousFile({ version, pins }: { version: MediaVersion; pins: readonly ReviewComment[] }) {
  const { t } = useTranslation()
  const kind = previewKind(version.contentType)
  const view = useVersionViewUrl(version.id)
  const label = t('review.version', { n: version.version })

  if (view.isError) return <p className="form-error" data-testid="review-view-error">{t('review.viewFailed')}</p>
  if (view.isLoading || !view.data) return <p className="muted" data-testid="review-viewer-loading">…</p>
  if (kind === 'image') {
    return (
      <div className="task-prev-canvas">
        <img src={view.data.viewUrl} alt={label} className="task-prev-img" data-testid="review-img" />
        {pins.map((c, i) =>
          c.posX != null && c.posY != null ? (
            <span
              key={c.id}
              className={`task-prev-pin${c.doneAt ? ' is-done' : ''}`}
              // Image-space physical fractions, as ReviewPanel places them — never mirrored.
              style={{ left: `${c.posX * 100}%`, top: `${c.posY * 100}%` }}
              data-testid={`task-page-prev-pin-${c.id}`}
              title={c.body}
            >
              {i + 1}
            </span>
          ) : null,
        )}
      </div>
    )
  }
  if (kind === 'video') return <video src={view.data.viewUrl} controls className="task-prev-media" data-testid="review-video" />
  if (kind === 'pdf') return <iframe src={view.data.viewUrl} title={label} className="task-prev-media task-prev-pdf" data-testid="review-pdf" />
  return (
    <div className="review-fallback" data-testid="review-fallback">
      <p>{label}</p>
      <a href={view.data.downloadUrl} download className={buttonClass('secondary')} data-testid="review-download">{t('review.download')}</a>
    </div>
  )
}
