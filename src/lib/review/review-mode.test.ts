import { describe, expect, it } from 'vitest'
import { hasOwnNoteThisRound, linkDisplayText, needsUpload, REVIEW_MODES, reviewModeLabelKey, toReviewMode } from './review-mode'

/**
 * ADR-0059. Two modes, and the fallback matters more than it looks.
 *
 * `review_mode` is `not null` in the database, so a null arriving here means a select list drifted
 * — a column somebody forgot to add to a query — not that a task has no mode. Falling back to
 * `digital` is the safe direction in that case: it asks for MORE before a task can be submitted, so
 * a drifted query cannot quietly let work through the gate with nothing attached.
 */

describe('toReviewMode', () => {
  it('passes both real values through', () => {
    expect(toReviewMode('digital')).toBe('digital')
    expect(toReviewMode('manual')).toBe('manual')
  })

  // The fallback is deliberately the STRICTER mode. If this ever flipped to 'manual', a query that
  // forgot the column would let every task submit on a comment.
  it('falls back to the stricter mode, never the looser one', () => {
    expect(toReviewMode(null)).toBe('digital')
    expect(toReviewMode(undefined)).toBe('digital')
    expect(toReviewMode('')).toBe('digital')
    expect(toReviewMode('MANUAL')).toBe('digital')
    expect(toReviewMode(42)).toBe('digital')
  })
})

describe('needsUpload', () => {
  it('is exactly the digital case', () => {
    expect(needsUpload('digital')).toBe(true)
    expect(needsUpload('manual')).toBe(false)
  })
})

describe('REVIEW_MODES', () => {
  // Every picker on every surface maps this list, so an omission is a mode nobody can choose.
  it('offers both modes, digital first', () => {
    expect([...REVIEW_MODES]).toEqual(['digital', 'manual'])
  })

  it('names each mode under one key, so the surfaces cannot label them differently', () => {
    expect(REVIEW_MODES.map(reviewModeLabelKey)).toEqual(['reviewMode.digital', 'reviewMode.manual'])
  })
})

/**
 * The manual submit gate, on the surface. It must ask exactly what `app.sub_task_submit` asks —
 * this round, this person — or the button goes live for a submission the database then refuses.
 */
describe('hasOwnNoteThisRound', () => {
  const notes = [
    { round: 1, authorId: 'me' },
    { round: 2, authorId: 'reviewer' },
  ]

  it('accepts my own note on this round', () => {
    expect(hasOwnNoteThisRound(notes, 1, 'me')).toBe(true)
  })

  // Last round's account is not an account of this round's work — the round-two trap, for notes.
  it('refuses last round’s note', () => {
    expect(hasOwnNoteThisRound(notes, 2, 'me')).toBe(false)
  })

  // A reviewer's comment is not the maker saying what they did.
  it('refuses somebody else’s note on the right round', () => {
    expect(hasOwnNoteThisRound(notes, 2, 'me')).toBe(false)
    expect(hasOwnNoteThisRound([{ round: 1, authorId: 'reviewer' }], 1, 'me')).toBe(false)
  })

  // A signed-out reader has no note of their own, and must not match every unattributed row.
  it('refuses an unknown user rather than matching a null author', () => {
    expect(hasOwnNoteThisRound([{ round: 1, authorId: null }], 1, null)).toBe(false)
  })

  it('refuses an empty thread', () => {
    expect(hasOwnNoteThisRound([], 1, 'me')).toBe(false)
  })
})

// ADR-0059 addendum d.16: the anchor shows where the link goes, not the token it carries.
describe('linkDisplayText', () => {
  it('shows host and path, drops the scheme and the query', () => {
    expect(linkDisplayText('https://www.icloud.com/keynote/0abc_deck?x=1#Q4')).toBe('www.icloud.com/keynote/0abc_deck')
  })

  it('shows a bare host without a trailing slash', () => {
    expect(linkDisplayText('https://staging.example.test/')).toBe('staging.example.test')
  })

  it('truncates a long path with an ellipsis, never mid-scheme', () => {
    const long = 'https://drive.example.test/' + 'a'.repeat(120)
    const shown = linkDisplayText(long)
    expect(shown.length).toBe(60)
    expect(shown.endsWith('…')).toBe(true)
    expect(shown.startsWith('drive.example.test/')).toBe(true)
  })

  // The database accepted it, so it is shown rather than swallowed — the reader can still click.
  it('shows an unparsable value as it is', () => {
    expect(linkDisplayText('http://')).toBe('http://')
  })
})
