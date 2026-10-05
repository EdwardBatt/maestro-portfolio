import { describe, expect, it } from 'vitest'
import { isDeliverableComplete } from './completeness'

describe('isDeliverableComplete — what counts as finished', () => {
  it('approved and archived are finished', () => {
    expect(isDeliverableComplete('approved')).toBe(true)
    expect(isDeliverableComplete('archived')).toBe(true)
  })

  it('work in flight is not', () => {
    for (const state of ['draft', 'in_progress', 'in_review', 'blocked'] as const) {
      expect(isDeliverableComplete(state)).toBe(false)
    }
  })

  // The one that is easy to get wrong. `delivered` looks like an ending, but it means the work is
  // out with the client and a revision can still come back — filing it under Completed would hide
  // exactly the work most likely to return.
  it('delivered is still LIVE', () => {
    expect(isDeliverableComplete('delivered')).toBe(false)
  })
})
