import { createClient } from 'npm:@supabase/supabase-js@2'
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'
import { crypto as stdCrypto } from 'jsr:@std/crypto@1'
import { encodeHex } from 'jsr:@std/encoding@1/hex'
import { guarded } from '../_shared/http.ts'
import { objectUrl } from '../_shared/s3.ts'
import { createLibraryArchiveHandler } from './handler.ts'
import { createOfficeTransport, officeConfigured, type OfficeConfig } from './transport.ts'

/**
 * library-archive — a closed project's working files go to the office server (ADR-0136), on the
 * `archive-sweep` pattern: cron-invoked, `CRON_SECRET` in `x-cron-secret`, service role, no user session.
 *
 * SWITCHED OFF until the office server exists for it (d.7): without OFFICE_ARCHIVE_URL /
 * OFFICE_ARCHIVE_USER / OFFICE_ARCHIVE_SECRET — or without an adapter for OFFICE_ARCHIVE_KIND in
 * transport.ts, which none has yet — it answers `{ disabled: true }` and touches nothing.
 * `{ "dryRun": true }` lists what is due per tenant either way.
 *
 * Schedule: daily, once switched on. It supersedes `archive-sweep`, whose 60-day clock ADR-0136 d.1 retired
 * (its due set is now always empty — 20261002100000).
 *
 * Secrets: CRON_SECRET; B2_S3_ENDPOINT / B2_REGION / B2_BUCKET / B2_KEY_ID / B2_APP_KEY;
 * OFFICE_ARCHIVE_URL / OFFICE_ARCHIVE_USER / OFFICE_ARCHIVE_SECRET / OFFICE_ARCHIVE_KIND.
 */
Deno.serve(guarded({}, (req) => {
  // Service role: system work across every tenant with no caller; the RPCs are granted to service_role only.
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const office: OfficeConfig = {
    url: Deno.env.get('OFFICE_ARCHIVE_URL'),
    user: Deno.env.get('OFFICE_ARCHIVE_USER'),
    secret: Deno.env.get('OFFICE_ARCHIVE_SECRET'),
    kind: Deno.env.get('OFFICE_ARCHIVE_KIND'),
  }

  const endpoint = Deno.env.get('B2_S3_ENDPOINT')
  const region = Deno.env.get('B2_REGION')
  const bucket = Deno.env.get('B2_BUCKET')
  const keyId = Deno.env.get('B2_KEY_ID')
  const appKey = Deno.env.get('B2_APP_KEY')
  const aws = endpoint && region && bucket && keyId && appKey
    ? new AwsClient({ accessKeyId: keyId, secretAccessKey: appKey, region, service: 's3' })
    : null

  const storage = aws && endpoint && bucket ? {
    get: async (key: string) => {
      const res = await aws.fetch(objectUrl(endpoint, bucket, key).toString(), { method: 'GET' })
      if (!res.ok || !res.body) return null
      return { body: res.body, size: Number(res.headers.get('content-length') ?? '0') }
    },
    put: async (key: string, body: ReadableStream<Uint8Array>, size: number) => {
      const res = await aws.fetch(objectUrl(endpoint, bucket, key).toString(), {
        method: 'PUT', body, headers: { 'content-length': String(size) },
      })
      return res.ok
    },
    remove: async (key: string) => {
      const res = await aws.fetch(objectUrl(endpoint, bucket, key).toString(), { method: 'DELETE' })
      return res.ok || res.status === 404
    },
  } : null

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(fn, args)
    return { data, error: error ? { message: error.message } : null }
  }

  return createLibraryArchiveHandler({
    cronSecret: Deno.env.get('CRON_SECRET'),
    configured: officeConfigured(office),
    transport: createOfficeTransport(office),
    tenants: async () => {
      const { data } = await admin.from('tenants').select('id')
      return (data ?? []).map((t: { id: string }) => t.id)
    },
    dueItems: (tenantId, limit) => rpc('library_archive_due_items', { p_tenant: tenantId, p_limit: limit }),
    mark: async (itemType, itemId, ref) => {
      const r = await rpc('library_archive_mark', { p_item_type: itemType, p_item_id: itemId, p_ref: ref })
      return r.error ? null : { removeOnline: r.data === true }
    },
    pending: (limit) => rpc('library_bring_back_pending', { p_limit: limit }),
    bringBackDone: async (requestId, ok, error) => {
      await rpc('library_bring_back_done', { p_request: requestId, p_ok: ok, p_error: error ?? null })
    },
    expired: (limit) => rpc('library_brought_back_expired', { p_limit: limit }),
    clearBroughtBack: async (assetId) => {
      await rpc('library_brought_back_clear', { p_asset: assetId })
    },
    storage,
    // std's digest takes an async iterable and hashes as it reads — a 5 GB file is never held in memory.
    sha256: async (body) =>
      encodeHex(await stdCrypto.subtle.digest('SHA-256', body as unknown as AsyncIterable<Uint8Array<ArrayBuffer>>)),
  })(req)
}))
