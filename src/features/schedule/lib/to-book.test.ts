import { describe, expect, it } from 'vitest'
import { campaignOptions, clientOptions, dueBucket, filterToBook, NO_FILTER, orderToBook, piecesInReach, waitingFor, type ToBookPiece } from './to-book'

const piece = (over: Partial<ToBookPiece>): ToBookPiece => ({
  deliverableId: 'd', name: 'Piece', code: null, campaignId: 'c1', campaignName: 'LUMA S2', clientId: 'k1', clientName: 'LUMA',
  dueAt: null, waitingSince: '2026-09-28T08:00:00Z', hours: 4, tasks: [], ...over,
})

describe('orderToBook (I74.21)', () => {
  it('puts the longest wait first, then the earlier due date', () => {
    const list = orderToBook([
      piece({ deliverableId: 'b', waitingSince: '2026-09-28T10:00:00Z' }),
      piece({ deliverableId: 'a', waitingSince: '2026-09-28T07:00:00Z' }),
      piece({ deliverableId: 'c', waitingSince: '2026-09-28T10:00:00Z', dueAt: '2026-09-29T15:00:00Z' }),
    ])
    expect(list.map((p) => p.deliverableId)).toEqual(['a', 'c', 'b'])
  })
})

describe('filterToBook', () => {
  const list = [
    piece({ deliverableId: 'p1', name: 'Post 2 — the payment-chime carousel', code: 'DA-003', clientId: 'luma', clientName: 'LUMA' }),
    piece({ deliverableId: 'p2', name: 'Digital banner ×3', code: 'DB-011', campaignId: 'c2', campaignName: 'Miles & Smiles Offer', clientId: 'ms', clientName: 'Miles & Smiles' }),
  ]
  it('searches the name, the code, the campaign and the client', () => {
    expect(filterToBook(list, { ...NO_FILTER, query: 'da-003' }, '2026-09-28').map((p) => p.deliverableId)).toEqual(['p1'])
    expect(filterToBook(list, { ...NO_FILTER, query: 'offer' }, '2026-09-28').map((p) => p.deliverableId)).toEqual(['p2'])
    expect(filterToBook(list, { ...NO_FILTER, query: 'miles' }, '2026-09-28').map((p) => p.deliverableId)).toEqual(['p2'])
  })
  it('narrows by client and campaign', () => {
    expect(filterToBook(list, { ...NO_FILTER, clientId: 'luma' }, '2026-09-28')).toHaveLength(1)
    expect(filterToBook(list, { ...NO_FILTER, campaignId: 'c2' }, '2026-09-28')).toHaveLength(1)
  })
  it('narrows by when it is due', () => {
    const due = [piece({ deliverableId: 'late', dueAt: '2026-09-26T15:00:00Z' }), piece({ deliverableId: 'thu', dueAt: '2026-10-01T15:00:00Z' }), piece({ deliverableId: 'next', dueAt: '2026-10-06T15:00:00Z' })]
    expect(filterToBook(due, { ...NO_FILTER, due: 'overdue' }, '2026-09-28').map((p) => p.deliverableId)).toEqual(['late'])
    expect(filterToBook(due, { ...NO_FILTER, due: 'thisWeek' }, '2026-09-28').map((p) => p.deliverableId)).toEqual(['thu'])
    expect(filterToBook(due, { ...NO_FILTER, due: 'nextWeek' }, '2026-09-28').map((p) => p.deliverableId)).toEqual(['next'])
  })
})

describe('dueBucket', () => {
  it('reads the due moment as an Iraq day', () => {
    // 22:30 UTC on the 30th is 01:30 on 1 Oct in Baghdad.
    expect(dueBucket('2026-09-30T22:30:00Z', '2026-10-01')).toBe('thisWeek')
    expect(dueBucket(null, '2026-10-01')).toBe('none')
  })
})

describe('client and campaign menus', () => {
  const list = [
    piece({ clientId: 'kite', clientName: 'Kite', campaignId: 'a' }),
    piece({ clientId: 'kite', clientName: 'Kite', campaignId: 'b', campaignName: 'B' }),
    piece({ clientId: 'gini', clientName: 'Gini', campaignId: 'g' }),
  ]
  it('counts pieces per client, most first', () => {
    expect(clientOptions(list)).toEqual([{ id: 'kite', name: 'Kite', count: 2 }, { id: 'gini', name: 'Gini', count: 1 }])
  })
  it('offers the chosen client\'s campaigns only', () => {
    expect(campaignOptions(list, 'kite').map((o) => o.id).sort()).toEqual(['a', 'b'])
  })
})

describe('piecesInReach — "Only your team\'s pieces"', () => {
  const list = [
    piece({ deliverableId: 'mine', tasks: [{ id: 't1', departmentId: 'cr', teamId: 'design', hours: 2 }] }),
    piece({ deliverableId: 'dept', tasks: [{ id: 't2', departmentId: 'cr', teamId: null, hours: 2 }] }),
    piece({ deliverableId: 'other', tasks: [{ id: 't3', departmentId: 'cr', teamId: 'motion', hours: 2 }] }),
  ]
  it('a team lead sees her team\'s, and the department\'s unplaced work', () => {
    expect(piecesInReach(list, { kind: 'team', teamId: 'design', departmentId: 'cr' }).map((p) => p.deliverableId)).toEqual(['mine', 'dept'])
  })
  it('a department lead sees the department', () => {
    expect(piecesInReach(list, { kind: 'department', departmentId: 'cr' })).toHaveLength(3)
  })
})

describe('waitingFor', () => {
  const now = Date.parse('2026-09-28T12:00:00Z')
  it('minutes, then hours, then days', () => {
    expect(waitingFor('2026-09-28T11:20:00Z', now)).toEqual({ unit: 'min', n: 40 })
    expect(waitingFor('2026-09-28T07:00:00Z', now)).toEqual({ unit: 'h', n: 5 })
    expect(waitingFor('2026-09-25T12:00:00Z', now)).toEqual({ unit: 'd', n: 3 })
  })
})
