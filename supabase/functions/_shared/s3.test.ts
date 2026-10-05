// ADR-0134 d.13 — the multipart XML and the half-finished-upload listing.
import { describe, expect, it } from 'vitest'
import {
  completeMultipartXml, encodeKey, objectUrl, parseListMultipartUploads, parseUploadId, quoteEtag, s3ErrorCode,
  staleUploads,
} from './s3.ts'

describe('s3 helpers', () => {
  it('encodes each key segment and keeps the slashes', () => {
    expect(encodeKey('t/c/f/a b+c.pdf')).toBe('t/c/f/a%20b%2Bc.pdf')
    expect(objectUrl('https://s3.x.test/', 'bkt', 't/c/f/x.png', { uploads: '' }).toString())
      .toBe('https://s3.x.test/bkt/t/c/f/x.png?uploads=')
  })

  it('reads the UploadId, and an error body even on a 200', () => {
    expect(parseUploadId('<InitiateMultipartUploadResult><Bucket>b</Bucket><UploadId>4_z123&amp;x</UploadId></InitiateMultipartUploadResult>'))
      .toBe('4_z123&x')
    expect(parseUploadId('<Error><Code>AccessDenied</Code></Error>')).toBeNull()
    expect(s3ErrorCode('<Error><Code>InternalError</Code></Error>')).toBe('InternalError')
    expect(s3ErrorCode('<CompleteMultipartUploadResult/>')).toBeNull()
  })

  it('quotes ETags the way S3 compares them, whatever the browser read', () => {
    expect(quoteEtag('abc')).toBe('"abc"')
    expect(quoteEtag('"abc"')).toBe('"abc"')
  })

  it('lists every part in order in the completion body', () => {
    const xml = completeMultipartXml([{ partNumber: 2, etag: '"b"' }, { partNumber: 1, etag: 'a' }])
    expect(xml.indexOf('<PartNumber>1</PartNumber>')).toBeLessThan(xml.indexOf('<PartNumber>2</PartNumber>'))
    expect(xml).toContain('<ETag>&quot;a&quot;</ETag>')
  })

  it('finds the uploads older than 24 hours, and only those', () => {
    const page = parseListMultipartUploads(`<ListMultipartUploadsResult>
      <IsTruncated>true</IsTruncated><NextKeyMarker>k2</NextKeyMarker><NextUploadIdMarker>u2</NextUploadIdMarker>
      <Upload><Key>k1</Key><UploadId>u1</UploadId><Initiated>2026-09-29T08:00:00.000Z</Initiated></Upload>
      <Upload><Key>k2</Key><UploadId>u2</UploadId><Initiated>2026-09-30T20:00:00.000Z</Initiated></Upload>
    </ListMultipartUploadsResult>`)
    expect(page.uploads).toHaveLength(2)
    expect(page.truncated).toBe(true)
    expect(page.nextKeyMarker).toBe('k2')
    const stale = staleUploads(page.uploads, new Date('2026-10-01T09:00:00Z'))
    expect(stale.map((u) => u.uploadId)).toEqual(['u1'])
  })
})
