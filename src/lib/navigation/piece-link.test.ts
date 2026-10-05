import { describe, expect, it } from 'vitest'
import { pieceHref, taskClickHref } from './piece-link'

/** ADR-0132 d.6/d.8 (I68.8, I68.10): one address for a deliverable opened for editing. */
describe('piece links', () => {
  it('opens the campaign page with the piece, and the task when named', () => {
    expect(pieceHref('c1', 'd1')).toBe('/campaigns/c1?piece=d1')
    expect(pieceHref('c1', 'd1', 't1')).toBe('/campaigns/c1?piece=d1&task=t1')
  })

  it('looks the campaign up when it is not known', () => {
    expect(pieceHref(null, 'd1')).toBe('/campaigns/piece/d1')
    expect(pieceHref(undefined, 'd1', 't1')).toBe('/campaigns/piece/d1?task=t1')
  })

  it('sends someone who may edit the piece to the campaign page, the maker to the task page', () => {
    const task = { id: 't1', deliverableId: 'd1', campaignId: 'c1' }
    expect(taskClickHref(task, true)).toBe('/campaigns/c1?piece=d1&task=t1')
    expect(taskClickHref(task, false)).toBe('/my-work/task/t1')
  })
})
