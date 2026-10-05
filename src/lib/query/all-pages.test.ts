import { describe, expect, it } from 'vitest'
import { IN_CHUNK } from './in-chunks'
import { PAGE_ROWS, allRows, inChunksPaged, restPages } from './all-pages'

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

describe('restPages', () => {
  it('reads every page after the first — the 2,154 conversations of 25 Sep are all there', async () => {
    const s = server(2154)
    const rest = await restPages<{ i: number }>(2154, s.read)
    expect(rest).toHaveLength(2154 - PAGE_ROWS)
    expect(rest[0]).toEqual({ i: 1000 })
    expect(rest.at(-1)).toEqual({ i: 2153 })
    expect(s.asked).toEqual([[1000, 1999], [2000, 2999]])
  })

  it('asks for nothing when the first page held everything', async () => {
    for (const total of [0, 12, PAGE_ROWS]) {
      const s = server(total)
      expect(await restPages(total, s.read)).toEqual([])
      expect(s.asked).toHaveLength(0)
    }
  })

  it('throws what the server refused with, rather than returning part of the list', async () => {
    const boom = new Error('permission denied')
    await expect(restPages(1500, async () => ({ data: null, error: boom }))).rejects.toBe(boom)
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
    await expect(allRows(async () => ({ data: null, error: boom }))).rejects.toBe(boom)
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
