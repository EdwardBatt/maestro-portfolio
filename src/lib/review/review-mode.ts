/**
 * How a task is reviewed (ADR-0059).
 *
 * `digital` is what this system has always done: the assignee uploads this round's version and the
 * reviewers read it. `manual` is for work that produces no file — a shoot day, a print run, an
 * installation, a media placement going live. The assignee writes what they did, the reviewers read
 * that, and approve or send it back exactly as they would a file.
 *
 * Edward, 29 Aug: *"digital routes to the existing upload, manual routes to a comment field, with
 * request changes or approve"*.
 *
 * The mode lives in two places and only one of them is an authority. A workflow step carries the
 * DEFAULT — "Installation produces nothing to upload" is a fact about installation, stated once on
 * the template. A task carries what is TRUE of it, copied from the step when the task is created,
 * and that is the only value the submit gate reads. A template edited later never reaches work
 * already under way.
 */

export type ReviewMode = 'digital' | 'manual'

export const REVIEW_MODES: readonly ReviewMode[] = ['digital', 'manual'] as const

/**
 * Narrow an unknown value to a mode, falling back to `digital`.
 *
 * The column is `not null` in the database, so a null here means a select list drifted rather than
 * that a task has no mode — and `digital` is the safe fallback in that case, because it asks for
 * MORE evidence before a task can be submitted, not less.
 */
export function toReviewMode(value: unknown): ReviewMode {
  return value === 'manual' ? 'manual' : 'digital'
}

/** Does submitting this task require an uploaded version? */
export function needsUpload(mode: ReviewMode): boolean {
  return mode === 'digital'
}

/** The i18n key for a mode's label, so every surface names it the same way. */
export function reviewModeLabelKey(mode: ReviewMode): string {
  return `reviewMode.${mode}`
}

/**
 * Does this person have their own note on this round?
 *
 * What `app.sub_task_submit` asks of a MANUAL task, in one place, so the submit modal and the
 * thread beneath it cannot disagree about whether the button should be live. Both halves matter: a
 * reviewer's comment is not the maker saying what they did, and last round's note is not an account
 * of this round's work.
 */
export function hasOwnNoteThisRound(
  comments: readonly { round: number; authorId: string | null }[],
  round: number,
  userId: string | null,
): boolean {
  if (userId == null) return false
  return comments.some((c) => c.round === round && c.authorId === userId)
}

/**
 * What a note's link SHOWS (ADR-0059 addendum d.16): the host and path, without the scheme and
 * without the query string — an iCloud share link is a hundred characters of token and the reader
 * needs "icloud.com/keynote/…", not the token. The full URL stays on the anchor's `href` and
 * `title`. Never throws: a value the database accepted but `URL` cannot parse is shown as it is.
 */
export function linkDisplayText(url: string, max = 60): string {
  let text: string
  try {
    const u = new URL(url)
    text = u.host + (u.pathname === '/' ? '' : u.pathname)
  } catch {
    text = url
  }
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}
