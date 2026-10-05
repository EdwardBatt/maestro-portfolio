import { describe, expect, it } from 'vitest'
import { groupHandoverItems, toItem, toLeaving, toResult, type HandoverItem } from './handover-api'

/** ADR-0133 (I70): reading what the database returns for a leaving person's hand-over. */
describe('handover-api (ADR-0133)', () => {
  it('reads an item, filling what is missing', () => {
    expect(toItem({ kind: 'task', item_id: 't1', label: 'Design 206', context: 'Poster 206', detail: { status: 'todo' } }))
      .toEqual({ kind: 'task', itemId: 't1', label: 'Design 206', context: 'Poster 206', detail: { status: 'todo' } })
    expect(toItem({ kind: 'client', item_id: 'c1', label: 'Kite Card', context: null, detail: null }).detail).toEqual({})
  })

  it('reads a leaving person with what is left', () => {
    const p = toLeaving({
      user_id: 'u1', name: 'Mira Adel Mansour', department: 'Client Services', leaving_since: '2026-09-30T10:00:00Z',
      started_by_name: 'Edward', items_remaining: 14, items: { client: 2, campaign: 12 },
    })
    expect(p.itemsRemaining).toBe(14)
    expect(p.items.campaign).toBe(12)
    expect(toLeaving({ user_id: 'u2', name: 'X', department: null, leaving_since: 'x', started_by_name: null,
      items_remaining: 0, items: null }).items).toEqual({})
  })

  it('reads the hand-over result — completed and whether the task needs re-booking', () => {
    expect(toResult({ kind: 'task', item_id: 't1', to: 'u9', outcome: 'assigned', reschedule_needed: true, completed: true }))
      .toEqual({ kind: 'task', itemId: 't1', to: 'u9', outcome: 'assigned', rescheduleNeeded: true, completed: true })
  })

  it("groups in the list's order, only the groups that apply (d.3)", () => {
    const items: HandoverItem[] = [
      { kind: 'review', itemId: 'r1', label: 'Resize', context: null, detail: {} },
      { kind: 'client', itemId: 'c1', label: 'Kite Card', context: null, detail: {} },
      { kind: 'task', itemId: 't1', label: 'Design', context: null, detail: {} },
      { kind: 'task', itemId: 't2', label: 'Copy', context: null, detail: {} },
    ]
    expect(groupHandoverItems(items).map((g) => [g.kind, g.items.length])).toEqual([['client', 1], ['task', 2], ['review', 1]])
    expect(groupHandoverItems([])).toEqual([])
  })
})
