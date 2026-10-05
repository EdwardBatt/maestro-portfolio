import { z } from 'npm:zod@4'
import { staleUploads, type PendingUpload } from '../_shared/s3.ts'

/**
 * library-sweep's behaviour, with its runtime injected so Vitest can reach it (the stall-sweep pattern).
 * `index.ts` only wires Deno.env, the service-role client and the B2 signer in.
 *
 * Daily (ADR-0134):
 *   1. LINK NOTICES (d.18) — a link that expires within two days: its adder is told once, bell and email
 *      (the email follows the notification row through notify-email, as every other notice's does).
 *   2. PURGE (d.9) — files deleted more than 30 days ago: every object only they name is deleted from B2,
 *      THEN the row goes. A file whose objects could not all be deleted keeps its row and is retried.
 *   3. HALF-FINISHED UPLOADS (d.13) — multipart uploads begun more than 24 hours ago are aborted. B2's
 *      lifecycle rule does the same after a day; this makes the 24 hours Maestro's promise, not the bucket's.
 *
 * `{ "dryRun": true }` lists what each step would do and changes nothing.
 */

export const Input = z.object({
  dryRun: z.boolean().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
})

export const LinkNotice = z.object({
  asset_id: z.string(), user_id: z.string(), name: z.string(), expires_on: z.string(),
}).passthrough()
export const PurgeItem = z.object({
  asset_id: z.string(), tenant_id: z.string(), object_keys: z.array(z.string()),
}).passthrough()

export interface LibrarySweepDeps {
  cronSecret: string | undefined
  /** `public.library_sweep_link_notices(p_dry_run)` under the service role. */
  linkNotices: (dryRun: boolean) => Promise<{ data: unknown; error: { message: string } | null }>
  /** `public.library_sweep_purge_due(p_limit)`. */
  purgeDue: (limit: number) => Promise<{ data: unknown; error: { message: string } | null }>
  /** `public.library_sweep_purge_confirm(p_asset)` — the row goes once its objects are gone. */
  purgeConfirm: (assetId: string) => Promise<boolean>
  /** Null when B2 is not configured: the storage steps are then reported skipped, never faked. */
  storage: {
    deleteObject: (key: string) => Promise<boolean>
    listUploads: () => Promise<PendingUpload[]>
    abortUpload: (key: string, uploadId: string) => Promise<boolean>
  } | null
  now: () => Date
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const err = (status: number, code: string, message: string) => json(status, { error: { code, message } })

export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ba = enc.encode(a)
  const bb = enc.encode(b)
  if (ba.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ba.length; i++) diff |= ba[i]! ^ bb[i]!
  return diff === 0
}

export function createLibrarySweepHandler(deps: LibrarySweepDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return err(405, 'method_not_allowed', 'POST only')

    const presented = req.headers.get('x-cron-secret') ?? ''
    if (!deps.cronSecret || !timingSafeEqual(presented, deps.cronSecret))
      return err(401, 'unauthenticated', 'Invalid or missing cron secret')

    const parsed = Input.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return err(400, 'bad_request', 'Invalid input')
    const dryRun = parsed.data.dryRun === true
    const limit = parsed.data.limit ?? 200

    // 1. Link notices.
    const ln = await deps.linkNotices(dryRun)
    if (ln.error) return err(500, 'sweep_failed', 'Could not read the links due')
    const notices = z.array(LinkNotice).safeParse(ln.data ?? [])
    if (!notices.success) return err(500, 'sweep_failed', 'Unexpected link-notice result')

    // 2. Purge.
    const pd = await deps.purgeDue(limit)
    if (pd.error) return err(500, 'sweep_failed', 'Could not read the files due for removal')
    const due = z.array(PurgeItem).safeParse(pd.data ?? [])
    if (!due.success) return err(500, 'sweep_failed', 'Unexpected purge result')

    const purge = { due: due.data.length, purged: 0, errors: 0, skipped: null as string | null }
    if (!dryRun) {
      if (!deps.storage) {
        purge.skipped = 'storage_unconfigured'
      } else {
        for (const item of due.data) {
          let ok = true
          for (const key of item.object_keys) {
            if (!(await deps.storage.deleteObject(key).catch(() => false))) ok = false
          }
          // Never drop the row while an object it names may still be in storage: retried next run.
          if (ok && (await deps.purgeConfirm(item.asset_id).catch(() => false))) purge.purged++
          else purge.errors++
        }
      }
    }

    // 3. Half-finished uploads.
    const uploads = { stale: 0, aborted: 0, errors: 0, skipped: null as string | null }
    if (!deps.storage) {
      uploads.skipped = 'storage_unconfigured'
    } else {
      const stale = staleUploads(await deps.storage.listUploads().catch(() => []), deps.now(), 24)
      uploads.stale = stale.length
      if (!dryRun) {
        for (const u of stale) {
          if (await deps.storage.abortUpload(u.key, u.uploadId).catch(() => false)) uploads.aborted++
          else uploads.errors++
        }
      }
    }

    return json(200, {
      dryRun,
      linkNotices: { count: notices.data.length, sent: dryRun ? 0 : notices.data.length },
      purge: { ...purge, assets: dryRun ? due.data.map((d) => d.asset_id) : undefined },
      uploads,
    })
  }
}
