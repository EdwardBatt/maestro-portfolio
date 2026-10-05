// review-media — mints short-lived, presigned Backblaze B2 (S3-compatible) URLs for uploading
// and viewing INTERNAL review versions on a deliverable (ADR-0025 / I3.1). The browser never
// holds the bucket credentials and never proxies bytes through the app; it PUT/GETs straight to
// B2 with a URL that expires in minutes.
//
// The function ONLY signs. The media_records ROW (object_key, content_type, size) is written by
// the client through normal RLS (media:manage) after a successful upload; the DB stamps `version`
// (trigger, ADR-0025) and the universal audit logs it. Mirrors asset-url (ADR-0022) — same secrets,
// same signing — but scoped to a deliverable's internal review chain, never the Library/portal.
//
// Auth: caller's JWT is verified; upload requires the `media:manage` grant; view requires only that
// the media_records row is in the caller's tenant (reads are tenant-wide). Tenant comes from the
// caller's claims, never the request, and the target deliverable/record is confirmed in-tenant.
//
// Secrets (Supabase → Edge Functions → Secrets), set by Edward, never seen by the app:
//   B2_S3_ENDPOINT   e.g. https://s3.us-west-004.backblazeb2.com
//   B2_REGION        e.g. us-west-004
//   B2_BUCKET        e.g. maestro-assets
//   B2_KEY_ID        S3-compatible application keyID (access key)
//   B2_APP_KEY       S3-compatible application key (secret)
//
// Deploy: `supabase functions deploy review-media`
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { hasPermission } from '../_shared/authz.ts'
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'
import { guarded } from '../_shared/http.ts'
import { contentDisposition, nameFromObjectKey, versionedName } from '../_shared/download-name.ts'

type ErrorBody = { error: { code: string; message: string } }
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...corsHeaders } })
const err = (status: number, code: string, message: string) =>
  json(status, { error: { code, message } } satisfies ErrorBody)

const UPLOAD_TTL = 900 // 15 min
const VIEW_TTL = 900

function sanitize(name: string): string {
  return name.replace(/[^\w.\-]+/g, '_').slice(0, 180) || 'file'
}

Deno.serve(guarded(corsHeaders, async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return err(405, 'method_not_allowed', 'POST only')

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const endpoint = Deno.env.get('B2_S3_ENDPOINT')
  const region = Deno.env.get('B2_REGION')
  const bucket = Deno.env.get('B2_BUCKET')
  const keyId = Deno.env.get('B2_KEY_ID')
  const appKey = Deno.env.get('B2_APP_KEY')
  if (!endpoint || !region || !bucket || !keyId || !appKey)
    return err(503, 'storage_unconfigured', 'B2 storage is not configured yet')

  // 1. Authenticate the caller.
  const authHeader = req.headers.get('authorization') ?? ''
  const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: callerData, error: callerErr } = await callerClient.auth.getUser()
  if (callerErr || !callerData.user) return err(401, 'unauthenticated', 'Sign in required')

  const meta = (callerData.user.app_metadata ?? {}) as Record<string, unknown>
  const callerTenant = typeof meta.tenant_id === 'string' ? meta.tenant_id : null
  const callerRoleId = typeof meta.app_role_id === 'string' ? meta.app_role_id : null
  if (!callerTenant || !callerRoleId) return err(403, 'forbidden', 'No role claim')

  let body: { op?: string; deliverableId?: string; fileName?: string; contentType?: string; mediaRecordId?: string }
  try { body = await req.json() } catch { return err(400, 'bad_request', 'Invalid JSON body') }
  const op = body.op

  const admin = createClient(url, serviceKey)
  // ADR-0037: resolve the permission axis through THE primitive, on the CALLER-scoped client —
  // the service-role client above has no auth.uid() and would resolve every grant to false.
  const hasGrant = (resource: string, action: string) => hasPermission(callerClient, resource, action)
  const aws = new AwsClient({ accessKeyId: keyId, secretAccessKey: appKey, region, service: 's3' })
  const presign = async (objectKey: string, method: 'PUT' | 'GET', ttl: number) => {
    const u = new URL(`${endpoint.replace(/\/$/, '')}/${bucket}/${objectKey.split('/').map(encodeURIComponent).join('/')}`)
    u.searchParams.set('X-Amz-Expires', String(ttl))
    const signed = await aws.sign(u.toString(), { method, aws: { signQuery: true } })
    return signed.url
  }

  if (op === 'upload') {
    if (!body.deliverableId || !body.fileName) return err(400, 'bad_request', 'deliverableId and fileName required')
    if (!(await hasGrant('media', 'manage'))) return err(403, 'forbidden', 'media:manage grant required')

    // Confirm the deliverable is in the caller's tenant before signing.
    const { data: deliverable } = await admin
      .from('deliverables').select('id, tenant_id')
      .eq('id', body.deliverableId).maybeSingle()
    if (!deliverable || deliverable.tenant_id !== callerTenant) return err(404, 'not_found', 'Deliverable not found')

    // object_key keyed on tenant → deliverable; the version lives on the row (stamped by trigger),
    // and a uuid keeps keys unique without a read-modify race here.
    const objectKey = `${callerTenant}/${deliverable.id}/${crypto.randomUUID()}-${sanitize(body.fileName)}`
    const uploadUrl = await presign(objectKey, 'PUT', UPLOAD_TTL)
    return json(200, { uploadUrl, objectKey, provider: 'b2', expiresIn: UPLOAD_TTL })
  }

  if (op === 'view') {
    if (!body.mediaRecordId) return err(400, 'bad_request', 'mediaRecordId required')
    const { data: rec } = await admin
      .from('media_records').select('id, tenant_id, object_key, file_name, version')
      .eq('id', body.mediaRecordId).maybeSingle()
    if (!rec || rec.tenant_id !== callerTenant) return err(404, 'not_found', 'Version not found')
    if (!rec.object_key) return err(409, 'no_object', 'Version has no stored file yet')

    const viewUrl = await presign(rec.object_key, 'GET', VIEW_TTL)

    // A second URL that forces a download rather than a preview. It carried `attachment` with
    // NO filename, which is barely better than nothing: the browser then names the file after
    // the last path segment and the caller sees the uuid key.
    //
    // `file_name` is the name the person uploaded (I35.7). Rows written before that column
    // existed have none, and the sanitised copy inside the object key is then the only trace of
    // it — a recovery, not the original, which is why the fallback is not the primary path. The
    // version is appended either way, so two rounds of one file never arrive under one name.
    const downloadName = versionedName(
      rec.file_name || nameFromObjectKey(rec.object_key),
      rec.version,
    )
    const uDl = new URL(`${endpoint.replace(/\/$/, '')}/${bucket}/${rec.object_key.split('/').map(encodeURIComponent).join('/')}`)
    uDl.searchParams.set('X-Amz-Expires', String(VIEW_TTL))
    uDl.searchParams.set('response-content-disposition', contentDisposition(downloadName))
    const signedDl = await aws.sign(uDl.toString(), { method: 'GET', aws: { signQuery: true } })

    return json(200, { viewUrl, downloadUrl: signedDl.url, expiresIn: VIEW_TTL })
  }

  return err(400, 'bad_op', "op must be 'upload' or 'view'")
}))
