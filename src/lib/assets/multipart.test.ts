import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PART_SIZE,
  RESUME_TTL_MS,
  partCount,
  pendingParts,
  readResume,
  resumeKey,
  runParts,
  sweepExpiredResumes,
  writeResume,
  type PartTransport,
} from './multipart'

/** A blob that reports a size without holding the bytes: `slice` only has to give a range back. */
function fakeFile(size: number): Blob & { size: number } {
  return {
    size,
    slice: () => new Blob(['x']),
  } as unknown as Blob & { size: number }
}

function transport(overrides: Partial<PartTransport> = {}): PartTransport & { signed: number[]; sent: number[] } {
  const signed: number[] = []
  const sent: number[] = []
  return {
    signed,
    sent,
    sign: async (ns) => { signed.push(...ns); return new Map(ns.map((n) => [n, `https://b2/part/${n}`])) },
    put: async (url) => { const n = Number(url.split('/').pop()); sent.push(n); return `"etag-${n}"` },
    sleep: async () => undefined,
    ...overrides,
  }
}

afterEach(() => localStorage.clear())

describe('multipart: big files go in parts and resume (ADR-0134 d.13)', () => {
  it('splits into 8 MB parts', () => {
    expect(partCount(1)).toBe(1)
    expect(partCount(PART_SIZE)).toBe(1)
    expect(partCount(PART_SIZE * 3 + 1)).toBe(4)
    expect(pendingParts(4, [{ partNumber: 2, etag: 'x' }])).toEqual([1, 3, 4])
  })

  it('a resumed upload sends only the parts not already sent, and returns every part in order', async () => {
    const t = transport()
    const done: number[] = []
    const parts = await runParts({
      file: fakeFile(PART_SIZE * 4 + 10), // 5 parts
      completed: [{ partNumber: 1, etag: '"a"' }, { partNumber: 3, etag: '"c"' }],
      transport: t,
      signal: new AbortController().signal,
      onPartDone: (p) => done.push(p.partNumber),
      onProgress: () => undefined,
    })
    expect(t.sent.sort()).toEqual([2, 4, 5])
    expect(done.sort()).toEqual([2, 4, 5])
    expect(parts.map((p) => p.partNumber)).toEqual([1, 2, 3, 4, 5])
    expect(parts[0]!.etag).toBe('"a"')
  })

  it('a failed part is retried with a growing wait, then the run stops (the record keeps what landed)', async () => {
    const waits: number[] = []
    let calls = 0
    const t = transport({
      put: async () => { calls++; throw new Error('network') },
      sleep: async (ms) => { waits.push(ms) },
    })
    await expect(
      runParts({ file: fakeFile(10), completed: [], transport: t, signal: new AbortController().signal, onPartDone: vi.fn(), onProgress: vi.fn() }),
    ).rejects.toThrow('network')
    expect(waits).toEqual([1000, 2000, 4000, 8000])
    expect(calls).toBe(5)
  })

  it('a part that fails once and then lands is kept', async () => {
    let first = true
    const t = transport({ put: async () => { if (first) { first = false; throw new Error('drop') } return '"ok"' } })
    const parts = await runParts({ file: fakeFile(10), completed: [], transport: t, signal: new AbortController().signal, onPartDone: vi.fn(), onProgress: vi.fn() })
    expect(parts).toEqual([{ partNumber: 1, etag: '"ok"' }])
  })
})

describe('multipart: the 24-hour memory', () => {
  const file = { name: 'film.mov', size: 900, lastModified: 42 }
  const key = resumeKey('folder-1', file)

  it('is keyed by folder, name, size and last-modified', () => {
    expect(key).toContain('folder-1|film.mov|900|42')
    expect(resumeKey('folder-2', file)).not.toBe(key)
    expect(resumeKey('folder-1', { ...file, lastModified: 43 })).not.toBe(key)
  })

  it('is read back within 24 hours', () => {
    const now = Date.now()
    writeResume(key, { uploadId: 'U', objectKey: 'K', parts: [{ partNumber: 1, etag: '"e"' }], startedAt: now - RESUME_TTL_MS + 60_000 })
    expect(readResume(key, now)?.parts).toEqual([{ partNumber: 1, etag: '"e"' }])
  })

  it('is discarded after 24 hours', () => {
    const now = Date.now()
    writeResume(key, { uploadId: 'U', objectKey: 'K', parts: [], startedAt: now - RESUME_TTL_MS - 1 })
    expect(readResume(key, now)).toBeNull()
    expect(localStorage.getItem(key)).toBeNull()
  })

  it('the sweep drops only the expired records', () => {
    const now = Date.now()
    const fresh = resumeKey('f', { name: 'a', size: 1, lastModified: 1 })
    writeResume(key, { uploadId: 'U', objectKey: 'K', parts: [], startedAt: now - RESUME_TTL_MS - 1 })
    writeResume(fresh, { uploadId: 'V', objectKey: 'L', parts: [], startedAt: now })
    localStorage.setItem('unrelated', 'keep')
    sweepExpiredResumes(now)
    expect(localStorage.getItem(key)).toBeNull()
    expect(localStorage.getItem(fresh)).not.toBeNull()
    expect(localStorage.getItem('unrelated')).toBe('keep')
  })
})
