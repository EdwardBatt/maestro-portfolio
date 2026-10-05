import { describe, expect, it } from 'vitest'
import { taskDueAt, toPreview, toQuantityPreview } from './piece-edit-api'

describe('piece-edit-api (I68, ADR-0132)', () => {
  it('reads the preview the database returns, filling what is missing', () => {
    const p = toPreview({
      cancelled: [{ id: 't1', title: 'Resize — Campus', status: 'in_progress', assignee: 'Zubaida Jamil' }],
      kept: [],
      added: ['Storyboard — Campus', 'Animate — Campus'],
      approved_after: false,
      owner_id: 'u1',
    })
    expect(p.cancelled[0]?.assigneeName).toBe('Zubaida Jamil')
    expect(p.added).toHaveLength(2)
    expect(p.approvedAfter).toBe(false)
    expect(p.ownerId).toBe('u1')
    const empty = toPreview({ approved_after: true } as never)
    expect(empty).toEqual({ cancelled: [], kept: [], added: [], approvedAfter: true, ownerId: null })
  })

  it('puts a task due at 18:00 Iraq time on its day (15:00Z) — ADR-0076 d.3', () => {
    expect(taskDueAt('2026-10-10')).toBe('2026-10-10T15:00:00.000Z')
    expect(taskDueAt('2026-10-10T09:30:00.000Z')).toBe('2026-10-10T09:30:00.000Z')
  })

  it('reads the quantity preview — the units cancelled, with who has each, and those added', () => {
    const q = toQuantityPreview({
      cancelled: [{ id: 't2', title: 'Artwork — Posts 2', status: 'in_progress', assignee: 'Zubaida Jamil' }],
      added: [],
      approved_after: true,
    })
    expect(q.cancelled[0]?.assigneeName).toBe('Zubaida Jamil')
    expect(toQuantityPreview({})).toEqual({ cancelled: [], added: [], approvedAfter: false })
  })
})
