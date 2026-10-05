import { describe, expect, it } from 'vitest'
import { notificationLabel } from './label'

/**
 * I30.7. An email that said "Hero KV" gave the reader no way to know which campaign it belonged to,
 * and the same deliverable name recurs across campaigns. The three null cases are as deliberate as
 * the joined one — each was decided explicitly (Edward, 8 Sep).
 */
describe('notificationLabel', () => {
  it('puts the campaign in front of the work', () => {
    expect(notificationLabel('Hero KV', 'Spring Launch')).toBe('Spring Launch — Hero KV')
  })

  it('leaves ad-hoc work as its title alone — no invented prefix (d.2)', () => {
    expect(notificationLabel('Logo tweak', null)).toBe('Logo tweak')
  })

  it('never prefixes a campaign with itself (d.1)', () => {
    // A campaign notification arrives with no context precisely so this cannot happen.
    expect(notificationLabel('Spring Launch', null)).toBe('Spring Launch')
  })

  it('leaves a resource clash naming the resource (d.3)', () => {
    // The label is a person or a piece of equipment, which is not in a campaign.
    expect(notificationLabel('RED Komodo', null)).toBe('RED Komodo')
  })

  it('passes a missing label through, so the caller can supply its own fallback wording', () => {
    expect(notificationLabel(null, null)).toBeNull()
  })

  it('falls back to the campaign alone rather than rendering a dangling separator', () => {
    expect(notificationLabel(null, 'Spring Launch')).toBe('Spring Launch')
  })
})
