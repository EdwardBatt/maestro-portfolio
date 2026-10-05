import { describe, expect, it } from 'vitest'
import { IN_CHUNK, inChunks } from './in-chunks'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('inChunks', () => {
  it('asks nothing for an empty list', async () => {
    let calls = 0
    const rows = await inChunks([], async () => { calls++; return { data: [], error: null } })
    expect(rows).toEqual([])
    expect(calls).toBe(0)
  })

  it('sends at most IN_CHUNK ids per read and joins the rows in batch order', async () => {
    const ids = Array.from({ length: 230 }, (_, i) => id(i))
    const sizes: number[] = []
    const rows = await inChunks<{ sub_task_id: string }>(ids, async (chunk) => {
      sizes.push(chunk.length)
      return { data: chunk.map((c) => ({ sub_task_id: c })), error: null }
    })
    expect(sizes).toEqual([IN_CHUNK, IN_CHUNK, 30])
    expect(rows.map((r) => r.sub_task_id)).toEqual(ids)
  })

  it('never asks for the same id twice', async () => {
    const seen: string[] = []
    await inChunks([id(1), id(2), id(1)], async (chunk) => { seen.push(...chunk); return { data: [], error: null } })
    expect(seen).toEqual([id(1), id(2)])
  })

  it('throws the first batch error, as one read would', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => id(i))
    await expect(
      inChunks(ids, async (chunk) => (chunk.length === 50 ? { data: null, error: new Error('boom') } : { data: [], error: null })),
    ).rejects.toThrow('boom')
  })
})
