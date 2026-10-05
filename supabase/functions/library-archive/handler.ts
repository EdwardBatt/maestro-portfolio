import { z } from 'npm:zod@4'
import { officeRef, type OfficeTransport } from './transport.ts'

/**
 * library-archive's behaviour, with its runtime injected so Vitest can reach it. `index.ts` wires Deno.env,
 * the service-role client, B2 and the office adapter in.
 *
 * ADR-0136, per run:
 *   1. SEND (d.1–d.3) — for every tenant, what `app.library_archive_due` lists: read from B2, sent to the
 *      office server, then the server's own size and SHA-256 are read back and compared with what was sent.
 *      Only a confirmed copy is marked archived, and only then — and only when no row staying online still
 *      names the key — is the online object removed. Anything else stays online and is retried next run.
 *   2. BRING BACK (d.4) — each pending request: its archived versions are copied back to B2 at their keys;
 *      the file is online for 30 days and the requester is told (the database does both on `done`).
 *   3. RETURN OFFLINE (d.4) — a brought-back file whose 30 days are over has its online copy removed again;
 *      the office copy was confirmed when it was archived, so nothing is sent.
 *
 * SWITCHED OFF (d.7): without the office address and credential, or without an adapter for the service, it
 * answers `{ disabled: true }` and touches nothing. `{ "dryRun": true }` lists what is due either way.
 */

export const Input = z.object({
  dryRun: z.boolean().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
})

export const DueItem = z.object({
  item_type: z.enum(['asset_version', 'media_record']),
  item_id: z.string(),
  asset_id: z.string().nullable(),
  version: z.number().nullable(),
  object_key: z.string(),
  size_bytes: z.number().nullable(),
  campaign_id: z.string().nullable(),
}).passthrough()
export type DueItemT = z.infer<typeof DueItem>

export const PendingRequest = z.object({
  request_id: z.string(),
  tenant_id: z.string(),
  asset_id: z.string(),
  items: z.array(z.object({ object_key: z.string().nullable(), archive_ref: z.string().nullable() }).passthrough()),
}).passthrough()

export const ExpiredItem = z.object({ asset_id: z.string(), object_keys: z.array(z.string()) }).passthrough()

type Rpc = { data: unknown; error: { message: string } | null }

export interface LibraryArchiveDeps {
  cronSecret: string | undefined
  /** OFFICE_ARCHIVE_URL + credential present. */
  configured: boolean
  /** The office adapter, or null when none exists for the configured service. */
  transport: OfficeTransport | null
  tenants: () => Promise<string[]>
  dueItems: (tenantId: string, limit: number) => Promise<Rpc>
  mark: (itemType: string, itemId: string, ref: string) => Promise<{ removeOnline: boolean } | null>
  pending: (limit: number) => Promise<Rpc>
  bringBackDone: (requestId: string, ok: boolean, error?: string) => Promise<void>
  expired: (limit: number) => Promise<Rpc>
  clearBroughtBack: (assetId: string) => Promise<void>
  storage: {
    get: (key: string) => Promise<{ body: ReadableStream<Uint8Array>; size: number } | null>
    put: (key: string, body: ReadableStream<Uint8Array>, size: number) => Promise<boolean>
    remove: (key: string) => Promise<boolean>
  } | null
  /** Lower-case hex SHA-256 of a stream. */
  sha256: (body: ReadableStream<Uint8Array>) => Promise<string>
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const err = (status: number, code: string, message: string) => json(status, { error: { code, message } })

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ba = enc.encode(a)
  const bb = enc.encode(b)
  if (ba.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ba.length; i++) diff |= ba[i]! ^ bb[i]!
  return diff === 0
}

/** Send one object and confirm it (d.3). Resolves to the office ref when confirmed, else null. */
export async function sendConfirmed(
  deps: Pick<LibraryArchiveDeps, 'transport' | 'storage' | 'sha256'>,
  tenantId: string,
  item: DueItemT,
): Promise<string | null> {
  if (!deps.transport || !deps.storage) return null
  const src = await deps.storage.get(item.object_key)
  if (!src) return null
  const ref = officeRef(tenantId, item.object_key)
  const [toOffice, toHash] = src.body.tee()
  const [, sentHash] = await Promise.all([deps.transport.put(ref, toOffice, src.size), deps.sha256(toHash)])
  const held = await deps.transport.stat(ref)
  if (!held || held.size !== src.size || held.sha256.toLowerCase() !== sentHash.toLowerCase()) return null
  return ref
}

export function createLibraryArchiveHandler(deps: LibraryArchiveDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return err(405, 'method_not_allowed', 'POST only')
    const presented = req.headers.get('x-cron-secret') ?? ''
    if (!deps.cronSecret || !timingSafeEqual(presented, deps.cronSecret))
      return err(401, 'unauthenticated', 'Invalid or missing cron secret')

    const parsed = Input.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return err(400, 'bad_request', 'Invalid input')
    const dryRun = parsed.data.dryRun === true
    const limit = parsed.data.limit ?? 100

    const disabledReason = !deps.configured
      ? 'office_server_not_configured'
      : !deps.transport ? 'no_transport_adapter'
      : !deps.storage ? 'storage_unconfigured'
      : null

    if (disabledReason && !dryRun) return json(200, { disabled: true, reason: disabledReason })

    const tenants = await deps.tenants()
    const due: Record<string, DueItemT[]> = {}
    for (const t of tenants) {
      const r = await deps.dueItems(t, limit)
      if (r.error) return err(500, 'archive_failed', 'Could not read the due set')
      const items = z.array(DueItem).safeParse(r.data ?? [])
      if (!items.success) return err(500, 'archive_failed', 'Unexpected due-set result')
      due[t] = items.data
    }

    if (dryRun) {
      const pending = await deps.pending(limit)
      return json(200, {
        dryRun: true,
        disabled: disabledReason !== null,
        reason: disabledReason,
        due: Object.fromEntries(Object.entries(due).map(([t, items]) => [t, items.length])),
        pendingBringBacks: Array.isArray(pending.data) ? pending.data.length : 0,
      })
    }

    // 1. SEND.
    const sent = { archived: 0, removedOnline: 0, unconfirmed: 0 }
    for (const [tenantId, items] of Object.entries(due)) {
      for (const item of items) {
        const ref = await sendConfirmed(deps, tenantId, item).catch(() => null)
        if (!ref) { sent.unconfirmed++; continue }
        const marked = await deps.mark(item.item_type, item.item_id, ref)
        if (!marked) { sent.unconfirmed++; continue }
        sent.archived++
        if (marked.removeOnline && (await deps.storage!.remove(item.object_key).catch(() => false))) sent.removedOnline++
      }
    }

    // 2. BRING BACK.
    const back = { restored: 0, failed: 0 }
    const pr = await deps.pending(limit)
    const pending = z.array(PendingRequest).safeParse(pr.error ? [] : (pr.data ?? []))
    for (const request of pending.success ? pending.data : []) {
      let ok = true
      for (const item of request.items) {
        if (!item.object_key || !item.archive_ref) { ok = false; break }
        const src = await deps.transport!.get(item.archive_ref).catch(() => null)
        if (!src || !(await deps.storage!.put(item.object_key, src.body, src.size).catch(() => false))) { ok = false; break }
      }
      await deps.bringBackDone(request.request_id, ok, ok ? undefined : 'transfer from the office server failed')
      if (ok) back.restored++
      else back.failed++
    }

    // 3. RETURN OFFLINE.
    const offline = { returned: 0, errors: 0 }
    const ex = await deps.expired(limit)
    const expired = z.array(ExpiredItem).safeParse(ex.error ? [] : (ex.data ?? []))
    for (const item of expired.success ? expired.data : []) {
      let ok = true
      for (const key of item.object_keys) if (!(await deps.storage!.remove(key).catch(() => false))) ok = false
      if (ok) { await deps.clearBroughtBack(item.asset_id); offline.returned++ }
      else offline.errors++
    }

    return json(200, { disabled: false, sent, broughtBack: back, returnedOffline: offline })
  }
}
