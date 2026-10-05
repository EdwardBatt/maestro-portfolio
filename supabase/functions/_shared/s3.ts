// The small pieces of Backblaze B2's S3-compatible API the Library uses (ADR-0022, ADR-0134 d.13) that are
// not a single presigned URL: object addresses, the multipart XML, and the listing of half-finished uploads.
//
// Pure functions only — no fetch, no credentials — so Vitest can reach them (`s3.test.ts`). The signing is
// aws4fetch's, in the callers (`asset-url`, `library-sweep`, `library-archive`).
//
// The XML is read with narrow regular expressions on purpose: the responses are tiny, machine-written and
// fixed in shape, and an XML parser would be a new dependency for three elements.

/** Each path segment encoded, the slashes kept — the form an S3 object URL needs. */
export function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}

/** `https://<endpoint>/<bucket>/<key>`, with optional query parameters (set BEFORE signing). */
export function objectUrl(endpoint: string, bucket: string, key: string, query: Record<string, string> = {}): URL {
  const u = new URL(`${endpoint.replace(/\/$/, '')}/${bucket}/${encodeKey(key)}`)
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v)
  return u
}

const unescapeXml = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)
  return m ? unescapeXml(m[1]!.trim()) : null
}

/** S3 can answer 200 with an `<Error>` body (CopyObject, CompleteMultipartUpload). */
export function s3ErrorCode(xml: string): string | null {
  return /<Error>/.test(xml) ? (tag(xml, 'Code') ?? 'UnknownError') : null
}

/** `InitiateMultipartUploadResult` → its UploadId. */
export function parseUploadId(xml: string): string | null {
  return tag(xml, 'UploadId')
}

/** An ETag as the browser read it — quoted or not — in the quoted form S3 compares. */
export function quoteEtag(etag: string): string {
  return `"${etag.trim().replace(/^"+|"+$/g, '')}"`
}

/** The `CompleteMultipartUpload` body: every part, in part-number order. */
export function completeMultipartXml(parts: { partNumber: number; etag: string }[]): string {
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber)
  const body = sorted
    .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${escapeXml(quoteEtag(p.etag))}</ETag></Part>`)
    .join('')
  return `<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${body}</CompleteMultipartUpload>`
}

export interface PendingUpload {
  key: string
  uploadId: string
  initiated: string
}

/** `ListMultipartUploadsResult` → each half-finished upload, and where the next page starts. */
export function parseListMultipartUploads(xml: string): {
  uploads: PendingUpload[]
  nextKeyMarker: string | null
  nextUploadIdMarker: string | null
  truncated: boolean
} {
  const uploads: PendingUpload[] = []
  for (const m of xml.matchAll(/<Upload>([\s\S]*?)<\/Upload>/g)) {
    const block = m[1]!
    const key = tag(block, 'Key')
    const uploadId = tag(block, 'UploadId')
    const initiated = tag(block, 'Initiated')
    if (key && uploadId && initiated) uploads.push({ key, uploadId, initiated })
  }
  return {
    uploads,
    nextKeyMarker: tag(xml, 'NextKeyMarker'),
    nextUploadIdMarker: tag(xml, 'NextUploadIdMarker'),
    truncated: tag(xml, 'IsTruncated') === 'true',
  }
}

/** Uploads begun more than `hours` before `now` — the ones ADR-0134 d.13 clears. */
export function staleUploads(uploads: PendingUpload[], now: Date, hours = 24): PendingUpload[] {
  const cutoff = now.getTime() - hours * 3600_000
  return uploads.filter((u) => {
    const t = Date.parse(u.initiated)
    return Number.isFinite(t) && t < cutoff
  })
}
