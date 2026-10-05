import { describe, expect, it } from 'vitest'
import { hasSeqGap, mergeMessages, type ChatMessage } from './merge-messages'

const m = (o: Partial<ChatMessage> & { id: string }): ChatMessage => ({
  seq: null, senderId: 'u1', senderName: 'Ann', body: 'x', createdAt: '2026-08-18T10:00:00Z', status: 'sent', ...o,
})

describe('mergeMessages (ADR-0015 apply-path)', () => {
  it('orders confirmed messages by seq', () => {
    const out = mergeMessages([], [m({ id: 'b', seq: 2 }), m({ id: 'a', seq: 1 })])
    expect(out.map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('a server-confirmed echo replaces the pending copy (same id) and takes its seq slot', () => {
    const pending = m({ id: 'p', seq: null, status: 'pending', createdAt: '2026-08-18T10:05:00Z' })
    const confirmed = m({ id: 'p', seq: 3, status: 'sent' })
    const withExisting = mergeMessages([m({ id: 'a', seq: 1 }), pending], [confirmed])
    expect(withExisting.map((x) => x.id)).toEqual(['a', 'p'])
    expect(withExisting.find((x) => x.id === 'p')!.seq).toBe(3)
    expect(withExisting.find((x) => x.id === 'p')!.status).toBe('sent')
  })

  it('pending messages sort after all confirmed ones', () => {
    const out = mergeMessages([m({ id: 'a', seq: 1 })], [m({ id: 'p', seq: null, status: 'pending' })])
    expect(out.map((x) => x.id)).toEqual(['a', 'p'])
  })

  it('dedupes a message delivered twice (broadcast + catch-up) by id', () => {
    const dup = m({ id: 'a', seq: 1 })
    expect(mergeMessages([dup], [dup]).length).toBe(1)
  })

  it('detects a seq gap that needs a catch-up refetch', () => {
    const have = [m({ id: 'a', seq: 4 })]
    expect(hasSeqGap(have, 5)).toBe(false) // contiguous
    expect(hasSeqGap(have, 7)).toBe(true) // missed 5,6
  })
})
