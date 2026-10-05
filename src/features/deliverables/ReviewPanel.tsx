import { BusyDialog, NoticeDialog } from '../../components/Notice'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, buttonClass } from '../../components/Button'
import { usePermissions } from '../../app/permissions'
import { useAuth } from '../../app/auth-context'
import {
  useDeliverableVersions,
  useUploadVersion,
  useVersionViewUrl,
  useVersionComments,
  useAddComment,
  useResolveComment,
  type MediaVersion,
  type ReviewComment,
} from './api/review-api'
import { previewKind } from './lib/media-preview'
import { groupByRound } from './lib/review-rounds'
import { threadComments } from './lib/pin-thread'
import { PinThread } from './components/PinThread'
import { ReviewRules } from './components/ReviewRules'
import { stampFormatter } from '../../lib/time/iraq'

/**
 * Internal review panel (ADR-0025, I3.1 + I3.2): the deliverable's version chain with upload,
 * inline playback, and anchored comments — image pins (pos_x/pos_y) and video timecodes. Rendered
 * in the deliverable detail, so every entry point reaches it. Upload is gated on `media:manage`;
 * commenting is open to any internal user; resolve is the author or `reviews:moderate` (RLS
 * enforces regardless). Round grouping + jump-to-comment arrive in I3.3.
 */

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * When something HAPPENED, in the reader's own clock and language — used for both the version
 * uploads and the comments beneath them.
 *
 * Both used to render `createdAt.slice(0, 10)`: the raw stored string, which is the UTC calendar day
 * with the time thrown away and no translation. It shows the wrong day either side of UTC and never
 * answers "how long ago?". Stored in UTC, displayed local (Edward, 1 Sep).
 *
 * Not to be reused for a DUE date: those are stored as midnight UTC standing in for a chosen day,
 * so putting one through this would move the deadline back a day for anyone west of UTC. See the
 * `T00:00:00Z` writes in `DeliverablesPage`.
 */
function useStamp() {
  const { i18n } = useTranslation()
  const fmt = stampFormatter(i18n.language === 'ar' ? 'ar' : 'en')
  return (iso: string): string | null => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : fmt.format(d)
  }
}

export function ReviewPanel({
  deliverableId,
  subTaskId,
  isReadOnly,
  allowUpload = true,
  showRules = false,
  pinActions = false,
}: {
  deliverableId: string
  /**
   * ADR-0058 d.1/d.3: the task whose artefacts these are. Given one, the panel shows and uploads
   * that task's versions — which is the container model working: a deliverable holds no file of its
   * own, so a reviewer sees the work they were asked about and not somebody else's.
   *
   * Omitted, it falls back to the whole deliverable. That is only right for work created before
   * this change; every surface that has a task in hand passes it.
   */
  subTaskId?: string | null
  isReadOnly?: boolean
  /** I52.12: the deliverables page opens a task's review for whoever is looking — a reviewer may
   *  comment and pin, but the upload belongs to the maker on My Work (ADR-0058 d.1). */
  allowUpload?: boolean
  /** ADR-0112 d.1 (I59.29): the rules the piece follows, beside the file. Off unless asked for —
   *  the review screens pass it; surfaces that already show the rules elsewhere do not. */
  showRules?: boolean
  /** ADR-0112 d.2 (I59.29): the viewer is the task's ASSIGNEE — offer Mark done / Undo / Reply on
   *  each pin somebody else wrote. The task page passes it for the maker. */
  pinActions?: boolean
}) {
  const { t } = useTranslation()
  const stamp = useStamp()
  const { can } = usePermissions()
  const canUpload = can('media:manage') && !isReadOnly && allowUpload

  const versions = useDeliverableVersions(deliverableId, subTaskId)
  const upload = useUploadVersion(deliverableId, subTaskId)
  const list = versions.data ?? []

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const selected = list.find((v) => v.id === selectedId) ?? list[0] ?? null

  function doUpload(file: File) {
    setError(null)
    upload.mutate(file, {
      onSuccess: ({ id }) => {
        setSelectedId(id)
        if (fileRef.current) fileRef.current.value = ''
      },
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
    if (!canUpload || upload.isPending) return
    const file = e.dataTransfer.files?.[0]
    if (file) doUpload(file)
  }

  return (
    <section
      className={`review-panel ${dragOver ? 'is-dragover' : ''}`}
      data-testid="review-panel"
      onDragOver={(e) => {
        if (!canUpload) return
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {/* ADR-0092 d.1 / I48.8: a version upload spans seconds — blocking, not a button label. */}
      {upload.isPending && <BusyDialog text={t('review.uploading')} testId="review-busy" />}
      <div className="review-head">
        <h3>{t('review.heading')}</h3>
        {canUpload && (
          <label className={buttonClass('secondary', 'md', 'review-upload')} data-testid="review-upload">
            {upload.isPending ? t('review.uploading') : `+ ${t('review.upload')}`}
            <input ref={fileRef} type="file" hidden disabled={upload.isPending} onChange={onPick} data-testid="review-file" />
          </label>
        )}
      </div>
      {canUpload && <p className="muted review-drophint" data-testid="review-drophint">{t('review.dropHint')}</p>}

      {error && (
        <NoticeDialog kind="error" message={error} testId="review-error" onClose={() => setError(null)} />
      )}

      {versions.isLoading ? (
        <p className="muted" data-testid="review-loading">…</p>
      ) : versions.isError ? (
        <p className="form-error" role="alert" data-testid="review-versions-error">
          {(versions.error as Error)?.message || t('review.uploadFailed')}
        </p>
      ) : list.length === 0 ? (
        <div className="empty-state" data-testid="review-empty"><p>{t('review.noVersions')}</p></div>
      ) : (
        <div className="review-body">
          <ul className="review-rail" data-testid="review-rail">
            {list.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  className={`review-version ${selected?.id === v.id ? 'is-selected' : ''}`}
                  onClick={() => setSelectedId(v.id)}
                  data-testid={`review-version-${v.id}`}
                >
                  <span className="review-vnum">{t('review.version', { n: v.version })}</span>
                  <span className="muted">
                    {v.uploadedByName ?? '—'}
                    {stamp(v.createdAt) && <> · <time dateTime={v.createdAt} data-testid={`review-version-time-${v.id}`}>{stamp(v.createdAt)}</time></>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {selected && (
            <VersionReview
              key={selected.id}
              version={selected}
              isReadOnly={isReadOnly}
              rulesFor={showRules ? deliverableId : null}
              pinActions={pinActions}
            />
          )}
        </div>
      )}
    </section>
  )
}

function VersionReview({
  version,
  isReadOnly,
  rulesFor = null,
  pinActions = false,
}: {
  version: MediaVersion
  isReadOnly?: boolean
  /** The deliverable whose rules to show beside the file, or null for none. */
  rulesFor?: string | null
  pinActions?: boolean
}) {
  const { t } = useTranslation()
  const { can } = usePermissions()
  const { session } = useAuth()
  const myId = session?.user.id ?? null
  const canModerate = can('reviews:moderate')

  /**
   * When the comment was WRITTEN — not where it points. Two clocks meet on one line here: `clock()`
   * renders a position inside the media, this renders a position in time, and they are told apart
   * by shape (the anchor is a filled pill, this is muted text) rather than by the reader guessing.
   *
   * It is not decoration. Every comment on a version is listed at once — deliberately, because
   * revealing notes only as the playhead reaches them hides most of the feedback most of the time —
   * so nothing but the posted time tells a reader whether a note is from this morning's round or
   * last Thursday's.
   */
  const posted = useStamp()

  const kind = previewKind(version.contentType)
  const view = useVersionViewUrl(version.id)
  const comments = useVersionComments(version.id)
  const add = useAddComment(version.id)
  const resolve = useResolveComment(version.id)

  const videoRef = useRef<HTMLVideoElement>(null)
  const [pending, setPending] = useState<
    { posX: number; posY: number } | { timecodeMs: number } | { page: number } | null
  >(null)
  const [body, setBody] = useState('')
  const [focusedId, setFocusedId] = useState<string | null>(null)
  /**
   * ADR-0057 d.6 — which page the embedded PDF is showing.
   *
   * The viewer is the browser's own, reached through `#page=N` (the PDF Open Parameters fragment
   * every mainstream viewer honours). That is a deliberate choice over a JavaScript PDF renderer:
   * page anchoring is a page number and a jump, and a renderer would add a multi-megabyte
   * dependency and a worker build for pixel-level pins nobody has asked for. If pin-level PDF
   * annotation is wanted later, THIS is the line that changes — not the column, not the comment.
   *
   * The reviewer types the page rather than the viewer reporting it, because a cross-origin
   * built-in viewer tells the host page nothing about where the reader is. Typing a number they
   * are looking at is honest; inferring one would be a guess presented as an anchor.
   */
  const [pdfPage, setPdfPage] = useState(1)

  const all = comments.data ?? []
  // ADR-0112 d.2: a reply hangs under its pin, never in the list as a comment of its own.
  const { pins: list, repliesOf } = threadComments(all)
  const pins = list.filter((c) => c.posX != null && c.posY != null)
  const groups = groupByRound(list)
  // Number the pinned comments (in creation order) so each image marker and its comment carry the
  // SAME number — the reviewer/assignee can match a note to the exact spot it's pinned to.
  const pinNumber = new Map(pins.map((c, i) => [c.id, i + 1]))

  // Jump-to-comment: seek the video to a timecoded note, or flash the image pin it's anchored to.
  function jumpTo(c: ReviewComment) {
    if (c.timecodeMs != null && videoRef.current) {
      try { videoRef.current.currentTime = c.timecodeMs / 1000 } catch { /* jsdom has no media pipeline */ }
    }
    if (c.posX != null && c.posY != null) setFocusedId(c.id)
    // Re-points the embedded viewer at the page the note is about. The iframe is keyed on the
    // page, so React remounts it — changing only a URL fragment does not reliably navigate an
    // already-loaded document, and a jump that silently does nothing is worse than no jump.
    if (c.page != null) setPdfPage(c.page)
  }

  function onImageClick(e: React.MouseEvent<HTMLImageElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return // jsdom / not laid out yet
    const posX = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const posY = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
    setPending({ posX, posY })
  }
  function markVideoTime() {
    const v = videoRef.current
    setPending({ timecodeMs: Math.round((v?.currentTime ?? 0) * 1000) })
  }

  /**
   * A video note stamps itself. The reviewer pauses on the frame they mean and starts typing; the
   * playhead is captured on the FIRST keystroke and frozen there. Nothing to press, and nothing to
   * forget to press — which was the whole problem with making it a button: the one moment a
   * reviewer is least likely to remember an extra click is the moment they have just seen the thing
   * they want to complain about.
   *
   * Frozen at the first keystroke, not read at submit, because a video left playing while someone
   * writes a sentence would stamp the note wherever it happened to drift to — a number that looks
   * authoritative and points at the wrong frame. Where the reviewer was when they began writing is
   * the honest answer whether they paused or not.
   *
   * `videoAnchorOff` is the opt-out: a note about the whole cut is a real thing to want, and once
   * it is off, only an explicit press turns it back on (re-reading the playhead at that moment).
   */
  const [videoAnchorOff, setVideoAnchorOff] = useState(false)
  function onBodyChange(next: string) {
    if (kind === 'video' && !videoAnchorOff && body === '' && next !== '') markVideoTime()
    setBody(next)
  }
  function dropVideoAnchor() {
    setVideoAnchorOff(true)
    setPending(null)
  }
  function takeVideoAnchor() {
    setVideoAnchorOff(false)
    markVideoTime()
  }
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!body.trim()) return
    const anchor = pending && 'posX' in pending
      ? { posX: pending.posX, posY: pending.posY }
      : pending && 'timecodeMs' in pending
        ? { timecodeMs: pending.timecodeMs }
        : pending && 'page' in pending
          ? { page: pending.page }
          : {}
    add.mutate({ body, ...anchor }, { onSuccess: () => { setBody(''); setPending(null); setVideoAnchorOff(false) } })
  }

  function anchorLabel(c: ReviewComment): string | null {
    if (c.timecodeMs != null) return clock(c.timecodeMs)
    if (c.posX != null && c.posY != null) return `#${pinNumber.get(c.id) ?? '•'}`
    if (c.page != null) return t('review.pageShort', { n: c.page })
    return null
  }

  return (
    <div className="review-detail" data-testid="review-detail">
      <div className="review-viewer" data-testid="review-viewer">
        {view.isError ? (
          <p className="form-error" data-testid="review-view-error">{t('review.viewFailed')}</p>
        ) : view.isLoading || !view.data ? (
          <p className="muted" data-testid="review-viewer-loading">…</p>
        ) : kind === 'image' ? (
          <div className="review-canvas" data-testid="review-canvas">
            <img src={view.data.viewUrl} alt={t('review.version', { n: version.version })} className="review-img" data-testid="review-img" onClick={onImageClick} />
            {pins.map((c) => (
              <span
                key={c.id}
                className={`review-pin ${c.resolved ? 'is-resolved' : ''} ${focusedId === c.id ? 'is-focused' : ''}`}
                // pos_x/pos_y are image-space PHYSICAL fractions (from the media's left/top), captured
                // the same way on click — so we position physically (left/top), never logically. Under
                // RTL, insetInlineStart would mirror the pin off its clicked point and off where other
                // locales see it; the image itself is not mirrored, so the annotation must not be either.
                style={{ left: `${(c.posX ?? 0) * 100}%`, top: `${(c.posY ?? 0) * 100}%` }}
                data-testid={`review-pin-${c.id}`}
                title={c.body}
              >
                {pinNumber.get(c.id)}
              </span>
            ))}
            {pending && 'posX' in pending && (
              <span className="review-pin is-pending" style={{ left: `${pending.posX * 100}%`, top: `${pending.posY * 100}%` }} data-testid="review-pin-pending" aria-hidden="true" />
            )}
          </div>
        ) : kind === 'video' ? (
          <video ref={videoRef} src={view.data.viewUrl} controls className="review-video" data-testid="review-video" />
        ) : kind === 'pdf' ? (
          <iframe
            key={pdfPage}
            src={`${view.data.viewUrl}#page=${pdfPage}`}
            title={t('review.version', { n: version.version })}
            className="review-pdf"
            data-testid="review-pdf"
          />
        ) : (
          /* ADR-0057 d.2. NOT a bare "unsupported" and a download button: a reviewer who cannot
             drop a pin has to be told whether the tool is missing, broken, or simply not possible
             for this format — and what to do instead. d.3 is the second half of that sentence: the
             review LOOP is not degraded, only the anchoring, so the convention for locating a
             comment is prose in its body, and the surface says so rather than leaving it folklore. */
          <div className="review-fallback" data-testid="review-fallback">
            <p data-testid="review-offline-why">{t('review.offline.why')}</p>
            <p className="muted" data-testid="review-offline-how">{t('review.offline.how')}</p>
            <a href={view.data.downloadUrl} download className={buttonClass('secondary')} data-testid="review-download">{t('review.download')}</a>
            {version.externalReviewUrl && (
              <a href={version.externalReviewUrl} target="_blank" rel="noreferrer" className={buttonClass('link')} data-testid="review-external">{t('review.openExternal')}</a>
            )}
          </div>
        )}
        {view.data && isReadOnly && (
          <div className="review-viewer-footer">
            <a href={view.data.downloadUrl} download className={buttonClass('primary')} data-testid="review-download-inline">{t('review.download')}</a>
          </div>
        )}
      </div>

      {/* ADR-0112 d.1: read-only (no comments column), the rules still sit beside the file. */}
      {isReadOnly && rulesFor && <ReviewRules deliverableId={rulesFor} />}

      {!isReadOnly && (
        <div className="review-comments" data-testid="review-comments">
        {rulesFor && <ReviewRules deliverableId={rulesFor} />}
        {list.length === 0 ? (
          <p className="muted" data-testid="review-comments-empty">{t('review.noComments')}</p>
        ) : (
          groups.map((g) => (
            <div className="review-round" key={g.round} data-testid={`review-round-${g.round}`}>
              <h4 className="review-round-head">{t('review.roundLabel', { n: g.round })}</h4>
              <ul className="review-comment-list">
                {g.comments.map((c) => {
                  const label = anchorLabel(c)
                  const when = posted(c.createdAt)
                  const canResolve = c.authorId === myId || canModerate
                  return (
                    <li key={c.id} className={`review-comment ${c.resolved ? 'is-resolved' : ''}`} data-testid={`review-comment-${c.id}`}>
                      <button type="button" className="review-comment-main" onClick={() => jumpTo(c)} data-testid={`comment-jump-${c.id}`}>
                        <span className="review-comment-meta muted">
                          {label && <span className="review-anchor" data-testid={`comment-anchor-${c.id}`}>{label}</span>}
                          <span>{c.authorName ?? '—'}</span>
                          {when && (
                            <time className="review-comment-time" dateTime={c.createdAt} data-testid={`comment-time-${c.id}`}>
                              {when}
                            </time>
                          )}
                        </span>
                        <span className="review-comment-body">{c.body}</span>
                      </button>
                      {canResolve && (
                        <Button
                          variant="secondary" size="sm"
                          disabled={resolve.isPending}
                          onClick={() => resolve.mutate({ id: c.id, resolved: !c.resolved })}
                          data-testid={`comment-resolve-${c.id}`}
                        >
                          {c.resolved ? t('review.reopen') : t('review.resolve')}
                        </Button>
                      )}
                      <PinThread
                        pin={c}
                        replies={repliesOf(c.id)}
                        scope={{ mediaRecordId: version.id }}
                        canReopen={canResolve}
                        makerActions={pinActions && c.authorId !== myId}
                        myId={myId}
                        stamp={posted}
                      />
                    </li>
                  )
                })}
              </ul>
            </div>
          ))
        )}

        <form className="review-composer" onSubmit={submit} data-testid="review-composer">
          <div className="review-anchor-row">
            {kind === 'image' && <span className="muted" data-testid="review-pin-hint">{pending && 'posX' in pending ? t('review.pinSet') : t('review.pinHint')}</span>}
            {/* Stamped, or opted out — never a button the reviewer has to find first. The stamp is
                stated in words, not just implied by a highlighted control, so "which frame is this
                going on?" is answered before they submit rather than after. */}
            {kind === 'video' && (pending && 'timecodeMs' in pending ? (
              <>
                <span className="muted" data-testid="review-time-set">{t('review.atTime', { time: clock(pending.timecodeMs) })}</span>
                <Button variant="link" onClick={dropVideoAnchor} data-testid="review-drop-time">
                  {t('review.wholeVideo')}
                </Button>
              </>
            ) : (
              <>
                <span className="muted" data-testid="review-time-hint">{videoAnchorOff ? t('review.wholeVideoSet') : t('review.timeHint')}</span>
                <Button variant="link" onClick={takeVideoAnchor} data-testid="review-mark-time">
                  {t('review.markTime')}
                </Button>
              </>
            ))}
            {/* ADR-0057 d.6. Optional, always: a comment about the whole document is the normal
                case and must not need a page to be submitted. Leaving the box empty is an
                unanchored comment, exactly as it is for an image nobody pinned. */}
            {kind === 'pdf' && (
              <label className="review-page-anchor" data-testid="review-page-anchor">
                {t('review.pageLabel')}
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={pending && 'page' in pending ? pending.page : ''}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    setPending(Number.isInteger(n) && n >= 1 ? { page: n } : null)
                  }}
                  data-testid="review-page-input"
                />
              </label>
            )}
            {/* d.2/d.3 again, in the place the reviewer is actually typing: the comment counts, it
                is just not pinned to anything, so say where it belongs in words. */}
            {kind === 'other' && (
              <span className="muted" data-testid="review-offline-hint">{t('review.offline.commentHint')}</span>
            )}
          </div>
          <textarea value={body} onChange={(e) => onBodyChange(e.target.value)} placeholder={t('review.commentPlaceholder')} data-testid="comment-body" />
          <Button variant="primary" type="submit" busy={add.isPending} disabled={!body.trim()} data-testid="comment-submit">{t('review.addComment')}</Button>
        </form>
      </div>
      )}
    </div>
  )
}
