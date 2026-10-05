import { createClient } from 'npm:@supabase/supabase-js@2'
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'
import { guarded } from '../_shared/http.ts'
import { objectUrl, parseListMultipartUploads, type PendingUpload } from '../_shared/s3.ts'
import { createLibrarySweepHandler } from './handler.ts'

/**
 * library-sweep — the Library's daily housekeeping (ADR-0134 d.9, d.13, d.18), on the `archive-sweep` /
 * `stall-sweep` pattern: cron-invoked, `CRON_SECRET` in `x-cron-secret`, service role, no user JWT.
 *
 * This is the FIRST code that deletes from B2 (ADR-0134 Consequences): only objects of files deleted more
 * than 30 days ago, and only keys no other row names (`public.library_sweep_purge_due`).
 *
 * Schedule: daily. `POST /functions/v1/library-sweep` with `x-cron-secret`; `{ "dryRun": true }` lists and
 * changes nothing. Behaviour lives in handler.ts (unit-tested); this file only wires the environment in.
 *
 * Secrets: CRON_SECRET; B2_S3_ENDPOINT / B2_REGION / B2_BUCKET / B2_KEY_ID / B2_APP_KEY (as asset-url).
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected. Without the B2 secrets the storage steps report
 * `storage_unconfigured` and nothing is removed; the link notices still go.
 */
Deno.serve(guarded({}, (req) => {
  // Service role: the sweep runs without a caller and crosses every tenant by design; the database
  // functions it calls are granted to service_role only.
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const endpoint = Deno.env.get('B2_S3_ENDPOINT')
  const region = Deno.env.get('B2_REGION')
  const bucket = Deno.env.get('B2_BUCKET')
  const keyId = Deno.env.get('B2_KEY_ID')
  const appKey = Deno.env.get('B2_APP_KEY')
  const aws = endpoint && region && bucket && keyId && appKey
    ? new AwsClient({ accessKeyId: keyId, secretAccessKey: appKey, region, service: 's3' })
    : null

  const storage = aws && endpoint && bucket ? {
    deleteObject: async (key: string) => {
      const res = await aws.fetch(objectUrl(endpoint, bucket, key).toString(), { method: 'DELETE' })
      return res.ok || res.status === 404
    },
    listUploads: async () => {
      const all: PendingUpload[] = []
      let keyMarker: string | null = null
      let idMarker: string | null = null
      for (let page = 0; page < 50; page++) {
        const u = new URL(`${endpoint.replace(/\/$/, '')}/${bucket}`)
        u.searchParams.set('uploads', '')
        if (keyMarker) u.searchParams.set('key-marker', keyMarker)
        if (idMarker) u.searchParams.set('upload-id-marker', idMarker)
        const res = await aws.fetch(u.toString(), { method: 'GET' })
        if (!res.ok) break
        const parsed = parseListMultipartUploads(await res.text())
        all.push(...parsed.uploads)
        if (!parsed.truncated) break
        keyMarker = parsed.nextKeyMarker
        idMarker = parsed.nextUploadIdMarker
      }
      return all
    },
    abortUpload: async (key: string, uploadId: string) => {
      const res = await aws.fetch(objectUrl(endpoint, bucket, key, { uploadId }).toString(), { method: 'DELETE' })
      return res.ok || res.status === 404
    },
  } : null

  return createLibrarySweepHandler({
    cronSecret: Deno.env.get('CRON_SECRET'),
    linkNotices: async (dryRun) => {
      const { data, error } = await admin.rpc('library_sweep_link_notices', { p_dry_run: dryRun })
      return { data, error: error ? { message: error.message } : null }
    },
    purgeDue: async (limit) => {
      const { data, error } = await admin.rpc('library_sweep_purge_due', { p_limit: limit })
      return { data, error: error ? { message: error.message } : null }
    },
    purgeConfirm: async (assetId) => {
      const { data, error } = await admin.rpc('library_sweep_purge_confirm', { p_asset: assetId })
      return !error && data === true
    },
    storage,
    now: () => new Date(),
  })(req)
}))
