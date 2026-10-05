import { describe, expect, it } from 'vitest'
import { openLinkTarget } from './piece-campaign'

/** I68.13 (ADR-0132 d.8): an old Deliverables link forwards to the piece's panel, or keeps the window for ad-hoc work. */
describe('openLinkTarget', () => {
  it('forwards a campaign deliverable to its piece on the campaign page, the task carried', () => {
    expect(openLinkTarget('d1', 't1', 'c1')).toEqual({ kind: 'forward', href: '/campaigns/c1?piece=d1&task=t1' })
    expect(openLinkTarget('d1', null, 'c1')).toEqual({ kind: 'forward', href: '/campaigns/c1?piece=d1' })
  })
  it('keeps ad-hoc work — no campaign — in this page\'s window', () => {
    expect(openLinkTarget('d1', null, null)).toEqual({ kind: 'adhoc' })
  })
  it('waits while the campaign is being looked up, and does nothing without a deliverable', () => {
    expect(openLinkTarget('d1', null, undefined)).toEqual({ kind: 'wait' })
    expect(openLinkTarget(null, 't1', 'c1')).toEqual({ kind: 'none' })
  })
})
