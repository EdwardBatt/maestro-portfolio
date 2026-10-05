import { describe, expect, it } from 'vitest'
import { IN_CHUNK, PAGE_ROWS, allRows, allRowsResult, inChunks, inChunksPaged } from './all-pages.ts'

/** A server that holds `total` rows and, like PostgREST, answers at most PAGE_ROWS per request. */
function server(total: number) {
  const asked: [number, number][] = []
  const read = async (from: number, to: number) => {
    asked.push([from, to])
    const rows = []
    for (let i = from; i <= Math.min(to, from + PAGE_ROWS - 1, total - 1); i++) rows.push({ i })
    return { data: rows, error: null }
  }
  return { read, asked }
}

describe('the functions keep the frontend page size', () => {
  it('pages at PostgREST max_rows (1000) and batches ids by 100', () => {
    expect(PAGE_ROWS).toBe(1000)
    expect(IN_CHUNK).toBe(100)
  })
})

describe('allRows', () => {
  it('keeps reading until a page comes back short — 2,154 rows are 2,154 rows', async () => {
    const s = server(2154)
    const rows = await allRows<{ i: number }>(s.read)
    expect(rows).toHaveLength(2154)
    expect(rows.at(-1)).toEqual({ i: 2153 })
    expect(s.asked).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })

  it('asks once when the list is short, and once more when it is exactly a page', async () => {
    const short = server(12)
    expect(await allRows(short.read)).toHaveLength(12)
    expect(short.asked).toHaveLength(1)
    const full = server(PAGE_ROWS)
    expect(await allRows(full.read)).toHaveLength(PAGE_ROWS)
    expect(full.asked).toEqual([[0, 999], [1000, 1999]])
  })

  it('throws what the server refused with, rather than returning part of the list', async () => {
    const boom = new Error('permission denied')
    let n = 0
    const read = async (from: number) => (n++ === 0 ? { data: Array.from({ length: PAGE_ROWS }, (_, i) => ({ i: from + i })), error: null } : { data: null, error: boom })
    await expect(allRows(read)).rejects.toBe(boom)
  })
})

describe('allRowsResult', () => {
  it('returns every row in the envelope', async () => {
    const r = await allRowsResult<{ i: number }>(server(1500).read)
    expect(r.error).toBeNull()
    expect(r.data).toHaveLength(1500)
  })

  it('returns the error in the envelope instead of throwing', async () => {
    const boom = { message: 'nope' }
    const r = await allRowsResult(async () => ({ data: null, error: boom }))
    expect(r).toEqual({ data: null, error: boom })
  })
})

describe('inChunks', () => {
  it('splits a long id list into batches of 100 and drops duplicates', async () => {
    const ids = [...Array.from({ length: 230 }, (_, i) => `id${i}`), 'id0', 'id1']
    const sizes: number[] = []
    const rows = await inChunks<string>(ids, async (chunk) => {
      sizes.push(chunk.length)
      return { data: chunk, error: null }
    })
    expect(sizes).toEqual([100, 100, 30])
    expect(rows).toHaveLength(230)
  })

  it('asks for nothing when there are no ids', async () => {
    let asked = 0
    expect(await inChunks([], async () => (asked++, { data: [], error: null }))).toEqual([])
    expect(asked).toBe(0)
  })
})

describe('inChunksPaged', () => {
  it('pages each batch of ids — a hundred parents with 1,500 children lose none', async () => {
    const ids = Array.from({ length: IN_CHUNK + 5 }, (_, i) => `p${i}`)
    const asked: string[] = []
    const rows = await inChunksPaged<{ n: number }>(ids, async (chunk, from, to) => {
      asked.push(`${chunk.length}@${from}`)
      const total = chunk.length === IN_CHUNK ? 1500 : 7
      const data = []
      for (let n = from; n <= Math.min(to, total - 1); n++) data.push({ n })
      return { data, error: null }
    })
    expect(rows).toHaveLength(1500 + 7)
    expect(asked.sort()).toEqual([`${IN_CHUNK}@0`, `${IN_CHUNK}@1000`, '5@0'].sort())
  })
})
