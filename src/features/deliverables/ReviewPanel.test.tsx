import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import '../../lib/i18n'
import type { MediaVersion, ReviewComment } from './api/review-api'

/**
 * ReviewPanel (ADR-0025, I3.1 + I3.2). review-api reaches lib/env in CI → mocked; the preview-kind
 * routing stays real. Covers: version list + upload gating, inline viewer per MIME type, and the
 * anchored-comment pane (render, resolve, add note, add at video timecode).
 */

const state = vi.hoisted(() => ({
  versions: [] as MediaVersion[],
  comments: [] as ReviewComment[],
  canUpload: true,
  canModerate: false,
  viewUrl: 'https://b2.example/signed' as string | null,
  addMutate: vi.fn(),
  resolveMutate: vi.fn(),
  pinDoneMutate: vi.fn(),
}))

vi.mock('./api/review-api', () => ({
  useDeliverableVersions: () => ({ data: state.versions, isLoading: false, isError: false }),
  useUploadVersion: () => ({ mutate: vi.fn(), isPending: false }),
  useVersionViewUrl: () => ({ data: state.viewUrl ? { viewUrl: state.viewUrl, downloadUrl: state.viewUrl } : null, isLoading: false, isError: false }),
  useVersionComments: () => ({ data: state.comments, isLoading: false, isError: false }),
  useAddComment: () => ({ mutate: state.addMutate, isPending: false }),
  useResolveComment: () => ({ mutate: state.resolveMutate, isPending: false }),
  // I59.29 (ADR-0112 d.2): the pin controls' hooks, mounted only when a control is shown.
  useSetPinDone: () => ({ mutate: state.pinDoneMutate, isPending: false }),
  useReplyToPin: () => ({ mutate: vi.fn(), isPending: false }),
}))

// I59.29 (ADR-0112 d.1): the rules beside the file — read only when the panel is asked to show them.
vi.mock('./api/review-rules-api', () => ({
  useDeliverableRules: () => ({ rules: [{ kind: 'dont', text: 'No red on the pack' }], isLoading: false }),
}))

vi.mock('../../app/permissions', () => ({
  usePermissions: () => ({
    can: (k: string) => (k === 'media:manage' ? state.canUpload : k === 'reviews:moderate' ? state.canModerate : false),
  }),
}))

vi.mock('../../app/auth-context', () => ({
  useAuth: () => ({ session: { user: { id: 'me' } } }),
}))

import { ReviewPanel } from './ReviewPanel'

const mkV = (o: Partial<MediaVersion> & { id: string; version: number }): MediaVersion => ({
  // I11.9: a version carries the round it was uploaded in; one upload per round is the normal case.
  round: o.version,
  objectKey: 'k/x', contentType: 'image/png', sizeBytes: 1000, storageTier: 'hot', retentionState: 'active',
  externalReviewUrl: null, uploadedById: 'u1', uploadedByName: 'Lina', createdAt: '2026-08-18T09:00:00Z', ...o,
})
const mkC = (o: Partial<ReviewComment> & { id: string }): ReviewComment => ({
  mediaRecordId: 'm1', subTaskId: null, round: 1, source: 'internal', body: 'looks good', timecodeMs: null, posX: null, posY: null,
  page: null, resolved: false, authorId: 'me', authorName: 'Me', createdAt: '2026-08-18T10:00:00Z', linkUrl: null, ...o,
})

const render_ = () => render(<ReviewPanel deliverableId="d1" />)

describe('ReviewPanel (ADR-0025, I3.1 + I3.2)', () => {
  beforeEach(() => {
    state.versions = []
    state.comments = []
    state.canUpload = true
    state.canModerate = false
    state.viewUrl = 'https://b2.example/signed'
    state.addMutate = vi.fn()
    state.resolveMutate = vi.fn()
    state.pinDoneMutate = vi.fn()
  })

  it('empty state when no versions; upload shown to media:manage', () => {
    render_()
    expect(screen.getByTestId('review-empty')).toBeInTheDocument()
    expect(screen.getByTestId('review-upload')).toBeInTheDocument()
  })

  it('hides upload without media:manage', () => {
    state.canUpload = false
    render_()
    expect(screen.queryByTestId('review-upload')).not.toBeInTheDocument()
  })

  it('renders the newest version inline (image) and lists versions', () => {
    state.versions = [mkV({ id: 'm2', version: 2, contentType: 'image/png' }), mkV({ id: 'm1', version: 1, contentType: 'video/mp4' })]
    render_()
    expect(screen.getByTestId('review-version-m2')).toBeInTheDocument()
    expect(screen.getByTestId('review-img')).toHaveAttribute('src', 'https://b2.example/signed')
  })

  it('switches viewer to the selected version (video)', () => {
    state.versions = [mkV({ id: 'm2', version: 2, contentType: 'image/png' }), mkV({ id: 'm1', version: 1, contentType: 'video/mp4' })]
    render_()
    fireEvent.click(screen.getByTestId('review-version-m1'))
    expect(screen.getByTestId('review-video')).toBeInTheDocument()
  })

  it('falls back to download for a non-web-playable type', () => {
    state.versions = [mkV({ id: 'm1', version: 1, contentType: 'video/quicktime', externalReviewUrl: 'https://frame.io/x' })]
    render_()
    expect(screen.getByTestId('review-download')).toHaveAttribute('href', 'https://b2.example/signed')
    expect(screen.getByTestId('review-external')).toHaveAttribute('href', 'https://frame.io/x')
  })

  it('renders comments with anchor + author and lets the author resolve', () => {
    state.versions = [mkV({ id: 'm1', version: 1, contentType: 'image/png' })]
    state.comments = [mkC({ id: 'c1', body: 'fix the logo', posX: 0.5, posY: 0.25, authorId: 'me' })]
    render_()
    const row = screen.getByTestId('review-comment-c1')
    expect(row).toHaveTextContent('fix the logo')
    expect(screen.getByTestId('comment-anchor-c1')).toBeInTheDocument() // 📍 pin marker
    const pin = screen.getByTestId('review-pin-c1')
    expect(pin).toBeInTheDocument() // overlay on the image
    // pos_x/pos_y are image-space PHYSICAL fractions — positioned with left/top, never logical
    // insetInlineStart, so pins don't mirror under RTL (I6.2 / ADR-0025).
    expect(pin.style.left).toBe('50%')
    expect(pin.style.top).toBe('25%')
    fireEvent.click(screen.getByTestId('comment-resolve-c1'))
    expect(state.resolveMutate).toHaveBeenCalledWith({ id: 'c1', resolved: true })
  })

  it('stamps a version with when it was uploaded, in the reader’s clock', () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-29T09:00:00Z')) // I66.8: a 2026 date shows no year
    state.versions = [mkV({ id: 'm1', version: 1, createdAt: '2026-08-18T22:30:00Z' })]
    render_()
    const stamp = screen.getByTestId('review-version-time-m1')
    expect(stamp).toHaveAttribute('datetime', '2026-08-18T22:30:00Z')
    // Was `createdAt.slice(0, 10)`: the UTC calendar day, untranslated, with the time discarded.
    expect(stamp).not.toHaveTextContent('2026-08-18')
    // I66.8: in Iraq time, as every time reads — 22:30 UTC is 01:30 the next morning in Baghdad.
    expect(stamp).toHaveTextContent('Wed, 19 Aug, 01:30')
    vi.useRealTimers()
  })

  it('stamps every comment with when it was posted, timecoded or not', () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-29T09:00:00Z')) // I66.8: a 2026 date shows no year
    state.versions = [mkV({ id: 'm1', version: 1, contentType: 'video/mp4' })]
    state.comments = [
      mkC({ id: 'c1', body: 'unanchored', createdAt: '2026-08-18T10:00:00Z' }),
      mkC({ id: 'c2', body: 'at the cut', timecodeMs: 83_000, createdAt: '2026-08-19T14:30:00Z' }),
    ]
    render_()
    // Every comment on a version is listed at once — they are NOT revealed as the playhead reaches
    // them — so the posted time is the only thing that orders a round for a reader. Asserted on the
    // machine-readable attribute, and on the words — in Iraq time since I66.8, so the runner's zone no longer matters.
    expect(screen.getByTestId('comment-time-c1')).toHaveAttribute('datetime', '2026-08-18T10:00:00Z')
    expect(screen.getByTestId('comment-time-c1')).toHaveTextContent('Tue, 18 Aug, 13:00')
    // c2 carries both clocks and they are different numbers: 1:23 INTO the video, posted on the 19th.
    expect(screen.getByTestId('comment-anchor-c2')).toHaveTextContent('1:23')
    expect(screen.getByTestId('comment-time-c2')).toHaveTextContent('Wed, 19 Aug, 17:30')
    vi.useRealTimers()
  })

  it('does not offer resolve to a non-author without reviews:moderate', () => {
    state.versions = [mkV({ id: 'm1', version: 1 })]
    state.comments = [mkC({ id: 'c1', authorId: 'someone-else' })]
    render_()
    expect(screen.queryByTestId('comment-resolve-c1')).not.toBeInTheDocument()
  })

  it('adds a plain note', () => {
    state.versions = [mkV({ id: 'm1', version: 1, contentType: 'image/png' })]
    render_()
    fireEvent.change(screen.getByTestId('comment-body'), { target: { value: 'general note' } })
    fireEvent.click(screen.getByTestId('comment-submit'))
    expect(state.addMutate).toHaveBeenCalledWith(expect.objectContaining({ body: 'general note' }), expect.anything())
  })

  // jsdom has no media pipeline, so the playhead is stubbed onto the element the panel holds a ref
  // to. An own property shadows jsdom's prototype accessor, which is inert.
  const playheadAt = (seconds: number) =>
    Object.defineProperty(screen.getByTestId('review-video'), 'currentTime', { value: seconds, configurable: true })

  it('stamps a video comment with the playhead on the first keystroke — nothing to press', () => {
    state.versions = [mkV({ id: 'm1', version: 1, contentType: 'video/mp4' })]
    render_()
    playheadAt(83)
    expect(screen.getByTestId('review-time-hint')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('comment-body'), { target: { value: 'the cut lands late' } })
    expect(screen.getByTestId('review-time-set')).toHaveTextContent('1:23')
    fireEvent.click(screen.getByTestId('comment-submit'))
    expect(state.addMutate).toHaveBeenCalledWith(expect.objectContaining({ body: 'the cut lands late', timecodeMs: 83_000 }), expect.anything())
  })

  it('freezes the stamp at the first keystroke, so a video left playing cannot drag it', () => {
    state.versions = [mkV({ id: 'm1', version: 1, contentType: 'video/mp4' })]
    render_()
    playheadAt(83)
    fireEvent.change(screen.getByTestId('comment-body'), { target: { value: 't' } })
    playheadAt(200) // still rolling while the reviewer types the rest
    fireEvent.change(screen.getByTestId('comment-body'), { target: { value: 'the cut lands late' } })
    fireEvent.click(screen.getByTestId('comment-submit'))
    expect(state.addMutate).toHaveBeenCalledWith(expect.objectContaining({ timecodeMs: 83_000 }), expect.anything())
  })

  it('drops the stamp for a note about the whole video', () => {
    state.versions = [mkV({ id: 'm1', version: 1, contentType: 'video/mp4' })]
    render_()
    playheadAt(42)
    fireEvent.change(screen.getByTestId('comment-body'), { target: { value: 'colour grade throughout' } })
    fireEvent.click(screen.getByTestId('review-drop-time'))
    expect(screen.queryByTestId('review-time-set')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('comment-submit'))
    // No anchor key at all — an unanchored comment, not one stamped at 0:00.
    expect(Object.keys(state.addMutate.mock.calls[0][0])).toEqual(['body'])
  })

  it('takes the stamp again on request, reading the playhead at that moment', () => {
    state.versions = [mkV({ id: 'm1', version: 1, contentType: 'video/mp4' })]
    render_()
    playheadAt(42)
    fireEvent.change(screen.getByTestId('comment-body'), { target: { value: 'here' } })
    fireEvent.click(screen.getByTestId('review-drop-time'))
    playheadAt(125)
    fireEvent.click(screen.getByTestId('review-mark-time'))
    expect(screen.getByTestId('review-time-set')).toHaveTextContent('2:05')
    fireEvent.click(screen.getByTestId('comment-submit'))
    expect(state.addMutate).toHaveBeenCalledWith(expect.objectContaining({ timecodeMs: 125_000 }), expect.anything())
  })

  it('groups comments by round, newest round first (I3.3)', () => {
    state.versions = [mkV({ id: 'm1', version: 1, contentType: 'image/png' })]
    state.comments = [mkC({ id: 'c1', round: 1, body: 'r1 note' }), mkC({ id: 'c2', round: 2, body: 'r2 note' })]
    render_()
    expect(screen.getByTestId('review-round-2')).toBeInTheDocument()
    expect(screen.getByTestId('review-round-1')).toBeInTheDocument()
    expect(within(screen.getByTestId('review-round-2')).getByTestId('review-comment-c2')).toBeInTheDocument()
    expect(within(screen.getByTestId('review-round-1')).getByTestId('review-comment-c1')).toBeInTheDocument()
  })

  it('jump-to-comment flashes the image pin it is anchored to (I3.3)', () => {
    state.versions = [mkV({ id: 'm1', version: 1, contentType: 'image/png' })]
    state.comments = [mkC({ id: 'c1', posX: 0.5, posY: 0.25, authorId: 'me' })]
    render_()
    expect(screen.getByTestId('review-pin-c1')).not.toHaveClass('is-focused')
    fireEvent.click(screen.getByTestId('comment-jump-c1'))
    expect(screen.getByTestId('review-pin-c1')).toHaveClass('is-focused')
  })
})

// ============================================================================
// ADR-0057 — documents are reviewed offline until Collabora, and a PDF comment can name its page.
//
// d.2 is a copy decision with teeth: a reviewer who cannot drop a pin must be told whether the
// tool is missing, broken, or simply not possible for this format. d.3 is the other half — the
// review LOOP is not degraded, only the anchoring — and the surface has to say so, or the
// convention for locating a comment stays folklore.
// ============================================================================
describe('ReviewPanel — a file that cannot be annotated (ADR-0057 d.2, d.3, I23.1/I23.2)', () => {
  beforeEach(() => {
    state.versions = [mkV({ id: 'm1', version: 1, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })]
    state.comments = []
    state.canUpload = true
    state.canModerate = false
    state.viewUrl = 'https://b2.example/signed'
    state.addMutate = vi.fn()
  })

  it('explains WHY it cannot be marked up, and what to do instead', () => {
    render_()
    // Not a bare "unsupported" and a button. Two sentences: the reason, and the instruction.
    expect(screen.getByTestId('review-offline-why')).toHaveTextContent(/cannot be marked up/i)
    expect(screen.getByTestId('review-offline-how')).toHaveTextContent(/download it/i)
    expect(screen.getByTestId('review-download')).toBeInTheDocument()
  })

  it('offers no annotation affordance at all — nothing to look broken', () => {
    render_()
    expect(screen.queryByTestId('review-pin-hint')).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-mark-time')).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-time-hint')).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-page-anchor')).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-canvas')).not.toBeInTheDocument()
  })

  // d.3, the half that is easy to forget: the loop is intact, only the anchoring is missing.
  it('says how to locate a comment in words, since there is nothing to pin it to', () => {
    render_()
    expect(screen.getByTestId('review-offline-hint')).toHaveTextContent(/say where you mean/i)
  })

  it('takes an unanchored comment and sends no anchor with it', () => {
    render_()
    fireEvent.change(screen.getByTestId('comment-body'), { target: { value: 'Page 4 runs long' } })
    fireEvent.click(screen.getByTestId('comment-submit'))
    expect(state.addMutate).toHaveBeenCalledWith({ body: 'Page 4 runs long' }, expect.anything())
  })

  it('renders such a comment in its round, with resolve, exactly like any other', () => {
    state.comments = [mkC({ id: 'c1', round: 2, body: 'Fonts are wrong', authorId: 'me' })]
    render_()
    expect(within(screen.getByTestId('review-round-2')).getByTestId('review-comment-c1')).toBeInTheDocument()
    expect(screen.getByTestId('comment-resolve-c1')).toBeInTheDocument()
    // …and shows no anchor chip, because there is honestly nothing to show.
    expect(screen.queryByTestId('comment-anchor-c1')).not.toBeInTheDocument()
  })
})

describe('ReviewPanel — a PDF comment names its page (ADR-0057 d.6, I23.3)', () => {
  beforeEach(() => {
    state.versions = [mkV({ id: 'm1', version: 1, contentType: 'application/pdf' })]
    state.comments = []
    state.canUpload = true
    state.canModerate = false
    state.viewUrl = 'https://b2.example/signed'
    state.addMutate = vi.fn()
  })

  it('opens the document at page 1 and offers a page box', () => {
    render_()
    expect(screen.getByTestId('review-pdf')).toHaveAttribute('src', 'https://b2.example/signed#page=1')
    expect(screen.getByTestId('review-page-anchor')).toBeInTheDocument()
  })

  it('sends the page the reviewer named', () => {
    render_()
    fireEvent.change(screen.getByTestId('review-page-input'), { target: { value: '4' } })
    fireEvent.change(screen.getByTestId('comment-body'), { target: { value: "The chairman's letter runs long" } })
    fireEvent.click(screen.getByTestId('comment-submit'))
    expect(state.addMutate).toHaveBeenCalledWith(
      { body: "The chairman's letter runs long", page: 4 },
      expect.anything(),
    )
  })

  // The page is OPTIONAL, always. A note about the whole document is the normal case and must not
  // need a page number to be submitted.
  it('sends no page when the box is left empty', () => {
    render_()
    fireEvent.change(screen.getByTestId('comment-body'), { target: { value: 'Fonts are wrong throughout' } })
    fireEvent.click(screen.getByTestId('comment-submit'))
    expect(state.addMutate).toHaveBeenCalledWith({ body: 'Fonts are wrong throughout' }, expect.anything())
  })

  it('refuses to anchor to a page below 1 — that is not "no page", it is a page nobody can turn to', () => {
    render_()
    fireEvent.change(screen.getByTestId('review-page-input'), { target: { value: '0' } })
    fireEvent.change(screen.getByTestId('comment-body'), { target: { value: 'note' } })
    fireEvent.click(screen.getByTestId('comment-submit'))
    expect(state.addMutate).toHaveBeenCalledWith({ body: 'note' }, expect.anything())
  })

  it('labels a page-anchored comment with its page', () => {
    state.comments = [mkC({ id: 'c1', page: 4, authorId: 'me' })]
    render_()
    expect(screen.getByTestId('comment-anchor-c1')).toHaveTextContent('p.4')
  })

  it('jumps the viewer to the page a comment is about', () => {
    state.comments = [mkC({ id: 'c1', page: 7, authorId: 'me' })]
    render_()
    fireEvent.click(screen.getByTestId('comment-jump-c1'))
    expect(screen.getByTestId('review-pdf')).toHaveAttribute('src', 'https://b2.example/signed#page=7')
  })

  // ---- I59.29 (ADR-0112): pins the maker answers, and the rules beside the file ----

  it('a reply hangs under its pin with "Done by", never as a comment of its own', () => {
    state.versions = [mkV({ id: 'm1', version: 1, contentType: 'image/png' })]
    state.comments = [
      mkC({ id: 'p1', body: 'Logo too small', posX: 0.2, posY: 0.3, authorId: 'rev', authorName: 'Rana', doneAt: '2026-09-25T11:00:00Z', doneById: 'mk', doneByName: 'Abeer' }),
      mkC({ id: 'r1', body: 'Bigger in v2', parentId: 'p1', authorId: 'mk', authorName: 'Abeer' }),
    ]
    render_()
    expect(screen.queryByTestId('review-comment-r1')).toBeNull()
    expect(within(screen.getByTestId('review-comment-p1')).getByTestId('pin-reply-r1')).toHaveTextContent('Bigger in v2')
    expect(screen.getByTestId('pin-done-p1')).toHaveTextContent('Done by Abeer')
    // Only the pin is numbered on the image.
    expect(screen.getByTestId('review-pin-p1')).toHaveTextContent('1')
  })

  it('the reviewer (a moderator) is offered Re-open on a done pin; nobody else is', () => {
    state.versions = [mkV({ id: 'm1', version: 1 })]
    state.comments = [mkC({ id: 'p1', authorId: 'rev', doneAt: 'x', doneById: 'mk', doneByName: 'Abeer' })]
    const { unmount } = render_()
    expect(screen.queryByTestId('pin-reopen-p1')).toBeNull()
    unmount()
    state.canModerate = true
    render_()
    fireEvent.click(screen.getByTestId('pin-reopen-p1'))
    expect(state.pinDoneMutate).toHaveBeenCalledWith({ id: 'p1', done: false }, expect.anything())
  })

  it("pinActions offers the maker Mark done on somebody else's pin, not on their own note", () => {
    state.versions = [mkV({ id: 'm1', version: 1 })]
    state.comments = [mkC({ id: 'p1', authorId: 'rev' }), mkC({ id: 'c2', authorId: 'me' })]
    render(<ReviewPanel deliverableId="d1" pinActions />)
    expect(screen.getByTestId('pin-mark-done-p1')).toBeInTheDocument()
    expect(screen.getByTestId('pin-reply-open-p1')).toBeInTheDocument()
    expect(screen.queryByTestId('pin-mark-done-c2')).toBeNull()
  })

  it('without pinActions the maker controls are not offered (existing surfaces unchanged)', () => {
    state.versions = [mkV({ id: 'm1', version: 1 })]
    state.comments = [mkC({ id: 'p1', authorId: 'rev' })]
    render_()
    expect(screen.queryByTestId('pin-mark-done-p1')).toBeNull()
    expect(screen.queryByTestId('review-rules')).toBeNull()
  })

  it("showRules puts the piece's rules beside the file", () => {
    state.versions = [mkV({ id: 'm1', version: 1 })]
    render(<ReviewPanel deliverableId="d1" showRules />)
    expect(within(screen.getByTestId('review-comments')).getByTestId('review-rules')).toHaveTextContent('No red on the pack')
  })

  it('showRules on a read-only panel still shows the rules, on their own', () => {
    state.versions = [mkV({ id: 'm1', version: 1 })]
    render(<ReviewPanel deliverableId="d1" showRules isReadOnly />)
    expect(screen.queryByTestId('review-comments')).toBeNull()
    expect(screen.getByTestId('review-rules')).toHaveTextContent('No red on the pack')
  })
})
