// asset-url — mints short-lived, presigned Backblaze B2 (S3-compatible) URLs for the Library (ADR-0022,
// ADR-0134). The browser never holds the bucket credentials and never proxies bytes through the app; it
// PUT/GETs straight to B2 with a URL that expires in minutes.
//
// The function SIGNS and, for a copy, asks B2 to copy server-side. Every asset ROW (name, object_key, size,
// version) is written by the client through RLS and the library_* RPCs after the bytes are in place, so the
// database stays the audited source of truth.
//
// Ops (body parsed with Zod — lib.ts):
//   upload            {folderId, fileName, contentType?, size?}   one presigned PUT; > 5 GB refused (413)
//   multipart_create  {folderId, fileName, contentType, size}     → {uploadId, objectKey}   (d.13)
//   multipart_sign    {objectKey, uploadId, partNumbers[]}        → {urls: [{partNumber, url}]}
//   multipart_complete{objectKey, uploadId, parts[{partNumber, etag}]}
//   multipart_abort   {objectKey, uploadId}
//   thumb_upload      {objectKey}                                 → presigned PUT for <key>.thumb.webp (d.26)
//   thumb_url         {assetId}                                   → presigned GET of its picture, 60 min
//   download          {assetId, version?}                         → attachment GET of that version
//   preview           {assetId}                                   → inline GET (d.6)
//   copy              {assetId, folderId}                         → server-side copy into the folder (d.10)
//
// Authorization (ADR-0037 — the one call path): reading is decided by RLS, so every asset / folder / version
// is read through the CALLER-scoped client (a deleted file the caller may not bring back simply is not
// there). Changing is `public.library_can_change(client)` — assets:manage AND the client within reach
// (ADR-0134 d.2) — asked through the same caller client. An upload into a folder asks
// `public.library_can_add(folder)`: the same rule, plus a deliverable's owner in that deliverable's own
// folder (I74.28). The service role is not used at all.
//
// The browser must read each part's ETag from B2's response to complete a multipart upload, so the bucket's
// CORS rule has to EXPOSE `ETag` (docs/RUNBOOK.md, "Library uploads in parts").
//
// Secrets (Supabase → Edge Functions → Secrets), set by Edward, never seen by the app:
//   B2_S3_ENDPOINT, B2_REGION, B2_BUCKET, B2_KEY_ID, B2_APP_KEY
//
// Deploy: `supabase functions deploy asset-url`
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { hasPermission } from '../_shared/authz.ts'
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'
import { guarded } from '../_shared/http.ts'
import { contentDisposition } from '../_shared/download-name.ts'
import { completeMultipartXml, objectUrl, parseUploadId, s3ErrorCode, encodeKey } from '../_shared/s3.ts'
import { Input, MAX_UPLOAD_BYTES, isOffline, objectKeyFor, parseKey, thumbKeyOf, type InputT } from './lib.ts'

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
const PART_TTL = 3600 // a part of a big file on a slow line can take a while
const DOWNLOAD_TTL = 900
const THUMB_TTL = 3600

Deno.serve(guarded(corsHeaders, async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return err(405, 'method_not_allowed', 'POST only')

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  const endpoint = Deno.env.get('B2_S3_ENDPOINT')
  const region = Deno.env.get('B2_REGION')
  const bucket = Deno.env.get('B2_BUCKET')
  const keyId = Deno.env.get('B2_KEY_ID')
  const appKey = Deno.env.get('B2_APP_KEY')
  if (!endpoint || !region || !bucket || !keyId || !appKey)
    return err(503, 'storage_unconfigured', 'B2 storage is not configured yet')

  // 1. Authenticate the caller.
  const authHeader = req.headers.get('authorization') ?? ''
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: callerData, error: callerErr } = await caller.auth.getUser()
  if (callerErr || !callerData.user) return err(401, 'unauthenticated', 'Sign in required')

  const meta = (callerData.user.app_metadata ?? {}) as Record<string, unknown>
  const callerTenant = typeof meta.tenant_id === 'string' ? meta.tenant_id.toLowerCase() : null
  const callerRoleId = typeof meta.app_role_id === 'string' ? meta.app_role_id : null
  if (!callerTenant || !callerRoleId) return err(403, 'forbidden', 'No role claim')

  // 2. Parse — client input is hostile (AGENTS.md §5).
  let body: InputT
  try {
    const parsed = Input.safeParse(await req.json())
    if (!parsed.success) return err(400, 'bad_request', 'Invalid input')
    body = parsed.data
  } catch {
    return err(400, 'bad_request', 'Invalid JSON body')
  }

  // ADR-0037: both axes through THE primitives, on the CALLER-scoped client.
  const hasGrant = (resource: string, action: string) => hasPermission(caller, resource, action)
  const canChange = async (clientId: string) => {
    const { data, error } = await caller.rpc('library_can_change', { p_client: clientId })
    return !error && data === true
  }
  /** I74.28: may the caller add files to THIS folder — the reach rule, or her own deliverable's folder. */
  const canAdd = async (folderId: string) => {
    const { data, error } = await caller.rpc('library_can_add', { p_folder: folderId })
    return !error && data === true
  }

  const aws = new AwsClient({ accessKeyId: keyId, secretAccessKey: appKey, region, service: 's3' })
  // Query parameters must be set BEFORE signing: they are part of what the signature covers.
  const presign = async (
    objectKey: string, method: 'PUT' | 'GET', ttl: number,
    opts: { disposition?: string; query?: Record<string, string> } = {},
  ) => {
    const u = objectUrl(endpoint, bucket, objectKey, opts.query ?? {})
    u.searchParams.set('X-Amz-Expires', String(ttl))
    if (opts.disposition) u.searchParams.set('response-content-disposition', opts.disposition)
    const signed = await aws.sign(u.toString(), { method, aws: { signQuery: true } })
    return signed.url
  }

  /**
   * A folder the caller can see, in their tenant, whose client they may change — or, for an upload
   * (`adding`), one they may add to: a deliverable's owner in its own folder (I74.28).
   */
  const changeableFolder = async (folderId: string, adding = false) => {
    const { data: folder } = await caller
      .from('asset_folders').select('id, tenant_id, client_id').eq('id', folderId).maybeSingle()
    if (!folder || String(folder.tenant_id).toLowerCase() !== callerTenant) return { error: err(404, 'not_found', 'Folder not found') }
    if (!(await (adding ? canAdd(folder.id) : canChange(folder.client_id)))) return { error: err(403, 'forbidden', 'You cannot change this client\'s files') }
    return { folder: folder as { id: string; tenant_id: string; client_id: string } }
  }

  /**
   * An upload key the caller minted for a client they may still change — or, for a deliverable's owner
   * (I74.28), for a folder of that client she may still add to.
   */
  const changeableKey = async (key: string) => {
    const parsed = parseKey(key)
    if (!parsed || parsed.tenantId !== callerTenant) return err(404, 'not_found', 'Upload not found')
    if (await canChange(parsed.clientId)) return null
    const { data: folder } = await caller
      .from('asset_folders').select('id, client_id').eq('id', parsed.folderId).maybeSingle()
    if (folder && String(folder.client_id).toLowerCase() === parsed.clientId && (await canAdd(parsed.folderId))) return null
    return err(403, 'forbidden', 'You cannot change this client\'s files')
  }

  /** An asset as the caller may see it (RLS: tenant + assets:view; a deleted one only for the three). */
  const visibleAsset = async (assetId: string) => {
    const { data } = await caller
      .from('assets')
      .select('id, tenant_id, folder_id, name, object_key, thumb_object_key, content_type, current_version, archived_at, brought_back_until, provider')
      .eq('id', assetId).maybeSingle()
    if (!data || String(data.tenant_id).toLowerCase() !== callerTenant) return null
    return data as {
      id: string; tenant_id: string; folder_id: string; name: string; object_key: string | null
      thumb_object_key: string | null; content_type: string | null; current_version: number
      archived_at: string | null; brought_back_until: string | null; provider: string
    }
  }

  const tooBig = () => err(413, 'too_big', 'This file is over 5 GB — share a link instead')

  switch (body.op) {
    case 'upload': {
      if (body.size !== undefined && body.size > MAX_UPLOAD_BYTES) return tooBig()
      const r = await changeableFolder(body.folderId, true)
      if (r.error) return r.error
      const objectKey = objectKeyFor(callerTenant, r.folder.client_id, r.folder.id, body.fileName, crypto.randomUUID())
      const uploadUrl = await presign(objectKey, 'PUT', UPLOAD_TTL)
      return json(200, { uploadUrl, objectKey, provider: 'b2', expiresIn: UPLOAD_TTL })
    }

    case 'multipart_create': {
      if (body.size > MAX_UPLOAD_BYTES) return tooBig()
      const r = await changeableFolder(body.folderId, true)
      if (r.error) return r.error
      const objectKey = objectKeyFor(callerTenant, r.folder.client_id, r.folder.id, body.fileName, crypto.randomUUID())
      const res = await aws.fetch(objectUrl(endpoint, bucket, objectKey, { uploads: '' }).toString(), {
        method: 'POST',
        headers: { 'content-type': body.contentType || 'application/octet-stream' },
      })
      const xml = await res.text()
      const uploadId = res.ok ? parseUploadId(xml) : null
      if (!uploadId) {
        console.error('multipart_create failed', res.status, s3ErrorCode(xml))
        return err(502, 'storage_failed', 'The upload could not be started')
      }
      return json(200, { uploadId, objectKey, provider: 'b2' })
    }

    case 'multipart_sign': {
      const refused = await changeableKey(body.objectKey)
      if (refused) return refused
      const urls = await Promise.all(body.partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await presign(body.objectKey, 'PUT', PART_TTL, {
          query: { partNumber: String(partNumber), uploadId: body.uploadId },
        }),
      })))
      return json(200, { urls, expiresIn: PART_TTL })
    }

    case 'multipart_complete': {
      const refused = await changeableKey(body.objectKey)
      if (refused) return refused
      const res = await aws.fetch(objectUrl(endpoint, bucket, body.objectKey, { uploadId: body.uploadId }).toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/xml' },
        body: completeMultipartXml(body.parts),
      })
      const xml = await res.text()
      if (!res.ok || s3ErrorCode(xml)) {
        console.error('multipart_complete failed', res.status, s3ErrorCode(xml))
        return err(502, 'storage_failed', 'The upload could not be finished')
      }
      return json(200, { objectKey: body.objectKey, provider: 'b2' })
    }

    case 'multipart_abort': {
      const refused = await changeableKey(body.objectKey)
      if (refused) return refused
      const res = await aws.fetch(objectUrl(endpoint, bucket, body.objectKey, { uploadId: body.uploadId }).toString(), {
        method: 'DELETE',
      })
      // 404: already gone (aborted, completed, or cleared by the bucket's lifecycle rule) — the same outcome.
      if (!res.ok && res.status !== 404) return err(502, 'storage_failed', 'The upload could not be cancelled')
      return json(200, { aborted: true })
    }

    case 'thumb_upload': {
      const refused = await changeableKey(body.objectKey)
      if (refused) return refused
      const thumbObjectKey = thumbKeyOf(body.objectKey)
      const uploadUrl = await presign(thumbObjectKey, 'PUT', UPLOAD_TTL)
      return json(200, { uploadUrl, thumbObjectKey, expiresIn: UPLOAD_TTL })
    }

    case 'thumb_url': {
      if (!(await hasGrant('assets', 'view'))) return err(403, 'forbidden', 'assets:view grant required')
      const asset = await visibleAsset(body.assetId)
      if (!asset) return err(404, 'not_found', 'Asset not found')
      if (!asset.thumb_object_key) return err(404, 'no_thumb', 'This file has no picture')
      const url = await presign(asset.thumb_object_key, 'GET', THUMB_TTL)
      return json(200, { url, expiresIn: THUMB_TTL })
    }

    case 'download':
    case 'preview': {
      if (!(await hasGrant('assets', 'view'))) return err(403, 'forbidden', 'assets:view grant required')
      const asset = await visibleAsset(body.assetId)
      if (!asset) return err(404, 'not_found', 'Asset not found')
      const version = body.op === 'download' && body.version ? body.version : asset.current_version
      const { data: v } = await caller
        .from('asset_versions').select('object_key, archived_at')
        .eq('asset_id', asset.id).eq('version', version).maybeSingle()
      // Rows filed before versions were kept may have none; the current version is then the asset's own key.
      const key = (v?.object_key as string | null | undefined) ?? (version === asset.current_version ? asset.object_key : null)
      if (!v && version !== asset.current_version) return err(404, 'not_found', 'Version not found')
      if (!key) return err(409, 'no_object', 'This version has no stored file (a link, or not uploaded yet)')
      if (isOffline((v?.archived_at as string | null | undefined) ?? null, asset.brought_back_until, new Date()))
        return err(409, 'archived', 'This file is archived on the office server — bring it back first')
      const disposition = contentDisposition(asset.name, body.op === 'preview' ? 'inline' : 'attachment')
      const downloadUrl = await presign(key, 'GET', DOWNLOAD_TTL, { disposition })
      return json(200, { downloadUrl, contentType: asset.content_type, expiresIn: DOWNLOAD_TTL })
    }

    case 'copy': {
      const asset = await visibleAsset(body.assetId)
      if (!asset) return err(404, 'not_found', 'Asset not found')
      const r = await changeableFolder(body.folderId)
      if (r.error) return r.error
      const { data: source } = await caller
        .from('asset_folders').select('client_id').eq('id', asset.folder_id).maybeSingle()
      if (!source || source.client_id !== r.folder.client_id)
        return err(403, 'another_client', 'A file is copied within its own client only')
      if (!asset.object_key) return json(200, { objectKey: null, thumbObjectKey: null }) // a link: nothing stored
      if (asset.archived_at && isOffline(asset.archived_at, asset.brought_back_until, new Date()))
        return err(409, 'archived', 'This file is archived on the office server — bring it back first')

      const copyObject = async (from: string, to: string) => {
        const res = await aws.fetch(objectUrl(endpoint, bucket, to).toString(), {
          method: 'PUT',
          headers: { 'x-amz-copy-source': `/${bucket}/${encodeKey(from)}` },
        })
        const xml = await res.text()
        return res.ok && !s3ErrorCode(xml)
      }
      const objectKey = objectKeyFor(callerTenant, r.folder.client_id, r.folder.id, asset.name, crypto.randomUUID())
      if (!(await copyObject(asset.object_key, objectKey))) return err(502, 'storage_failed', 'The file could not be copied')
      // The picture is a convenience: a copy without one shows its kind tile (d.26), so its failure is not the copy's.
      let thumbObjectKey: string | null = null
      if (asset.thumb_object_key && (await copyObject(asset.thumb_object_key, thumbKeyOf(objectKey))))
        thumbObjectKey = thumbKeyOf(objectKey)
      return json(200, { objectKey, thumbObjectKey })
    }
  }
}))
