// ADR-0134 (I72) — asset-url's input and its key fence.
import { describe, expect, it } from 'vitest'
import { Input, MAX_UPLOAD_BYTES, isOffline, objectKeyFor, parseKey, thumbKeyOf } from './lib.ts'

const T = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b'
const C = '7a1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b'
const F = '8b1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b'

describe('asset-url input', () => {
  it('takes every op the Library uses', () => {
    for (const body of [
      { op: 'upload', folderId: F, fileName: 'a.pdf', size: 10 },
      { op: 'upload', folderId: F, fileName: 'a.pdf' },
      { op: 'multipart_create', folderId: F, fileName: 'a.mov', contentType: 'video/quicktime', size: MAX_UPLOAD_BYTES },
      { op: 'multipart_sign', objectKey: 'k', uploadId: 'u', partNumbers: [1, 2, 3] },
      { op: 'multipart_complete', objectKey: 'k', uploadId: 'u', parts: [{ partNumber: 1, etag: '"e"' }] },
      { op: 'multipart_abort', objectKey: 'k', uploadId: 'u' },
      { op: 'thumb_upload', objectKey: 'k' },
      { op: 'thumb_url', assetId: F },
      { op: 'download', assetId: F, version: 2 },
      { op: 'preview', assetId: F },
      { op: 'copy', assetId: F, folderId: F },
    ]) expect(Input.safeParse(body).success, JSON.stringify(body)).toBe(true)
  })

  it('refuses what is malformed', () => {
    for (const body of [
      { op: 'nope' },
      { op: 'upload', folderId: 'not-an-id', fileName: 'a.pdf' },
      { op: 'upload', folderId: F, fileName: '' },
      { op: 'multipart_create', folderId: F, fileName: 'a', size: -1 },
      { op: 'multipart_create', folderId: F, fileName: 'a' },
      { op: 'multipart_sign', objectKey: 'k', uploadId: 'u', partNumbers: [0] },
      { op: 'multipart_sign', objectKey: 'k', uploadId: 'u', partNumbers: [10_001] },
      { op: 'multipart_sign', objectKey: 'k', uploadId: 'u', partNumbers: Array.from({ length: 101 }, (_, i) => i + 1) },
      { op: 'download', assetId: F, version: 0 },
    ]) expect(Input.safeParse(body).success, JSON.stringify(body)).toBe(false)
  })
})

describe('object keys', () => {
  it('are keyed on tenant, client and folder, never the raw filename', () => {
    const key = objectKeyFor(T, C, F, 'Brief v2 (final).pdf', 'u-u-i-d')
    expect(key).toBe(`${T}/${C}/${F}/u-u-i-d-Brief_v2_final_.pdf`)
    expect(thumbKeyOf(key)).toBe(`${key}.thumb.webp`)
  })

  it('parse back to their tenant and client — and nothing else parses', () => {
    expect(parseKey(`${T}/${C}/${F}/abc-x.pdf`)).toEqual({ tenantId: T, clientId: C, folderId: F })
    expect(parseKey(`${T}/${C}/x.pdf`)).toBeNull()
    expect(parseKey(`${T}/${C}/${F}/../../other/x.pdf`)).toBeNull()
    expect(parseKey(`${T}/${C}/${F}/abc-x.pdf.thumb.webp`)).toBeNull()
    expect(parseKey(`archive/${T}/${C}/${F}/x.pdf`)).toBeNull()
  })
})

describe('archived versions', () => {
  const now = new Date('2026-10-01T09:00:00Z')
  it('are offline unless brought back and still within their 30 days', () => {
    expect(isOffline(null, null, now)).toBe(false)
    expect(isOffline('2026-09-01T00:00:00Z', null, now)).toBe(true)
    expect(isOffline('2026-09-01T00:00:00Z', '2026-10-20T00:00:00Z', now)).toBe(false)
    expect(isOffline('2026-09-01T00:00:00Z', '2026-09-30T00:00:00Z', now)).toBe(true)
  })
})
