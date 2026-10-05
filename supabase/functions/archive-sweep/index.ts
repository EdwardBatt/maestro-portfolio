// archive-sweep — ADR-0023 internal-round retention job.
//
// Relocates internal review rounds that are past their retention window off the hot store to
// the tenant's configured ARCHIVE target (cloud B2/R2 now; on-prem local later), then flips
// retention_state → archived / storage_tier → cold. Postgres metadata (media_records +
// review_feedback) is never touched — provenance is permanent regardless of where bytes live.
//
// Invoked on a schedule (Supabase scheduled function / external cron), NOT by end users. There
// is no user JWT; the caller proves itself with a shared CRON_SECRET header. Uses the
// service-role client because the sweep is cross-tenant system work that must read/write rows
// no single user owns — the ONLY privileged step, and it authorizes via the shared secret
// before doing anything.
//
// Idempotent by construction: the due-set query only returns retention_state='active',
// delivered_at IS NULL rows, so an already-archived (or since-delivered) round drops out — a
// retried or overlapping run cannot double-archive.
//
// Secrets (Supabase → Edge Functions → Secrets; set by Edward, never in code/logs):
//   CRON_SECRET            shared secret the scheduler sends as `x-cron-secret`
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY   (auto-injected)
//   B2_S3_ENDPOINT / B2_REGION / B2_KEY_ID / B2_APP_KEY   active bucket creds (see asset-url)
//   B2_BUCKET              active/hot bucket
//   B2_ARCHIVE_BUCKET      cloud archive bucket (may equal B2_BUCKET; objects go under archive/)
// Local (on-prem) archiving is gated on the per-tenant endpoint contract (ADR-0023 open item)
// and stays a documented follow-up (ADR-0016/0022 residency pattern); rows for a 'local'-target
// tenant are reported skipped until that lands, never force-flipped.
//
// Deploy: `supabase functions deploy archive-sweep`
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'
import { z } from 'https://esm.sh/zod@3.23.8'
import { guarded } from '../_shared/http.ts'

type ErrorBody = { error: { code: string; message: string } }
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const err = (status: number, code: string, message: string) =>
  json(status, { error: { code, message } } satisfies ErrorBody)

// Exported so unit tests can reuse the schema (maestro-edge-function).
export const Input = z.object({
  limit: z.number().int().min(1).max(1000).optional(),
  dryRun: z.boolean().optional(),
})

// Constant-time string compare — avoids a timing oracle on the shared cron secret.
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ba = enc.encode(a)
  const bb = enc.encode(b)
  if (ba.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i]
  return diff === 0
}

Deno.serve(guarded({}, async (req) => {
  if (req.method !== 'POST') return err(405, 'method_not_allowed', 'POST only')

  // Authorize the scheduler. No user context — a shared secret gates this system route.
  const cronSecret = Deno.env.get('CRON_SECRET')
  const presented = req.headers.get('x-cron-secret') ?? ''
  if (!cronSecret || !timingSafeEqual(presented, cronSecret))
    return err(401, 'unauthenticated', 'Invalid or missing cron secret')

  let parsed: z.infer<typeof Input>
  try { parsed = Input.parse(await req.json().catch(() => ({}))) }
  catch { return err(400, 'bad_request', 'Invalid input') }
  const limit = parsed.limit ?? 100
  const dryRun = parsed.dryRun ?? false

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, serviceKey)

  // Due set — same predicate as app.media_records_due_for_archive(): undelivered, active,
  // past archive_due_at. Expressed as PostgREST filters (no dynamic SQL).
  const nowIso = new Date().toISOString()
  const { data: due, error: dueErr } = await admin
    .from('media_records')
    .select('id, tenant_id, provider, object_key, storage_tier, retention_state')
    .eq('retention_state', 'active')
    .is('delivered_at', null)
    .not('archive_due_at', 'is', null)
    .lte('archive_due_at', nowIso)
    .order('archive_due_at', { ascending: true })
    .limit(limit)
  if (dueErr) return err(500, 'query_failed', 'Could not read the due set')

  const rows = due ?? []
  if (dryRun) return json(200, { dryRun: true, due: rows.length, ids: rows.map((r) => r.id) })

  // Per-tenant archive target (cloud|local + provider/location). Cache per tenant.
  const settingsCache = new Map<string, { archive_target: string; archive_provider: string | null; archive_location: string | null }>()
  const getSettings = async (tenantId: string) => {
    if (settingsCache.has(tenantId)) return settingsCache.get(tenantId)!
    const { data } = await admin
      .from('tenant_storage_settings')
      .select('archive_target, archive_provider, archive_location')
      .eq('tenant_id', tenantId).maybeSingle()
    const s = data ?? { archive_target: 'cloud', archive_provider: null, archive_location: null }
    settingsCache.set(tenantId, s)
    return s
  }

  // Cloud archive via S3 server-side copy into the archive bucket under an archive/ prefix,
  // then (optionally) the hot copy can be lifecycled out separately. Same bytes, referenced
  // object_key is preserved — the DB row keeps pointing at the moved key's logical path.
  const endpoint = Deno.env.get('B2_S3_ENDPOINT')
  const region = Deno.env.get('B2_REGION')
  const keyId = Deno.env.get('B2_KEY_ID')
  const appKey = Deno.env.get('B2_APP_KEY')
  const hotBucket = Deno.env.get('B2_BUCKET')
  const archiveBucket = Deno.env.get('B2_ARCHIVE_BUCKET') ?? hotBucket
  const cloudReady = Boolean(endpoint && region && keyId && appKey && hotBucket && archiveBucket)
  const aws = cloudReady
    ? new AwsClient({ accessKeyId: keyId!, secretAccessKey: appKey!, region: region!, service: 's3' })
    : null

  const enc = (k: string) => k.split('/').map(encodeURIComponent).join('/')
  const copyToCloudArchive = async (objectKey: string) => {
    const dest = `archive/${objectKey}`
    const u = `${endpoint!.replace(/\/$/, '')}/${archiveBucket}/${enc(dest)}`
    const res = await aws!.fetch(u, {
      method: 'PUT',
      headers: { 'x-amz-copy-source': `/${hotBucket}/${enc(objectKey)}` },
    })
    if (!res.ok) throw new Error(`archive copy failed (${res.status})`)
    return dest
  }

  const results = { swept: rows.length, archived: 0, skipped: 0, errors: 0 as number, detail: [] as unknown[] }

  for (const row of rows) {
    try {
      const settings = await getSettings(row.tenant_id)

      // Local (on-prem) target: gated on the per-tenant endpoint contract (ADR-0023 open item).
      // Report and move on; never flip state without a confirmed relocation.
      if (settings.archive_target === 'local') {
        results.skipped++
        results.detail.push({ id: row.id, status: 'skipped', reason: 'local_archive_pending_contract' })
        continue
      }
      if (!cloudReady) {
        results.skipped++
        results.detail.push({ id: row.id, status: 'skipped', reason: 'cloud_archive_unconfigured' })
        continue
      }
      if (!row.object_key) {
        // Nothing stored (metadata-only round) — just flip state; there are no bytes to move.
        await admin.from('media_records')
          .update({ retention_state: 'archived', storage_tier: 'cold' }).eq('id', row.id)
        results.archived++
        results.detail.push({ id: row.id, status: 'archived', note: 'no_object' })
        continue
      }

      await copyToCloudArchive(row.object_key)
      // Relocation confirmed → flip state. object_key is left as the logical key; the archived
      // copy lives under archive/<key> in the archive bucket. (A later hot-bucket lifecycle rule
      // reclaims the hot copy; not this job's concern.)
      const { error: updErr } = await admin.from('media_records')
        .update({ retention_state: 'archived', storage_tier: 'cold' }).eq('id', row.id)
      if (updErr) throw new Error('state flip failed after copy')
      results.archived++
      results.detail.push({ id: row.id, status: 'archived' })
    } catch (_e) {
      // Never leak internals to the caller; the row stays 'active' and is retried next run.
      results.errors++
      results.detail.push({ id: row.id, status: 'error' })
    }
  }

  return json(200, results)
}))
