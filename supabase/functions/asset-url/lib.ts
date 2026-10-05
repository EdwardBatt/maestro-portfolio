// asset-url's input and its object-key rules, apart from the handler so Vitest can reach them (lib.test.ts).
import { z } from 'npm:zod@4'

/** ADR-0134 d.11: a file over 5 GB is refused — "too big — share a link instead". */
export const MAX_UPLOAD_BYTES = 5 * 1024 ** 3

/** S3 allows 10,000 parts; one sign call covers a window of them, never all at once. */
export const MAX_PARTS_PER_SIGN = 100

const id = z.guid()
const fileName = z.string().trim().min(1).max(255)
const contentType = z.string().trim().max(255).optional()
const size = z.number().int().nonnegative()
const objectKey = z.string().min(1).max(1024)
const uploadId = z.string().min(1).max(1024)
const partNumber = z.number().int().min(1).max(10_000)

export const Input = z.discriminatedUnion('op', [
  // `size` is optional only so the uploader already deployed keeps working until it sends it; when it is
  // sent, over 5 GB is refused. Every new caller sends it.
  z.object({ op: z.literal('upload'), folderId: id, fileName, contentType, size: size.optional() }),
  z.object({ op: z.literal('multipart_create'), folderId: id, fileName, contentType, size }),
  z.object({
    op: z.literal('multipart_sign'), objectKey, uploadId,
    partNumbers: z.array(partNumber).min(1).max(MAX_PARTS_PER_SIGN),
  }),
  z.object({
    op: z.literal('multipart_complete'), objectKey, uploadId,
    parts: z.array(z.object({ partNumber, etag: z.string().min(1).max(200) })).min(1).max(10_000),
  }),
  z.object({ op: z.literal('multipart_abort'), objectKey, uploadId }),
  z.object({ op: z.literal('thumb_upload'), objectKey }),
  z.object({ op: z.literal('thumb_url'), assetId: id }),
  z.object({ op: z.literal('download'), assetId: id, version: z.number().int().min(1).optional() }),
  z.object({ op: z.literal('preview'), assetId: id }),
  z.object({ op: z.literal('copy'), assetId: id, folderId: id }),
])
export type InputT = z.infer<typeof Input>

/** The stored name of an upload: safe, short, and never the person's raw filename. */
export function sanitize(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').slice(0, 180) || 'file'
}

/** `<tenant>/<client>/<folder>/<uuid>-<name>` — keyed on the hierarchy (design §8.4). */
export function objectKeyFor(tenantId: string, clientId: string, folderId: string, name: string, uuid: string): string {
  return `${tenantId}/${clientId}/${folderId}/${uuid}-${sanitize(name)}`
}

/** Where a file's small picture lives: beside it (ADR-0134 d.26). */
export const thumbKeyOf = (key: string) => `${key}.thumb.webp`

const GUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
const KEY = new RegExp(`^(${GUID})/(${GUID})/(${GUID})/([^/]+)$`)

/**
 * The tenant and client an upload key belongs to — or null for anything that is not one this function
 * minted. A key from the browser is hostile: this is what fences a part-sign, a completion, an abort or a
 * thumbnail to the caller's own tenant and a client within their reach.
 */
export function parseKey(key: string): { tenantId: string; clientId: string; folderId: string } | null {
  if (key.includes('..') || key.endsWith('.thumb.webp')) return null
  const m = KEY.exec(key)
  return m ? { tenantId: m[1]!.toLowerCase(), clientId: m[2]!.toLowerCase(), folderId: m[3]!.toLowerCase() } : null
}

/** Is this asset version offline — archived to the office server and not brought back (ADR-0136 d.4)? */
export function isOffline(versionArchivedAt: string | null, broughtBackUntil: string | null, now: Date): boolean {
  if (!versionArchivedAt) return false
  return !(broughtBackUntil && Date.parse(broughtBackUntil) > now.getTime())
}
